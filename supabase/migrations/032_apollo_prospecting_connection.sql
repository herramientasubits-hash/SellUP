-- ============================================================
-- 032: Conexión real de Apollo.io — prospecting_provider_connections
-- ============================================================
-- Propósito: Habilitar la primera integración real de Prospección
-- y Enriquecimiento. Crea la tabla de conexión de proveedores de
-- prospección, preparada para Apollo.io como primer proveedor
-- real y extensible a Lusha u otros futuros.
--
-- Decisión de arquitectura:
--   Se usa una tabla separada (prospecting_provider_connections)
--   en lugar de external_integration_connections para mantener la
--   semántica diferenciada entre integraciones comerciales
--   (HubSpot, Slack) y proveedores de datos de prospección.
--   vault_secret_id referencia lógica a vault.secrets — no FK
--   física para evitar dependencias cross-schema.
--
-- Extensión futura:
--   Esta tabla soportará Lusha y cualquier proveedor adicional.
--   La columna provider_id + UNIQUE constraint garantiza una
--   conexión activa por proveedor.
-- ============================================================

-- ============================================================
-- Tabla: prospecting_provider_connections
-- ============================================================
CREATE TABLE IF NOT EXISTS prospecting_provider_connections (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id             UUID        NOT NULL
                            REFERENCES prospecting_providers(id) ON DELETE CASCADE,
  vault_secret_id         UUID,                          -- Ref lógica a vault.secrets.id
  credentials_status      TEXT        NOT NULL DEFAULT 'missing'
                            CHECK (credentials_status IN (
                              'missing',   -- Sin credencial en Vault
                              'stored'     -- API key presente en Vault
                            )),
  connection_status       TEXT        NOT NULL DEFAULT 'not_connected'
                            CHECK (connection_status IN (
                              'not_connected',   -- Sin credencial configurada
                              'not_tested',      -- Credencial guardada, sin probar
                              'connected',       -- Health check exitoso
                              'error',           -- Health check fallido
                              'disconnected'     -- Desconectado voluntariamente
                            )),
  last_tested_at          TIMESTAMPTZ,
  last_connected_at       TIMESTAMPTZ,
  last_connection_error   TEXT,
  configured_by           UUID        REFERENCES internal_users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una única conexión activa por proveedor
  CONSTRAINT uq_prospecting_provider_connection UNIQUE (provider_id)
);

CREATE INDEX IF NOT EXISTS idx_ppc_provider_id
  ON prospecting_provider_connections (provider_id);

CREATE INDEX IF NOT EXISTS idx_ppc_connection_status
  ON prospecting_provider_connections (connection_status);

-- ============================================================
-- Trigger: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION update_prospecting_provider_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ppc_updated_at
  BEFORE UPDATE ON prospecting_provider_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_prospecting_provider_connections_updated_at();

-- ============================================================
-- RLS: Solo administradores activos pueden leer conexiones.
-- Las escrituras van siempre por service role desde Server Actions.
-- ============================================================
ALTER TABLE prospecting_provider_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_prospecting_connections"
  ON prospecting_provider_connections
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
-- Extender integration_audit.event_type para Apollo
-- Los eventos de Apollo siguen el patrón genérico existente:
-- credential_stored, credential_updated, connection_tested,
-- connection_succeeded, connection_failed, disconnected.
-- No se requiere extensión del constraint existente ya que
-- Apollo reutiliza los tipos genéricos con integration_key='apollo'.
-- ============================================================
-- (Sin cambios al constraint — los tipos genéricos son suficientes)

-- ============================================================
-- Extender RLS de prospecting_providers para permitir
-- actualización de lifecycle_status desde service role.
-- (El service role bypasses RLS — no se requiere policy adicional)
-- ============================================================

-- ============================================================
-- Comentario arquitectónico
-- ============================================================
-- Apollo.io se conecta mediante API Key almacenada en Vault.
-- Vault secret name: sellup_prospecting_apollo_api_key
-- Health check endpoint: GET https://api.apollo.io/v1/auth/health
--   Header: X-Api-Key: {api_key}
--   200 OK + { is_logged_in: true } = conexión válida
--   No consume búsquedas ni créditos del plan.
--
-- Al conectar exitosamente:
--   prospecting_providers.lifecycle_status → 'connected'
--   prospecting_providers.is_available_for_selection → true
-- Al desconectar:
--   prospecting_providers.lifecycle_status → 'prepared'
--   prospecting_providers.is_available_for_selection → false
--
-- Endpoints futuros (no activos en esta migración):
--   POST /api/v1/mixed_companies/search   → búsqueda de empresas
--   GET  /api/v1/organizations/enrich     → enriquecimiento de empresa
--   POST /api/v1/mixed_people/api_search  → búsqueda de personas (requiere master key)
--   POST /api/v1/people/match             → enriquecimiento de persona
-- ============================================================
