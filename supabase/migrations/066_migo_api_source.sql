-- ============================================================
-- Migration 066: Migo API Source Connection
-- ============================================================
-- Añade Migo API (Perú) como fuente configurable en el catálogo
-- con almacenamiento de credenciales en Vault.
--
-- Migo API es un proveedor privado peruano que ofrece consulta de
-- RUC con actividades económicas y CIIU via API REST.
-- ============================================================

-- ── 1. Seed en source_catalog_connections ──────────────────────

INSERT INTO source_catalog_connections (
    source_key,
    source_name_snapshot,
    country_code,
    auth_type,
    requires_credentials,
    credentials_status,
    connection_status,
    vault_secret_name,
    metadata
) VALUES (
    'pe_migo_api',
    'Migo API Perú',
    'PE',
    'api_key',
    TRUE,
    'missing',
    'not_tested',
    'sellup_source_pe_migo_api_api_key',
    '{
        "source_provider": "migo_api",
        "source_type": "structured_registry",
        "source_mode": "pilot",
        "catalog_key": "pe_migo_api"
    }'::jsonb
)
ON CONFLICT (source_key) DO NOTHING;

-- ── 2. Extender integration_audit.event_type ───────────────────

ALTER TABLE integration_audit
  DROP CONSTRAINT IF EXISTS integration_audit_event_type_check;

ALTER TABLE integration_audit
  ADD CONSTRAINT integration_audit_event_type_check CHECK (event_type IN (
    -- Eventos genéricos
    'credential_stored',
    'credential_updated',
    'connection_tested',
    'connection_succeeded',
    'connection_failed',
    'disconnected',
    -- Eventos OAuth (Slack)
    'oauth_started',
    'oauth_connected',
    'oauth_failed',
    -- Eventos de canal y mensajería (Slack)
    'channel_created',
    'test_message_sent',
    -- Eventos específicos de Samu IA
    'samu_api_key_stored',
    'samu_api_key_updated',
    'samu_connection_tested',
    'samu_connection_succeeded',
    'samu_connection_failed',
    'samu_disconnected',
    -- Eventos específicos de Tavily
    'tavily_api_key_stored',
    'tavily_api_key_updated',
    'tavily_connection_tested',
    'tavily_connection_succeeded',
    'tavily_connection_failed',
    'tavily_disconnected',
    -- Eventos específicos de Google CSE
    'google_cse_credentials_stored',
    'google_cse_credentials_updated',
    'google_cse_connection_tested',
    'google_cse_connection_succeeded',
    'google_cse_connection_failed',
    'google_cse_disconnected',
    -- Eventos específicos de Migo API
    'migo_api_key_stored',
    'migo_api_key_updated',
    'migo_connection_tested',
    'migo_connection_succeeded',
    'migo_connection_failed',
    'migo_disconnected'
  ));

-- ── 3. Verification ────────────────────────────────────────────

SELECT
  source_key,
  auth_type,
  requires_credentials,
  credentials_status,
  connection_status,
  vault_secret_name
FROM source_catalog_connections
WHERE source_key = 'pe_migo_api';
