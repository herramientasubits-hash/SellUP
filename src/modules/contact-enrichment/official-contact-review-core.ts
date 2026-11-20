// Agente 2A — «Revisión» de un contacto APROBADO (AGENT2A-CONTACT-APPROVED-REVIEW, Bryan 19-11).
//
// La ficha del contacto abre la MISMA ficha del candidato que «Por revisar», sobre su candidato
// de origen ya aprobado. Allí se revela y verifica igual que antes de aprobar; «Guardar» lleva al
// contacto (y a HubSpot) lo que el candidato tiene y el contacto todavía no.
//
// PURO: qué cambia, cómo se describe y qué hacer con una empresa elegida a mano. Lo usan la
// acción (para aplicar) y la UI (copy). Sin dependencias de servidor.

import {
  classifyEmailChange,
  isPersonalEmailDomain,
  normalizeEmailForCheck,
} from './email-change-classifier-core';
import { canonicalLinkedin } from './candidate-identity-completion-core';

export const OFFICIAL_CONTACT_REVIEW_HITO = 'AGENT2A-CONTACT-APPROVED-REVIEW' as const;
export const OFFICIAL_CONTACT_REVIEW_TRAIL_KEY = 'review_saves' as const;
/** Marca del candidato de un cambio de empresa sin dueño en la empresa nueva: lo ven todos. */
export const COMPANY_CHANGE_OPEN_METADATA_KEY = 'company_change_open' as const;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// ── Qué cambia ──────────────────────────────────────────────────────

export interface ReviewContactSnapshot {
  email: string | null;
  linkedinUrl: string | null;
  jobTitle: string | null;
  /** Dominio de la cuenta del contacto (para saber si un correo es de la misma empresa). */
  accountDomain: string | null;
}

export interface ReviewCandidateSnapshot {
  email: string | null;
  linkedinUrl: string | null;
  title: string | null;
}

/**
 * Qué hacer con el correo del candidato:
 *   * `fill` — el contacto no tiene correo: se completa.
 *   * `same_company` — otro correo de la misma empresa: pasa a principal (el anterior, adicional).
 *   * `personal` — correo personal: aparte, nunca principal.
 *   * `other_company` — de otra empresa: NO se aplica aquí (va por «Cambió de empresa»).
 */
export type ReviewEmailChange =
  | { kind: 'fill'; email: string }
  | { kind: 'same_company'; email: string; previous: string }
  | { kind: 'personal'; email: string }
  | { kind: 'other_company'; email: string };

export interface ReviewChangePlan {
  email: ReviewEmailChange | null;
  /** LinkedIn nuevo para un contacto que no lo tiene (nunca reemplaza uno distinto). */
  linkedinUrl: string | null;
  /** Cargo nuevo (distinto y no vacío). */
  jobTitle: string | null;
}

export function planOfficialContactReviewChanges(input: {
  contact: ReviewContactSnapshot;
  candidate: ReviewCandidateSnapshot;
}): ReviewChangePlan {
  const { contact, candidate } = input;
  const current = normalizeEmailForCheck(contact.email);
  const found = normalizeEmailForCheck(candidate.email);
  let email: ReviewEmailChange | null = null;
  if (found && !current) {
    const domain = found.slice(found.lastIndexOf('@') + 1);
    email = isPersonalEmailDomain(domain) ? { kind: 'personal', email: found } : { kind: 'fill', email: found };
  } else if (found && current && found !== current) {
    const classified = classifyEmailChange({
      currentEmail: current,
      foundEmail: found,
      companyDomains: [contact.accountDomain, current.slice(current.lastIndexOf('@') + 1)],
      employment: null,
    });
    if (classified.case === 'personal_email') email = { kind: 'personal', email: found };
    else if (classified.case === 'same_company_new_email') email = { kind: 'same_company', email: found, previous: current };
    else if (classified.case !== 'same_email') email = { kind: 'other_company', email: found };
  }

  const candidateLinkedin = canonicalLinkedin(candidate.linkedinUrl);
  const linkedinUrl = candidateLinkedin && !canonicalLinkedin(contact.linkedinUrl) ? clean(candidate.linkedinUrl) : null;

  const title = clean(candidate.title);
  const jobTitle = title && title.toLowerCase() !== (clean(contact.jobTitle) ?? '').toLowerCase() ? title : null;

  return { email, linkedinUrl, jobTitle };
}

/** ¿Hay algo que aplicar (sin contar teléfonos, que se cuentan aparte)? */
export function reviewPlanHasChanges(plan: ReviewChangePlan): boolean {
  return (!!plan.email && plan.email.kind !== 'other_company') || !!plan.linkedinUrl || !!plan.jobTitle;
}

/** Las líneas del resumen que se muestra ANTES de aplicar. */
export function describeOfficialContactReviewChanges(input: {
  plan: ReviewChangePlan;
  newPhones: readonly string[];
  contactEmail: string | null;
  contactJobTitle: string | null;
}): string[] {
  const { plan } = input;
  const lines: string[] = [];
  if (plan.email) {
    switch (plan.email.kind) {
      case 'fill':
        lines.push(`Correo: se agrega ${plan.email.email}.`);
        break;
      case 'same_company':
        lines.push(`Correo: ${plan.email.previous} → ${plan.email.email} (el anterior queda como adicional).`);
        break;
      case 'personal':
        lines.push(`Correo personal: ${plan.email.email} (aparte; no reemplaza al principal).`);
        break;
      case 'other_company':
        lines.push(
          `Correo de otra empresa (${plan.email.email}): no se cambia aquí. Si ya no trabaja en esta empresa, usa «Enviar a revisión» en el aviso de cambio de empresa.`,
        );
        break;
    }
  }
  if (input.newPhones.length > 0) lines.push(`Teléfonos nuevos: ${input.newPhones.join(', ')}.`);
  if (plan.linkedinUrl) lines.push('LinkedIn: agregado.');
  if (plan.jobTitle) {
    lines.push(
      input.contactJobTitle ? `Cargo: ${input.contactJobTitle} → ${plan.jobTitle}.` : `Cargo: se agrega ${plan.jobTitle}.`,
    );
  }
  return lines;
}

// ── Empresa elegida a mano (Bryan 19-11, § 6) ───────────────────────

export type ReviewCompanyMoveDecision =
  /** Es la empresa en la que ya está. */
  | 'same_company'
  /** La empresa es de quien revisa: se cambia en el MISMO contacto. */
  | 'in_place'
  /** Es de otro dueño, no tiene dueño o no existe en SellUp: flujo «Cambió de empresa» (opción A). */
  | 'company_change';

export function decideReviewCompanyMove(input: {
  actorId: string;
  contactAccountId: string;
  /** La cuenta de SellUp de la empresa elegida, si existe. */
  target: { accountId: string; ownerId: string | null } | null;
}): ReviewCompanyMoveDecision {
  const target = input.target;
  if (target && target.accountId === input.contactAccountId) return 'same_company';
  if (target && target.ownerId && target.ownerId === input.actorId) return 'in_place';
  return 'company_change';
}

/** ¿El candidato del cambio de empresa queda abierto a todos? (empresa sin dueño o sin cuenta). */
export function isOpenCompanyChangeTarget(target: { accountId: string | null; ownerId: string | null } | null): boolean {
  return !target || !target.accountId || !target.ownerId;
}

export function isOpenCompanyChangeCandidate(metadata: unknown): boolean {
  return isRecord(metadata) && metadata[COMPANY_CHANGE_OPEN_METADATA_KEY] === true;
}

// ── Rastro en el contacto ───────────────────────────────────────────

export interface ReviewTrailEntry {
  hito: typeof OFFICIAL_CONTACT_REVIEW_HITO;
  candidate_id: string;
  saved_at: string;
  saved_by: string;
  /** `close`: se guardó solo al cerrar la revisión (Bryan 19-11: lo revelado no se pierde). */
  trigger: 'save' | 'close' | 'company_move';
  changes: string[];
  /** Lo que no se pudo aplicar (se aplicó lo demás; nada se deshace). */
  failed: string[];
}

const MAX_TRAIL = 20;

export function appendReviewTrail(metadata: unknown, entry: ReviewTrailEntry): Record<string, unknown> {
  const base = isRecord(metadata) ? metadata : {};
  const previous = Array.isArray(base[OFFICIAL_CONTACT_REVIEW_TRAIL_KEY]) ? (base[OFFICIAL_CONTACT_REVIEW_TRAIL_KEY] as unknown[]) : [];
  return { ...base, [OFFICIAL_CONTACT_REVIEW_TRAIL_KEY]: [...previous, entry].slice(-MAX_TRAIL) };
}

// ── Copy ────────────────────────────────────────────────────────────

export const OFFICIAL_CONTACT_REVIEW_COPY = {
  button: 'Revisión',
  buttonHelper: 'Abre su ficha de revisión: revela o verifica correo, LinkedIn y teléfonos (incluido «Buscar más números») y cambia su empresa.',
  banner: 'Revisando contacto aprobado · los cambios se aplican al guardar. Lo que reveles también se guarda al cerrar.',
  save: 'Guardar',
  saving: 'Guardando…',
  summaryTitle: 'Guardar cambios en el contacto',
  summaryDescription: 'Esto se aplica al contacto de SellUp y al de HubSpot:',
  nothingToSave: 'No hay cambios para guardar: el contacto ya tiene lo que muestra la revisión.',
  saved: (count: number) => (count === 1 ? 'Se guardó 1 cambio en el contacto.' : `Se guardaron ${count} cambios en el contacto.`),
  partial: (failed: readonly string[]) => `Se guardó lo demás, pero no se pudo: ${failed.join('; ')}.`,
  openFailed: 'No pudimos abrir la revisión de este contacto. Vuelve a intentarlo.',
  unavailable: 'Este contacto no se puede revisar (archivado o fuera de tu alcance).',
  companyMovedInPlace: (company: string) => `Listo: el contacto ahora está en ${company} (en HubSpot, como empresa principal).`,
  companySame: (company: string) => `El contacto ya está en ${company}.`,
  companyChangeHint:
    'Esa empresa es de otro responsable, no tiene responsable o no existe en SellUp: el contacto se archiva y se crea un candidato «Por revisar» allí, con su correo, LinkedIn y todos sus teléfonos.',
} as const;
