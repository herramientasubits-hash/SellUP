-- Tabla de auditoría para eventos de acceso de usuarios
-- Registra todas las decisiones administrativas sobre usuarios

CREATE TABLE IF NOT EXISTS access_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID NOT NULL REFERENCES internal_users(id),
    target_user_id UUID NOT NULL REFERENCES internal_users(id),
    action_type TEXT NOT NULL CHECK (
        action_type IN ('approved', 'rejected', 'suspended', 'reactivated', 'role_changed', 'created')
    ),
    previous_status TEXT,
    new_status TEXT,
    previous_role_id UUID REFERENCES roles(id),
    new_role_id UUID REFERENCES roles(id),
    reason TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice para auditoría por usuario objetivo
CREATE INDEX IF NOT EXISTS idx_access_audit_target_user ON access_audit(target_user_id);

-- Índice para auditoría por actor
CREATE INDEX IF NOT EXISTS idx_access_audit_actor ON access_audit(actor_user_id);

-- Índice para auditoría por fecha
CREATE INDEX IF NOT EXISTS idx_access_audit_created ON access_audit(created_at DESC);

-- Función para registrar evento de auditoría de acceso
CREATE OR REPLACE FUNCTION log_access_event(
    p_actor_user_id UUID,
    p_target_user_id UUID,
    p_action_type TEXT,
    p_previous_status TEXT DEFAULT NULL,
    p_new_status TEXT DEFAULT NULL,
    p_previous_role_id UUID DEFAULT NULL,
    p_new_role_id UUID DEFAULT NULL,
    p_reason TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO access_audit (
        actor_user_id,
        target_user_id,
        action_type,
        previous_status,
        new_status,
        previous_role_id,
        new_role_id,
        reason,
        metadata
    ) VALUES (
        p_actor_user_id,
        p_target_user_id,
        p_action_type,
        p_previous_status,
        p_new_status,
        p_previous_role_id,
        p_new_role_id,
        p_reason,
        p_metadata
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql;

-- Función para obtener historial de acceso de un usuario
CREATE OR REPLACE FUNCTION get_user_access_history(p_target_user_id UUID)
RETURNS TABLE(
    id UUID,
    action_type TEXT,
    previous_status TEXT,
    new_status TEXT,
    previous_role_key TEXT,
    new_role_key TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ,
    actor_email TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        aa.id,
        aa.action_type,
        aa.previous_status,
        aa.new_status,
        pr.key,
        nr.key,
        aa.reason,
        aa.created_at,
        au.email
    FROM access_audit aa
    JOIN internal_users au ON aa.actor_user_id = au.id
    LEFT JOIN roles pr ON aa.previous_role_id = pr.id
    LEFT JOIN roles nr ON aa.new_role_id = nr.id
    WHERE aa.target_user_id = p_target_user_id
    ORDER BY aa.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE;