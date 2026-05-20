-- Asocia cada usuario a su grupo organizacional primario.
-- Un usuario pertenece a un grupo a la vez (MVP: sin membresía múltiple).

ALTER TABLE internal_users
    ADD COLUMN IF NOT EXISTS group_id UUID
        REFERENCES organization_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_internal_users_group ON internal_users(group_id);
