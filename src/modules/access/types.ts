export type AccessStatus = 'pending_approval' | 'active' | 'rejected' | 'suspended';

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface InternalUser {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  access_status: AccessStatus;
  role_id: string | null;
  role_key: string | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  suspended_at: string | null;
  last_login_at: string | null;
}

export interface AccessAuditEntry {
  id: string;
  action_type: string;
  previous_status: string | null;
  new_status: string | null;
  previous_role_key: string | null;
  new_role_key: string | null;
  reason: string | null;
  created_at: string;
  actor_email: string;
}

export interface UsersSummary {
  pending: number;
  active: number;
  suspended: number;
  rejected: number;
}