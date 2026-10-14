-- ============================================================
-- 149 · Uso de IA: la forma de búsqueda sale de la metadata del lote
-- ============================================================
--
-- POR QUÉ
--   La 147 deriva `provider_usage_logs.search_mode` sólo de
--   `prospect_batches.source`: todo lote `agent_1` queda como 'exploratory'.
--   Los lotes del árbol de empresa, de proveedores y de competidores también son
--   `agent_1`, pero declaran su forma en `metadata.search_mode`
--   ('corporate_tree', 'suppliers', 'competitors'). En /ai-usage salían como
--   «Empresas por industria» (Prod 14-10, lote 9aeb56a6 del árbol).
--
-- QUÉ HACE
--   1. Reemplaza `provider_usage_batch_dimensions`: si la metadata del lote dice
--      una de esas formas, gana; si no, la regla de la 147 por `source`.
--      País y macro industria no cambian.
--   2. Corrige las filas ya escritas de esos lotes: sólo donde search_mode está
--      en NULL o en el 'exploratory' que derivó la 147. Idempotente.
--
-- QUÉ NO HACE
--   - No toca el disparador, las reglas de agente/paso, costos, créditos ni RLS.
--   - No pisa un search_mode distinto de NULL/'exploratory'.
--
-- Espejo en TypeScript: `resolveBatchDimensions` y
-- `SEARCH_MODES_FROM_BATCH_METADATA` (src/modules/usage-tracking/usage-dimensions.ts);
-- una prueba exige que digan lo mismo.
--
-- REVERSIBLE
--   Volver a correr la sección 2.b de la 147 (CREATE OR REPLACE de
--   provider_usage_batch_dimensions) y, si se quiere, dejar en 'exploratory' las
--   filas de esos lotes.
--
-- 🔴 NO APLICADA al escribirla.
-- ============================================================

CREATE OR REPLACE FUNCTION public.provider_usage_batch_dimensions(p_batch_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = pg_temp
AS $$
  SELECT ARRAY[
    upper(NULLIF(btrim(b.country_code), '')),
    COALESCE(
      NULLIF(btrim(b.metadata -> 'apollo_discovery_taxonomy' ->> 'macro_industry_key'), ''),
      NULLIF(btrim(b.metadata -> 'claude_company_search' ->> 'macro_industry_key'), ''),
      NULLIF(btrim(b.metadata -> 'lusha_run_observability' ->> 'macro_industry_key'), '')
    ),
    CASE
      WHEN b.metadata ->> 'search_mode' IN ('corporate_tree', 'suppliers', 'competitors') THEN b.metadata ->> 'search_mode'
      WHEN b.source = 'agent_1' THEN 'exploratory'
      WHEN b.source IN ('imported', 'external_import') THEN 'import'
      ELSE NULL
    END
  ]
  FROM public.prospect_batches AS b
  WHERE b.id = p_batch_id;
$$;

REVOKE ALL ON FUNCTION public.provider_usage_batch_dimensions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_usage_batch_dimensions(uuid) TO service_role;

UPDATE public.provider_usage_logs AS l
   SET search_mode = b.metadata ->> 'search_mode'
  FROM public.prospect_batches AS b
 WHERE l.batch_id = b.id
   AND b.metadata ->> 'search_mode' IN ('corporate_tree', 'suppliers', 'competitors')
   AND (l.search_mode IS NULL OR l.search_mode = 'exploratory');
