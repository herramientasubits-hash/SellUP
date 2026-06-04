-- Migration 054: Crear la tabla hubspot_owner_mappings
-- Permite mapear dinámicamente correos de asesores con sus HubSpot Owner IDs.

CREATE TABLE IF NOT EXISTS hubspot_owner_mappings (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_user_email TEXT        NOT NULL,
    hubspot_owner_id    TEXT        NOT NULL,
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    created_by          UUID        NULL REFERENCES internal_users(id) ON DELETE SET NULL,
    metadata            JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at
DROP TRIGGER IF EXISTS hubspot_owner_mappings_set_updated_at ON hubspot_owner_mappings;
CREATE TRIGGER hubspot_owner_mappings_set_updated_at
    BEFORE UPDATE ON hubspot_owner_mappings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Índice para búsquedas rápidas por email
CREATE INDEX IF NOT EXISTS idx_hubspot_owner_mappings_email ON hubspot_owner_mappings(internal_user_email);

-- Constraint única para evitar duplicados activos por email
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_user_email
    ON hubspot_owner_mappings (internal_user_email)
    WHERE (is_active = true);

-- RLS
ALTER TABLE hubspot_owner_mappings ENABLE ROW LEVEL SECURITY;

-- Politicas RLS
CREATE POLICY "active_users_can_read_hubspot_owner_mappings"
    ON hubspot_owner_mappings FOR SELECT
    TO authenticated
    USING (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_insert_hubspot_owner_mappings"
    ON hubspot_owner_mappings FOR INSERT
    TO authenticated
    WITH CHECK (has_active_access(auth.uid()));

CREATE POLICY "active_users_can_update_hubspot_owner_mappings"
    ON hubspot_owner_mappings FOR UPDATE
    TO authenticated
    USING (has_active_access(auth.uid()))
    WITH CHECK (has_active_access(auth.uid()));

-- Seed inicial de mappings existentes en el codigo
INSERT INTO hubspot_owner_mappings (internal_user_email, hubspot_owner_id, is_active)
VALUES
  ('soporte@sellup.co', '12345678', true),
  ('growth@sellup.co', '87654321', true),
  ('admin@sellup.co', '11223344', true),
  ('qa@sellup.co', '44332211', true)
ON CONFLICT (internal_user_email) WHERE (is_active = true) DO NOTHING;

COMMENT ON TABLE hubspot_owner_mappings IS
    'Mapeo dinámico entre correos internos de UBITS/SellUp y HubSpot Owner IDs.';
