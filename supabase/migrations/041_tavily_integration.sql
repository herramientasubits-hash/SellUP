-- ============================================================
-- Migration 041: Tavily web search integration
-- ============================================================
-- Propósito: Registrar Tavily como integración administrable
-- de búsqueda web en el catálogo de integraciones de SellUp.
--
-- Patrón: Idéntico a Samu IA (034) — reutiliza
-- external_integrations / external_integration_connections
-- sin necesidad de tablas nuevas.
--
-- Seguridad:
--   La API key se almacena exclusivamente en Supabase Vault.
--   Vault secret name: sellup_tavily_api_key
--   No se guarda en texto plano en ninguna tabla relacional.
--
-- Categoría: 'other' (búsqueda web / investigación; no es CRM,
-- comunicación, almacenamiento ni IA generativa).
--
-- Default: Tavily NO reemplaza el provider mock del web_search_tool.
--   El mock sigue siendo el provider por defecto.
--   Tavily solo se activa cuando el admin configura la API key
--   y el código invoca explícitamente provider='tavily'.
--
-- Créditos Tavily:
--   El plan gratuito incluye ~1,000 búsquedas/mes.
--   Cada búsqueda consume 1 crédito.
--   El test de conexión consume 1 crédito.
--   Mantener Tavily desactivado para usuarios finales
--   hasta validar calidad y costos.
-- ============================================================

-- ============================================================
-- 1. Insertar Tavily en el catálogo de integraciones
-- ============================================================
INSERT INTO external_integrations (
  integration_key,
  name,
  description,
  category,
  is_available
)
VALUES (
  'tavily',
  'Tavily',
  'Proveedor de búsqueda web inteligente para validar empresas, sitios web y fuentes públicas. Usado por el Agente 1 para investigación y verificación de prospectos.',
  'other',
  true
)
ON CONFLICT (integration_key) DO UPDATE
  SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    is_available = EXCLUDED.is_available,
    updated_at  = NOW();

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
WHERE ei.integration_key = 'tavily'
  AND NOT EXISTS (
    SELECT 1
    FROM   external_integration_connections eic
    WHERE  eic.integration_id = ei.id
  );

-- ============================================================
-- 3. Extender integration_audit.event_type
--    Incluir los eventos genéricos usados por Tavily
--    (credential_stored, credential_updated, connection_tested,
--     connection_succeeded, connection_failed, disconnected)
--    ya están en el constraint desde la migración 016 / 019.
--    No se requiere extensión adicional para Tavily.
--
--    También se corrige retroactivamente: se agrega soporte
--    para los eventos de Samu IA que actualmente violarían
--    el constraint si el constraint aún existe estrictamente.
-- ============================================================
ALTER TABLE integration_audit
  DROP CONSTRAINT IF EXISTS integration_audit_event_type_check;

-- Constraint ampliado: genérico + OAuth (Slack) + Samu + Tavily
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
    'tavily_disconnected'
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
WHERE ei.integration_key = 'tavily';
