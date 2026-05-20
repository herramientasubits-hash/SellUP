-- Correcciones al módulo de jerarquía organizacional.
--
-- 1. Previene autoasignación de manager a nivel DB (el frontend ya lo filtra,
--    pero la constraint garantiza integridad aunque se llame directo a la API).
--
-- 2. Extiende la lista de action_type válidos en access_audit para incluir
--    'manager_changed', necesario para auditoría del cambio de jefe directo.

-- 1. Constraint: un usuario no puede ser su propio jefe directo
ALTER TABLE internal_users
  ADD CONSTRAINT chk_no_self_manager
  CHECK (manager_id IS NULL OR manager_id <> id);

-- 2. Extender CHECK de action_type en access_audit
ALTER TABLE access_audit DROP CONSTRAINT IF EXISTS access_audit_action_type_check;
ALTER TABLE access_audit
  ADD CONSTRAINT access_audit_action_type_check
  CHECK (action_type IN (
    'approved', 'rejected', 'suspended', 'reactivated',
    'role_changed', 'created', 'manager_changed'
  ));
