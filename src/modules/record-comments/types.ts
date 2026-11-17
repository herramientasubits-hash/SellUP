// ============================================================
// Comentarios y alertas sobre empresas y contactos (migración 168).
//
// Un comentario es un mensaje que apunta a un dato concreto de la ficha
// (teléfono, LinkedIn, empleados…) o a la ficha en general. Una «alerta» queda
// abierta hasta que alguien la marca como resuelta. Tipos y etiquetas puros:
// los usan el servidor y el cliente.
// ============================================================

export const RECORD_COMMENT_KINDS = ['note', 'alert'] as const;
export type RecordCommentKind = (typeof RECORD_COMMENT_KINDS)[number];

export const RECORD_COMMENT_FIELD_KEYS = [
  'general',
  'phone',
  'email',
  'linkedin',
  'job_title',
  'website',
  'employees',
  'industry',
  'country',
  'tax_id',
  'owner',
  'other',
] as const;
export type RecordCommentFieldKey = (typeof RECORD_COMMENT_FIELD_KEYS)[number];

export const RECORD_COMMENT_REASONS = [
  'phone_not_exists',
  'phone_no_answer',
  'phone_wrong_person',
] as const;
export type RecordCommentReason = (typeof RECORD_COMMENT_REASONS)[number];

/** Sobre qué tipo de ficha se comenta. */
export type RecordCommentTarget = 'account' | 'contact';

export const RECORD_COMMENT_KIND_LABELS: Record<RecordCommentKind, string> = {
  note: 'Nota',
  alert: 'Alerta',
};

export const RECORD_COMMENT_FIELD_LABELS: Record<RecordCommentFieldKey, string> = {
  general: 'General',
  phone: 'Teléfono',
  email: 'Email',
  linkedin: 'LinkedIn',
  job_title: 'Cargo',
  website: 'Sitio web',
  employees: 'Número de empleados',
  industry: 'Industria / actividad',
  country: 'País',
  tax_id: 'ID fiscal',
  owner: 'Responsable',
  other: 'Otro dato',
};

/** Los datos que se ofrecen en cada ficha, en este orden. */
export const RECORD_COMMENT_FIELDS_BY_TARGET: Record<RecordCommentTarget, readonly RecordCommentFieldKey[]> = {
  contact: ['general', 'phone', 'email', 'linkedin', 'job_title', 'other'],
  account: ['general', 'website', 'linkedin', 'employees', 'industry', 'country', 'tax_id', 'owner', 'phone', 'other'],
};

export const RECORD_COMMENT_REASON_LABELS: Record<RecordCommentReason, string> = {
  phone_not_exists: 'El número no existe',
  phone_no_answer: 'No contesta',
  phone_wrong_person: 'Es de otra persona',
};

/** Etiqueta corta que se pinta junto al número reportado. */
export const RECORD_COMMENT_REASON_SHORT: Record<RecordCommentReason, string> = {
  phone_not_exists: 'No existe',
  phone_no_answer: 'No contesta',
  phone_wrong_person: 'Otra persona',
};

export const RECORD_COMMENT_BODY_MAX = 2000;
export const RECORD_COMMENT_RESOLUTION_MAX = 1000;
export const RECORD_COMMENT_FIELD_VALUE_MAX = 500;

export interface RecordCommentPerson {
  id: string;
  name: string;
}

export interface RecordComment {
  id: string;
  accountId: string;
  contactId: string | null;
  fieldKey: RecordCommentFieldKey;
  fieldValue: string | null;
  kind: RecordCommentKind;
  reason: RecordCommentReason | null;
  body: string;
  author: RecordCommentPerson | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: RecordCommentPerson | null;
  resolutionNote: string | null;
}

/** Una fila de la bandeja: el comentario y a qué ficha lleva. */
export interface RecordCommentInboxItem extends RecordComment {
  accountName: string;
  contactName: string | null;
}

/** Lo que manda el formulario (o un atajo) para crear un comentario. */
export interface CreateRecordCommentInput {
  target: RecordCommentTarget;
  /** id de la empresa o del contacto, según `target`. */
  targetId: string;
  fieldKey: RecordCommentFieldKey;
  fieldValue?: string | null;
  kind: RecordCommentKind;
  reason?: RecordCommentReason | null;
  body: string;
}

/**
 * Respuesta de lectura. `available: false` cuando la tabla todavía no existe
 * (migración 168 sin aplicar): la ficha esconde la sección en vez de fallar.
 */
export type RecordCommentsResult =
  | { available: true; comments: RecordCommentInboxItem[] }
  | { available: false };

export type RecordCommentMutationResult =
  | { success: true; comment: RecordCommentInboxItem }
  | { success: false; error: string };

export type InboxStatusFilter = 'open' | 'resolved' | 'notes' | 'all';
/** everyone = todo lo de mi alcance; my_accounts = empresas de las que soy responsable; authored = lo que escribí. */
export type InboxPeopleFilter = 'everyone' | 'my_accounts' | 'authored';

export interface RecordCommentsInboxFilters {
  status: InboxStatusFilter;
  people: InboxPeopleFilter;
  fieldKey: RecordCommentFieldKey | 'any';
}

export type RecordCommentsInboxResult =
  | { available: true; items: RecordCommentInboxItem[]; openAlerts: number; truncated: boolean }
  | { available: false };
