-- Migration 069: Tavily LinkedIn company search pricing (Agent 1 · v1.16K-R-B)
-- Non-destructive: inserts a dedicated provider_pricing_config row so the
-- controlled LinkedIn company search (operation_key = 'linkedin_company_search')
-- can resolve unit_cost_usd and record estimated_cost_usd > 0 in
-- provider_usage_logs once ENABLE_LINKEDIN_COMPANY_SEARCH is enabled.
--
-- Context:
--   provider_usage_logs already records logs with
--   operation_key = 'linkedin_company_search', but there was no matching
--   provider_pricing_config row. Without it, the wiring could not resolve a
--   unit cost and estimated_cost_usd would land at 0/NULL — breaking economic
--   traceability and budget tracking. This migration closes that gap.
--
-- Scope:
--   - Adds exactly one row: tavily / linkedin_company_search / per_credit.
--   - Same reference rate as Tavily multi_query_web_search: USD 0.008 per credit.
--   - Basic Search = 1 credit/query (controlled search uses basic depth only).
--   - DOES NOT modify the existing multi_query_web_search, Apollo, or Lusha rows.
--   - No backfill. No RLS/policy/grant changes. No flag activation.
--
-- estimated_cost_usd = credits_used × 0.008
-- real_cost_usd stays NULL until billing reconciliation.

-- ═══════════════════════════════════════════════════════════════
-- Tavily LinkedIn company search pricing — Pay-as-you-go reference rate
--
-- Conflict target: partial unique index idx_provider_pricing_active_unique
-- on (provider_key, operation_key, unit) WHERE is_active = true.
-- DO UPDATE ensures the correct rate if this migration is ever re-run.
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES (
  'tavily',
  'linkedin_company_search',
  'per_credit',
  0.00800000,
  'USD',
  'Pricing basis: Tavily public Pay-as-you-go reference rate. '
  'Reference rate: USD 0.008 per API credit. '
  'Controlled LinkedIn company URL search uses Basic Search: 1 credit per query. '
  'Strictly capped: maxPerBatch 3, maxQueriesPerCandidate 1, maxResultsPerQuery 1. '
  'Same unit cost as tavily/multi_query_web_search; defined separately so '
  'linkedin_company_search usage logs resolve estimated_cost_usd > 0. '
  'This rate is used for estimated_cost_usd only. '
  'It does not represent reconciled real invoiced cost (real_cost_usd remains NULL until billing reconciliation).',
  true
)
ON CONFLICT (provider_key, operation_key, unit) WHERE is_active = true
DO UPDATE SET
  unit_cost_usd = EXCLUDED.unit_cost_usd,
  currency      = EXCLUDED.currency,
  notes         = EXCLUDED.notes,
  updated_at    = now();
