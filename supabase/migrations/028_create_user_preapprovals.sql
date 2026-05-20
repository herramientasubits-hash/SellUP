-- Tabla de preautorizaciones manuales de usuarios.
--
-- Flujo:
--   1. Admin crea preaprobación con email, rol, líder y grupo opcionales.
--   2. Cuando esa persona hace login con Google OAuth (@ubits.co),
--      sync_internal_user detecta la preaprobación pendiente, crea el
--      internal_user directamente como 'active' y marca la preaprobación
--      como 'claimed'.
--   3. Si no hay preaprobación, el usuario queda en 'pending_approval'
--      (flujo normal ya existente).
--
-- Esto mantiene internal_users limpio: solo usuarios con auth_user_id real.

CREATE TABLE IF NOT EXISTS user_preapprovals (
    id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email                   TEXT         NOT NULL,
    full_name               TEXT,
    role_id                 UUID         NOT NULL REFERENCES roles(id),
    manager_id              UUID         REFERENCES internal_users(id) ON DELETE SET NULL,
    group_id                UUID         REFERENCES organization_groups(id) ON DELETE SET NULL,
    status                  TEXT         NOT NULL DEFAULT 'pending_claim'
                                         CHECK (status IN ('pending_claim', 'claimed', 'cancelled')),
    created_by              UUID         NOT NULL REFERENCES internal_users(id),
    notes                   TEXT,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    claimed_at              TIMESTAMPTZ,
    claimed_by_auth_user_id UUID         REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Solo puede existir una preaprobación pendiente por email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_preapprovals_email_pending
    ON user_preapprovals(lower(email))
    WHERE status = 'pending_claim';

CREATE INDEX IF NOT EXISTS idx_preapprovals_email  ON user_preapprovals(lower(email));
CREATE INDEX IF NOT EXISTS idx_preapprovals_status ON user_preapprovals(status);

-- RLS
ALTER TABLE user_preapprovals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage preapprovals"
    ON user_preapprovals
    FOR ALL
    TO authenticated
    USING (is_admin(auth.uid()))
    WITH CHECK (is_admin(auth.uid()));

-- Ampliar action_type en access_audit para nuevos eventos
ALTER TABLE access_audit DROP CONSTRAINT IF EXISTS access_audit_action_type_check;
ALTER TABLE access_audit
    ADD CONSTRAINT access_audit_action_type_check
    CHECK (action_type IN (
        'approved', 'rejected', 'suspended', 'reactivated',
        'role_changed', 'created', 'manager_changed',
        'preauthorized', 'preapproval_cancelled',
        'group_assigned'
    ));

-- Actualizar sync_internal_user para reclamar preautorizaciones al primer login.
-- Mantiene SECURITY DEFINER (necesario para bypasear RLS en primer registro).
CREATE OR REPLACE FUNCTION sync_internal_user(
    p_auth_user_id UUID,
    p_email        TEXT,
    p_full_name    TEXT DEFAULT NULL,
    p_avatar_url   TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_internal_user_id UUID;
    v_exists           BOOLEAN;
    v_preapproval      RECORD;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM internal_users WHERE auth_user_id = p_auth_user_id
    ) INTO v_exists;

    IF v_exists THEN
        UPDATE internal_users
        SET full_name  = COALESCE(p_full_name, full_name),
            avatar_url = COALESCE(p_avatar_url, avatar_url),
            updated_at = NOW()
        WHERE auth_user_id = p_auth_user_id
        RETURNING id INTO v_internal_user_id;

    ELSE
        -- Buscar preautorización pendiente (case-insensitive)
        SELECT * INTO v_preapproval
        FROM user_preapprovals
        WHERE lower(email) = lower(p_email)
          AND status = 'pending_claim'
        LIMIT 1;

        IF FOUND THEN
            -- Activar directamente desde preaprobación
            INSERT INTO internal_users (
                auth_user_id, email, full_name, avatar_url,
                access_status, role_id, manager_id, group_id,
                approved_at
            ) VALUES (
                p_auth_user_id,
                p_email,
                COALESCE(p_full_name, v_preapproval.full_name),
                p_avatar_url,
                'active',
                v_preapproval.role_id,
                v_preapproval.manager_id,
                v_preapproval.group_id,
                NOW()
            )
            RETURNING id INTO v_internal_user_id;

            -- Marcar preaprobación como reclamada
            UPDATE user_preapprovals
            SET status                  = 'claimed',
                claimed_at              = NOW(),
                claimed_by_auth_user_id = p_auth_user_id,
                updated_at              = NOW()
            WHERE id = v_preapproval.id;

        ELSE
            -- Flujo normal: usuario queda pendiente de aprobación
            INSERT INTO internal_users (auth_user_id, email, full_name, avatar_url, access_status)
            VALUES (p_auth_user_id, p_email, p_full_name, p_avatar_url, 'pending_approval')
            RETURNING id INTO v_internal_user_id;
        END IF;
    END IF;

    RETURN v_internal_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
