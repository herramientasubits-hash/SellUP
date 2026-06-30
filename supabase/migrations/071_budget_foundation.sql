-- Migration 071: Provider budget foundation (Hito A — Créditos y presupuestos)
--
-- Crea la fundación técnica mínima para el módulo de Créditos y presupuestos.
-- No modifica datos operativos. No hace backfill. No crea UI. No implementa
-- enforcement. No toca Agente 1, Apollo, ChileCompra ni SUNAT.
--
-- Cambios:
--   A. tool_catalog          — catálogo de proveedores/herramientas + seed inicial
--   B. budget_rules          — reglas de límite por proveedor/scope/periodo
--   C. provider_usage_logs   — columnas snapshot de rol y grupo al momento del consumo
--
-- Tablas nuevas: tool_catalog, budget_rules
-- Tabla extendida: provider_usage_logs (aditivo — histórico queda NULL)

-- ═══════════════════════════════════════════════════════════════
-- A. tool_catalog — catálogo técnico de proveedores/herramientas
-- ═══════════════════════════════════════════════════════════════
--
-- Registro canónico de cada herramienta que genera consumo en SellUp.
-- provider_key es la clave de negocio (única, texto), coherente con
-- provider_usage_logs.provider_key y provider_pricing_config.provider_key.
--
-- Este catálogo es de configuración, no de consumo. No contiene datos
-- operativos ni históricos. El seed inicial es idempotente.

CREATE TABLE IF NOT EXISTS public.tool_catalog (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key     TEXT        NOT NULL UNIQUE,
  display_name     TEXT        NOT NULL,
  tool_type        TEXT        NOT NULL
    CONSTRAINT tool_catalog_tool_type_valid
      CHECK (tool_type IN ('llm', 'data_enrichment', 'web_search', 'crm', 'other')),
  consumption_unit TEXT        NOT NULL
    CONSTRAINT tool_catalog_consumption_unit_valid
      CHECK (consumption_unit IN ('tokens', 'credits', 'requests', 'usd_estimated')),
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  notes            TEXT        NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at (reutiliza función set_updated_at existente en el proyecto)
DROP TRIGGER IF EXISTS tool_catalog_set_updated_at ON public.tool_catalog;
CREATE TRIGGER tool_catalog_set_updated_at
  BEFORE UPDATE ON public.tool_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Índices
CREATE INDEX IF NOT EXISTS idx_tool_catalog_is_active
  ON public.tool_catalog (is_active);

CREATE INDEX IF NOT EXISTS idx_tool_catalog_tool_type
  ON public.tool_catalog (tool_type);

-- RLS: solo service_role puede leer y escribir (mismo patrón que wizard_*)
ALTER TABLE public.tool_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.tool_catalog;
CREATE POLICY "service_role full access"
  ON public.tool_catalog
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Seed inicial — 7 proveedores base.
-- ON CONFLICT DO UPDATE garantiza idempotencia: volver a correr la migración
-- actualiza display_name/tool_type/consumption_unit sin duplicar filas.
INSERT INTO public.tool_catalog
  (provider_key, display_name, tool_type, consumption_unit, is_active)
VALUES
  ('anthropic', 'Claude (Anthropic)',  'llm',              'tokens',        true),
  ('openai',    'GPT (OpenAI)',        'llm',              'tokens',        true),
  ('gemini',    'Gemini (Google)',     'llm',              'tokens',        true),
  ('tavily',    'Tavily Search',       'web_search',       'credits',       true),
  ('apollo',    'Apollo.io',          'data_enrichment',  'credits',       true),
  ('lusha',     'Lusha',              'data_enrichment',  'credits',       true),
  ('samu_ia',   'Samu IA',            'llm',              'usd_estimated', true)
ON CONFLICT (provider_key) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  tool_type        = EXCLUDED.tool_type,
  consumption_unit = EXCLUDED.consumption_unit,
  is_active        = EXCLUDED.is_active,
  updated_at       = now();

-- ═══════════════════════════════════════════════════════════════
-- B. budget_rules — reglas de límite presupuestal
-- ═══════════════════════════════════════════════════════════════
--
-- Una regla define un límite (en créditos y/o USD) para un proveedor
-- dentro de un scope (global / rol / grupo / usuario) y un periodo
-- (mensual / trimestral / anual / custom).
--
-- Este hito solo crea la estructura. No hay enforcement todavía.
-- La columna on_exceed está presente para informar enforcement futuro.
--
-- FK a tool_catalog: real via provider_key TEXT UNIQUE.
-- Si tool_catalog.provider_key se borra en el futuro, la FK SET NULL no
-- aplica a TEXT; documentamos la relación como lógica con REFERENCES real.

CREATE TABLE IF NOT EXISTS public.budget_rules (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK lógica al catálogo: mismo valor que tool_catalog.provider_key
  provider_key   TEXT          NOT NULL
    REFERENCES public.tool_catalog(provider_key)
      ON UPDATE CASCADE
      ON DELETE RESTRICT,
  scope_type     TEXT          NOT NULL
    CONSTRAINT budget_rules_scope_type_valid
      CHECK (scope_type IN ('global', 'role', 'group', 'user')),
  -- NULL solo permitido cuando scope_type = 'global' (ver constraint abajo)
  scope_id       TEXT          NULL,
  period_type    TEXT          NOT NULL DEFAULT 'monthly'
    CONSTRAINT budget_rules_period_type_valid
      CHECK (period_type IN ('monthly', 'quarterly', 'annual', 'custom')),
  -- Al menos uno de limit_credits / limit_usd debe ser NOT NULL (ver constraint)
  limit_credits  NUMERIC(14,4) NULL
    CONSTRAINT budget_rules_limit_credits_positive
      CHECK (limit_credits IS NULL OR limit_credits > 0),
  limit_usd      NUMERIC(12,6) NULL
    CONSTRAINT budget_rules_limit_usd_positive
      CHECK (limit_usd IS NULL OR limit_usd > 0),
  on_exceed      TEXT          NOT NULL DEFAULT 'alert'
    CONSTRAINT budget_rules_on_exceed_valid
      CHECK (on_exceed IN ('alert', 'block', 'require_approval')),
  is_active      BOOLEAN       NOT NULL DEFAULT true,
  notes          TEXT          NULL,
  created_by     UUID          NULL
    REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),

  -- Integridad scope: global => scope_id NULL; otros => scope_id NOT NULL
  CONSTRAINT budget_rules_scope_id_coherence
    CHECK (
      (scope_type = 'global' AND scope_id IS NULL)
      OR
      (scope_type <> 'global' AND scope_id IS NOT NULL)
    ),

  -- Al menos uno de los límites debe estar presente
  CONSTRAINT budget_rules_at_least_one_limit
    CHECK (limit_credits IS NOT NULL OR limit_usd IS NOT NULL)
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS budget_rules_set_updated_at ON public.budget_rules;
CREATE TRIGGER budget_rules_set_updated_at
  BEFORE UPDATE ON public.budget_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Unicidad de reglas por provider + scope ─────────────────────────────────
--
-- Postgres permite múltiples NULLs en un índice UNIQUE estándar, por lo que
-- UNIQUE(provider_key, scope_type, scope_id) permitiría varias reglas globales.
-- Solución: índice funcional con COALESCE para que NULL ≡ '__global__'.
--
-- Una sola expresión cubre ambos casos (global y no-global) sin dos índices.

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_rules_unique_scope
  ON public.budget_rules (provider_key, scope_type, COALESCE(scope_id, '__global__'));

-- Índices adicionales
CREATE INDEX IF NOT EXISTS idx_budget_rules_provider_key
  ON public.budget_rules (provider_key);

CREATE INDEX IF NOT EXISTS idx_budget_rules_scope_type_id
  ON public.budget_rules (scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_budget_rules_is_active
  ON public.budget_rules (is_active);

CREATE INDEX IF NOT EXISTS idx_budget_rules_provider_active
  ON public.budget_rules (provider_key, is_active);

-- RLS: mismo patrón que wizard_pilot_settings
ALTER TABLE public.budget_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON public.budget_rules;
CREATE POLICY "service_role full access"
  ON public.budget_rules
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- C. provider_usage_logs — snapshot de rol y grupo al momento del consumo
-- ═══════════════════════════════════════════════════════════════
--
-- Agrega dos columnas de snapshot al momento del log. Permite reportes
-- históricos correctos aunque el usuario cambie de rol/grupo después.
--
-- No hace backfill: histórico queda NULL.
-- No modifica datos operativos.
-- Idempotente (ADD COLUMN IF NOT EXISTS).

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS triggered_by_role_key TEXT NULL;

ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS triggered_by_group_id UUID NULL
    REFERENCES public.organization_groups(id) ON DELETE SET NULL;

-- Índice sparse: solo filas con rol poblado (logs nuevos post-migración)
CREATE INDEX IF NOT EXISTS idx_provider_usage_role_key
  ON public.provider_usage_logs (triggered_by_role_key)
  WHERE triggered_by_role_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_group_id
  ON public.provider_usage_logs (triggered_by_group_id)
  WHERE triggered_by_group_id IS NOT NULL;
