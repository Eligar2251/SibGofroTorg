-- Experimental, owner-mediated, single-target merge primitive.
-- Depends on migration_complete_app_backup.sql and migration_pc_incremental_backup.sql.
-- This migration does not enable replication or modify application rows.
-- Only a service-role server may call it. The caller must establish a common
-- ancestor, check the PC's source identity and present a conflict-free plan.
-- This RPC cannot make a transaction atomic across different Supabase servers.
CREATE TABLE IF NOT EXISTS sgt_pc_backup.merge_receipts (
  operation_id uuid PRIMARY KEY,
  instance_id text NOT NULL,
  payload_hash text NOT NULL,
  applied_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON sgt_pc_backup.merge_receipts FROM PUBLIC, anon, authenticated;

-- Build an indexed, typed primary-key predicate from server catalog metadata.
CREATE OR REPLACE FUNCTION sgt_pc_backup.merge_key_predicate(p_table text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
  SELECT string_agg(format('x.%1$I = k.%1$I',a.attname),' AND ' ORDER BY kx.ordinality)
  FROM pg_index i JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  JOIN unnest(i.indkey) WITH ORDINALITY kx(attnum,ordinality) ON true
  JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=kx.attnum
  WHERE n.nspname='public' AND r.relname=p_table AND i.indisprimary AND i.indnkeyatts=i.indnatts
$$;
REVOKE ALL ON FUNCTION sgt_pc_backup.merge_key_predicate(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sgt_pc_apply_changes(
  p_instance text, p_catalog_hash text, p_operation_id uuid, p_changes jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,sgt_pc_backup
SET lock_timeout='5s'
AS $$
DECLARE
  current_instance text; previous sgt_pc_backup.merge_receipts%ROWTYPE;
  payload_hash text; c jsonb; t record; tbl text; key_data jsonb;
  old_row jsonb; new_row jsonb; actual jsonb; row_count integer;
  expected_keys text[]; supplied_keys text[]; columns text[]; before_columns text[]; after_columns text[];
  col_list text; val_list text; set_list text; key_pred text; has_seq boolean; affected integer;
BEGIN
  SELECT instance_id INTO current_instance FROM sgt_pc_backup.state WHERE singleton FOR SHARE;
  IF p_instance IS NULL OR p_instance !~ '^[a-f0-9]{32}$' OR current_instance IS DISTINCT FROM p_instance OR p_catalog_hash IS NULL OR p_catalog_hash !~ '^[a-f0-9]{32}$' OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'PC merge: source identity does not match' USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p_changes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_changes)=0 OR jsonb_array_length(p_changes)>500 OR octet_length(p_changes::text)>10485760 THEN
    RAISE EXCEPTION 'PC merge: invalid or oversized changeset' USING ERRCODE='22023';
  END IF;
  payload_hash:=encode(sha256(convert_to(p_instance || ':' || p_catalog_hash || ':' || p_changes::text,'UTF8')),'hex');
  -- Share the restore lock so a restore cannot race the compare-and-swap.
  PERFORM pg_advisory_xact_lock(hashtext('sgt_restore_app_data'));
  SELECT * INTO previous FROM sgt_pc_backup.merge_receipts WHERE operation_id=p_operation_id;
  IF FOUND THEN
    IF previous.instance_id IS DISTINCT FROM p_instance OR previous.payload_hash IS DISTINCT FROM payload_hash THEN
      RAISE EXCEPTION 'PC merge: operation id already used for different data' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('applied',previous.applied_count,'alreadyApplied',true);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_changes) x GROUP BY x->>'table',x->'key' HAVING count(*)>1) THEN
    RAISE EXCEPTION 'PC merge: duplicate row key' USING ERRCODE='22023';
  END IF;
  -- Lock all app tables in a deterministic order: triggers can update tables
  -- other than the target. The lock is bounded and no trigger is disabled.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    ORDER BY c.relname
  LOOP EXECUTE format('LOCK TABLE public.%I IN SHARE ROW EXCLUSIVE MODE',t.relname); END LOOP;
  IF md5(sgt_pc_backup.catalog()::text) IS DISTINCT FROM p_catalog_hash THEN
    RAISE EXCEPTION 'PC merge: source catalog changed' USING ERRCODE='40001';
  END IF;

  -- Validate every record and compare the complete current rows before doing
  -- anything. A mismatch aborts the entire PostgreSQL transaction.
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    tbl:=c->>'table'; key_data:=c->'key'; old_row:=c->'before'; new_row:=c->'after';
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR jsonb_typeof(key_data) IS DISTINCT FROM 'object'
      OR old_row IS NULL OR new_row IS NULL OR (old_row='null'::jsonb AND new_row='null'::jsonb)
      OR (old_row<>'null'::jsonb AND jsonb_typeof(old_row)<>'object')
      OR (new_row<>'null'::jsonb AND jsonb_typeof(new_row)<>'object') THEN
      RAISE EXCEPTION 'PC merge: invalid record' USING ERRCODE='22023';
    END IF;
    -- Do not allow offline promotion or credential changes through merge.
    IF tbl IS NULL OR tbl IN ('admins','users') OR NOT EXISTS (
      SELECT 1 FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relname=tbl AND r.relkind IN ('r','p') AND NOT r.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=r.oid AND d.deptype='e')
    ) THEN RAISE EXCEPTION 'PC merge: table not allowed: %',tbl USING ERRCODE='22023'; END IF;
    SELECT array_agg(a.attname::text ORDER BY a.attname::text) INTO expected_keys FROM pg_index i
      JOIN pg_class r ON r.oid=i.indrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      JOIN unnest(i.indkey) k(attnum) ON true JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=k.attnum
      WHERE n.nspname='public' AND r.relname=tbl AND i.indisprimary AND i.indnkeyatts=i.indnatts;
    SELECT array_agg(k ORDER BY k) INTO supplied_keys FROM jsonb_object_keys(key_data) k;
    IF expected_keys IS NULL OR expected_keys IS DISTINCT FROM supplied_keys OR EXISTS (SELECT 1 FROM jsonb_each(key_data) k WHERE k.value='null'::jsonb) THEN
      RAISE EXCEPTION 'PC merge: missing or invalid primary key for %',tbl USING ERRCODE='22023';
    END IF;
    SELECT array_agg(a.attname::text ORDER BY a.attname::text) INTO columns FROM pg_attribute a
      JOIN pg_class r ON r.oid=a.attrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relname=tbl AND a.attnum>0 AND NOT a.attisdropped;
    IF old_row<>'null'::jsonb THEN SELECT array_agg(k ORDER BY k) INTO before_columns FROM jsonb_object_keys(old_row) k; ELSE before_columns:=NULL; END IF;
    IF new_row<>'null'::jsonb THEN SELECT array_agg(k ORDER BY k) INTO after_columns FROM jsonb_object_keys(new_row) k; ELSE after_columns:=NULL; END IF;
    IF (old_row<>'null'::jsonb AND (before_columns IS DISTINCT FROM columns OR key_data IS DISTINCT FROM (SELECT jsonb_object_agg(k,old_row->k) FROM jsonb_object_keys(key_data) k)))
      OR (new_row<>'null'::jsonb AND (after_columns IS DISTINCT FROM columns OR key_data IS DISTINCT FROM (SELECT jsonb_object_agg(k,new_row->k) FROM jsonb_object_keys(key_data) k))) THEN
      RAISE EXCEPTION 'PC merge: incomplete row or changed primary key in %',tbl USING ERRCODE='22023';
    END IF;
    -- Sequence values are not transactional and independently-created numeric
    -- ids require a separate allocation protocol. Stop rather than guess.
    SELECT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relname=tbl AND a.attnum>0 AND NOT a.attisdropped
        AND (a.attidentity<>'' OR pg_get_serial_sequence(format('public.%I',tbl),a.attname) IS NOT NULL)) INTO has_seq;
    IF has_seq THEN RAISE EXCEPTION 'PC merge: sequence-bearing table % requires manual reconciliation',tbl USING ERRCODE='22023'; END IF;
    key_pred:=sgt_pc_backup.merge_key_predicate(tbl);
    EXECUTE format('SELECT count(*)::int, (jsonb_agg(to_jsonb(x))->0) FROM public.%1$I x CROSS JOIN jsonb_populate_record(NULL::public.%1$I,$1) k WHERE %2$s',tbl,key_pred)
      INTO row_count,actual USING key_data;
    IF row_count>1 OR (row_count=0 AND old_row<>'null'::jsonb) OR (row_count=1 AND (old_row='null'::jsonb OR actual IS DISTINCT FROM old_row)) THEN
      RAISE EXCEPTION 'PC merge conflict: current row changed in %',tbl USING ERRCODE='40001';
    END IF;
  END LOOP;

  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    tbl:=c->>'table';key_data:=c->'key';old_row:=c->'before';new_row:=c->'after';
    -- Triggers from earlier operations may have touched this row in the same
    -- transaction. Recheck and roll back rather than overwrite that change.
    key_pred:=sgt_pc_backup.merge_key_predicate(tbl);
    EXECUTE format('SELECT count(*)::int, (jsonb_agg(to_jsonb(x))->0) FROM public.%1$I x CROSS JOIN jsonb_populate_record(NULL::public.%1$I,$1) k WHERE %2$s',tbl,key_pred) INTO row_count,actual USING key_data;
    IF row_count>1 OR (row_count=0 AND old_row<>'null'::jsonb) OR (row_count=1 AND (old_row='null'::jsonb OR actual IS DISTINCT FROM old_row)) THEN
      RAISE EXCEPTION 'PC merge conflict: row changed by a trigger in %',tbl USING ERRCODE='40001';
    END IF;
    IF new_row='null'::jsonb THEN
      EXECUTE format('DELETE FROM public.%1$I x USING jsonb_populate_record(NULL::public.%1$I,$1) k WHERE %2$s',tbl,key_pred) USING key_data;
    ELSE
      SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum),
             string_agg(format('r.%I',a.attname),',' ORDER BY a.attnum),
             string_agg(format('%1$I = r.%1$I',a.attname),',' ORDER BY a.attnum)
      INTO col_list,val_list,set_list FROM pg_attribute a JOIN pg_class r ON r.oid=a.attrelid JOIN pg_namespace n ON n.oid=r.relnamespace
      WHERE n.nspname='public' AND r.relname=tbl AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attidentity='';
      IF old_row='null'::jsonb THEN
        EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r',tbl,col_list,val_list) USING new_row;
      ELSE
        EXECUTE format('UPDATE public.%1$I x SET %2$s FROM jsonb_populate_record(NULL::public.%1$I,$1) r, jsonb_populate_record(NULL::public.%1$I,$2) k WHERE %3$s',tbl,set_list,key_pred) USING new_row,key_data;
      END IF;
    END IF;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'PC merge: trigger suppressed or multiplied a change in %',tbl USING ERRCODE='40001'; END IF;
    IF new_row<>'null'::jsonb THEN
      key_pred:=sgt_pc_backup.merge_key_predicate(tbl);
      EXECUTE format('SELECT count(*)::int, (jsonb_agg(to_jsonb(x))->0) FROM public.%1$I x CROSS JOIN jsonb_populate_record(NULL::public.%1$I,$1) k WHERE %2$s',tbl,key_pred) INTO row_count,actual USING key_data;
      -- A normal BEFORE UPDATE trigger supplies the remote timestamp. All
      -- other requested values, including computed fields, must survive.
      IF row_count<>1 OR (actual-'updated_at') IS DISTINCT FROM (new_row-'updated_at') THEN
        RAISE EXCEPTION 'PC merge: trigger or generated value changed data in %',tbl USING ERRCODE='40001';
      END IF;
    END IF;
  END LOOP;
  -- A later trigger may have modified an earlier row. Verify the final
  -- transaction state for every requested key, including deletions.
  FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
    tbl:=c->>'table';key_data:=c->'key';new_row:=c->'after';
    key_pred:=sgt_pc_backup.merge_key_predicate(tbl);
    EXECUTE format('SELECT count(*)::int, (jsonb_agg(to_jsonb(x))->0) FROM public.%1$I x CROSS JOIN jsonb_populate_record(NULL::public.%1$I,$1) k WHERE %2$s',tbl,key_pred) INTO row_count,actual USING key_data;
    IF (new_row='null'::jsonb AND row_count<>0) OR (new_row<>'null'::jsonb AND (row_count<>1 OR (actual-'updated_at') IS DISTINCT FROM (new_row-'updated_at'))) THEN
      RAISE EXCEPTION 'PC merge: final row differs after trigger in %',tbl USING ERRCODE='40001';
    END IF;
  END LOOP;
  INSERT INTO sgt_pc_backup.merge_receipts(operation_id,instance_id,payload_hash,applied_count)
    VALUES(p_operation_id,p_instance,payload_hash,jsonb_array_length(p_changes));
  RETURN jsonb_build_object('applied',jsonb_array_length(p_changes),'alreadyApplied',false);
END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_apply_changes(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_pc_apply_changes(text,text,uuid,jsonb) TO service_role;
