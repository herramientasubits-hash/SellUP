export type TaxIdentifierType =
  | 'NIT'
  | 'RFC'
  | 'RUT'
  | 'RUC'
  | 'CUIT'
  | 'CNPJ'
  | 'RNC'
  | 'RTN'
  | 'cedula_juridica'
  | 'other';

export type AccountSource =
  | 'manual'
  | 'agent_1'
  | 'hubspot'
  | 'apollo'
  | 'imported'
  | 'other';

export type PipelineStatus =
  | 'new'
  | 'ready_for_research'
  | 'research_in_progress'
  | 'ready_for_outreach'
  | 'archived';

export type AccountAuditAction =
  | 'account_created'
  | 'account_updated'
  | 'account_status_changed'
  | 'account_archived'
  | 'account_owner_changed';

export interface Account {
  id: string;
  name: string;
  legal_name: string | null;
  normalized_name: string | null;
  website: string | null;
  domain: string | null;
  country: string | null;
  country_code: string | null;
  city: string | null;
  region: string | null;
  industry: string | null;
  company_size: string | null;
  tax_identifier: string | null;
  tax_identifier_type: TaxIdentifierType | null;
  source: AccountSource;
  pipeline_status: PipelineStatus;
  pipeline_substatus: string | null;
  owner_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  hubspot_company_id: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

export interface AccountWithOwner extends Account {
  owner: { id: string; full_name: string | null; email: string } | null;
  created_by_user: { id: string; full_name: string | null } | null;
}

export interface AccountAuditEntry {
  id: string;
  account_id: string;
  actor_user_id: string | null;
  action_type: AccountAuditAction;
  details: Record<string, unknown>;
  created_at: string;
  actor?: { full_name: string | null; email: string } | null;
}

export interface AccountsSummary {
  total: number;
  new: number;
  ready_for_research: number;
  ready_for_outreach: number;
  archived: number;
}

export interface AccountListItem {
  id: string;
  name: string;
  country: string | null;
  country_code: string | null;
  industry: string | null;
  website: string | null;
  domain: string | null;
  pipeline_status: PipelineStatus;
  source: AccountSource;
  created_at: string;
  owner_id: string | null;
  owner_name: string | null;
}

export interface CreateAccountInput {
  name: string;
  legal_name?: string;
  website?: string;
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  industry?: string;
  company_size?: string;
  tax_identifier?: string;
  tax_identifier_type?: TaxIdentifierType;
  owner_id?: string;
  notes?: string;
}

export interface UpdateAccountInput {
  name?: string;
  legal_name?: string;
  website?: string;
  country?: string;
  country_code?: string;
  city?: string;
  region?: string;
  industry?: string;
  company_size?: string;
  tax_identifier?: string;
  tax_identifier_type?: TaxIdentifierType;
  owner_id?: string;
  pipeline_status?: PipelineStatus;
  pipeline_substatus?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface InternalUserOption {
  id: string;
  full_name: string | null;
  email: string;
}

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  new: 'Nueva',
  ready_for_research: 'Lista para investigar',
  research_in_progress: 'Investigación en curso',
  ready_for_outreach: 'Lista para contacto',
  archived: 'Archivada',
};

export const SOURCE_LABELS: Record<AccountSource, string> = {
  manual: 'Manual',
  agent_1: 'Agente 1',
  hubspot: 'HubSpot',
  apollo: 'Apollo',
  imported: 'Importada',
  other: 'Otra',
};

export const AUDIT_ACTION_LABELS: Record<AccountAuditAction, string> = {
  account_created: 'Cuenta creada',
  account_updated: 'Cuenta actualizada',
  account_status_changed: 'Estado cambiado',
  account_archived: 'Cuenta archivada',
  account_owner_changed: 'Owner cambiado',
};

export const TAX_IDENTIFIER_TYPE_LABELS: Record<TaxIdentifierType, string> = {
  NIT: 'NIT (Colombia)',
  RFC: 'RFC (México)',
  RUT: 'RUT (Chile/Uruguay)',
  RUC: 'RUC (Perú/Ecuador/Paraguay)',
  CUIT: 'CUIT (Argentina)',
  CNPJ: 'CNPJ (Brasil)',
  RNC: 'RNC (Rep. Dominicana)',
  RTN: 'RTN (Honduras)',
  cedula_juridica: 'Cédula Jurídica',
  other: 'Otro',
};

export const LATAM_COUNTRIES: { code: string; name: string }[] = [
  { code: 'CO', name: 'Colombia' },
  { code: 'MX', name: 'México' },
  { code: 'CL', name: 'Chile' },
  { code: 'AR', name: 'Argentina' },
  { code: 'BR', name: 'Brasil' },
  { code: 'PE', name: 'Perú' },
  { code: 'UY', name: 'Uruguay' },
  { code: 'EC', name: 'Ecuador' },
  { code: 'PY', name: 'Paraguay' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'PA', name: 'Panamá' },
  { code: 'DO', name: 'Rep. Dominicana' },
  { code: 'US', name: 'Estados Unidos' },
  { code: 'ES', name: 'España' },
];

export const INDUSTRIES: string[] = [
  'Tecnología',
  'Servicios financieros / Fintech',
  'Retail / E-commerce',
  'Manufactura',
  'Salud / Healthcare',
  'Educación / EdTech',
  'Logística / Transporte',
  'Energía / Utilities',
  'Construcción / Real Estate',
  'Medios / Publicidad',
  'Agroindustria',
  'Minería',
  'Telecomunicaciones',
  'Consultoría / Servicios profesionales',
  'Alimentos y bebidas',
  'Automotriz',
  'Gobierno / Sector público',
  'Otro',
];

export const COMPANY_SIZES: string[] = [
  '1-10 empleados',
  '11-50 empleados',
  '51-200 empleados',
  '201-500 empleados',
  '501-1,000 empleados',
  '1,001-5,000 empleados',
  '5,001+ empleados',
];
