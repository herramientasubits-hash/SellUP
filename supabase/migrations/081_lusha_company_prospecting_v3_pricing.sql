-- ============================================================
-- Migration 081: Pricing Lusha company_prospecting_v3 (Q3F-5S / Q3F-5S.2)
-- ============================================================
-- Lusha V3 Company Prospecting endpoint: POST /v3/companies/prospecting
-- Mismo contrato que migration 037: USD 300/mes cobrados anualmente = USD 3,600/año
-- / 40,800 créditos compartidos/mes → 0.08823529 USD por crédito.
--
-- Observado en Q3F-5R (microbenchmark real 2026-07):
--   billing.creditsCharged=1 en 3 de 3 requests con pagination.size=10.
--   Esto NO garantiza "1 crédito/request" como regla contractual universal.
--   El cálculo runtime SIEMPRE usa el valor real de billing.creditsCharged.
--   Si billing.creditsCharged=3 → credits_used=3 → estimatedCost=3×unit_cost_usd.
--
-- unit = 'per_credit' (igual que 'organizations_search' en migration 072).
-- Estado: EXPERIMENTAL, no conectado a producción. Activado en Q3F-5S.
--
-- Deterministic UPDATE + INSERT WHERE NOT EXISTS is used to guarantee the desired
-- active pricing state for the partial unique index. ON CONFLICT is not used.
-- ============================================================

-- PASO A: actualizar fila activa si ya existe
UPDATE public.provider_pricing_config
SET
  unit_cost_usd = 0.08823529,
  currency      = 'USD',
  notes         = 'Lusha V3 Company Prospecting (POST /v3/companies/prospecting). Contrato: USD 300/mes cobrados anualmente = USD 3,600/año / 40,800 créditos/mes. Observado Q3F-5R: billing.creditsCharged=1 en 3/3 requests con size=10. Costo runtime usa billing.creditsCharged real — no asumir 1 crédito/request. Estado: EXPERIMENTAL, no conectado a producción. Activado en Q3F-5S.',
  is_active     = true,
  updated_at    = now()
WHERE
  provider_key   = 'lusha'
  AND operation_key = 'company_prospecting_v3'
  AND unit          = 'per_credit'
  AND is_active     = true;

-- PASO B: insertar solo si no existe fila activa con esa identidad
INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
SELECT
  'lusha',
  'company_prospecting_v3',
  'per_credit',
  0.08823529,
  'USD',
  'Lusha V3 Company Prospecting (POST /v3/companies/prospecting). Contrato: USD 300/mes cobrados anualmente = USD 3,600/año / 40,800 créditos/mes. Observado Q3F-5R: billing.creditsCharged=1 en 3/3 requests con size=10. Costo runtime usa billing.creditsCharged real — no asumir 1 crédito/request. Estado: EXPERIMENTAL, no conectado a producción. Activado en Q3F-5S.',
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.provider_pricing_config
  WHERE provider_key   = 'lusha'
    AND operation_key  = 'company_prospecting_v3'
    AND unit           = 'per_credit'
    AND is_active      = true
);
