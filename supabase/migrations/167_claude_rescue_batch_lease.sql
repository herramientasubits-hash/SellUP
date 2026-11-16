-- ============================================================
-- 167 — Candado por búsqueda para el rescate con IA (Claude)
-- ============================================================
-- ⚠️ NO APLICADA EN PRODUCCIÓN. Se aplica sólo con autorización explícita de la
-- dueña, después del merge. Sin aplicar, la app funciona como antes (sin candado).
--
-- El rescate de las descartadas de una búsqueda se dispara desde varios lados
-- (al terminar la búsqueda, la continuación de Apollo, el botón «Rescatar con IA»,
-- el cron diario). Dos vueltas a la vez sobre la MISMA búsqueda gastan el doble y
-- pueden pasar del tope de 10 en revisión (revisión a fondo 16-11).
--
-- El candado vive en `prospect_batches.metadata.claude_rescue_lease_until` y se
-- toma con UNA sentencia atómica (jsonb_set): nunca reescribe el resto de la
-- metadata (el candado viejo de `claude-action-lock.ts` sí lo hacía, y podía pisar
-- lo que escribe Apollo en el mismo lote).
--
--   · agent1_try_claude_rescue_lease(batch, ttl) → true si lo tomó (libre o vencido);
--   · agent1_release_claude_rescue_lease(batch)  → lo suelta (idempotente).
--
-- Sólo el cliente de servicio (service_role) las ejecuta: el rescate corre en el
-- servidor con ese cliente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.agent1_try_claude_rescue_lease(
  p_batch_id uuid,
  p_ttl_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ttl integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 300), 30), 900);
  v_taken integer;
BEGIN
  UPDATE public.prospect_batches
     SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{claude_rescue_lease_until}',
           to_jsonb(to_char((now() + make_interval(secs => v_ttl)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
           true
         )
   WHERE id = p_batch_id
     AND (
       metadata->>'claude_rescue_lease_until' IS NULL
       OR (metadata->>'claude_rescue_lease_until')::timestamptz < now()
     );
  GET DIAGNOSTICS v_taken = ROW_COUNT;
  RETURN v_taken > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.agent1_release_claude_rescue_lease(p_batch_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  UPDATE public.prospect_batches
     SET metadata = metadata - 'claude_rescue_lease_until'
   WHERE id = p_batch_id
     AND metadata ? 'claude_rescue_lease_until';
$$;

REVOKE ALL ON FUNCTION public.agent1_try_claude_rescue_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent1_release_claude_rescue_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent1_try_claude_rescue_lease(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent1_release_claude_rescue_lease(uuid) TO service_role;
