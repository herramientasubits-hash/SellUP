-- Migration 036: usage_tracking_foundation
-- Foundation for tracking agent executions, provider calls, costs, and result quality.
-- All inserts are server-side only (service_role). Admins can read via SELECT policies.

-- ============================================================
-- TABLE: agent_runs
-- One row per complete agent execution.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key            text              NOT NULL,
  agent_name           text              NULL,
  triggered_by         uuid              NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  status               text              NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending','running','completed','failed','cancelled')),
  input_params         jsonb             NOT NULL DEFAULT '{}'::jsonb,
  results_requested    integer           NULL,
  results_generated    integer           NULL DEFAULT 0,
  results_unique       integer           NULL DEFAULT 0,
  results_approved     integer           NULL DEFAULT 0,
  results_discarded    integer           NULL DEFAULT 0,
  estimated_cost_usd   numeric(12,6)     NULL DEFAULT 0,
  real_cost_usd        numeric(12,6)     NULL,
  started_at           timestamptz       NULL DEFAULT now(),
  finished_at          timestamptz       NULL,
  error_message        text              NULL,
  metadata             jsonb             NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz       NOT NULL DEFAULT now(),
  updated_at           timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_key    ON public.agent_runs (agent_key);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status       ON public.agent_runs (status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_triggered_by ON public.agent_runs (triggered_by);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at   ON public.agent_runs (created_at DESC);

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_agent_runs"
  ON public.agent_runs FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_role_update_agent_runs"
  ON public.agent_runs FOR UPDATE TO service_role USING (true);

CREATE POLICY "admin_select_agent_runs"
  ON public.agent_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );

-- ============================================================
-- TABLE: agent_run_steps
-- One row per internal step within an agent execution.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id         uuid              NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  step_key             text              NOT NULL,
  step_name            text              NULL,
  provider_key         text              NULL,
  status               text              NOT NULL DEFAULT 'attempted'
                                         CHECK (status IN ('skipped','attempted','success','error')),
  results_returned     integer           NULL DEFAULT 0,
  results_useful       integer           NULL DEFAULT 0,
  estimated_cost_usd   numeric(12,6)     NULL DEFAULT 0,
  real_cost_usd        numeric(12,6)     NULL,
  duration_ms          integer           NULL,
  error_message        text              NULL,
  metadata             jsonb             NOT NULL DEFAULT '{}'::jsonb,
  started_at           timestamptz       NULL DEFAULT now(),
  finished_at          timestamptz       NULL,
  created_at           timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run_id      ON public.agent_run_steps (agent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_run_steps_provider_key ON public.agent_run_steps (provider_key);

ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_agent_run_steps"
  ON public.agent_run_steps FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_role_update_agent_run_steps"
  ON public.agent_run_steps FOR UPDATE TO service_role USING (true);

CREATE POLICY "admin_select_agent_run_steps"
  ON public.agent_run_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );

-- ============================================================
-- TABLE: provider_usage_logs
-- One row per call to any external provider or AI model.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_usage_logs (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id         uuid              NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  agent_run_step_id    uuid              NULL REFERENCES public.agent_run_steps(id) ON DELETE SET NULL,
  provider_key         text              NOT NULL,
  operation_key        text              NOT NULL,
  model                text              NULL,
  input_tokens         integer           NULL DEFAULT 0,
  output_tokens        integer           NULL DEFAULT 0,
  credits_used         numeric(12,4)     NULL,
  results_returned     integer           NULL DEFAULT 0,
  estimated_cost_usd   numeric(12,6)     NULL DEFAULT 0,
  real_cost_usd        numeric(12,6)     NULL,
  status               text              NOT NULL DEFAULT 'success'
                                         CHECK (status IN ('success','error','rate_limited','quota_exceeded')),
  error_code           text              NULL,
  error_message        text              NULL,
  duration_ms          integer           NULL,
  triggered_by         uuid              NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  metadata             jsonb             NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_provider_key  ON public.provider_usage_logs (provider_key);
CREATE INDEX IF NOT EXISTS idx_provider_usage_operation_key ON public.provider_usage_logs (operation_key);
CREATE INDEX IF NOT EXISTS idx_provider_usage_agent_run_id  ON public.provider_usage_logs (agent_run_id);
CREATE INDEX IF NOT EXISTS idx_provider_usage_created_at    ON public.provider_usage_logs (created_at DESC);

ALTER TABLE public.provider_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_provider_usage_logs"
  ON public.provider_usage_logs FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "admin_select_provider_usage_logs"
  ON public.provider_usage_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );

-- ============================================================
-- TABLE: provider_pricing_config
-- Configurable cost estimates per provider + operation.
-- Admins manage this; agents read it to compute estimated costs.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.provider_pricing_config (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key         text              NOT NULL,
  operation_key        text              NOT NULL,
  unit                 text              NOT NULL
                                         CHECK (unit IN ('per_request','per_result','per_1k_tokens','per_credit')),
  unit_cost_usd        numeric(12,8)     NOT NULL DEFAULT 0,
  currency             text              NOT NULL DEFAULT 'USD',
  notes                text              NULL,
  effective_from       date              NOT NULL DEFAULT current_date,
  is_active            boolean           NOT NULL DEFAULT true,
  created_by           uuid              NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  created_at           timestamptz       NOT NULL DEFAULT now(),
  updated_at           timestamptz       NOT NULL DEFAULT now()
);

-- Only one active config per provider + operation + unit
CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_pricing_active_unique
  ON public.provider_pricing_config (provider_key, operation_key, unit)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_provider_pricing_lookup
  ON public.provider_pricing_config (provider_key, operation_key, is_active);

ALTER TABLE public.provider_pricing_config ENABLE ROW LEVEL SECURITY;

-- Service role reads pricing config to compute estimates inside agents
CREATE POLICY "service_role_all_provider_pricing_config"
  ON public.provider_pricing_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Admins can read and manage pricing config
CREATE POLICY "admin_all_provider_pricing_config"
  ON public.provider_pricing_config FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );

-- Seed: placeholder rows with unit_cost_usd = 0 to signal "must be configured".
-- Real prices vary by plan and contract — admins must update these values.
INSERT INTO public.provider_pricing_config
  (provider_key, operation_key, unit, unit_cost_usd, notes, is_active)
VALUES
  ('apollo',    'company_search',  'per_result',    0, 'Configure según plan Apollo. Precio varía por contrato.', true),
  ('apollo',    'person_enrich',   'per_result',    0, 'Configure según plan Apollo. Precio varía por contrato.', true),
  ('lusha',     'person_enrich',   'per_result',    0, 'Configure según plan Lusha. Precio varía por contrato.', true),
  ('lusha',     'company_enrich',  'per_result',    0, 'Configure según plan Lusha. Precio varía por contrato.', true),
  ('anthropic', 'input_token',     'per_1k_tokens', 0, 'Configure según modelo Anthropic activo.', true),
  ('anthropic', 'output_token',    'per_1k_tokens', 0, 'Configure según modelo Anthropic activo.', true),
  ('openai',    'input_token',     'per_1k_tokens', 0, 'Configure según modelo OpenAI activo.', true),
  ('openai',    'output_token',    'per_1k_tokens', 0, 'Configure según modelo OpenAI activo.', true),
  ('hubspot',   'api_call',        'per_request',   0, 'HubSpot no cobra por llamada de API directamente. Mantener en 0 salvo acuerdo diferente.', true)
ON CONFLICT DO NOTHING;

-- ============================================================
-- TABLE: result_quality_events
-- Lifecycle events for each result generated by an agent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.result_quality_events (
  id                   uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id         uuid              NULL REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  result_type          text              NOT NULL
                                         CHECK (result_type IN ('prospect','company','contact','meeting','other')),
  result_id            uuid              NULL,
  external_id          text              NULL,
  event_type           text              NOT NULL
                                         CHECK (event_type IN (
                                           'generated','normalized','duplicate_detected',
                                           'discarded','approved','converted_to_account',
                                           'sent_to_hubspot','contact_useful','contact_invalid'
                                         )),
  source_key           text              NULL
                                         CHECK (source_key IN (
                                           'internal_db','hubspot','apollo','lusha',
                                           'samu_ia','web_ai','preloaded'
                                         ) OR source_key IS NULL),
  performed_by         uuid              NULL REFERENCES public.internal_users(id) ON DELETE SET NULL,
  notes                text              NULL,
  metadata             jsonb             NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_result_quality_agent_run_id ON public.result_quality_events (agent_run_id);
CREATE INDEX IF NOT EXISTS idx_result_quality_event_type   ON public.result_quality_events (event_type);
CREATE INDEX IF NOT EXISTS idx_result_quality_source_key   ON public.result_quality_events (source_key);
CREATE INDEX IF NOT EXISTS idx_result_quality_created_at   ON public.result_quality_events (created_at DESC);

ALTER TABLE public.result_quality_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_insert_result_quality_events"
  ON public.result_quality_events FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "admin_select_result_quality_events"
  ON public.result_quality_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.internal_users iu
      JOIN public.roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );
