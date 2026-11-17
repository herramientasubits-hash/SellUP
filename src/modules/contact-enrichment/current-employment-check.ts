/**
 * Cargo y empresa ACTUALES de un contacto (CONTACT-CURRENT-EMPLOYMENT-1).
 *
 * El cargo que se muestra viene de la búsqueda de Apollo o de HubSpot y puede tener años. Cuando
 * ya pedimos a Apollo la ficha completa de la persona (`people/match`, que se paga igual para
 * completar el contacto), la respuesta trae su historial laboral con el trabajo actual. Aquí se
 * compara ese trabajo actual con la empresa y el cargo que mostramos.
 *
 * No llama a nadie ni gasta créditos: sólo lee una respuesta que ya llegó. Funciones puras.
 */

export const CURRENT_EMPLOYMENT_SNAPSHOT_KEY = 'current_employment_snapshot';
export const CURRENT_EMPLOYMENT_METADATA_KEY = 'current_employment';

/** Máximo de trabajos actuales que se guardan (una persona rara vez tiene más de 2–3). */
const MAX_CURRENT_ROLES = 5;
/** Largo mínimo para aceptar que un nombre de empresa contiene al otro. */
const MIN_CONTAINED_NAME_LENGTH = 4;

export interface CurrentRole {
  organization_id: string | null;
  organization_name: string | null;
  title: string | null;
  start_date: string | null;
}

/** Lo mínimo del historial de Apollo que hace falta guardar. */
export interface CurrentEmploymentSnapshot {
  /** Apollo mandó historial laboral (aunque no tenga trabajo actual). */
  has_history: boolean;
  roles: CurrentRole[];
  /** Organización actual según Apollo (`person.organization`). */
  organization: { id: string | null; name: string | null; domain: string | null } | null;
}

export type CurrentEmploymentStatus =
  /** Trabaja en la empresa y con el cargo que mostramos. */
  | 'confirmed'
  /** Trabaja en la empresa, pero con otro cargo: se muestra el actual. */
  | 'title_changed'
  /** Su trabajo actual es en otra empresa. */
  | 'other_company'
  /** Apollo no le conoce trabajo actual. */
  | 'no_current_role'
  /** Apollo no mandó historial: no se puede saber. */
  | 'unknown';

/** Quién comprobó: el historial de Apollo o la búsqueda web de Claude («Verificar con IA»). */
export type CurrentEmploymentSource = 'apollo' | 'ai_web';

export interface CurrentEmploymentCheck {
  status: CurrentEmploymentStatus;
  source: CurrentEmploymentSource;
  checked_at: string;
  /** Cargo que teníamos antes de comprobar. */
  previous_title: string | null;
  current_title: string | null;
  current_company: string | null;
  /** Desde cuándo tiene el trabajo actual (AAAA-MM-DD o AAAA-MM), si Apollo lo sabe. */
  current_since: string | null;
  /** Sólo «Verificar con IA»: la fuente, la frase tal cual y su fecha (si el buscador la da). */
  evidence_url?: string | null;
  evidence_quote?: string | null;
  evidence_date?: string | null;
  /** Sólo «Verificar con IA»: la fuente es su propio perfil de LinkedIn (el guardado en SellUp). */
  evidence_own_profile?: boolean;
  /**
   * Sólo «Verificar con IA»: false cuando la fuente confirma que sigue en la empresa pero no dice
   * el cargo (o lo dice con otras palabras). Sin «Sin verificar», se trata como confirmado.
   */
  title_confirmed?: boolean | null;
}

/** Estados que merecen aviso: la persona posiblemente ya no está en la empresa. */
export const CURRENT_EMPLOYMENT_LEFT_STATUSES: ReadonlySet<CurrentEmploymentStatus> = new Set([
  'other_company',
  'no_current_role',
]);

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function domainOf(value: unknown): string | null {
  const raw = clean(value)?.toLowerCase();
  if (!raw) return null;
  const host = raw.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
  return host || null;
}

/**
 * Extrae los trabajos actuales del historial de Apollo (`employment_history`). Devuelve null
 * cuando la persona no trae historial ni organización (p. ej. la búsqueda gratuita).
 */
export function extractCurrentEmployment(
  employmentHistory: unknown,
  organization: unknown,
): CurrentEmploymentSnapshot | null {
  const history = Array.isArray(employmentHistory) ? employmentHistory.filter(isRecord) : [];
  const org = isRecord(organization)
    ? {
        id: clean(organization.id),
        name: clean(organization.name),
        domain: domainOf(organization.primary_domain) ?? domainOf(organization.website_url),
      }
    : null;
  if (history.length === 0 && !org) return null;

  const roles = history
    .filter((entry) => entry.current === true && !clean(entry.end_date))
    .slice(0, MAX_CURRENT_ROLES)
    .map((entry) => ({
      organization_id: clean(entry.organization_id),
      organization_name: clean(entry.organization_name),
      title: clean(entry.title),
      start_date: clean(entry.start_date),
    }));

  return { has_history: history.length > 0, roles, organization: org };
}

/** Lee un snapshot guardado en metadata (tolerante a datos viejos o ajenos). */
export function readCurrentEmploymentSnapshot(value: unknown): CurrentEmploymentSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.roles)) return null;
  const roles = value.roles.filter(isRecord).map((role) => ({
    organization_id: clean(role.organization_id),
    organization_name: clean(role.organization_name),
    title: clean(role.title),
    start_date: clean(role.start_date),
  }));
  const org = isRecord(value.organization)
    ? { id: clean(value.organization.id), name: clean(value.organization.name), domain: clean(value.organization.domain) }
    : null;
  return { has_history: value.has_history === true, roles, organization: org };
}

// ── Comparación de empresas y cargos ─────────────────────────────

const LEGAL_SUFFIXES = new Set([
  'sa', 'sas', 'spa', 'ltda', 'ltd', 'limitada', 'srl', 'sac', 'saa', 'sl', 'slu', 'cv', 'de', 'inc',
  'llc', 'corp', 'co', 'gmbh', 'ag', 'eirl', 'eireli', 'me', 'epp', 'plc', 'bv', 'nv',
]);

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Nombre de empresa comparable: sin tildes, signos ni sufijos societarios al final. */
export function normalizeCompanyNameForMatch(value: string | null | undefined): string | null {
  const text = clean(value);
  if (!text) return null;
  // «S.A.» y «S.A.S.» quedan como «s a s»: se juntan las letras sueltas antes de quitar sufijos.
  const tokens = normalizeText(text.replace(/\b([A-Za-z])\.(?=[A-Za-z]\.?)/g, '$1')).split(' ');
  while (tokens.length > 1 && LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  const joined = tokens.join(' ').trim();
  return joined || null;
}

export function companyNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeCompanyNameForMatch(a);
  const right = normalizeCompanyNameForMatch(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  if (shorter.length < MIN_CONTAINED_NAME_LENGTH) return false;
  // Palabra completa: «eglo» está en «eglo iluminacion chile», pero «gas» no está en «vegas».
  return ` ${longer} `.includes(` ${shorter} `);
}

/** Dos cargos dicen lo mismo (ignora tildes, mayúsculas y signos; uno puede contener al otro). */
export function titlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = clean(a) ? normalizeText(a as string) : null;
  const right = clean(b) ? normalizeText(b as string) : null;
  if (!left || !right) return false;
  if (left === right) return true;
  return ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `);
}

export interface AssessCurrentEmploymentInput {
  snapshot: CurrentEmploymentSnapshot | null;
  /** Cargo que mostramos hoy. */
  shownTitle: string | null;
  companyName: string | null;
  companyDomain: string | null;
  checkedAt: string;
}

function roleAtCompany(input: AssessCurrentEmploymentInput, snapshot: CurrentEmploymentSnapshot): CurrentRole | null {
  const expectedDomain = domainOf(input.companyDomain);
  const org = snapshot.organization;
  const orgIsCompany =
    !!org &&
    ((!!expectedDomain && !!org.domain && org.domain === expectedDomain) || companyNamesMatch(org.name, input.companyName));

  for (const role of snapshot.roles) {
    if (companyNamesMatch(role.organization_name, input.companyName)) return role;
    if (orgIsCompany && org?.id && role.organization_id === org.id) return role;
  }
  // Apollo dice que su organización actual es la empresa, aunque el historial la nombre distinto.
  if (orgIsCompany && snapshot.roles.length === 1) return snapshot.roles[0];
  return null;
}

/** Compara el trabajo actual de la persona con la empresa y el cargo que mostramos. */
export function assessCurrentEmployment(input: AssessCurrentEmploymentInput): CurrentEmploymentCheck {
  const base = {
    source: 'apollo' as const,
    checked_at: input.checkedAt,
    previous_title: clean(input.shownTitle),
  };
  const snapshot = input.snapshot;
  if (!snapshot || !snapshot.has_history) {
    return { ...base, status: 'unknown', current_title: null, current_company: null, current_since: null };
  }
  if (snapshot.roles.length === 0) {
    return { ...base, status: 'no_current_role', current_title: null, current_company: null, current_since: null };
  }

  const atCompany = roleAtCompany(input, snapshot);
  if (!atCompany) {
    const elsewhere = snapshot.roles[0];
    return {
      ...base,
      status: 'other_company',
      current_title: elsewhere.title,
      current_company: elsewhere.organization_name ?? snapshot.organization?.name ?? null,
      current_since: elsewhere.start_date,
    };
  }

  const sameTitle = !atCompany.title || !base.previous_title || titlesMatch(atCompany.title, base.previous_title);
  return {
    ...base,
    status: sameTitle ? 'confirmed' : 'title_changed',
    current_title: atCompany.title ?? base.previous_title,
    current_company: atCompany.organization_name ?? clean(input.companyName),
    current_since: atCompany.start_date,
  };
}

/**
 * Una fuente más vieja que esto no prueba el trabajo de hoy: la gente cambia de cargo cada 2–3
 * años, y el buscador puede devolver una copia de un perfil de LinkedIn que ya no existe.
 */
export const EMPLOYMENT_EVIDENCE_MAX_AGE_DAYS = 730;

const DAY_MS = 86_400_000;
const AGE_UNIT_DAYS: Record<string, number> = { second: 1 / 86_400, minute: 1 / 1_440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };

/**
 * Fecha de una fuente web: acepta la antigüedad del buscador («2924 days ago», «3 weeks ago») o
 * una fecha («April 30, 2025», «2025-04-30»). null si no se entiende.
 */
export function parseEvidenceDate(value: string | null | undefined, checkedAt: string): Date | null {
  const text = clean(value);
  if (!text) return null;
  const relative = text.toLowerCase().match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/);
  if (relative) {
    const base = new Date(checkedAt).getTime();
    if (Number.isNaN(base)) return null;
    return new Date(base - Number(relative[1]) * AGE_UNIT_DAYS[relative[2]] * DAY_MS);
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** Días entre la fecha de la fuente y la comprobación (null si no se sabe). */
export function evidenceAgeDays(value: string | null | undefined, checkedAt: string): number | null {
  const date = parseEvidenceDate(value, checkedAt);
  const base = new Date(checkedAt).getTime();
  if (!date || Number.isNaN(base)) return null;
  return Math.max(0, Math.floor((base - date.getTime()) / DAY_MS));
}

/** La fuente es demasiado vieja para decir dónde trabaja hoy. Sin fecha, no se la descarta. */
export function isStaleEvidence(value: string | null | undefined, checkedAt: string): boolean {
  const days = evidenceAgeDays(value, checkedAt);
  return days !== null && days > EMPLOYMENT_EVIDENCE_MAX_AGE_DAYS;
}

/** Cargo que debe mostrarse tras la comprobación (el actual sólo si sigue en la empresa). */
export function titleAfterEmploymentCheck(check: CurrentEmploymentCheck, shownTitle: string | null): string | null {
  return check.status === 'title_changed' && check.current_title ? check.current_title : shownTitle;
}

/** Lee la comprobación guardada en metadata (tolerante a datos viejos). */
export function readCurrentEmploymentCheck(value: unknown): CurrentEmploymentCheck | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const valid: CurrentEmploymentStatus[] = ['confirmed', 'title_changed', 'other_company', 'no_current_role', 'unknown'];
  if (typeof status !== 'string' || !valid.includes(status as CurrentEmploymentStatus)) return null;
  return {
    status: status as CurrentEmploymentStatus,
    source: value.source === 'ai_web' ? 'ai_web' : 'apollo',
    checked_at: clean(value.checked_at) ?? '',
    previous_title: clean(value.previous_title),
    current_title: clean(value.current_title),
    current_company: clean(value.current_company),
    current_since: clean(value.current_since),
    // La fuente sólo existe en lo que verificó la IA; lo de Apollo queda igual que antes.
    ...(value.source === 'ai_web'
      ? {
          evidence_url: clean(value.evidence_url),
          evidence_quote: clean(value.evidence_quote),
          evidence_date: clean(value.evidence_date),
          evidence_own_profile: value.evidence_own_profile === true,
          title_confirmed: typeof value.title_confirmed === 'boolean' ? value.title_confirmed : null,
        }
      : {}),
  };
}
