-- ============================================================
-- 019: Slack OAuth Integration
-- ============================================================
-- Propósito:
--   1. Habilitar Slack como integración operativa (is_available = true).
--   2. Crear el registro de conexión inicial para Slack con auth_type = oauth2.
--   3. Extender integration_audit.event_type con eventos OAuth y canal.
-- ============================================================

-- ============================================================
-- 1. Activar Slack en el catálogo de integraciones
-- ============================================================
UPDATE external_integrations
SET
  is_available = true,
  description  = 'Conecta el workspace de Slack para crear un canal oficial de SellUp y habilitar futuras alertas y comunicaciones operativas.',
  updated_at   = NOW()
WHERE integration_key = 'slack';

-- ============================================================
-- 2. Insertar conexión inicial para Slack (si no existe)
-- ============================================================
INSERT INTO external_integration_connections (
  integration_id,
  auth_type,
  credentials_status,
  connection_status
)
SELECT
  id,
  'oauth2',
  'missing',
  'not_tested'
FROM external_integrations
WHERE integration_key = 'slack'
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. Extender integration_audit.event_type
--    Reemplazar el CHECK existente para incluir eventos OAuth y canal.
--    Nombre del constraint autogenerado: integration_audit_event_type_check
-- ============================================================
ALTER TABLE integration_audit
  DROP CONSTRAINT IF EXISTS integration_audit_event_type_check;

ALTER TABLE integration_audit
  ADD CONSTRAINT integration_audit_event_type_check CHECK (event_type IN (
    -- Eventos genéricos (HubSpot y futuros)
    'credential_stored',
    'credential_updated',
    'connection_tested',
    'connection_succeeded',
    'connection_failed',
    'disconnected',
    -- Eventos OAuth (Slack y futuros)
    'oauth_started',
    'oauth_connected',
    'oauth_failed',
    -- Eventos de canal y mensajería
    'channel_created',
    'test_message_sent'
  ));

-- ============================================================
-- Comentario arquitectónico
-- ============================================================
-- Slack usa OAuth v2 con bot token almacenado en Vault.
-- Vault secret name: sellup_integration_slack_bot_token
-- Metadata (no sensible) en external_integration_connections.metadata:
--   team_id, team_name, bot_user_id, scopes[], channel_id, channel_name.
-- El bot token NUNCA se almacena en tablas relacionales ni se expone al frontend.
-- ============================================================
