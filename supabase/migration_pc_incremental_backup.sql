-- Change metadata for browser-side incremental copies. Application rows are
-- stored only in public tables; this private schema records changed primary
-- keys, not full rows. Apply after the updated migration_complete_app_backup.sql.
CREATE SCHEMA IF NOT EXISTS sgt_pc_backup;
REVOKE ALL ON SCHEMA sgt_pc_backup FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS sgt_pc_backup.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  instance_id text NOT NULL,
  pruned_before bigint NOT NULL DEFAULT 0
);
INSERT INTO sgt_pc_backup.state(singleton, instance_id)
VALUES (true, md5(random()::text || clock_timestamp()::text)) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS sgt_pc_backup.changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  xid bigint NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  table_name text NOT NULL,
  key_data jsonb,
  needs_snapshot boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sgt_pc_backup_changes_xid ON sgt_pc_backup.changes(xid);
CREATE INDEX IF NOT EXISTS sgt_pc_backup_changes_age ON sgt_pc_backup.changes(changed_at);
REVOKE ALL ON ALL TABLES IN SCHEMA sgt_pc_backup FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA sgt_pc_backup FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION sgt_pc_backup.track_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
DECLARE
  rel oid := coalesce(pg_partition_root(TG_RELID), TG_RELID);
  rel_name text;
  keys text[];
  key_old jsonb;
  key_new jsonb;
  key_args text;
BEGIN
  SELECT relname INTO rel_name FROM pg_class WHERE oid=rel;
  SELECT array_agg(a.attname ORDER BY k.ordinality) INTO keys
    FROM pg_index i JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
    WHERE i.indrelid=rel AND i.indisprimary;
  IF keys IS NULL THEN
    INSERT INTO sgt_pc_backup.changes(xid,table_name,needs_snapshot) VALUES(txid_current(),rel_name,true);
  ELSE
    SELECT string_agg(format('%L, ($1).%I', k, k), ', ') INTO key_args FROM unnest(keys) k;
    IF TG_OP IN ('UPDATE','DELETE') THEN
      EXECUTE 'SELECT jsonb_build_object(' || key_args || ')' INTO key_old USING OLD;
      INSERT INTO sgt_pc_backup.changes(xid,table_name,key_data) VALUES(txid_current(),rel_name,key_old);
    END IF;
    IF TG_OP IN ('UPDATE','INSERT') THEN
      EXECUTE 'SELECT jsonb_build_object(' || key_args || ')' INTO key_new USING NEW;
      IF key_old IS NULL OR key_old IS DISTINCT FROM key_new THEN
        INSERT INTO sgt_pc_backup.changes(xid,table_name,key_data) VALUES(txid_current(),rel_name,key_new);
      END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION sgt_pc_backup.track_truncate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
BEGIN
  INSERT INTO sgt_pc_backup.changes(xid,table_name,needs_snapshot) VALUES(txid_current(),TG_TABLE_NAME,true);
  RETURN NULL;
END $$;
-- A full restore disables user triggers. The restore function invokes this
-- within its transaction after completing the data replacement.
CREATE OR REPLACE FUNCTION public.sgt_pc_backup_mark_reset() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
BEGIN INSERT INTO sgt_pc_backup.changes(xid,table_name,needs_snapshot) VALUES(txid_current(),'*',true); END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_mark_reset() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sgt_pc_backup_enable() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup SET lock_timeout='5s' AS $$
DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
    ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_rows ON public.%I',t.relname);
    EXECUTE format('CREATE TRIGGER sgt_pc_backup_rows AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION sgt_pc_backup.track_row()',t.relname);
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_truncate ON public.%I',t.relname);
    EXECUTE format('CREATE TRIGGER sgt_pc_backup_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION sgt_pc_backup.track_truncate()',t.relname);
  END LOOP;
  -- TRUNCATE can target a partition directly. Row triggers are cloned by
  -- PostgreSQL from the parent, but TRUNCATE triggers are not.
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relispartition AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_truncate ON public.%I',t.relname);
    EXECUTE format('CREATE TRIGGER sgt_pc_backup_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION sgt_pc_backup.track_truncate()',t.relname);
  END LOOP;
  PERFORM public.sgt_pc_backup_mark_reset();
END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_enable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_pc_backup_enable() TO service_role;

-- Stopping is global to this source; it leaves existing journal and PC files intact.
-- The next enable adds a reset marker, so all clients must take a fresh snapshot.
CREATE OR REPLACE FUNCTION public.sgt_pc_backup_disable() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup SET lock_timeout='5s' AS $$
DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_rows ON public.%I',t.relname);
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_truncate ON public.%I',t.relname);
  END LOOP;
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relispartition AND c.relkind IN ('r','p') ORDER BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS sgt_pc_backup_truncate ON public.%I',t.relname);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_disable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_pc_backup_disable() TO service_role;

CREATE OR REPLACE FUNCTION sgt_pc_backup.catalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
  SELECT coalesce(jsonb_object_agg(t.relname, jsonb_build_object(
    'columns', (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'generated',a.attgenerated,'identity',a.attidentity) ORDER BY a.attnum)
      FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),
    'pk', coalesce((SELECT jsonb_agg(a.attname ORDER BY k.ordinality) FROM pg_index i
      JOIN unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true
      JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=t.oid AND i.indisprimary),'[]'::jsonb)
  )), '{}'::jsonb)
  FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relkind IN ('r','p') AND NOT t.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=t.oid AND d.deptype='e')
$$;
CREATE OR REPLACE FUNCTION sgt_pc_backup.assert_ready() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
BEGIN
  IF to_regprocedure('public.sgt_restore_app_data(jsonb)') IS NULL OR position('sgt_pc_backup_mark_reset' IN pg_get_functiondef('public.sgt_restore_app_data(jsonb)'::regprocedure))=0 THEN
    RAISE EXCEPTION 'Install updated migration_complete_app_backup.sql before incremental backups';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
      AND (NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='sgt_pc_backup_rows' AND t.tgenabled IN ('O','A'))
        OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='sgt_pc_backup_truncate' AND t.tgenabled IN ('O','A')))) THEN
    RAISE EXCEPTION 'Incremental triggers missing or disabled; enable tracking or update triggers from the owner interface';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relispartition AND c.relkind IN ('r','p')
      AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='sgt_pc_backup_truncate' AND t.tgenabled IN ('O','A'))) THEN
    RAISE EXCEPTION 'Incremental partition trigger missing; update triggers from the owner interface';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION sgt_pc_backup.sequences() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
DECLARE t record; a record; seq_name text; seq_last bigint; seq_called boolean; seqs jsonb; all_seqs jsonb := '{}'::jsonb;
BEGIN
  FOR t IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') LOOP
    seqs := '{}'::jsonb;
    FOR a IN SELECT attname FROM pg_attribute WHERE attrelid=t.oid AND attnum>0 AND NOT attisdropped LOOP
      seq_name := pg_get_serial_sequence(format('public.%I',t.relname),a.attname);
      IF seq_name IS NOT NULL THEN
        EXECUTE format('SELECT last_value,is_called FROM %s',seq_name::regclass) INTO seq_last,seq_called;
        seqs := seqs || jsonb_build_object(a.attname,jsonb_build_object('last',seq_last::text,'called',seq_called));
      END IF;
    END LOOP;
    all_seqs := all_seqs || jsonb_build_object(t.relname,seqs);
  END LOOP;
  RETURN all_seqs;
END $$;

CREATE OR REPLACE FUNCTION public.sgt_pc_backup_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
DECLARE meta jsonb; base jsonb; instance text; BEGIN
  PERFORM sgt_pc_backup.assert_ready();
  meta := sgt_pc_backup.catalog();
  base := public.sgt_export_app_data();
  SELECT instance_id INTO instance FROM sgt_pc_backup.state WHERE singleton;
  RETURN jsonb_build_object('instance',instance,'cursor',txid_snapshot_xmin(txid_current_snapshot())::text,'catalog',meta,'catalogHash',md5(meta::text),'snapshot',base);
END $$;

DROP FUNCTION IF EXISTS public.sgt_pc_backup_changes(text,text,jsonb);
CREATE OR REPLACE FUNCTION public.sgt_pc_backup_changes(p_instance text, p_cursor text, p_catalog_hash text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
DECLARE c bigint; floor_xid bigint; instance text; meta jsonb; item record; keys jsonb; values_json jsonb; conditions text; result jsonb := '{}'::jsonb; rows_changed bigint;
BEGIN
  IF p_cursor !~ '^[0-9]{1,20}$' THEN RAISE EXCEPTION 'Invalid backup cursor'; END IF;
  c := p_cursor::bigint;
  PERFORM sgt_pc_backup.assert_ready();
  SELECT instance_id,pruned_before INTO instance,floor_xid FROM sgt_pc_backup.state WHERE singleton;
  meta := sgt_pc_backup.catalog();
  IF instance IS DISTINCT FROM p_instance THEN RETURN jsonb_build_object('reset',true,'reason','instance_changed'); END IF;
  IF md5(meta::text) IS DISTINCT FROM p_catalog_hash OR c < floor_xid OR c > txid_snapshot_xmin(txid_current_snapshot()) THEN
    RETURN jsonb_build_object('reset',true,'reason','resnapshot');
  END IF;
  SELECT count(*) INTO rows_changed FROM (SELECT 1 FROM sgt_pc_backup.changes WHERE xid>=c LIMIT 5001) recent;
  IF rows_changed>5000 THEN RETURN jsonb_build_object('reset',true,'reason','backlog'); END IF;
  IF EXISTS (SELECT 1 FROM sgt_pc_backup.changes WHERE xid>=c AND needs_snapshot) THEN RETURN jsonb_build_object('reset',true,'reason','resnapshot'); END IF;
  FOR item IN SELECT table_name FROM sgt_pc_backup.changes WHERE xid>=c GROUP BY table_name ORDER BY table_name LOOP
    IF NOT (meta ? item.table_name) OR jsonb_array_length(meta->item.table_name->'pk')=0 THEN RETURN jsonb_build_object('reset',true); END IF;
    SELECT jsonb_agg(key_data) INTO keys FROM (SELECT DISTINCT key_data FROM sgt_pc_backup.changes WHERE xid>=c AND table_name=item.table_name) unique_keys;
    SELECT string_agg(format('r.%1$I = v.%1$I',name),' AND ' ORDER BY name)
      INTO conditions FROM jsonb_array_elements_text(meta->item.table_name->'pk') name;
    EXECUTE format('SELECT coalesce(jsonb_agg(DISTINCT to_jsonb(r)), ''[]''::jsonb) FROM jsonb_array_elements($1) k CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I, k.value) v JOIN public.%1$I r ON %2$s', item.table_name,conditions) INTO values_json USING keys;
    result := result || jsonb_build_object(item.table_name,jsonb_build_object('keys',keys,'rows',values_json));
  END LOOP;
  RETURN jsonb_build_object('reset',false,'cursor',txid_snapshot_xmin(txid_current_snapshot())::text,'tables',result, 'sequences', CASE WHEN rows_changed>0 THEN sgt_pc_backup.sequences() ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_changes(text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_pc_backup_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.sgt_pc_backup_changes(text,text,text) TO service_role;

-- Safe retention: do not prune transactions still visible to an older snapshot.
-- A lagging browser receives reset=true and obtains a new full snapshot.
CREATE OR REPLACE FUNCTION public.sgt_pc_backup_prune() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,sgt_pc_backup AS $$
DECLARE safe_xid bigint := txid_snapshot_xmin(txid_current_snapshot()); removed_max bigint;
BEGIN
  WITH removed AS (
    DELETE FROM sgt_pc_backup.changes WHERE ctid IN (
      SELECT ctid FROM sgt_pc_backup.changes
      WHERE changed_at < clock_timestamp() - interval '7 days' AND xid < safe_xid
      ORDER BY changed_at LIMIT 2000
    ) RETURNING xid
  ) SELECT max(xid) INTO removed_max FROM removed;
  IF removed_max IS NOT NULL THEN
    UPDATE sgt_pc_backup.state SET pruned_before=greatest(pruned_before,removed_max+1) WHERE singleton;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sgt_pc_backup_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_pc_backup_prune() TO service_role;
NOTIFY pgrst, 'reload schema';
