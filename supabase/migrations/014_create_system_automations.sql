-- ============================================================
-- 014: Automatizaciones del sistema (capa de configuración)
-- ============================================================
-- Propósito: Almacenar configuración de qué comportamientos de SellUp
-- son manuales, sugeridos o automáticos.
-- Esta tabla es consultada por módulos operativos (Pipeline, Cuentas,
-- agentes) para decidir cómo comportarse ante eventos clave.
-- NO ejecuta ningún flujo real — solo almacena configuración.
-- ============================================================

-- Tabla principal
CREATE TABLE IF NOT EXISTS system_automations (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_key               TEXT UNIQUE NOT NULL,
  name                         TEXT NOT NULL,
  description                  TEXT,
  trigger_key                  TEXT NOT NULL,
  category                     TEXT NOT NULL DEFAULT 'prospecting',
  execution_mode               TEXT NOT NULL DEFAULT 'manual'
                                 CHECK (execution_mode IN ('manual', 'suggested', 'automatic')),
  is_available                 BOOLEAN NOT NULL DEFAULT true,
  requires_ai_provider         BOOLEAN NOT NULL DEFAULT false,
  requires_prospecting_provider BOOLEAN NOT NULL DEFAULT false,
  requires_hubspot             BOOLEAN NOT NULL DEFAULT false,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                   UUID REFERENCES internal_users(id) ON DELETE SET NULL
);

-- Índice por categoría para filtrado eficiente
CREATE INDEX IF NOT EXISTS idx_system_automations_category
  ON system_automations (category);

-- Índice por trigger_key para consulta rápida desde módulos operativos
CREATE INDEX IF NOT EXISTS idx_system_automations_trigger_key
  ON system_automations (trigger_key);

-- Trigger para mantener updated_at actualizado
CREATE OR REPLACE FUNCTION update_system_automations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_system_automations_updated_at
  BEFORE UPDATE ON system_automations
  FOR EACH ROW
  EXECUTE FUNCTION update_system_automations_updated_at();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE system_automations ENABLE ROW LEVEL SECURITY;

-- Solo administradores activos pueden leer
CREATE POLICY "admins_can_read_system_automations"
  ON system_automations
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

-- Solo administradores activos pueden modificar
CREATE POLICY "admins_can_update_system_automations"
  ON system_automations
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
-- Seeds MVP: Dos automatizaciones iniciales de prospección
-- ============================================================
INSERT INTO system_automations (
  automation_key,
  name,
  description,
  trigger_key,
  category,
  execution_mode,
  is_available,
  requires_ai_provider,
  requires_prospecting_provider,
  requires_hubspot
)
VALUES
  (
    'enrich_on_manual_prospect_created',
    'Enriquecimiento inicial de prospecto manual',
    'Cuando un usuario crea manualmente una empresa o prospecto, SellUp puede enriquecer automáticamente los datos iniciales usando IA u omitir esta acción hasta que el usuario la dispare manualmente.',
    'manual_prospect_created',
    'prospecting',
    'suggested',
    true,
    true,
    false,
    false
  ),
  (
    'deepen_on_batch_prospect_approved',
    'Profundización inicial de prospecto aprobado desde lote',
    'Cuando un usuario aprueba un prospecto generado por IA o importado desde un proveedor externo, SellUp puede iniciar automáticamente la profundización de inteligencia de cuenta.',
    'batch_prospect_approved',
    'prospecting',
    'suggested',
    true,
    true,
    true,
    false
  )
ON CONFLICT (automation_key) DO NOTHING;
