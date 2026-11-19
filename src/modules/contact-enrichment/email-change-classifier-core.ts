// Agente 2A — ¿Qué significa el correo que trajo el proveedor? (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE)
//
// Núcleo PURO (sin red, sin Supabase). Decisiones de Bryan (18-11):
//
//   * Un correo nuevo de la MISMA empresa pasa a ser el principal (en SellUp y en HubSpot) y el
//     anterior se conserva como correo adicional.
//   * Un correo personal (gmail, hotmail…) se guarda aparte y en HubSpot va como correo adicional,
//     sin volverse principal.
//   * Un correo de OTRA empresa (o Apollo diciendo que trabaja en otra) es un CAMBIO DE EMPRESA:
//     nunca se escribe en el contacto viejo; se ofrece mandarlo a revisión en la empresa nueva.
//
// Este archivo sólo CLASIFICA. Qué se escribe lo deciden las acciones con esta respuesta.

import { isGenericEmailDomain, normalizeDomain } from '@/server/agents/contact-enrichment-toolkit/company-consistency-checker';
import type { CurrentEmploymentCheck, CurrentEmploymentSnapshot } from './current-employment-check';

export const CONTACT_EMAIL_CHECK_HITO = 'AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE' as const;

/** Clave en `contact_enrichment_candidates.enrichment_metadata` con la última comprobación. */
export const EMAIL_CHECK_METADATA_KEY = 'email_check';

export type EmailChangeCase =
  /** A — el proveedor devuelve el mismo correo y no ve otra empresa. */
  | 'same_email'
  /** B — otro correo de la misma empresa: pasa a principal, el anterior queda como adicional. */
  | 'same_company_new_email'
  /** C — correo personal: se guarda aparte, nunca como principal. */
  | 'personal_email'
  /** D — correo de otra empresa: cambio de empresa. */
  | 'company_change'
  /** E — señales contradictorias (correo y empleo no cuentan la misma historia). */
  | 'conflicting'
  /** F — sin correo, pero el proveedor dice que ya no trabaja ahí. */
  | 'left_no_email'
  /** G — sin correo nuevo y sin señales de cambio. */
  | 'no_new_email';

/** Casos en los que el correo encontrado NO se escribe en el contacto/candidato actual. */
export const EMAIL_WITHHELD_CASES: ReadonlySet<EmailChangeCase> = new Set(['company_change', 'conflicting']);

/** Casos que abren (o pueden abrir) el flujo «Cambió de empresa». */
export const COMPANY_CHANGE_CASES: ReadonlySet<EmailChangeCase> = new Set(['company_change', 'conflicting', 'left_no_email']);

const EMPLOYMENT_LEFT = new Set(['other_company', 'no_current_role']);
const EMPLOYMENT_STAYS = new Set(['confirmed', 'title_changed']);

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Correo en minúsculas o null. */
export function normalizeEmailForCheck(value: string | null | undefined): string | null {
  const email = clean(value)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** Dominio de un correo (sin `www.`) o null. */
export function emailDomainOf(email: string | null | undefined): string | null {
  const value = normalizeEmailForCheck(email);
  if (!value) return null;
  return normalizeDomain(value.slice(value.lastIndexOf('@') + 1));
}

export function isPersonalEmailDomain(domain: string | null | undefined): boolean {
  return isGenericEmailDomain(normalizeDomain(domain));
}

/** Sufijos que no identifican a la empresa (`weatherford.com.mx` → `weatherford`). */
const GENERIC_SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gob', 'gov', 'edu', 'ac', 'mil', 'nom', 'ltd', 'plc']);

/**
 * La etiqueta que nombra a la empresa en un dominio: `weatherford.com` y `weatherford.com.mx`
 * dan `weatherford`; `mail.acme.co` da `acme`. Heurística deliberadamente simple: sirve para
 * reconocer dominios del MISMO grupo, nunca para decidir que dos empresas distintas son una.
 */
export function domainRootLabel(domain: string | null | undefined): string | null {
  const host = normalizeDomain(domain);
  if (!host) return null;
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return labels[0] ?? null;
  labels.pop(); // TLD (`com`, `mx`, `co`…)
  if (labels.length >= 2 && GENERIC_SECOND_LEVEL.has(labels[labels.length - 1])) labels.pop();
  return labels[labels.length - 1] ?? null;
}

/** ¿Los dos dominios son de la misma empresa (mismo dominio o mismo nombre en otro país)? */
export function sameCompanyDomain(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeDomain(a);
  const right = normalizeDomain(b);
  if (!left || !right) return false;
  if (left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`)) return true;
  const rootLeft = domainRootLabel(left);
  const rootRight = domainRootLabel(right);
  return !!rootLeft && rootLeft.length >= 3 && rootLeft === rootRight;
}

export interface EmailChangeInput {
  /** Correo que tiene hoy el contacto (o el candidato). */
  currentEmail: string | null;
  /** Correo que devolvió el proveedor. */
  foundEmail: string | null;
  /** Dominios conocidos de la empresa actual (cuenta, búsqueda). */
  companyDomains: readonly (string | null | undefined)[];
  /** Empleo actual según Apollo (`assessCurrentEmployment`). */
  employment: Pick<CurrentEmploymentCheck, 'status'> | null;
}

export interface EmailChangeClassification {
  case: EmailChangeCase;
  foundEmail: string | null;
  foundEmailDomain: string | null;
}

/** Dominios de la empresa actual: los de la cuenta y el del correo actual si es corporativo. */
export function knownCompanyDomains(input: Pick<EmailChangeInput, 'currentEmail' | 'companyDomains'>): string[] {
  const domains: string[] = [];
  const push = (value: string | null | undefined) => {
    const domain = normalizeDomain(value);
    if (domain && !isGenericEmailDomain(domain) && !domains.includes(domain)) domains.push(domain);
  };
  for (const domain of input.companyDomains) push(domain);
  push(emailDomainOf(input.currentEmail));
  return domains;
}

/** La tabla A–G de la propuesta (§ 3). */
export function classifyEmailChange(input: EmailChangeInput): EmailChangeClassification {
  const current = normalizeEmailForCheck(input.currentEmail);
  const found = normalizeEmailForCheck(input.foundEmail);
  const foundDomain = emailDomainOf(found);
  const status = input.employment?.status ?? null;
  const left = !!status && EMPLOYMENT_LEFT.has(status);
  const stays = !!status && EMPLOYMENT_STAYS.has(status);
  const result = (kind: EmailChangeCase): EmailChangeClassification => ({
    case: kind,
    foundEmail: found,
    foundEmailDomain: foundDomain,
  });

  if (!found) return result(left ? 'left_no_email' : 'no_new_email');
  if (current && found === current) return result(status === 'other_company' ? 'conflicting' : 'same_email');
  if (isPersonalEmailDomain(foundDomain)) return result('personal_email');

  const domains = knownCompanyDomains(input);
  if (domains.length === 0) {
    // Sin dominio con qué comparar, manda el empleo: sin señal de cambio, es un correo más.
    return result(left ? 'company_change' : 'same_company_new_email');
  }
  if (domains.some((domain) => sameCompanyDomain(domain, foundDomain))) {
    return result(status === 'other_company' ? 'conflicting' : 'same_company_new_email');
  }
  // Correo corporativo de OTRO dominio. Si Apollo jura que sigue en la empresa, puede ser un
  // dominio del grupo que no conocemos: contradictorio, decide una persona.
  return result(stays ? 'conflicting' : 'company_change');
}

/** Lo que se guarda de la empresa nueva (para precargar la revisión). */
export interface EmailCheckEmployment {
  status: CurrentEmploymentCheck['status'];
  current_company: string | null;
  current_title: string | null;
  current_since: string | null;
  /** Dominio de la organización actual según Apollo, si lo dio. */
  organization_domain: string | null;
}

export type EmailCheckResolution =
  /** Se aplicó (correo principal o personal guardado). */
  | 'applied'
  /** El usuario dijo «Sigue aquí» y no había nada que cambiar. */
  | 'dismissed'
  /** Se confirmó el cambio de empresa: el contacto se archivó y hay candidato nuevo. */
  | 'company_change_confirmed';

export interface EmailCheckBlock {
  hito: typeof CONTACT_EMAIL_CHECK_HITO;
  case: EmailChangeCase;
  /** Para qué se consultó al proveedor. */
  purpose: 'verify_email' | 'email' | 'linkedin' | 'phone';
  checked_at: string;
  checked_by: string | null;
  provider: 'apollo' | 'lusha' | null;
  /** El correo que trajo el proveedor (ya pagado). null si no trajo. */
  found_email: string | null;
  found_email_domain: string | null;
  employment: EmailCheckEmployment | null;
  resolution: EmailCheckResolution | null;
  resolved_at: string | null;
  resolved_by: string | null;
  /** Candidato creado en la empresa nueva (cuando se confirmó el cambio). */
  new_candidate_id: string | null;
}

export function buildEmailCheckEmployment(
  check: CurrentEmploymentCheck | null,
  snapshot: CurrentEmploymentSnapshot | null,
): EmailCheckEmployment | null {
  if (!check || check.status === 'unknown') return null;
  return {
    status: check.status,
    current_company: check.current_company,
    current_title: check.current_title,
    current_since: check.current_since,
    organization_domain: check.status === 'other_company' ? normalizeDomain(snapshot?.organization?.domain) : null,
  };
}

export function buildEmailCheckBlock(input: {
  classification: EmailChangeClassification;
  purpose: EmailCheckBlock['purpose'];
  checkedAt: string;
  checkedBy: string | null;
  provider: 'apollo' | 'lusha' | null;
  employment: EmailCheckEmployment | null;
}): EmailCheckBlock {
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    case: input.classification.case,
    purpose: input.purpose,
    checked_at: input.checkedAt,
    checked_by: input.checkedBy,
    provider: input.provider,
    found_email: input.classification.foundEmail,
    found_email_domain: input.classification.foundEmailDomain,
    employment: input.employment,
    resolution: null,
    resolved_at: null,
    resolved_by: null,
    new_candidate_id: null,
  };
}

const CASES: readonly EmailChangeCase[] = [
  'same_email',
  'same_company_new_email',
  'personal_email',
  'company_change',
  'conflicting',
  'left_no_email',
  'no_new_email',
];
const RESOLUTIONS: readonly EmailCheckResolution[] = ['applied', 'dismissed', 'company_change_confirmed'];

/** Lee el bloque guardado (tolerante a datos viejos o ajenos). */
export function readEmailCheckBlock(metadata: unknown): EmailCheckBlock | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const raw = (metadata as Record<string, unknown>)[EMAIL_CHECK_METADATA_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const kind = typeof r.case === 'string' && (CASES as readonly string[]).includes(r.case) ? (r.case as EmailChangeCase) : null;
  const checkedAt = clean(r.checked_at);
  if (!kind || !checkedAt) return null;
  const purpose = r.purpose === 'email' || r.purpose === 'linkedin' || r.purpose === 'phone' ? r.purpose : 'verify_email';
  const e = r.employment && typeof r.employment === 'object' && !Array.isArray(r.employment) ? (r.employment as Record<string, unknown>) : null;
  const employmentStatus = clean(e?.status);
  const resolution =
    typeof r.resolution === 'string' && (RESOLUTIONS as readonly string[]).includes(r.resolution)
      ? (r.resolution as EmailCheckResolution)
      : null;
  return {
    hito: CONTACT_EMAIL_CHECK_HITO,
    case: kind,
    purpose,
    checked_at: checkedAt,
    checked_by: clean(r.checked_by),
    provider: r.provider === 'apollo' || r.provider === 'lusha' ? r.provider : null,
    found_email: normalizeEmailForCheck(clean(r.found_email)),
    found_email_domain: clean(r.found_email_domain),
    employment:
      e && employmentStatus
        ? {
            status: employmentStatus as CurrentEmploymentCheck['status'],
            current_company: clean(e.current_company),
            current_title: clean(e.current_title),
            current_since: clean(e.current_since),
            organization_domain: clean(e.organization_domain),
          }
        : null,
    resolution,
    resolved_at: clean(r.resolved_at),
    resolved_by: clean(r.resolved_by),
    new_candidate_id: clean(r.new_candidate_id),
  };
}

/** ¿Hay un cambio de empresa detectado que nadie ha resuelto todavía? */
export function hasPendingCompanyChange(block: EmailCheckBlock | null): boolean {
  return !!block && block.resolution === null && COMPANY_CHANGE_CASES.has(block.case);
}

/**
 * ¿Merece guardarse esta comprobación hecha DE PASO (revelar LinkedIn, correo o teléfono)? Sólo
 * cuando dice algo: un cambio de empresa, un correo distinto. Un «todo igual» no pisa una
 * verificación anterior.
 */
export function isNoteworthyIncidentalCheck(kind: EmailChangeCase): boolean {
  return kind !== 'same_email' && kind !== 'no_new_email';
}
