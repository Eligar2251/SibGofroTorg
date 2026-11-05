-- Full public application-table snapshots and transactional restore.
-- Only the trusted server service role may call these functions. This does not
-- include auth, storage files, extensions, database roles or schema definitions.
CREATE OR REPLACE FUNCTION public.sgt_export_app_data()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
  rows_json jsonb;
  cols_json jsonb;
  all_rows jsonb := '{}'::jsonb;
  all_columns jsonb := '{}'::jsonb;
  all_sequences jsonb := '{}'::jsonb;
  seqs jsonb;
  seq_name text;
  seq_last bigint;
  seq_called boolean;
  seq_col record;
  row_total bigint := 0;
BEGIN
  FOR t IN
    SELECT c.oid, c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
    ORDER BY c.relname
  LOOP
    EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(r)), ''[]''::jsonb) FROM public.%I r', t.relname) INTO rows_json;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'generated', a.attgenerated, 'identity', a.attidentity) ORDER BY a.attnum), '[]'::jsonb)
      INTO cols_json FROM pg_attribute a WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped;
    seqs := '{}'::jsonb;
    FOR seq_col IN SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum > 0 AND NOT attisdropped LOOP
      seq_name := pg_get_serial_sequence(format('public.%I', t.relname), seq_col.attname);
      IF seq_name IS NOT NULL THEN
        EXECUTE format('SELECT last_value, is_called FROM %s', seq_name::regclass) INTO seq_last, seq_called;
        seqs := seqs || jsonb_build_object(seq_col.attname, jsonb_build_object('last', seq_last::text, 'called', seq_called));
      END IF;
    END LOOP;
    all_sequences := all_sequences || jsonb_build_object(t.relname, seqs);
    all_rows := all_rows || jsonb_build_object(t.relname, rows_json);
    all_columns := all_columns || jsonb_build_object(t.relname, cols_json);
    row_total := row_total + jsonb_array_length(rows_json);
  END LOOP;
  IF all_rows = '{}'::jsonb THEN RAISE EXCEPTION 'No application tables found in public'; END IF;
  RETURN jsonb_build_object('app', 'SibGofroTorg', 'backupFormat', 'sgt-public-v1', 'version', 1,
    'exportedAt', statement_timestamp(), 'totalRows', row_total, 'tables', all_rows, 'columns', all_columns, 'sequences', all_sequences);
END;
$$;

-- Replaces only matching public tables; one PostgreSQL transaction rolls back on
-- failure. Schema mismatch, external FKs and cyclic FK graphs fail closed.
-- Intended exclusively for an explicitly authorised, inactive replica/restore.
CREATE OR REPLACE FUNCTION public.sgt_restore_app_data(p_snapshot jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t record;
  tr record;
  seq_col record;
  names text[];
  pending text[];
  current_name text;
  qualified_tables text;
  writable_columns text;
  expected_columns jsonb;
  seq_name text;
  seq_last bigint;
  max_value bigint;
  trigger_states jsonb := '[]'::jsonb;
  trigger_state jsonb;
  total bigint := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('sgt_restore_app_data'));
  IF p_snapshot->>'app' IS DISTINCT FROM 'SibGofroTorg'
     OR p_snapshot->>'backupFormat' IS DISTINCT FROM 'sgt-public-v1'
     OR jsonb_typeof(p_snapshot->'tables') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'columns') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'sequences') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid or incomplete SGT public backup';
  END IF;
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO names
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e');
  IF names IS NULL OR names IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(p_snapshot->'tables') ORDER BY 1)
     OR names IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(p_snapshot->'columns') ORDER BY 1)
     OR names IS DISTINCT FROM ARRAY(SELECT jsonb_object_keys(p_snapshot->'sequences') ORDER BY 1) THEN
    RAISE EXCEPTION 'Backup and target public table lists differ; no data changed';
  END IF;
  FOR t IN SELECT unnest(names) AS name LOOP
    IF jsonb_typeof(p_snapshot->'tables'->t.name) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid rows for %', t.name; END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'generated', a.attgenerated, 'identity', a.attidentity) ORDER BY a.attnum), '[]'::jsonb)
      INTO expected_columns FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t.name AND a.attnum > 0 AND NOT a.attisdropped;
    IF expected_columns IS DISTINCT FROM p_snapshot->'columns'->t.name THEN
      RAISE EXCEPTION 'Schema differs for table %; no data changed', t.name;
    END IF;
    -- Reject truncated or manually modified rows instead of silently writing NULLs.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_snapshot->'tables'->t.name) r
      WHERE jsonb_typeof(r) <> 'object' OR NOT (r ?& ARRAY(SELECT x->>'name' FROM jsonb_array_elements(expected_columns) x))
        OR EXISTS (SELECT 1 FROM jsonb_object_keys(CASE WHEN jsonb_typeof(r) = 'object' THEN r ELSE '{}'::jsonb END) key_name WHERE NOT key_name = ANY(ARRAY(SELECT x->>'name' FROM jsonb_array_elements(expected_columns) x)))) THEN
      RAISE EXCEPTION 'Incomplete row in table %', t.name;
    END IF;
  END LOOP;

  SELECT string_agg(format('public.%I', name), ', ' ORDER BY name) INTO qualified_tables FROM unnest(names) AS name;
  -- Prevent updated_at, derived-table and other user triggers from mutating the
  -- restored rows. Transaction rollback also restores trigger states on error.
  FOR tr IN SELECT c.relname, tg.tgname, tg.tgenabled FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(names) AND NOT tg.tgisinternal AND tg.tgenabled <> 'D'
  LOOP
    trigger_states := trigger_states || jsonb_build_array(jsonb_build_object('table', tr.relname, 'name', tr.tgname, 'mode', tr.tgenabled));
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', tr.relname, tr.tgname);
  END LOOP;

  -- Disable user triggers before TRUNCATE too: an ON TRUNCATE trigger could
  -- otherwise modify unrelated data or make a supposedly exact restore unsafe.
  -- RESTRICT is deliberate: never silently truncate a table in another schema.
  EXECUTE 'TRUNCATE TABLE ' || qualified_tables || ' RESTRICT';

  pending := names;
  WHILE cardinality(pending) > 0 LOOP
    current_name := NULL;
    SELECT candidate INTO current_name FROM unnest(pending) candidate
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid
        JOIN pg_namespace cn ON cn.oid = child.relnamespace
        JOIN pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_namespace pn ON pn.oid = parent.relnamespace
        WHERE fk.contype = 'f' AND cn.nspname = 'public' AND pn.nspname = 'public'
          AND child.relname = candidate AND parent.relname = ANY(pending) AND parent.relname <> candidate
      ) ORDER BY candidate LIMIT 1;
    IF current_name IS NULL THEN RAISE EXCEPTION 'Cyclic foreign keys require manual restore'; END IF;
    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum) INTO writable_columns
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = current_name AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = '';
    IF writable_columns IS NULL THEN RAISE EXCEPTION 'No writable columns for %', current_name; END IF;
    EXECUTE format('INSERT INTO public.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1)',
      current_name, writable_columns, writable_columns, current_name) USING p_snapshot->'tables'->current_name;
    total := total + jsonb_array_length(p_snapshot->'tables'->current_name);
    pending := array_remove(pending, current_name);
  END LOOP;

  FOR trigger_state IN SELECT value FROM jsonb_array_elements(trigger_states) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE %s TRIGGER %I', trigger_state->>'table',
      CASE trigger_state->>'mode' WHEN 'R' THEN 'REPLICA' WHEN 'A' THEN 'ALWAYS' ELSE '' END,
      trigger_state->>'name');
  END LOOP;
  -- Advance serial/identity sequences at least to their old and restored values.
  FOR t IN SELECT unnest(names) AS name LOOP
    FOR seq_col IN SELECT attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t.name AND a.attnum > 0 AND NOT a.attisdropped LOOP
      seq_name := pg_get_serial_sequence(format('public.%I', t.name), seq_col.attname);
      IF seq_name IS NOT NULL THEN
        EXECUTE format('SELECT last_value FROM %s', seq_name::regclass) INTO seq_last;
        EXECUTE format('SELECT max(%I) FROM public.%I', seq_col.attname, t.name) INTO max_value;
        IF max_value IS NOT NULL OR p_snapshot->'sequences'->t.name->seq_col.attname->>'last' IS NOT NULL THEN
          PERFORM setval(seq_name::regclass, greatest(seq_last, coalesce(max_value, seq_last),
            coalesce((p_snapshot->'sequences'->t.name->seq_col.attname->>'last')::bigint, seq_last)), true);
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  -- Notify browser-side copies atomically when the optional incremental migration is installed.
  IF to_regprocedure('public.sgt_pc_backup_mark_reset()') IS NOT NULL THEN
    EXECUTE 'SELECT public.sgt_pc_backup_mark_reset()';
  END IF;
  RETURN jsonb_build_object('tables', cardinality(names), 'rows', total);
END;
$$;
REVOKE ALL ON FUNCTION public.sgt_export_app_data() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sgt_restore_app_data(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sgt_export_app_data() TO service_role;
GRANT EXECUTE ON FUNCTION public.sgt_restore_app_data(jsonb) TO service_role;
