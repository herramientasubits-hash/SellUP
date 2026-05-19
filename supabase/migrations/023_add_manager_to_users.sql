-- Agrega campo manager_id a internal_users para jerarquía organizacional.
-- NULL significa sin jefe directo asignado (soy mi propio jefe / raíz del árbol).

ALTER TABLE internal_users
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES internal_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_internal_users_manager ON internal_users(manager_id);
