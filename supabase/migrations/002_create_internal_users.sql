-- Tabla de usuarios internos de SellUp
-- Vincula auth.users con el estado de acceso interno

CREATE TABLE IF NOT EXISTS internal_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    access_status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (
        access_status IN ('pending_approval', 'active', 'rejected', 'suspended')
    ),
    role_id UUID REFERENCES roles(id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES internal_users(id),
    rejected_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES internal_users(id),
    suspended_at TIMESTAMPTZ,
    suspended_by UUID REFERENCES internal_users(id),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para búsquedas por email
CREATE INDEX IF NOT EXISTS idx_internal_users_email ON internal_users(email);

-- Índice para búsquedas por status
CREATE INDEX IF NOT EXISTS idx_internal_users_status ON internal_users(access_status);

-- Índice para búsquedas por role
CREATE INDEX IF NOT EXISTS idx_internal_users_role ON internal_users(role_id);

-- Función para crear o actualizar usuario interno desde auth.users
CREATE OR REPLACE FUNCTION sync_internal_user(
    p_auth_user_id UUID,
    p_email TEXT,
    p_full_name TEXT DEFAULT NULL,
    p_avatar_url TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_internal_user_id UUID;
    v_exists BOOLEAN;
BEGIN
    -- Verificar si ya existe
    SELECT EXISTS(SELECT 1 FROM internal_users WHERE auth_user_id = p_auth_user_id) INTO v_exists;

    IF v_exists THEN
        -- Actualizar datos pero NO el status
        UPDATE internal_users
        SET full_name = COALESCE(p_full_name, full_name),
            avatar_url = COALESCE(p_avatar_url, avatar_url),
            updated_at = NOW()
        WHERE auth_user_id = p_auth_user_id
        RETURNING id INTO v_internal_user_id;
    ELSE
        -- Crear nuevo usuario interno con status pendiente
        INSERT INTO internal_users (auth_user_id, email, full_name, avatar_url, access_status)
        VALUES (p_auth_user_id, p_email, p_full_name, p_avatar_url, 'pending_approval')
        RETURNING id INTO v_internal_user_id;
    END IF;

    RETURN v_internal_user_id;
END;
$$ LANGUAGE plpgsql;

-- Función para obtener usuario interno por auth_user_id
CREATE OR REPLACE FUNCTION get_internal_user(p_auth_user_id UUID)
RETURNS TABLE(
    id UUID,
    auth_user_id UUID,
    email TEXT,
    full_name TEXT,
    avatar_url TEXT,
    access_status TEXT,
    role_id UUID,
    role_key TEXT,
    requested_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    suspended_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        iu.id,
        iu.auth_user_id,
        iu.email,
        iu.full_name,
        iu.avatar_url,
        iu.access_status,
        iu.role_id,
        r.key,
        iu.requested_at,
        iu.approved_at,
        iu.rejected_at,
        iu.suspended_at,
        iu.last_login_at
    FROM internal_users iu
    LEFT JOIN roles r ON iu.role_id = r.id
    WHERE iu.auth_user_id = p_auth_user_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Función para verificar si el usuario tiene acceso activo
CREATE OR REPLACE FUNCTION has_active_access(p_auth_user_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS(
        SELECT 1 FROM internal_users
        WHERE auth_user_id = p_auth_user_id
        AND access_status = 'active'
    );
$$ LANGUAGE sql STABLE;

-- Función para verificar si el usuario es administrador
CREATE OR REPLACE FUNCTION is_admin(p_auth_user_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS(
        SELECT 1 FROM internal_users iu
        JOIN roles r ON iu.role_id = r.id
        WHERE iu.auth_user_id = p_auth_user_id
        AND iu.access_status = 'active'
        AND r.key = 'admin'
    );
$$ LANGUAGE sql STABLE;