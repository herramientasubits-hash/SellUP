-- Fix: sync_internal_user necesita SECURITY DEFINER para poder hacer INSERT
-- cuando lo llama un usuario nuevo que aún no tiene registro en internal_users.
-- Sin esto, la política RLS "Admins can insert internal users" bloquea el INSERT
-- y el usuario queda en un estado fantasma (no aparece como pendiente para el admin).

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
$$ LANGUAGE plpgsql SECURITY DEFINER;
