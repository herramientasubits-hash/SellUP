-- ============================================================
-- 016: Auditoría de integraciones externas
-- ============================================================
-- Propósito: Registrar eventos administrativos sobre integraciones
-- para trazabilidad completa. Nunca almacena tokens ni datos sensibles.
-- ============================================================

CREATE TABLE IF NOT EXISTS integration_audit (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key TEXT NOT NULL,    -- 'hubspot', 'slack', etc.
  event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                      'credential_stored',
                      'credential_updated',
                      'connection_tested',
                      'connection_succeeded',
                      'connection_failed',
                      'disconnected'
                    )),
  actor_user_id   UUID REFERENCES internal_users(id) ON DELETE SET NULL,
  metadata        JSONB,            -- Info no sensible: error_code, hub_id, scopes, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_key
  ON integration_audit (integration_key);

CREATE INDEX IF NOT EXISTS idx_integration_audit_actor
  ON integration_audit (actor_user_id);

CREATE INDEX IF NOT EXISTS idx_integration_audit_created
  ON integration_audit (created_at DESC);

-- ============================================================
-- RLS: Solo administradores activos pueden leer auditoría
-- ============================================================
ALTER TABLE integration_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_integration_audit"
  ON integration_audit
  FOR SELECT
  TO authenticated
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

-- ============================================================
-- Función helper para insertar eventos de auditoría (service role)
-- ============================================================
CREATE OR REPLACE FUNCTION log_integration_event(
  p_integration_key TEXT,
  p_event_type      TEXT,
  p_actor_user_id   UUID,
  p_metadata        JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO integration_audit (
    integration_key,
    event_type,
    actor_user_id,
    metadata
  )
  VALUES (
    p_integration_key,
    p_event_type,
    p_actor_user_id,
    p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
