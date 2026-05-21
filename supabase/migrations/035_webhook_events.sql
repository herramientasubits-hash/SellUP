-- Migration 035: integration_webhook_events
-- Stores raw inbound webhook payloads for inspection and future processing.
-- RLS: service_role INSERT only, admin SELECT only.

CREATE TABLE IF NOT EXISTS public.integration_webhook_events (
  id               uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key  text             NOT NULL,
  event_source     text             NOT NULL,
  event_type       text,
  headers          jsonb            NOT NULL DEFAULT '{}',
  payload          jsonb,
  raw_body         text,
  received_at      timestamptz      NOT NULL DEFAULT now(),
  processed_status text             NOT NULL DEFAULT 'received',
  processing_notes text
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_webhook_events_integration_key
  ON public.integration_webhook_events (integration_key);

CREATE INDEX IF NOT EXISTS idx_webhook_events_received_at
  ON public.integration_webhook_events (received_at DESC);

-- Enable RLS
ALTER TABLE public.integration_webhook_events ENABLE ROW LEVEL SECURITY;

-- Service role can insert (webhook handler uses service role)
CREATE POLICY "service_role_insert_webhook_events"
  ON public.integration_webhook_events
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Admins can read all events (mirrors integration_audit pattern)
CREATE POLICY "admin_select_webhook_events"
  ON public.integration_webhook_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM internal_users iu
      JOIN roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );
