-- ============================================================
-- 018: Proveedores de prospección y enriquecimiento
-- ============================================================
-- Propósito: Catálogo de proveedores externos contemplados para
-- generación, validación y enriquecimiento de prospectos.
--
-- Decisión de arquitectura: Tabla dedicada (NO reutiliza
-- external_integrations) porque los proveedores de prospección
-- tienen un ciclo de vida distinto (planned → prepared → connected)
-- y no tienen credenciales ni estado de conexión operativo aún.
-- Mezclarlos en external_integrations contaminaria la semántica
-- de integraciones comerciales (HubSpot, Slack, etc.).
--
-- Extensión futura:
--   1. Agregar columna `vault_secret_id` cuando se defina el proveedor activo.
--   2. Agregar tabla `prospecting_provider_connections` para estado de conexión.
--   3. Agregar columna `active_provider_key` en una tabla de config global.
--   4. Las automatizaciones y batch jobs consultarán getActiveProspectingProvider()
--      para decidir qué proveedor usar, sin lógica quemada en código.
-- ============================================================

-- ============================================================
-- Tabla: prospecting_providers (catálogo de proveedores)
-- ============================================================
CREATE TABLE IF NOT EXISTS prospecting_providers (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key              TEXT UNIQUE NOT NULL,     -- 'apollo', 'lusha', 'future_provider'
  name                      TEXT NOT NULL,
  description               TEXT,
  provider_type             TEXT NOT NULL DEFAULT 'prospecting_and_enrichment'
                              CHECK (provider_type IN (
                                'prospecting',
                                'enrichment',
                                'prospecting_and_enrichment'
                              )),
  lifecycle_status          TEXT NOT NULL DEFAULT 'planned'
                              CHECK (lifecycle_status IN (
                                'planned',       -- Contemplado, sin evaluación de integración
                                'prepared',      -- Arquitectura lista, pendiente decisión de negocio
                                'connected',     -- Conectado y operativo (uso futuro)
                                'inactive'       -- Deshabilitado tras haber estado activo (uso futuro)
                              )),
  is_available_for_selection BOOLEAN NOT NULL DEFAULT false, -- true = se puede elegir como proveedor activo
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prospecting_providers_key
  ON prospecting_providers (provider_key);

CREATE INDEX IF NOT EXISTS idx_prospecting_providers_lifecycle
  ON prospecting_providers (lifecycle_status);

-- ============================================================
-- Trigger: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION update_prospecting_providers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prospecting_providers_updated_at
  BEFORE UPDATE ON prospecting_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_prospecting_providers_updated_at();

-- ============================================================
-- RLS: Solo administradores activos pueden leer el catálogo.
-- Escritura no expuesta en UI — providers gestionados como seeds.
-- ============================================================
ALTER TABLE prospecting_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_can_read_prospecting_providers"
  ON prospecting_providers
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
-- Seeds: proveedores contemplados
-- lifecycle_status = 'prepared': arquitectura lista para conectar
-- lifecycle_status = 'planned': contemplado, sin evaluación aún
-- ============================================================
INSERT INTO prospecting_providers (
  provider_key,
  name,
  description,
  provider_type,
  lifecycle_status,
  is_available_for_selection
)
VALUES
  (
    'apollo',
    'Apollo.io',
    'Plataforma de inteligencia comercial con base de datos de +270M de contactos. Permite prospección, búsqueda de decisores y enriquecimiento de cuentas con datos firmográficos y tecnográficos.',
    'prospecting_and_enrichment',
    'prepared',
    false
  ),
  (
    'lusha',
    'Lusha',
    'Herramienta de enriquecimiento de datos B2B enfocada en datos de contacto verificados. Especializada en búsqueda de emails directos y teléfonos de decisores.',
    'enrichment',
    'prepared',
    false
  ),
  (
    'future_provider',
    'Proveedor alternativo futuro',
    'Espacio reservado para un proveedor de prospección o enriquecimiento adicional que se evaluará según necesidades del negocio.',
    'prospecting_and_enrichment',
    'planned',
    false
  )
ON CONFLICT (provider_key) DO NOTHING;
