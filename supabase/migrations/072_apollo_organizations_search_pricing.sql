-- ============================================================
-- Migration 072: Pricing Apollo organizations_search (v1.16K-X)
-- ============================================================
-- Apollo Agent 1 company discovery: organizations_search
-- Mismo contrato que migration 037: USD 4,200 / 480,000 créditos compartidos.
-- → 0.00875000 USD por crédito.
--
-- MAX_APOLLO_ORGANIZATIONS_PER_RUN = 10
-- → MAX estimated cost per run = 10 × 0.00875 = 0.0875 USD
-- ============================================================

INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES
  (
    'apollo',
    'organizations_search',
    'per_credit',
    0.00875000,
    'USD',
    'Agent 1 company discovery. Contrato Apollo: USD 4,200 / 480,000 créditos. Cap duro: 10 orgs/run = máx 0.0875 USD estimado. Activado en v1.16K-X.',
    true
  )
ON CONFLICT DO NOTHING;
