-- ============================================================
-- Migration 147: cada consulta a un proveedor dice qué agente, qué paso,
-- qué país, qué industria y qué forma de búsqueda la pagó
-- ============================================================
-- AI-USAGE FASE 2 (módulo «Uso de IA, costos y efectividad»).
--
-- POR QUÉ
--   `provider_usage_logs` registra el dinero de cada consulta, pero no dice de
--   qué agente ni de qué paso salió, ni para qué país o industria se hizo. La
--   página /ai-usage tenía que adivinarlo por `agent_run_id` (casi siempre
--   vacío en el Agente 1) y no podía repartir el costo por país ni por paso.
--
-- QUÉ HACE
--   1. Añade cinco columnas OPCIONALES (NULL permitido) a provider_usage_logs:
--      agent_key, agent_step, country_code, macro_industry_key, search_mode.
--   2. Crea un disparador BEFORE INSERT que sólo rellena lo que llega en NULL:
--        - agent_key / agent_step: por proveedor + operación + metadata->>'flow'
--          con una tabla fija (`provider_usage_agent_dimensions`). Si ninguna
--          regla aplica y la fila trae agent_run_id, el agente sale de
--          agent_runs.agent_key (`provider_usage_agent_from_run`).
--        - country_code / macro_industry_key / search_mode: del lote
--          (prospect_batches) por batch_id (`provider_usage_batch_dimensions`).
--      Un valor que el escritor ya mandó NUNCA se pisa.
--   3. Rellena las filas existentes con la MISMA lógica: una sentencia por
--      dimensión, sólo donde la columna está en NULL. Volver a correrla no
--      cambia nada (idempotente).
--   4. Índices para filtrar por agente y por país (created_at ya tiene el suyo
--      desde la 036; se declara con el mismo nombre e IF NOT EXISTS).
--
-- QUÉ NO HACE
--   - No cambia ningún escritor de consultas ni ningún valor de costo, créditos,
--     estado o metadata: sólo escribe las cinco columnas nuevas.
--   - No borra filas, no toca políticas RLS ni permisos de la tabla.
--   - No inventa: una consulta sin regla ni ejecución queda con agent_key NULL;
--     una sin lote, sin país.
--
-- La tabla de reglas tiene un espejo en TypeScript
-- (src/modules/usage-tracking/usage-dimensions.ts) y una prueba exige que las
-- dos digan lo mismo, en el mismo orden.
--
-- REVERSIBLE
--   DROP TRIGGER IF EXISTS provider_usage_logs_fill_dimensions ON public.provider_usage_logs;
--   DROP FUNCTION IF EXISTS public.provider_usage_logs_fill_dimensions();
--   DROP FUNCTION IF EXISTS public.provider_usage_batch_dimensions(uuid);
--   DROP FUNCTION IF EXISTS public.provider_usage_agent_from_run(text);
--   DROP FUNCTION IF EXISTS public.provider_usage_agent_dimensions(text, text, text);
--   DROP INDEX IF EXISTS public.idx_provider_usage_agent_key;
--   DROP INDEX IF EXISTS public.idx_provider_usage_country_code;
--   ALTER TABLE public.provider_usage_logs DROP COLUMN IF EXISTS agent_key, ...;
--   (las cinco columnas son nuevas: quitarlas devuelve la tabla a la 146).
--
-- 🔴 NO APLICADA al escribirla. El código de /ai-usage tolera que las columnas
-- todavía no existan: calcula lo mismo en memoria.
-- ============================================================

-- ── 1. Columnas ──────────────────────────────────────────────

ALTER TABLE public.provider_usage_logs ADD COLUMN IF NOT EXISTS agent_key text NULL;
ALTER TABLE public.provider_usage_logs ADD COLUMN IF NOT EXISTS agent_step text NULL;
ALTER TABLE public.provider_usage_logs ADD COLUMN IF NOT EXISTS country_code text NULL;
ALTER TABLE public.provider_usage_logs ADD COLUMN IF NOT EXISTS macro_industry_key text NULL;
ALTER TABLE public.provider_usage_logs ADD COLUMN IF NOT EXISTS search_mode text NULL;

COMMENT ON COLUMN public.provider_usage_logs.agent_key IS
  'Agente que hizo la consulta (agent1, agent2a o la clave de agent_runs). Lo rellena el disparador de la 147 si llega NULL.';
COMMENT ON COLUMN public.provider_usage_logs.agent_step IS
  'Paso del agente (clasificador, rescate_web, apollo, ...). Lo rellena el disparador de la 147 si llega NULL.';
COMMENT ON COLUMN public.provider_usage_logs.country_code IS
  'País del lote (prospect_batches.country_code) en mayúsculas. Lo rellena el disparador de la 147 si llega NULL.';
COMMENT ON COLUMN public.provider_usage_logs.macro_industry_key IS
  'Macro industria declarada en la metadata del lote. Lo rellena el disparador de la 147 si llega NULL.';
COMMENT ON COLUMN public.provider_usage_logs.search_mode IS
  'Forma de búsqueda del lote (exploratory, import). Lo rellena el disparador de la 147 si llega NULL.';

-- ── 2. Reglas: proveedor + operación + flow → agente y paso ──
--
-- Una regla por línea WHEN y en el orden en que se evalúan (gana la primera).
-- La prueba de paridad lee estas líneas tal cual: conserva el formato.

CREATE OR REPLACE FUNCTION public.provider_usage_agent_dimensions(
  p_provider_key text,
  p_operation_key text,
  p_flow text
) RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE
    WHEN p_provider_key IN ('anthropic') AND p_operation_key IN ('company_classification') AND p_flow = 'claude_rescue' THEN ARRAY['agent1', 'rescate']
    WHEN p_provider_key IN ('anthropic') AND p_operation_key IN ('company_classification') THEN ARRAY['agent1', 'clasificador']
    WHEN p_provider_key IN ('anthropic') AND p_operation_key IN ('company_domain_search') THEN ARRAY['agent1', 'rescate_web']
    WHEN p_provider_key IN ('anthropic') AND p_operation_key IN ('company_search') THEN ARRAY['agent1', 'claude_busca_empresas']
    WHEN p_provider_key IN ('tavily') AND p_operation_key IN ('multi_query_web_search', 'linkedin_company_search', 'rich_profile_enrichment', 'web_search') THEN ARRAY['agent1', 'busqueda_web']
    WHEN p_provider_key IN ('apollo') AND p_operation_key IN ('organizations_search', 'mixed_companies_search') THEN ARRAY['agent1', 'apollo']
    WHEN p_provider_key IN ('apollo') AND p_operation_key IN ('organization_enrichment') THEN ARRAY['agent1', 'enriquecer_empresa']
    WHEN p_provider_key IN ('lusha') AND p_operation_key IN ('company_prospecting_v3') THEN ARRAY['agent1', 'lusha']
    WHEN p_provider_key IN ('hubspot') THEN ARRAY['agent1', 'duplicados_hubspot']
    WHEN p_provider_key IN ('apollo', 'lusha') AND p_operation_key IN ('people_search', 'bulk_people_search', 'contact_search', 'contacts_search') THEN ARRAY['agent2a', 'buscar_contactos']
    WHEN p_provider_key IN ('apollo', 'lusha') AND p_operation_key IN ('person_match', 'person_enrich', 'people_enrich', 'lusha_contact_search', 'lusha_contact_enrich') THEN ARRAY['agent2a', 'identificar_contacto']
    WHEN p_provider_key IN ('apollo', 'lusha') AND strpos(p_operation_key, 'cache_hit') > 0 THEN ARRAY['agent2a', 'telefono_en_cache']
    WHEN p_provider_key IN ('apollo', 'lusha') AND strpos(p_operation_key, 'reveal') > 0 THEN ARRAY['agent2a', 'revelar_telefono']
    WHEN p_provider_key IN ('apollo', 'lusha') AND strpos(p_operation_key, 'search_more') > 0 THEN ARRAY['agent2a', 'revelar_telefono']
    WHEN p_provider_key IN ('apollo', 'lusha') AND starts_with(p_operation_key, 'lusha_contact_') THEN ARRAY['agent2a', 'buscar_contactos']
    ELSE ARRAY[NULL::text, NULL::text]
  END;
$$;

-- agent_runs.agent_key → vocabulario de las consultas. Lo desconocido se conserva.
CREATE OR REPLACE FUNCTION public.provider_usage_agent_from_run(p_run_agent_key text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_temp
AS $$
  SELECT CASE
    WHEN p_run_agent_key IN ('prospect_generation', 'candidate_enrichment') THEN 'agent1'
    WHEN p_run_agent_key IN ('agent_2a_contact_enrichment') THEN 'agent2a'
    ELSE NULLIF(btrim(p_run_agent_key), '')
  END;
$$;

-- Lote → [país, macro industria, forma de búsqueda].
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
      WHEN b.source = 'agent_1' THEN 'exploratory'
      WHEN b.source IN ('imported', 'external_import') THEN 'import'
      ELSE NULL
    END
  ]
  FROM public.prospect_batches AS b
  WHERE b.id = p_batch_id;
$$;

-- ── 3. Disparador ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.provider_usage_logs_fill_dimensions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_temp
AS $$
DECLARE
  v_agent text[];
  v_run_agent text;
  v_batch text[];
BEGIN
  IF NEW.agent_key IS NULL OR NEW.agent_step IS NULL THEN
    v_agent := public.provider_usage_agent_dimensions(
      NEW.provider_key, NEW.operation_key, NEW.metadata ->> 'flow'
    );
    IF NEW.agent_key IS NULL THEN
      NEW.agent_key := v_agent[1];
      IF NEW.agent_key IS NULL AND NEW.agent_run_id IS NOT NULL THEN
        SELECT public.provider_usage_agent_from_run(r.agent_key)
          INTO v_run_agent
          FROM public.agent_runs AS r
         WHERE r.id = NEW.agent_run_id;
        NEW.agent_key := v_run_agent;
      END IF;
    END IF;
    -- El paso sólo se completa si la regla es del mismo agente que la fila.
    IF NEW.agent_step IS NULL AND v_agent[1] IS NOT DISTINCT FROM NEW.agent_key THEN
      NEW.agent_step := v_agent[2];
    END IF;
  END IF;

  IF NEW.batch_id IS NOT NULL
     AND (NEW.country_code IS NULL OR NEW.macro_industry_key IS NULL OR NEW.search_mode IS NULL) THEN
    v_batch := public.provider_usage_batch_dimensions(NEW.batch_id);
    IF v_batch IS NOT NULL THEN
      NEW.country_code := COALESCE(NEW.country_code, v_batch[1]);
      NEW.macro_industry_key := COALESCE(NEW.macro_industry_key, v_batch[2]);
      NEW.search_mode := COALESCE(NEW.search_mode, v_batch[3]);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_usage_logs_fill_dimensions ON public.provider_usage_logs;
CREATE TRIGGER provider_usage_logs_fill_dimensions
  BEFORE INSERT ON public.provider_usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.provider_usage_logs_fill_dimensions();

-- Las funciones son internas: sólo service_role (y el disparador) las usan.
REVOKE ALL ON FUNCTION public.provider_usage_agent_dimensions(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_usage_agent_from_run(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_usage_batch_dimensions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_usage_logs_fill_dimensions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provider_usage_agent_dimensions(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_usage_agent_from_run(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_usage_batch_dimensions(uuid) TO service_role;

-- ── 4. Relleno de las filas existentes (idempotente) ─────────

UPDATE public.provider_usage_logs AS l
   SET agent_key = (public.provider_usage_agent_dimensions(l.provider_key, l.operation_key, l.metadata ->> 'flow'))[1]
 WHERE l.agent_key IS NULL
   AND (public.provider_usage_agent_dimensions(l.provider_key, l.operation_key, l.metadata ->> 'flow'))[1] IS NOT NULL;

UPDATE public.provider_usage_logs AS l
   SET agent_key = public.provider_usage_agent_from_run(r.agent_key)
  FROM public.agent_runs AS r
 WHERE l.agent_key IS NULL
   AND l.agent_run_id = r.id
   AND public.provider_usage_agent_from_run(r.agent_key) IS NOT NULL;

UPDATE public.provider_usage_logs AS l
   SET agent_step = (public.provider_usage_agent_dimensions(l.provider_key, l.operation_key, l.metadata ->> 'flow'))[2]
 WHERE l.agent_step IS NULL
   AND l.agent_key IS NOT NULL
   AND (public.provider_usage_agent_dimensions(l.provider_key, l.operation_key, l.metadata ->> 'flow'))[1] = l.agent_key
   AND (public.provider_usage_agent_dimensions(l.provider_key, l.operation_key, l.metadata ->> 'flow'))[2] IS NOT NULL;

UPDATE public.provider_usage_logs AS l
   SET country_code = (public.provider_usage_batch_dimensions(l.batch_id))[1]
 WHERE l.country_code IS NULL
   AND l.batch_id IS NOT NULL
   AND (public.provider_usage_batch_dimensions(l.batch_id))[1] IS NOT NULL;

UPDATE public.provider_usage_logs AS l
   SET macro_industry_key = (public.provider_usage_batch_dimensions(l.batch_id))[2]
 WHERE l.macro_industry_key IS NULL
   AND l.batch_id IS NOT NULL
   AND (public.provider_usage_batch_dimensions(l.batch_id))[2] IS NOT NULL;

UPDATE public.provider_usage_logs AS l
   SET search_mode = (public.provider_usage_batch_dimensions(l.batch_id))[3]
 WHERE l.search_mode IS NULL
   AND l.batch_id IS NOT NULL
   AND (public.provider_usage_batch_dimensions(l.batch_id))[3] IS NOT NULL;

-- ── 5. Índices ───────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_provider_usage_created_at
  ON public.provider_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_usage_agent_key
  ON public.provider_usage_logs (agent_key)
  WHERE agent_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_provider_usage_country_code
  ON public.provider_usage_logs (country_code)
  WHERE country_code IS NOT NULL;
