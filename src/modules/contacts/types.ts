export type ContactSeniority =
  | 'c_level'
  | 'vp'
  | 'director'
  | 'manager'
  | 'individual_contributor'
  | 'unknown';

export type ContactRole =
  | 'decision_maker'
  | 'economic_buyer'
  | 'champion'
  | 'influencer'
  | 'evaluator'
  | 'technical_stakeholder'
  | 'hr_leader'
  | 'learning_leader'
  | 'procurement'
  | 'unknown';

export type ContactStatus =
  | 'active'
  | 'inactive'
  | 'left_company'
  | 'do_not_contact'
  | 'archived';

export type ContactSource =
  | 'manual'
  | 'hubspot'
  | 'apollo'
  | 'lusha'
  | 'agent_1'
  | 'imported'
  | 'other';

export type ConfidenceLevel = 'unknown' | 'low' | 'medium' | 'high' | 'verified';

export type ContactAuditAction =
  | 'contact_created'
  | 'contact_updated'
  | 'contact_status_changed'
  | 'contact_archived'
  | 'contact_primary_changed'
  | 'contact_role_changed';

export interface Contact {
  id: string;
  account_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  department: string | null;
  seniority: ContactSeniority | null;
  role_in_account: ContactRole | null;
  contact_status: ContactStatus;
  source: ContactSource;
  hubspot_contact_id: string | null;
  email_confidence: ConfidenceLevel | null;
  phone_confidence: ConfidenceLevel | null;
  is_primary: boolean;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface ContactAuditEntry {
  id: string;
  contact_id: string;
  account_id: string;
  actor_user_id: string | null;
  action_type: ContactAuditAction;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string | null; email: string } | null;
}

export interface ContactsSummary {
  total: number;
  decision_makers: number;
  champions: number;
  primary: number;
  inactive_or_archived: number;
}

export interface CreateContactInput {
  account_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  mobile_phone?: string;
  linkedin_url?: string;
  job_title?: string;
  department?: string;
  seniority?: ContactSeniority;
  role_in_account?: ContactRole;
  contact_status?: ContactStatus;
  is_primary?: boolean;
  notes?: string;
}

export interface UpdateContactInput {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  email?: string;
  phone?: string;
  mobile_phone?: string;
  linkedin_url?: string;
  job_title?: string;
  department?: string;
  seniority?: ContactSeniority | null;
  role_in_account?: ContactRole | null;
  contact_status?: ContactStatus;
  is_primary?: boolean;
  notes?: string;
  metadata?: Record<string, unknown>;
}

// ── Labels ────────────────────────────────────────────────────

export const SENIORITY_LABELS: Record<ContactSeniority, string> = {
  c_level: 'C-Level',
  vp: 'VP / Vicepresidente',
  director: 'Director',
  manager: 'Gerente / Manager',
  individual_contributor: 'Colaborador individual',
  unknown: 'Desconocido',
};

export const ROLE_LABELS: Record<ContactRole, string> = {
  decision_maker: 'Decisor',
  economic_buyer: 'Comprador económico',
  champion: 'Champion',
  influencer: 'Influenciador',
  evaluator: 'Evaluador',
  technical_stakeholder: 'Stakeholder técnico',
  hr_leader: 'Líder de RRHH',
  learning_leader: 'Líder de Aprendizaje',
  procurement: 'Compras / Procurement',
  unknown: 'Desconocido',
};

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'Activo',
  inactive: 'Inactivo',
  left_company: 'Salió de la empresa',
  do_not_contact: 'No contactar',
  archived: 'Archivado',
};

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  manual: 'Manual',
  hubspot: 'HubSpot',
  apollo: 'Apollo',
  lusha: 'Lusha',
  agent_1: 'Agente 1',
  imported: 'Importado',
  other: 'Otro',
};

export const DEPARTMENTS: string[] = [
  'Tecnología / IT',
  'Recursos Humanos',
  'Aprendizaje y Desarrollo',
  'Finanzas',
  'Comercial / Ventas',
  'Marketing',
  'Operaciones',
  'Legal / Jurídico',
  'Compras / Procurement',
  'Gerencia General',
  'Otro',
];
