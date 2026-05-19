-- Roles base para SellUp
-- Este catálogo define los roles operativos del sistema

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed de roles base
INSERT INTO roles (key, name, description) VALUES
    ('admin', 'Administrador', 'Acceso completo a configuración y gestión de usuarios'),
    ('seller_bd', 'Vendedor / BD', 'Usuario de ventas y desarrollo de negocio'),
    ('commercial_manager', 'Manager comercial', 'Gestión de equipo comercial y reportes'),
    ('commercial_lead', 'Líder comercial', 'Liderazgo de equipo y supervisión de cuentas')
ON CONFLICT (key) DO NOTHING;

-- Función para obtener rol por key
CREATE OR REPLACE FUNCTION get_role_by_key(p_key TEXT)
RETURNS UUID AS $$
    SELECT id FROM roles WHERE key = p_key;
$$ LANGUAGE sql STABLE;

-- Función para obtener todos los roles
CREATE OR REPLACE FUNCTION get_all_roles()
RETURNS TABLE(id UUID, key TEXT, name TEXT, description TEXT) AS $$
    SELECT id, key, name, description FROM roles ORDER BY name;
$$ LANGUAGE sql STABLE;