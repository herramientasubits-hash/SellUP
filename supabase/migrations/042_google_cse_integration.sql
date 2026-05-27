-- ============================================================
-- Migration 042: Google Custom Search Engine integration
-- ============================================================
-- Propósito: Registrar Google CSE como integración administrable
-- de búsqueda web en el catálogo de integraciones de SellUp.
--
-- Patrón: Idéntico a Tavily (041) y Samu IA (034).
-- Reutiliza external_integrations / external_integration_connections
-- sin tablas nuevas.
--
-- Seguridad:
--   Las credenciales se almacenan exclusivamente en Supabase Vault.
--   Vault secret names:
--     sellup_google_cse_api_key  — Google Cloud API Key (Restricted)
--     sellup_google_cse_cx       — Programmable Search Engine ID
--   No se guardan en texto plano en ninguna tabla relacional.
--
-- Auth type: api_key (dos secrets independientes en Vault).
--
-- Categoría: 'other' (búsqueda web; no es CRM, comunicación,
-- almacenamiento ni IA generativa — igual que Tavily).
--
-- Límites API:
--   100 consultas/día gratis.
--   $5 por 1,000 consultas adicionales (~$0.005/query).
--   Máximo 10 resultados por query (restricción del API).
-- ============================================================

-- ============================================================
-- 1. Insertar Google CSE en el catálogo de integraciones
-- ============================================================
INSERT INTO external_integrations (
  integration_key,
  name,
  description,
  category,
  is_available
)
VALUES (
  'google_cse',
  'Google Custom Search',
  'Proveedor de búsqueda web via Google Custom Search Engine. Complementa a Tavily con cobertura de resultados de Google para investigación y validación de prospectos.',
  'other',
  true
)
ON CONFLICT (integration_key) DO UPDATE
  SET
    name         = EXCLUDED.name,
    description  = EXCLUDED.description,
    is_available = EXCLUDED.is_available,
    updated_at   = NOW();

-- ============================================================
-- 2. Crear registro de conexión inicial (idempotente)
-- ============================================================
INSERT INTO external_integration_connections (
  integration_id,
  auth_type,
  credentials_status,
  connection_status
)
SELECT
  ei.id,
  'api_key',
  'missing',
  'not_tested'
FROM external_integrations ei
WHERE ei.integration_key = 'google_cse'
  AND NOT EXISTS (
    SELECT 1
    FROM   external_integration_connections eic
    WHERE  eic.integration_id = ei.id
  );

-- ============================================================
-- 3. Extender integration_audit.event_type con eventos de Google CSE
-- ============================================================
ALTER TABLE integration_audit
  DROP CONSTRAINT IF EXISTS integration_audit_event_type_check;

ALTER TABLE integration_audit
  ADD CONSTRAINT integration_audit_event_type_check CHECK (event_type IN (
    -- Eventos genéricos (HubSpot, Tavily y futuros)
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
    'google_cse_disconnected'
  ));

-- ============================================================
-- Verification
-- ============================================================
SELECT
  ei.integration_key,
  ei.name,
  ei.is_available,
  eic.auth_type,
  eic.credentials_status,
  eic.connection_status
FROM external_integrations ei
LEFT JOIN external_integration_connections eic ON eic.integration_id = ei.id
WHERE ei.integration_key = 'google_cse';
