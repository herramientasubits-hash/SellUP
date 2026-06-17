-- Migration 063: Tavily pricing and batch traceability (16AB.43.9)
-- Non-destructive: adds batch_id and usage_key to provider_usage_logs;
-- inserts Tavily pricing at public Pay-as-you-go reference rate.
--
-- Changes:
--   1. batch_id  — optional FK to prospect_batches(id) ON DELETE SET NULL
--   2. usage_key — optional internal idempotency key for SellUp-generated logs
--   3. Tavily pricing config: USD 0.008 per credit (estimated_cost_usd basis only)
--
-- No backfill. No RLS changes. No policy changes. No grant changes.
-- Historical logs keep batch_id = NULL and usage_key = NULL.

-- ═══════════════════════════════════════════════════════════════
-- 1. batch_id — direct relation to prospect_batches
--
-- Nullable, no default. Historical logs unaffected.
-- ON DELETE SET NULL preserves economic traceability when a batch
-- is deleted; the log row survives with batch_id = NULL.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS batch_id UUID NULL
    REFERENCES public.prospect_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_provider_usage_batch_id
  ON public.provider_usage_logs (batch_id)
  WHERE batch_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. usage_key — internal SellUp idempotency key
--
-- Nullable, no default. Historical logs unaffected.
-- Example future key: tavily:{batchId}:round:{n}:multi_query
-- Unique only among non-NULL values (partial unique index).
-- External Tavily request IDs are not used; identity is SellUp-owned.
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.provider_usage_logs
  ADD COLUMN IF NOT EXISTS usage_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_usage_usage_key_unique
  ON public.provider_usage_logs (usage_key)
  WHERE usage_key IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. Tavily pricing — Pay-as-you-go public reference rate
--
-- Conflict target: partial unique index idx_provider_pricing_active_unique
-- on (provider_key, operation_key, unit) WHERE is_active = true.
-- DO UPDATE ensures correct rate if migration is ever re-run.
--
-- estimated_cost_usd = credits_used × 0.008
-- real_cost_usd stays NULL until billing reconciliation.
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, currency, notes, is_active)
VALUES (
  'tavily',
  'multi_query_web_search',
  'per_credit',
  0.00800000,
  'USD',
  'Pricing basis: Tavily public Pay-as-you-go reference rate. '
  'Reference rate: USD 0.008 per API credit. '
  'Basic Search: 1 credit per query. '
  'Advanced Search: 2 credits per query. '
  'Current operational plan: Researcher Free, 1,000 monthly credits, Pay as you go disabled. '
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
