-- Adds 'archived' as a terminal access_status and supporting audit event types.

-- 1. Extend access_status CHECK
ALTER TABLE internal_users
  DROP CONSTRAINT IF EXISTS internal_users_access_status_check;

ALTER TABLE internal_users
  ADD CONSTRAINT internal_users_access_status_check
  CHECK (access_status IN ('pending_approval', 'active', 'rejected', 'suspended', 'archived'));

-- 2. Timestamp + actor columns for archive
ALTER TABLE internal_users
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES internal_users(id) ON DELETE SET NULL;

-- 3. Extend action_type CHECK
ALTER TABLE access_audit
  DROP CONSTRAINT IF EXISTS access_audit_action_type_check;

ALTER TABLE access_audit
  ADD CONSTRAINT access_audit_action_type_check
  CHECK (action_type IN (
    'approved', 'rejected', 'suspended', 'reactivated',
    'role_changed', 'created', 'manager_changed',
    'preauthorized', 'preapproval_cancelled', 'group_assigned',
    'activated_from_rejected', 'archived'
  ));
