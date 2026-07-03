-- ============================================================
-- Migration 079: Pricing Apollo organization_enrichment (v1.L2.15)
-- ============================================================
-- Apollo Enrichment Cascade: /organizations/enrich
-- Mismo contrato que migration 037 y 072: USD 4,200 / 480,000 créditos compartidos.
-- → 0.00875000 USD por crédito.
--
-- AGENT1_APOLLO_MAX_ENRICHMENTS_PER_RUN = 1 (default)
-- HARD_MAX_ENRICHMENTS_CAP = 3
-- → MAX estimated cost per run = 3 × 0.00875 = 0.02625 USD
-- ============================================================

INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES
  (
    'apollo',
    'organization_enrichment',
    'per_credit',
    0.00875000,
    'USD',
    'Agent 1 enrichment cascade. Contrato Apollo: USD 4,200 / 480,000 créditos. Cap duro: 3 enrichments/run = máx 0.02625 USD estimado. Activado en v1.L2.15.',
    true
  )
ON CONFLICT DO NOTHING;
