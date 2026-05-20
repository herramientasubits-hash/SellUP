export type AccessStatus = 'pending_approval' | 'active' | 'rejected' | 'suspended' | 'archived';
export type PreapprovalStatus = 'pending_claim' | 'claimed' | 'cancelled';

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
}

export interface OrganizationGroup {
  id: string;
  name: string;
  description: string | null;
  parent_group_id: string | null;
  depth: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPreapproval {
  id: string;
  email: string;
  full_name: string | null;
  role_id: string;
  role_key: string | null;
  role_name: string | null;
  manager_id: string | null;
  manager_name: string | null;
  group_id: string | null;
  group_name: string | null;
  status: PreapprovalStatus;
  created_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  claimed_at: string | null;
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
  manager_id: string | null;
  group_id: string | null;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  suspended_at: string | null;
  archived_at: string | null;
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
  preapproved: number;
  archived: number;
}
