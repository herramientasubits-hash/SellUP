// Agente 2A — Fusionar en HubSpot cuando el correo correcto ya lo tiene OTRO contacto
// (AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE, Bryan 19-11).
//
// Núcleo PURO: la red y la base entran por `deps`. NUNCA lanza.
//
// El caso: «Verificar correo» encuentra el correo correcto, SellUp lo deja como principal, pero en
// HubSpot el cambio da 409 porque OTRO contacto ya usa ese correo. Reglas de Bryan (19-11):
//   * Mismo contacto = el que HubSpot devuelve al BUSCAR POR EL CORREO recién encontrado. Ése es el
//     PRINCIPAL de la fusión; el contacto vinculado hoy a SellUp se fusiona DENTRO de él.
//   * Sólo con confirmación de una persona: la fusión no se puede deshacer.
//   * Después de fusionar, con lo que sabe SellUp: el LinkedIn y el cargo REEMPLAZAN; los teléfonos
//     van al primer campo vacío y nunca repetidos (`planRevealedPhonesForHubSpot`); la empresa de
//     la cuenta queda como «Principal» (sin quitar otras); el propietario del CONTACTO pasa a ser
//     quien confirma (la empresa no se toca).
//   * HubSpot crea un Record ID nuevo al fusionar: SellUp se repunta a ése.
//   * Contactos de SellUp duplicados (otro contacto de SellUp vinculado al de HubSpot que absorbe)
//     NO se unifican aquí: quedan anotados como pendiente.

import { linkedinProfileKey } from './linkedin-profile-url';
import { EMAIL_CHECK_METADATA_KEY } from './email-change-classifier-core';
import {
  planRevealedPhonesForHubSpot,
  type RevealedPhoneForHubSpot,
  type RevealedPhoneHubSpotPlan,
} from '@/modules/contacts/contact-hubspot-sync-core';
import type { HubSpotExistingContactProperties } from '@/modules/contacts/contact-hubspot-sync-core';

export const CONTACT_HUBSPOT_MERGE_HITO = 'AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE' as const;

/** Clave, dentro del bloque `email_check` del candidato y en `contacts.metadata`, de la fusión. */
export const HUBSPOT_MERGE_METADATA_KEY = 'hubspot_merge';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normEmail(value: unknown): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

// ── ¿Hay un 409 pendiente? ──────────────────────────────────────────

export interface PendingHubSpotEmailConflict {
  /** El correo correcto (el que encontró «Verificar correo» y quedó principal en SellUp). */
  foundEmail: string;
}

/**
 * El 409 que dejó «Verificar correo» (o «Sigue aquí») en el bloque `email_check` del candidato de
 * origen: se aplicó en SellUp, HubSpot dijo `conflict` y todavía nadie fusionó.
 */
export function readPendingHubSpotEmailConflict(
  candidateMetadata: Record<string, unknown> | null | undefined,
): PendingHubSpotEmailConflict | null {
  const raw = isRecord(candidateMetadata?.[EMAIL_CHECK_METADATA_KEY])
    ? (candidateMetadata![EMAIL_CHECK_METADATA_KEY] as Record<string, unknown>)
    : null;
  if (!raw) return null;
  if (raw.resolution !== 'applied' || raw.hubspot_outcome !== 'conflict') return null;
  const merge = isRecord(raw[HUBSPOT_MERGE_METADATA_KEY]) ? (raw[HUBSPOT_MERGE_METADATA_KEY] as Record<string, unknown>) : null;
  if (merge && (merge.outcome === 'merged' || merge.outcome === 'already_same' || merge.outcome === 'promoted_on_retry')) {
    return null;
  }
  const foundEmail = normEmail(raw.found_email);
  return foundEmail ? { foundEmail } : null;
}

// ── Oferta ──────────────────────────────────────────────────────────

/** Lo que la confirmación muestra del contacto de HubSpot que tiene el correo. */
export interface HubSpotMergeOtherContact {
  id: string;
  name: string | null;
  email: string | null;
  jobTitle: string | null;
}

export type HubSpotMergeOffer =
  /** Nada que ofrecer. */
  | { status: 'none' }
  /** Hay otro contacto de HubSpot con el correo: se puede fusionar (con confirmación). */
  | { status: 'available'; foundEmail: string; currentHubSpotContactId: string; other: HubSpotMergeOtherContact }
  /** Ya nadie más tiene el correo en HubSpot: basta con reintentar el cambio de principal. */
  | { status: 'retry'; foundEmail: string; currentHubSpotContactId: string }
  /** No se pudo consultar HubSpot. */
  | { status: 'hubspot_unavailable'; foundEmail: string };

export interface HubSpotProfileForMerge {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
}

/**
 * Decide la oferta. `other` es lo que HubSpot devolvió al buscar por el correo encontrado:
 * `null` = nadie lo tiene; `'error'` = no se pudo consultar.
 */
export function classifyHubSpotMergeOffer(input: {
  contact: { email: string | null; hubspotContactId: string | null; archivedAt: string | null } | null;
  conflict: PendingHubSpotEmailConflict | null;
  other: HubSpotProfileForMerge | null | 'error' | undefined;
}): HubSpotMergeOffer {
  const { contact, conflict } = input;
  if (!contact || !conflict || contact.archivedAt) return { status: 'none' };
  const current = clean(contact.hubspotContactId);
  if (!current) return { status: 'none' };
  // Si alguien cambió el correo del contacto en SellUp después, ya no es el mismo caso.
  if (normEmail(contact.email) !== conflict.foundEmail) return { status: 'none' };
  if (input.other === 'error' || input.other === undefined) return { status: 'hubspot_unavailable', foundEmail: conflict.foundEmail };
  if (input.other === null) return { status: 'retry', foundEmail: conflict.foundEmail, currentHubSpotContactId: current };
  if (String(input.other.id) === current) return { status: 'none' };
  const name = [clean(input.other.firstName), clean(input.other.lastName)].filter(Boolean).join(' ') || null;
  return {
    status: 'available',
    foundEmail: conflict.foundEmail,
    currentHubSpotContactId: current,
    other: { id: String(input.other.id), name, email: normEmail(input.other.email), jobTitle: clean(input.other.jobTitle) },
  };
}

// ── Lo que viaja después de fusionar ───────────────────────────────

export interface MergeFollowUpInput {
  /** Lo que sabe SellUp del contacto. */
  sellup: { linkedinUrl: string | null; jobTitle: string | null };
  /** Propietario de HubSpot de quien confirma (null si no se encontró). */
  actorOwnerId: string | null;
  /** El contacto fusionado, leído de HubSpot. */
  merged: { properties: HubSpotExistingContactProperties; ownerId: string | null } | null;
  /** Números vivos del contacto en SellUp (colección oficial, principal primero). */
  sellupPhones: readonly RevealedPhoneForHubSpot[];
}

export interface MergeFollowUpPlan {
  /** Se REEMPLAZAN (sólo los que cambian). */
  replace: { hs_linkedin_url?: string; jobtitle?: string; hubspot_owner_id?: string };
  /** Primer campo vacío, nunca repetidos. */
  phones: RevealedPhoneHubSpotPlan;
}

export function planMergeFollowUp(input: MergeFollowUpInput): MergeFollowUpPlan {
  const replace: MergeFollowUpPlan['replace'] = {};
  const props = input.merged?.properties ?? {};

  const linkedin = clean(input.sellup.linkedinUrl);
  if (linkedin) {
    const remote = clean(props.hs_linkedin_url ?? null);
    const same = remote && linkedinProfileKey(remote) && linkedinProfileKey(remote) === linkedinProfileKey(linkedin);
    if (!same) replace.hs_linkedin_url = linkedin;
  }

  const title = clean(input.sellup.jobTitle);
  if (title && clean(props.jobtitle ?? null)?.toLowerCase() !== title.toLowerCase()) replace.jobtitle = title;

  const owner = clean(input.actorOwnerId);
  if (owner && clean(input.merged?.ownerId ?? null) !== owner) replace.hubspot_owner_id = owner;

  // Sin poder leer el contacto fusionado no se afirma qué campos están vacíos: no viaja ningún
  // teléfono (fail closed, igual que el completado de vacíos).
  const phones = input.merged ? planRevealedPhonesForHubSpot(input.sellupPhones, props) : {};
  return { replace, phones };
}

// ── Orquestación ────────────────────────────────────────────────────

export type HubSpotMergeOutcome =
  /** Se fusionó y SellUp quedó apuntando al registro resultante. */
  | 'merged'
  /** Nadie más tenía el correo: se volvió a cambiar el principal y esta vez entró. */
  | 'promoted_on_retry'
  /** El contacto que tiene el correo ya es el vinculado: no había nada que fusionar. */
  | 'already_same'
  /** No hay 409 pendiente para este contacto. */
  | 'not_pending'
  | 'hubspot_unavailable'
  | 'merge_failed'
  | 'retry_failed';

export type StepOutcome = 'written' | 'unchanged' | 'failed' | 'skipped';

export interface HubSpotMergeReport {
  outcome: HubSpotMergeOutcome;
  /** Id del contacto que tenía el correo (principal de la fusión). */
  primaryHubSpotContactId: string | null;
  /** Id del contacto de SellUp que se fusionó dentro. */
  mergedFromHubSpotContactId: string | null;
  /** Id resultante (nuevo por defecto en HubSpot). */
  mergedHubSpotContactId: string | null;
  /** Código HTTP de HubSpot cuando la fusión falló (sin cuerpo). */
  httpStatus: number | null;
  steps: {
    repoint: 'written' | 'failed' | 'skipped';
    email: 'primary' | 'not_primary' | 'unreadable' | 'skipped';
    linkedin: StepOutcome;
    jobTitle: StepOutcome;
    owner: StepOutcome;
    phones: StepOutcome;
    company: StepOutcome;
  };
  /** Otros contactos de SellUp vinculados a alguno de los dos ids (pendiente de unificar). */
  otherSellupContactIds: string[];
}

export interface HubSpotMergeDeps {
  findByEmail: (email: string) => Promise<HubSpotProfileForMerge | null>;
  promotePrimaryEmail: (hubspotContactId: string, email: string) => Promise<string>;
  merge: (primaryId: string, mergeId: string) => Promise<{ ok: true; mergedId: string } | { error: string; status?: number }>;
  /** Repunta SellUp (contacto, su candidato y cualquier otro contacto vinculado a los dos ids). */
  repoint: (input: { fromIds: string[]; toId: string }) => Promise<{ ok: true; otherContactIds: string[] } | { ok: false }>;
  readMerged: (hubspotContactId: string) => Promise<{ properties: HubSpotExistingContactProperties; ownerId: string | null } | null>;
  readPrimaryEmail: (hubspotContactId: string) => Promise<string | null | undefined>;
  loadSellupPhones: () => Promise<RevealedPhoneForHubSpot[]>;
  resolveActorOwnerId: () => Promise<string | null>;
  replaceProperties: (
    hubspotContactId: string,
    props: MergeFollowUpPlan['replace'],
  ) => Promise<{ ok: true; written: string[] } | { error: string }>;
  fillPhones: (hubspotContactId: string, plan: RevealedPhoneHubSpotPlan) => Promise<{ ok: true; written: string[] } | { error: string }>;
  setPrimaryCompany: (hubspotContactId: string, hubspotCompanyId: string) => Promise<{ ok: true } | { error: string }>;
}

export interface HubSpotMergeInput {
  conflict: PendingHubSpotEmailConflict | null;
  contact: {
    email: string | null;
    hubspotContactId: string | null;
    archivedAt: string | null;
    linkedinUrl: string | null;
    jobTitle: string | null;
    accountHubSpotCompanyId: string | null;
  };
}

async function safe<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await call();
  } catch {
    return fallback;
  }
}

const NO_STEPS: HubSpotMergeReport['steps'] = {
  repoint: 'skipped',
  email: 'skipped',
  linkedin: 'skipped',
  jobTitle: 'skipped',
  owner: 'skipped',
  phones: 'skipped',
  company: 'skipped',
};

export async function runHubSpotContactMerge(input: HubSpotMergeInput, deps: HubSpotMergeDeps): Promise<HubSpotMergeReport> {
  const report = (patch: Partial<HubSpotMergeReport> & { outcome: HubSpotMergeOutcome }): HubSpotMergeReport => ({
    primaryHubSpotContactId: null,
    mergedFromHubSpotContactId: clean(input.contact.hubspotContactId),
    mergedHubSpotContactId: null,
    httpStatus: null,
    steps: NO_STEPS,
    otherSellupContactIds: [],
    ...patch,
  });

  const current = clean(input.contact.hubspotContactId);
  const conflict = input.conflict;
  if (!conflict || !current || input.contact.archivedAt || normEmail(input.contact.email) !== conflict.foundEmail) {
    return report({ outcome: 'not_pending' });
  }

  // 1. El mismo contacto = el que HubSpot devuelve buscando por el correo encontrado.
  let other: HubSpotProfileForMerge | null;
  try {
    other = await deps.findByEmail(conflict.foundEmail);
  } catch {
    return report({ outcome: 'hubspot_unavailable' });
  }

  // 2. Nadie lo tiene ya (lo borraron o le cambiaron el correo): reintentar el principal.
  if (!other) {
    const retried = await safe(() => deps.promotePrimaryEmail(current, conflict.foundEmail), 'failed');
    const ok = retried === 'promoted' || retried === 'already_primary' || retried === 'promoted_previous_not_kept';
    return report({ outcome: ok ? 'promoted_on_retry' : 'retry_failed', mergedHubSpotContactId: ok ? current : null });
  }

  const primaryId = String(other.id);
  if (primaryId === current) {
    return report({ outcome: 'already_same', primaryHubSpotContactId: primaryId, mergedHubSpotContactId: current });
  }

  // 3. Fusionar: el que tiene el correo es el principal.
  const merged = await safe(() => deps.merge(primaryId, current), { error: 'THREW' } as { error: string; status?: number });
  if (!('ok' in merged)) {
    return report({ outcome: 'merge_failed', primaryHubSpotContactId: primaryId, httpStatus: merged.status ?? null });
  }
  const mergedId = merged.mergedId;
  const steps: HubSpotMergeReport['steps'] = { ...NO_STEPS };

  // 4. SellUp al id resultante. Desde aquí nada frena lo siguiente: la fusión ya ocurrió.
  const repointed = await safe(() => deps.repoint({ fromIds: [current, primaryId], toId: mergedId }), { ok: false } as const);
  steps.repoint = repointed.ok ? 'written' : 'failed';
  const otherSellupContactIds = repointed.ok ? repointed.otherContactIds : [];

  // 5. Lo que sabe SellUp.
  const [mergedContact, sellupPhones, actorOwnerId] = await Promise.all([
    safe(() => deps.readMerged(mergedId), null),
    safe(() => deps.loadSellupPhones(), [] as RevealedPhoneForHubSpot[]),
    safe(() => deps.resolveActorOwnerId(), null),
  ]);
  const plan = planMergeFollowUp({
    sellup: { linkedinUrl: input.contact.linkedinUrl, jobTitle: input.contact.jobTitle },
    actorOwnerId,
    merged: mergedContact,
    sellupPhones,
  });

  const replaceKeys = Object.keys(plan.replace);
  if (replaceKeys.length > 0) {
    const written = await safe(() => deps.replaceProperties(mergedId, plan.replace), { error: 'THREW' } as { error: string });
    const ok = 'ok' in written ? new Set(written.written) : new Set<string>();
    const mark = (key: string, has: boolean): StepOutcome => (!has ? 'unchanged' : ok.has(key) ? 'written' : 'failed');
    steps.linkedin = mark('hs_linkedin_url', 'hs_linkedin_url' in plan.replace);
    steps.jobTitle = mark('jobtitle', 'jobtitle' in plan.replace);
    steps.owner = mark('hubspot_owner_id', 'hubspot_owner_id' in plan.replace);
  } else {
    steps.linkedin = clean(input.contact.linkedinUrl) ? 'unchanged' : 'skipped';
    steps.jobTitle = clean(input.contact.jobTitle) ? 'unchanged' : 'skipped';
    steps.owner = actorOwnerId ? 'unchanged' : 'skipped';
  }
  if (!actorOwnerId) steps.owner = 'skipped';

  if (!mergedContact) {
    steps.phones = 'skipped';
  } else if (Object.keys(plan.phones).length === 0) {
    steps.phones = 'unchanged';
  } else {
    const filled = await safe(() => deps.fillPhones(mergedId, plan.phones), { error: 'THREW' } as { error: string });
    steps.phones = 'ok' in filled && filled.written.length > 0 ? 'written' : 'failed';
  }

  const companyId = clean(input.contact.accountHubSpotCompanyId);
  if (companyId) {
    const company = await safe(() => deps.setPrimaryCompany(mergedId, companyId), { error: 'THREW' } as { error: string });
    steps.company = 'ok' in company ? 'written' : 'failed';
  }

  const primaryEmail = await safe(() => deps.readPrimaryEmail(mergedId), undefined);
  steps.email =
    primaryEmail === undefined ? 'unreadable' : normEmail(primaryEmail) === conflict.foundEmail ? 'primary' : 'not_primary';

  return report({
    outcome: 'merged',
    primaryHubSpotContactId: primaryId,
    mergedHubSpotContactId: mergedId,
    steps,
    otherSellupContactIds,
  });
}

// ── Copy ────────────────────────────────────────────────────────────

export function hubspotMergeOutcomeText(outcome: HubSpotMergeOutcome, httpStatus: number | null = null): string {
  switch (outcome) {
    case 'merged':
      return 'Listo: los contactos quedaron fusionados en HubSpot con el correo correcto como principal.';
    case 'promoted_on_retry':
      return 'Listo: en HubSpot ya nadie más tenía ese correo y quedó como principal.';
    case 'already_same':
      return 'En HubSpot ya es el mismo contacto: no había nada que fusionar.';
    case 'not_pending':
      return 'Ya no hay nada que fusionar para este contacto.';
    case 'hubspot_unavailable':
      return 'No pudimos consultar HubSpot. Intenta de nuevo en un momento.';
    case 'retry_failed':
      return 'HubSpot no aceptó el correo como principal. Intenta de nuevo en un momento.';
    case 'merge_failed':
      return httpStatus === 403
        ? 'HubSpot no permitió la fusión: la conexión no tiene permiso para fusionar contactos.'
        : 'HubSpot no pudo fusionar los contactos (puede ser el límite de fusiones o de asociaciones). No se cambió nada.';
  }
}
