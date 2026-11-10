-- 162 — Cuánto ocupa la base: la función detrás de Integraciones › Supabase.
--
-- La dueña (09-11) pidió ver desde SellUp cuánto espacio usa Supabase y cuánto
-- pesa cada cosa (empresas, contactos, búsquedas…), para enterarse antes de
-- que se llene y deje de poder guardar búsquedas.
--
-- Sólo LEE el catálogo de Postgres: no crea tablas, no escribe filas, no toca
-- datos. Devuelve el tamaño total de la base y, por tabla, lo que pesa (datos +
-- índices + TOAST) y cuántas filas tiene. Las tablas de hasta 64 MB se cuentan
-- de verdad; las más grandes usan la estimación de Postgres (contar millones de
-- filas cada vez que alguien abre la pantalla sería caro).
--
-- Agrupar tablas en «Empresas», «Contactos»… es cosa de la app
-- (src/modules/storage-usage/storage-categories.ts): aquí sólo van los números.
--
-- Sólo la llama el servidor con la llave de servicio: ni `anon` ni
-- `authenticated` pueden ejecutarla.

CREATE OR REPLACE FUNCTION public.sellup_storage_usage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '25s'
AS $$
DECLARE
  v_exact_limit_bytes constant bigint := 64 * 1024 * 1024;
  v_tables jsonb := '[]'::jsonb;
  v_rows bigint;
  v_exact boolean;
  r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           pg_total_relation_size(c.oid) AS total_bytes,
           c.reltuples AS estimated_rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp%'
  LOOP
    v_exact := false;
    v_rows := greatest(r.estimated_rows, 0)::bigint;

    IF r.total_bytes <= v_exact_limit_bytes THEN
      BEGIN
        EXECUTE format('SELECT count(*) FROM %I.%I', r.schema_name, r.table_name) INTO v_rows;
        v_exact := true;
      EXCEPTION WHEN OTHERS THEN
        -- Una tabla que no se deja leer (p. ej. del sistema) se queda con la estimación.
        v_rows := greatest(r.estimated_rows, 0)::bigint;
        v_exact := false;
      END;
    END IF;

    v_tables := v_tables || jsonb_build_array(jsonb_build_object(
      'schema', r.schema_name,
      'name', r.table_name,
      'total_bytes', r.total_bytes,
      'rows', v_rows,
      'rows_exact', v_exact
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'generated_at', now(),
    'tables', v_tables
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sellup_storage_usage() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sellup_storage_usage() FROM anon;
REVOKE ALL ON FUNCTION public.sellup_storage_usage() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sellup_storage_usage() TO service_role;

COMMENT ON FUNCTION public.sellup_storage_usage() IS
  'Integraciones › Supabase: tamaño de la base y, por tabla, peso y filas. Sólo lectura; sólo service_role.';
