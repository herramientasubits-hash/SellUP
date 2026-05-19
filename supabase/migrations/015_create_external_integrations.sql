-- ============================================================
-- 015: Integraciones externas — catálogo, credenciales y estado
-- ============================================================
-- Propósito: Almacenar el catálogo de integraciones disponibles,
-- las credenciales de acceso de forma segura, y el estado de
-- conexión por integración. Diseñado para ser reutilizable más
-- allá de HubSpot.
-- ============================================================

-- ============================================================
-- Tabla: external_integrations (catálogo)
-- ============================================================
CREATE TABLE IF NOT EXISTS external_integrations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key  TEXT UNIQUE NOT NULL,       -- 'hubspot', 'slack', etc.
  name             TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL DEFAULT 'commercial_crm'
                     CHECK (category IN ('commercial_crm', 'communication', 'storage', 'ai', 'other')),
  is_available     BOOLEAN NOT NULL DEFAULT false, -- true = operativa, false = próximamente
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_integrations_key
  ON external_integrations (integration_key);

CREATE INDEX IF NOT EXISTS idx_external_integrations_available
  ON external_integrations (is_available);

-- ============================================================
-- Tabla: external_integration_credentials (almacén seguro de tokens)
-- Equivalente a ai_provider_credentials pero para integraciones externas.
-- El token NUNCA se devuelve al frontend — solo se lee en server-side.
-- ============================================================
CREATE TABLE IF NOT EXISTS external_integration_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key TEXT UNIQUE NOT NULL,   -- FK conceptual a external_integrations.integration_key
  credential      TEXT NOT NULL,          -- Token / API key (solo server-side)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No exponemos esta tabla al cliente. El acceso es solo service role.

-- ============================================================
-- Tabla: external_integration_connections (estado de conexión)
-- ============================================================
CREATE TABLE IF NOT EXISTS external_integration_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id        UUID NOT NULL REFERENCES external_integrations(id) ON DELETE CASCADE,
  auth_type             TEXT NOT NULL DEFAULT 'private_app_access_token'
                          CHECK (auth_type IN ('private_app_access_token', 'oauth2', 'api_key')),
  credentials_status    TEXT NOT NULL DEFAULT 'missing'
                          CHECK (credentials_status IN ('missing', 'stored')),
  connection_status     TEXT NOT NULL DEFAULT 'not_tested'
                          CHECK (connection_status IN ('not_tested', 'connected', 'error', 'disconnected')),
  last_tested_at        TIMESTAMPTZ,
  last_tested_by        UUID REFERENCES internal_users(id) ON DELETE SET NULL,
  last_connection_error TEXT,
  connected_at          TIMESTAMPTZ,
  connected_by          UUID REFERENCES internal_users(id) ON DELETE SET NULL,
  disconnected_at       TIMESTAMPTZ,
  disconnected_by       UUID REFERENCES internal_users(id) ON DELETE SET NULL,
  metadata              JSONB,   -- hub_id, app_id, scopes, etc. (SIN datos sensibles)
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_integration_connections_unique
  ON external_integration_connections (integration_id);

CREATE INDEX IF NOT EXISTS idx_external_integration_connections_status
  ON external_integration_connections (connection_status);

-- ============================================================
-- Trigger: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION update_external_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_external_integrations_updated_at
  BEFORE UPDATE ON external_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_external_integrations_updated_at();

CREATE OR REPLACE FUNCTION update_external_integration_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_external_integration_connections_updated_at
  BEFORE UPDATE ON external_integration_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_external_integration_connections_updated_at();

-- ============================================================
-- RLS: external_integrations
-- Solo administradores activos pueden leer el catálogo.
-- ============================================================
ALTER TABLE external_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_external_integrations"
  ON external_integrations
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
-- RLS: external_integration_connections
-- Solo administradores activos pueden leer y modificar estado.
-- ============================================================
ALTER TABLE external_integration_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_integration_connections"
  ON external_integration_connections
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

CREATE POLICY "admins_can_insert_integration_connections"
  ON external_integration_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM internal_users iu
      JOIN roles r ON r.id = iu.role_id
      WHERE iu.auth_user_id = auth.uid()
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    )
  );

CREATE POLICY "admins_can_update_integration_connections"
  ON external_integration_connections
  FOR UPDATE
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
-- Seeds: catálogo de integraciones
-- ============================================================
INSERT INTO external_integrations (integration_key, name, description, category, is_available)
VALUES
  (
    'hubspot',
    'HubSpot CRM',
    'Conecta SellUp con HubSpot para validar información de cuentas, detectar duplicados por dominio y preparar sincronizaciones controladas.',
    'commercial_crm',
    true
  ),
  (
    'slack',
    'Slack',
    'Notificaciones y alertas del sistema en canales de Slack.',
    'communication',
    false
  ),
  (
    'google_drive',
    'Google Drive',
    'Almacenamiento y acceso a documentos comerciales desde SellUp.',
    'storage',
    false
  ),
  (
    'samu_ia',
    'Samu IA',
    'Motor de inteligencia artificial especializado para operaciones comerciales avanzadas.',
    'ai',
    false
  )
ON CONFLICT (integration_key) DO NOTHING;

-- ============================================================
-- Seeds: conexión inicial para HubSpot (vacía, lista para configurar)
-- ============================================================
INSERT INTO external_integration_connections (
  integration_id,
  auth_type,
  credentials_status,
  connection_status
)
SELECT
  id,
  'private_app_access_token',
  'missing',
  'not_tested'
FROM external_integrations
WHERE integration_key = 'hubspot'
ON CONFLICT DO NOTHING;
