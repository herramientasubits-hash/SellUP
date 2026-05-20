-- ─────────────────────────────────────────────────────────────────────────────
-- Sistema global de notificaciones internas de SellUp.
--
-- Arquitectura:
--   1. user_notifications: almacena notificaciones por destinatario.
--   2. RLS: cada usuario solo ve/actualiza las suyas. Sin INSERT público.
--   3. create_notifications_for_recipients(): función reutilizable SECURITY DEFINER
--      para que cualquier módulo futuro pueda emitir notificaciones sin repetir lógica.
--   4. notify_admins_of_pending_user(): evento específico para pending_approval.
--   5. sync_internal_user() actualizada: llama a notify_admins_of_pending_user
--      solo al crear un nuevo usuario pendiente (no en updates ni en preaprobados).
--
-- Anti-duplicados:
--   Unique index en (recipient_id, notification_type, entity_id) WHERE entity_id IS NOT NULL.
--   create_notifications_for_recipients usa ON CONFLICT DO NOTHING.
--   sync_internal_user solo invoca la notificación en el branch ELSE/ELSE (primera creación).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Tabla principal ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_notifications (
    id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_internal_user_id  UUID         NOT NULL REFERENCES internal_users(id) ON DELETE CASCADE,
    notification_type           TEXT         NOT NULL,
    title                       TEXT         NOT NULL,
    message                     TEXT         NOT NULL,
    action_label                TEXT,
    action_url                  TEXT,
    entity_type                 TEXT,
    entity_id                   UUID,
    is_read                     BOOLEAN      NOT NULL DEFAULT FALSE,
    read_at                     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Índices ───────────────────────────────────────────────────────────────────

-- Feed principal: por destinatario, sin leer, ordenado por fecha
CREATE INDEX IF NOT EXISTS idx_notifications_feed
    ON user_notifications(recipient_internal_user_id, is_read, created_at DESC);

-- Conteo rápido de no leídas
CREATE INDEX IF NOT EXISTS idx_notifications_unread
    ON user_notifications(recipient_internal_user_id)
    WHERE NOT is_read;

-- Anti-duplicados: un evento por entidad por destinatario
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_no_dup
    ON user_notifications(recipient_internal_user_id, notification_type, entity_id)
    WHERE entity_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

-- Lectura: cada usuario solo ve sus propias notificaciones
CREATE POLICY "Users can read own notifications"
    ON user_notifications
    FOR SELECT
    TO authenticated
    USING (
        recipient_internal_user_id = (
            SELECT id FROM internal_users
            WHERE auth_user_id = auth.uid()
            LIMIT 1
        )
    );

-- Actualización: solo pueden marcarse como leídas por el destinatario
CREATE POLICY "Users can mark own notifications as read"
    ON user_notifications
    FOR UPDATE
    TO authenticated
    USING (
        recipient_internal_user_id = (
            SELECT id FROM internal_users
            WHERE auth_user_id = auth.uid()
            LIMIT 1
        )
    )
    WITH CHECK (
        recipient_internal_user_id = (
            SELECT id FROM internal_users
            WHERE auth_user_id = auth.uid()
            LIMIT 1
        )
    );

-- Sin política de INSERT pública: las notificaciones solo se crean
-- desde funciones SECURITY DEFINER controladas por el backend.

-- ── Función reutilizable: crear notificaciones para múltiples destinatarios ──

CREATE OR REPLACE FUNCTION create_notifications_for_recipients(
    p_recipient_ids     UUID[],
    p_type              TEXT,
    p_title             TEXT,
    p_message           TEXT,
    p_action_label      TEXT    DEFAULT NULL,
    p_action_url        TEXT    DEFAULT NULL,
    p_entity_type       TEXT    DEFAULT NULL,
    p_entity_id         UUID    DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    INSERT INTO user_notifications (
        recipient_internal_user_id,
        notification_type,
        title,
        message,
        action_label,
        action_url,
        entity_type,
        entity_id
    )
    SELECT
        UNNEST(p_recipient_ids),
        p_type,
        p_title,
        p_message,
        p_action_label,
        p_action_url,
        p_entity_type,
        p_entity_id
    ON CONFLICT (recipient_internal_user_id, notification_type, entity_id)
    WHERE entity_id IS NOT NULL
    DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Evento específico: nuevo usuario pendiente de aprobación ──────────────────
--
-- Notifica a todos los admins activos cuando se crea un usuario con
-- pending_approval. Solo se llama desde sync_internal_user en la primera
-- creación, nunca en updates.
--
-- Futuros eventos deben seguir este patrón:
--   notify_admins_of_<event>(p_entity_id, ...params)
--   → llama a create_notifications_for_recipients(...)

CREATE OR REPLACE FUNCTION notify_admins_of_pending_user(
    p_pending_user_id   UUID,
    p_email             TEXT
)
RETURNS VOID AS $$
DECLARE
    v_admin_ids UUID[];
BEGIN
    SELECT ARRAY_AGG(u.id)
    INTO v_admin_ids
    FROM internal_users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.access_status = 'active'
      AND r.key = 'admin';

    IF v_admin_ids IS NULL OR ARRAY_LENGTH(v_admin_ids, 1) = 0 THEN
        RETURN;
    END IF;

    PERFORM create_notifications_for_recipients(
        v_admin_ids,
        'user_pending_approval',
        'Nuevo usuario pendiente de aprobación',
        p_email || ' solicitó acceso a SellUp y requiere revisión.',
        'Revisar usuarios',
        '/settings/users?tab=pending',
        'internal_user',
        p_pending_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── sync_internal_user actualizada ───────────────────────────────────────────
--
-- Cambio respecto a versión anterior (028):
--   En el branch "usuario nuevo sin preaprobación", después del INSERT con
--   pending_approval, se llama a notify_admins_of_pending_user().
--
-- Anti-duplicado garantizado porque:
--   - Esta ruta solo se ejecuta cuando v_exists = FALSE (primer login).
--   - notify_admins_of_pending_user → create_notifications_for_recipients
--     usa ON CONFLICT DO NOTHING sobre (recipient_id, type, entity_id).

CREATE OR REPLACE FUNCTION sync_internal_user(
    p_auth_user_id  UUID,
    p_email         TEXT,
    p_full_name     TEXT DEFAULT NULL,
    p_avatar_url    TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    v_internal_user_id  UUID;
    v_exists            BOOLEAN;
    v_preapproval       RECORD;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM internal_users WHERE auth_user_id = p_auth_user_id
    ) INTO v_exists;

    IF v_exists THEN
        -- Usuario existente: solo actualizar metadatos, no status ni notificaciones
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
            -- Preaprobado: activar directamente, sin notificación de pendiente
            INSERT INTO internal_users (
                auth_user_id, email, full_name, avatar_url,
                access_status, role_id, manager_id, group_id, approved_at
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

            UPDATE user_preapprovals
            SET status                  = 'claimed',
                claimed_at              = NOW(),
                claimed_by_auth_user_id = p_auth_user_id,
                updated_at              = NOW()
            WHERE id = v_preapproval.id;

        ELSE
            -- Flujo normal: nuevo usuario pendiente de aprobación
            INSERT INTO internal_users (auth_user_id, email, full_name, avatar_url, access_status)
            VALUES (p_auth_user_id, p_email, p_full_name, p_avatar_url, 'pending_approval')
            RETURNING id INTO v_internal_user_id;

            -- Notificar a todos los admins activos (primera y única vez)
            PERFORM notify_admins_of_pending_user(v_internal_user_id, p_email);
        END IF;
    END IF;

    RETURN v_internal_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
