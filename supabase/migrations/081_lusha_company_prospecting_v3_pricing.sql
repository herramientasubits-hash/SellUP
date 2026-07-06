-- ============================================================
-- Migration 081: Pricing Lusha company_prospecting_v3 (Q3F-5S)
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
-- ============================================================

INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES
  (
    'lusha',
    'company_prospecting_v3',
    'per_credit',
    0.08823529,
    'USD',
    'Lusha V3 Company Prospecting (POST /v3/companies/prospecting). Contrato: USD 300/mes cobrados anualmente = USD 3,600/año / 40,800 créditos/mes. Observado Q3F-5R: billing.creditsCharged=1 en 3/3 requests con size=10. Costo runtime usa billing.creditsCharged real — no asumir 1 crédito/request. Estado: EXPERIMENTAL, no conectado a producción. Activado en Q3F-5S.',
    true
  )
ON CONFLICT DO NOTHING;
