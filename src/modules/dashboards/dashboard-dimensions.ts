// TABLEROS-1 — Las dimensiones con las que se cortan los tableros: tamaño de
// empresa, seniority, completitud de un contacto y estado de una solicitud de
// contactos. Sin E/S.
//
// Segmento NO está: es un cálculo interno de Ubits que aún no vive en SellUp
// (queda en «Lo que falta»). Mientras tanto se corta por Tamaño.

// ── Tamaño de empresa ──────────────────────────────────────────────────────────

/** Los tramos de `COMPANY_SIZES` (Empresas), con su rango de empleados. */
export const COMPANY_SIZE_BANDS: readonly { label: string; min: number; max: number }[] = [
  { label: '1-10 empleados', min: 1, max: 10 },
  { label: '11-50 empleados', min: 11, max: 50 },
  { label: '51-200 empleados', min: 51, max: 200 },
  { label: '201-500 empleados', min: 201, max: 500 },
  { label: '501-1,000 empleados', min: 501, max: 1000 },
  { label: '1,001-5,000 empleados', min: 1001, max: 5000 },
  { label: '5,001+ empleados', min: 5001, max: Number.POSITIVE_INFINITY },
];

export const SIZE_UNKNOWN = 'Sin dato';

function bandForCount(count: number): string {
  return COMPANY_SIZE_BANDS.find((band) => count >= band.min && count <= band.max)?.label ?? SIZE_UNKNOWN;
}

/**
 * El tramo de tamaño de una empresa. Manda el número de empleados; si no hay,
 * el tamaño escrito (`51-200 empleados`, `51-200`, `5001+`). Lo demás, «Sin dato».
 */
export function sizeBandOf(employeeCount: number | null | undefined, companySize: string | null | undefined): string {
  if (typeof employeeCount === 'number' && Number.isFinite(employeeCount) && employeeCount > 0) {
    return bandForCount(Math.round(employeeCount));
  }
  const text = companySize?.toLowerCase().replace(/empleados?/g, '').replace(/[.,\s]/g, '') ?? '';
  if (!text) return SIZE_UNKNOWN;
  const range = text.match(/^(\d+)-(\d+)$/);
  if (range) return bandForCount(Number(range[1]));
  const plus = text.match(/^(\d+)\+$/);
  if (plus) return bandForCount(Number(plus[1]));
  const single = text.match(/^(\d+)$/);
  if (single) return bandForCount(Number(single[1]));
  return SIZE_UNKNOWN;
}

/** El orden de los tramos para pintarlos de menor a mayor, «Sin dato» al final. */
export function sizeBandRank(label: string): number {
  const index = COMPANY_SIZE_BANDS.findIndex((band) => band.label === label);
  return index === -1 ? COMPANY_SIZE_BANDS.length : index;
}

// ── Seniority ──────────────────────────────────────────────────────────────────

const SENIORITY_LABELS: Readonly<Record<string, string>> = {
  c_suite: 'C-level',
  owner: 'Dueño',
  founder: 'Fundador',
  partner: 'Socio',
  vp: 'VP',
  head: 'Head',
  director: 'Director',
  manager: 'Manager',
  senior: 'Senior',
  entry: 'Junior',
  intern: 'Practicante',
  executive: 'Ejecutivo',
};

export const SENIORITY_UNKNOWN = 'Sin dato';

export function seniorityLabel(raw: string | null | undefined): string {
  const key = raw?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
  if (!key) return SENIORITY_UNKNOWN;
  return SENIORITY_LABELS[key] ?? raw!.trim();
}

// ── Completitud de un contacto ─────────────────────────────────────────────────

export type ContactCompleteness =
  | 'full'
  | 'missing_phone'
  | 'missing_email'
  | 'missing_linkedin'
  | 'missing_linkedin_phone'
  | 'missing_several';

export const CONTACT_COMPLETENESS_ORDER: readonly ContactCompleteness[] = [
  'full',
  'missing_phone',
  'missing_email',
  'missing_linkedin',
  'missing_linkedin_phone',
  'missing_several',
];

export const CONTACT_COMPLETENESS_LABELS: Record<ContactCompleteness, string> = {
  full: 'Completo',
  missing_phone: 'Falta teléfono',
  missing_email: 'Falta correo',
  missing_linkedin: 'Falta LinkedIn',
  missing_linkedin_phone: 'Falta LinkedIn y teléfono',
  missing_several: 'Faltan varios datos',
};

/** Completo = correo, teléfono y LinkedIn. Lo demás dice qué falta. */
export function completenessOf(channels: { hasEmail: boolean; hasPhone: boolean; hasLinkedin: boolean }): ContactCompleteness {
  const { hasEmail, hasPhone, hasLinkedin } = channels;
  if (hasEmail && hasPhone && hasLinkedin) return 'full';
  if (hasEmail && hasLinkedin) return 'missing_phone';
  if (hasPhone && hasLinkedin) return 'missing_email';
  if (hasEmail && hasPhone) return 'missing_linkedin';
  if (hasEmail) return 'missing_linkedin_phone';
  return 'missing_several';
}

// ── Estado de una solicitud de contactos ───────────────────────────────────────

/**
 * Lo que pasó con una solicitud de contactos (una empresa a la que se le
 * buscaron contactos). Sólo «Enriquecida» es resultado: tiene al menos un
 * contacto APROBADO. Lo demás es uso.
 */
export type ContactRequestState =
  | 'enriched'
  | 'pending_review'
  | 'reviewed_none'
  | 'no_results'
  | 'failed'
  | 'in_progress';

export const CONTACT_REQUEST_STATE_ORDER: readonly ContactRequestState[] = [
  'enriched',
  'pending_review',
  'reviewed_none',
  'no_results',
  'failed',
  'in_progress',
];

export const CONTACT_REQUEST_STATE_LABELS: Record<ContactRequestState, string> = {
  enriched: 'Enriquecida',
  pending_review: 'Por revisar',
  reviewed_none: 'Revisada sin aprobar',
  no_results: 'Sin resultados',
  failed: 'Fallida',
  in_progress: 'En proceso',
};

const ACTIVE_RUN_STATUSES = new Set(['pending', 'resolving', 'ready_to_enrich', 'enriching']);

export function contactRequestStateOf(input: {
  runStatuses: readonly string[];
  candidateStatuses: readonly string[];
}): ContactRequestState {
  const { runStatuses, candidateStatuses } = input;
  if (candidateStatuses.includes('approved')) return 'enriched';
  if (candidateStatuses.includes('pending_review')) return 'pending_review';
  if (candidateStatuses.length > 0) return 'reviewed_none';
  const live = runStatuses.filter((status) => status !== 'superseded');
  if (live.some((status) => ACTIVE_RUN_STATUSES.has(status))) return 'in_progress';
  if (live.length > 0 && live.every((status) => status === 'failed')) return 'failed';
  return 'no_results';
}

// ── Estados de revisión ────────────────────────────────────────────────────────

export const CONTACT_PENDING_STATUSES: ReadonlySet<string> = new Set(['pending_review']);
export const CONTACT_APPROVED_STATUSES: ReadonlySet<string> = new Set(['approved']);
export const CONTACT_REJECTED_STATUSES: ReadonlySet<string> = new Set(['discarded', 'duplicate']);

export const COMPANY_PENDING_STATUSES: ReadonlySet<string> = new Set(['generated', 'normalized', 'needs_review']);
export const COMPANY_APPROVED_STATUSES: ReadonlySet<string> = new Set(['approved', 'converted_to_account']);
export const COMPANY_REJECTED_STATUSES: ReadonlySet<string> = new Set(['discarded', 'duplicate']);

/** «Enriquecer empresa de HubSpot» (#894): sólo `completed` y `partial` completaron algo. */
export const HUBSPOT_ENRICHED_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial']);

export const HUBSPOT_OUTCOME_LABELS: Readonly<Record<string, string>> = {
  completed: 'Completa',
  partial: 'Parcial',
  nothing_found: 'Sin datos nuevos',
};

// ── Datos que SellUp completó ─────────────────────────────────────────────────

/** Campos de empresa que completa «Enriquecer empresa de HubSpot». */
export const COMPANY_FILLED_FIELD_LABELS: Readonly<Record<string, string>> = {
  tax_identifier: 'Número fiscal',
  legal_name: 'Razón social',
  country: 'País',
  industry: 'Industria',
  company_size: 'Tamaño',
};

/** Propiedades de contacto de HubSpot que SellUp llenó (vacías allá), agrupadas por dato. */
const HUBSPOT_CONTACT_PROPERTY_GROUP: Readonly<Record<string, string>> = {
  firstname: 'Nombre',
  lastname: 'Apellido',
  jobtitle: 'Cargo',
  phone: 'Teléfono',
  mobilephone: 'Teléfono',
  company_phone: 'Teléfono',
  telefono_alterno: 'Teléfono',
  hs_linkedin_url: 'LinkedIn',
  email: 'Correo',
};

/** Los datos (no las propiedades) que se completaron en un contacto, sin repetir. */
export function hubspotFilledDataOf(properties: readonly string[]): string[] {
  const out = new Set<string>();
  for (const property of properties) {
    const label = HUBSPOT_CONTACT_PROPERTY_GROUP[property];
    if (label) out.add(label);
  }
  return [...out];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Las propiedades de HubSpot que SellUp llenó en un contacto, leídas de
 * `contacts.metadata.hubspot_sync`: `fill_empty` (campos vacíos completados) y
 * `email_fill` (el correo). Sólo cuenta lo que HubSpot aceptó (`filled`).
 */
export function filledHubspotPropertiesOf(hubspotSync: unknown): string[] {
  const sync = asRecord(hubspotSync);
  if (!sync) return [];
  const out: string[] = [];
  const fill = asRecord(sync.fill_empty);
  if (fill && fill.outcome === 'filled' && Array.isArray(fill.properties)) {
    out.push(...fill.properties.filter((item): item is string => typeof item === 'string'));
  }
  const emailFill = asRecord(sync.email_fill);
  if (emailFill && emailFill.outcome === 'filled') out.push('email');
  return out;
}
