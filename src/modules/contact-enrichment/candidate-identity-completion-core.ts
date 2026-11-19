// Agente 2A — Completar un candidato que ya existe en HubSpot: «Revelar LinkedIn», «Revelar
// correo» e identidad para «Revelar teléfono» (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// «Primero HubSpot» ofrece como candidatos contactos que YA están en el CRM. Muchos llegan
// incompletos: sólo con correo, o sólo con LinkedIn, y sin teléfono. Para esos candidatos:
//
//   * no había forma de traer el canal que falta (LinkedIn o correo);
//   * «Revelar teléfono» quedaba DESHABILITADO para siempre: su `source_contact_id` es un id de
//     HubSpot, no de Apollo ni de Lusha, así que la privacidad (supresión por identidad NATIVA
//     del proveedor, PR #289) no se podía evaluar y el reveal se bloqueaba fail-closed.
//
// Este núcleo identifica a la persona en Apollo con un `people/match` usando lo que el candidato
// SÍ tiene (el mismo endpoint que la búsqueda por LinkedIn y la completion de #589; nunca
// `reveal_phone_number`). Con CORREO y LINKEDIN, los usa uno después del otro: primero el correo
// y, si no aparece la persona, el LinkedIn. Con lo que devuelve:
//
//   * guarda el `apollo_person_id` (columna de la mig. 098) ⇒ la privacidad pasa a ser
//     evaluable con la MISMA función que usan los cuatro gates del servidor
//     (`resolvePhoneRevealProviderIdentity`) y «Revelar teléfono» sigue su flujo de siempre;
//   * guarda el LinkedIn o el correo que faltaban. Si Apollo no los trae, Lusha: búsqueda por
//     correo para el LinkedIn (vista sin revelar) o búsqueda por LinkedIn + enrich SÓLO de
//     correos para el correo (los mismos adaptadores de la búsqueda por LinkedIn). Nunca
//     teléfonos.
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITES (deliberados)
// ═══════════════════════════════════════════════════════════════════
//
//   * NUNCA sobrescribe: sólo completa columnas vacías (`apollo_person_id`, `linkedin_url`,
//     `email`).
//   * NUNCA revela teléfonos. El teléfono sigue siendo el waterfall.
//   * Un match cuyo nombre no se parece al del candidato NO se guarda (`identity_mismatch`):
//     guardar la identidad de otra persona haría que la privacidad se evaluara sobre ella.
//   * Sólo candidatos de origen HubSpot, en `pending_review` (o aprobados, desde la ficha del
//     contacto que nació de ellos), con correo o LinkedIn. Sólo roles
//     que pueden revelar teléfono. Los candidatos de Apollo/Lusha no cambian en nada.
//   * Es PURO: sin red, sin Supabase, sin env. Todo efecto entra por `deps`.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import { resolvePhoneRevealProviderIdentity } from './provider-suppression-core';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import { normalizeLinkedinProfileUrl } from './linkedin-profile-url';
import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  assessCurrentEmployment,
  titleAfterEmploymentCheck,
  type CurrentEmploymentSnapshot,
} from './current-employment-check';
import {
  EMAIL_CHECK_METADATA_KEY,
  EMAIL_WITHHELD_CASES,
  COMPANY_CHANGE_CASES,
  buildEmailCheckBlock,
  buildEmailCheckEmployment,
  classifyEmailChange,
} from './email-change-classifier-core';

export const CANDIDATE_IDENTITY_COMPLETION_HITO = 'AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION';

/** Clave en `enrichment_metadata` donde queda el rastro del último intento. */
export const IDENTITY_COMPLETION_METADATA_KEY = 'identity_completion';

/** Créditos de Apollo de una identificación (`people/match` respondido). */
export const IDENTITY_COMPLETION_APOLLO_CREDITS = 1;

/** Para qué se pide la identificación: cambia qué carencia la justifica. */
export type IdentityCompletionPurpose = 'linkedin' | 'email' | 'phone';

/** Dato con el que se busca a la persona. */
export type IdentityChannel = 'email' | 'linkedin';

// ── Normalización ────────────────────────────────────────────────

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Correo utilizable (minúsculas) o null. Descarta los marcadores de correo bloqueado. */
export function normalizeCandidateEmail(value: string | null | undefined): string | null {
  const email = clean(value)?.toLowerCase() ?? null;
  if (!email || !EMAIL_PATTERN.test(email)) return null;
  if (email.includes('email_not_unlocked') || email.endsWith('@domain.com')) return null;
  return email;
}

/** URL canónica de un perfil `/in/` o null. */
export function canonicalLinkedin(value: string | null | undefined): string | null {
  const normalized = normalizeLinkedinProfileUrl(value);
  return normalized.ok ? normalized.canonicalUrl : null;
}

// ── Elegibilidad (compartida con el cliente) ─────────────────────

export interface IdentityCompletionFacts {
  email?: string | null;
  linkedinUrl?: string | null;
  apolloPersonId?: string | null;
  source?: string | null;
  sourceContactId?: string | null;
  enrichmentMetadata?: Record<string, unknown> | null;
}

export interface IdentityCompletionEligibility {
  /**
   * El candidato vino de HubSpot («Primero HubSpot»). Es el ÚNICO origen al que se ofrece: los de
   * Apollo/Lusha ya nacen con identidad de proveedor, y para ellos el bloqueo de privacidad sin
   * identidad se conserva exactamente como estaba (#291 / #295).
   */
  isHubSpotCandidate: boolean;
  /** Tiene un correo utilizable con el que buscar. */
  hasEmail: boolean;
  /** Tiene un perfil de LinkedIn (`/in/`) con el que buscar. */
  hasLinkedin: boolean;
  /** No tiene LinkedIn. */
  missingLinkedin: boolean;
  /** No tiene correo. */
  missingEmail: boolean;
  /** No tiene identidad NATIVA de proveedor: la privacidad del reveal no es evaluable. */
  missingProviderIdentity: boolean;
  /** Un intento anterior ya terminó sin resultado: no se vuelve a ofrecer para no gastar. */
  previousAttemptFruitless: boolean;
  /** Datos con los que se buscaría, EN ORDEN (correo primero, luego LinkedIn). */
  identityChannels: IdentityChannel[];
  /** ¿Se ofrece «Revelar LinkedIn»? (tiene correo, le falta el LinkedIn) */
  canRevealLinkedin: boolean;
  /** ¿Se ofrece «Revelar correo»? (tiene LinkedIn, le falta el correo) */
  canRevealEmail: boolean;
  /** ¿«Revelar teléfono» necesita identificar primero (y puede)? */
  phoneRevealNeedsIdentity: boolean;
}

const FRUITLESS_OUTCOMES = new Set<IdentityCompletionOutcome>(['not_found', 'identity_mismatch']);

/**
 * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — huella del dato con el que se buscó (correo y
 * LinkedIn normalizados). Un intento sin fruto bloquea volver a gastar CON LOS MISMOS DATOS; si el
 * registro gana un correo o un LinkedIn nuevo, la huella cambia y se vuelve a ofrecer. Es un hash
 * FNV-1a (no criptográfico): sólo sirve para comparar, nunca para guardar el dato en claro.
 */
export function identityCompletionInputKey(facts: Pick<IdentityCompletionFacts, 'email' | 'linkedinUrl'>): string {
  const text = `${normalizeCandidateEmail(facts.email) ?? ''}|${canonicalLinkedin(facts.linkedinUrl) ?? ''}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v1:${hash.toString(16).padStart(8, '0')}`;
}

/** Huella guardada en el último intento, o null (intentos anteriores a este hito). */
export function readLastIdentityCompletionInputKey(metadata: Record<string, unknown> | null | undefined): string | null {
  const block = metadata?.[IDENTITY_COMPLETION_METADATA_KEY];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const key = (block as Record<string, unknown>).input_key;
  return typeof key === 'string' && key ? key : null;
}

export interface IdentityCompletionEvaluationOptions {
  /**
   * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — también candidatos de Apollo, Lusha o creados a
   * mano. Sólo lo pasa la ficha del contacto OFICIAL (Bryan 18-11): «Por revisar» no cambia.
   */
  anySource?: boolean;
}

/** Último desenlace registrado en la metadata del candidato, o null. */
export function readLastIdentityCompletionOutcome(
  metadata: Record<string, unknown> | null | undefined,
): IdentityCompletionOutcome | null {
  const block = metadata?.[IDENTITY_COMPLETION_METADATA_KEY];
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  const outcome = (block as Record<string, unknown>).outcome;
  return typeof outcome === 'string' && (IDENTITY_COMPLETION_OUTCOMES as readonly string[]).includes(outcome)
    ? (outcome as IdentityCompletionOutcome)
    : null;
}

export function evaluateCandidateIdentityCompletion(
  facts: IdentityCompletionFacts,
  options: IdentityCompletionEvaluationOptions = {},
): IdentityCompletionEligibility {
  const isHubSpotCandidate = clean(facts.source)?.toLowerCase() === 'hubspot';
  const hasEmail = normalizeCandidateEmail(facts.email) !== null;
  const hasLinkedin = canonicalLinkedin(facts.linkedinUrl) !== null;
  const missingLinkedin = !clean(facts.linkedinUrl);
  const missingEmail = !clean(facts.email);
  const missingProviderIdentity =
    resolvePhoneRevealProviderIdentity({
      apolloPersonId: facts.apolloPersonId ?? null,
      source: facts.source ?? null,
      sourceContactId: facts.sourceContactId ?? null,
    }) === null;
  const last = readLastIdentityCompletionOutcome(facts.enrichmentMetadata ?? null);
  // Sin fruto CON LOS MISMOS DATOS. Un intento viejo (sin huella) sigue bloqueando como antes.
  const lastKey = readLastIdentityCompletionInputKey(facts.enrichmentMetadata ?? null);
  const previousAttemptFruitless =
    last !== null && FRUITLESS_OUTCOMES.has(last) && (lastKey === null || lastKey === identityCompletionInputKey(facts));
  const identityChannels: IdentityChannel[] = [
    ...(hasEmail ? (['email'] as const) : []),
    ...(hasLinkedin ? (['linkedin'] as const) : []),
  ];
  const offerable = (isHubSpotCandidate || options.anySource === true) && !previousAttemptFruitless;
  return {
    isHubSpotCandidate,
    hasEmail,
    hasLinkedin,
    missingLinkedin,
    missingEmail,
    missingProviderIdentity,
    previousAttemptFruitless,
    identityChannels,
    canRevealLinkedin: offerable && hasEmail && missingLinkedin,
    canRevealEmail: offerable && hasLinkedin && missingEmail,
    phoneRevealNeedsIdentity: offerable && identityChannels.length > 0 && missingProviderIdentity,
  };
}

// ── Coincidencia de nombre ───────────────────────────────────────

function nameTokens(...values: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s'-]/g, ' ');
    for (const token of normalized.split(/[\s'-]+/)) {
      if (token.length >= 2) tokens.add(token);
    }
  }
  return tokens;
}

/**
 * ¿El nombre que devolvió el proveedor es compatible con el del candidato? Basta con que
 * compartan un nombre o un apellido. Sin nombre en alguno de los dos lados se acepta: el correo o
 * el LinkedIn son coincidencias exactas y no hay con qué contradecirlas.
 */
export function isProviderNameConsistent(
  candidate: { firstName?: string | null; lastName?: string | null; fullName?: string | null },
  provider: { firstName?: string | null; lastName?: string | null; fullName?: string | null },
): boolean {
  const local = nameTokens(candidate.firstName, candidate.lastName, candidate.fullName);
  const remote = nameTokens(provider.firstName, provider.lastName, provider.fullName);
  if (local.size === 0 || remote.size === 0) return true;
  for (const token of remote) if (local.has(token)) return true;
  return false;
}

// ── Contrato con el exterior ─────────────────────────────────────

export interface IdentityCompletionCandidate {
  id: string;
  status: string | null;
  source: string | null;
  sourceContactId: string | null;
  apolloPersonId: string | null;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  companyName: string | null;
  companyDomain: string | null;
  /** Cargo que mostramos hoy (de HubSpot). Opcional para no romper lectores viejos. */
  title?: string | null;
  enrichmentMetadata: Record<string, unknown>;
}

export interface IdentityProviderUsage {
  provider_key: 'apollo' | 'lusha';
  /** `person_match`, `lusha_contact_search`, `lusha_contact_enrich`. */
  operation_key: string;
  /** null ⇒ desconocido, nunca 0 inventado. */
  credits_used: number | null;
  status: 'success' | 'error';
  results_returned: number;
  error_code?: string;
}

/**
 * Una búsqueda: por CORREO o por LINKEDIN (nunca los dos a la vez, para que cada crédito tenga
 * un único dato que lo justifique). Nombre y empresa sólo desempatan.
 */
export interface IdentityLookupQuery {
  channel: IdentityChannel;
  email: string | null;
  linkedinUrl: string | null;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  domain: string | null;
  /** Se busca el correo: el proveedor puede revelar correos (nunca teléfonos). */
  wantsEmail: boolean;
}

export interface IdentityLookupPerson {
  /** Id de Apollo (sólo Apollo). */
  id?: string | null;
  firstName: string | null;
  lastName: string | null;
  fullName?: string | null;
  linkedinUrl: string | null;
  email: string | null;
  /** Trabajo actual según Apollo (people/match). Sólo Apollo; null si no lo trajo. */
  currentEmployment?: CurrentEmploymentSnapshot | null;
}

export type IdentityLookup =
  | { kind: 'found'; person: IdentityLookupPerson; usage: IdentityProviderUsage[] }
  | { kind: 'not_found' | 'unavailable' | 'error'; usage: IdentityProviderUsage[] };

export interface IdentityCompletionPatch {
  apollo_person_id?: string;
  /** Cargo actual según Apollo, cuando sigue en la empresa con otro cargo. */
  title?: string;
  linkedin_url?: string;
  email?: string;
  enrichment_metadata: Record<string, unknown>;
}

export interface IdentityCompletionDeps {
  actor: { internalUserId: string; roleKey: string | null };
  nowIso: string;
  loadCandidate: (candidateId: string) => Promise<IdentityCompletionCandidate | null>;
  lookupApollo: (query: IdentityLookupQuery) => Promise<IdentityLookup>;
  /** Opcional: sin él no hay segunda vía para el LinkedIn ni el correo. */
  lookupLusha?: (query: IdentityLookupQuery) => Promise<IdentityLookup>;
  persist: (candidateId: string, patch: IdentityCompletionPatch) => Promise<void>;
  logUsage: (
    entry: IdentityProviderUsage,
    context: { purpose: IdentityCompletionPurpose | 'verify_email'; channel: IdentityChannel },
  ) => Promise<void>;
}

export const IDENTITY_COMPLETION_OUTCOMES = [
  'completed',
  'not_found',
  'identity_mismatch',
  'provider_unavailable',
  'provider_error',
  /**
   * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — se encontró un correo, pero es de OTRA empresa
   * (o Apollo dice que ya trabaja en otra): no se guarda en este registro. Queda la evidencia en
   * `enrichment_metadata.email_check` para mandarlo a revisión en la empresa nueva.
   */
  'company_change_detected',
] as const;
export type IdentityCompletionOutcome = (typeof IDENTITY_COMPLETION_OUTCOMES)[number];

export type IdentityCompletionStatus =
  | IdentityCompletionOutcome
  | 'unauthorized_role'
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'not_pending_review'
  | 'not_hubspot_candidate'
  | 'missing_identifier'
  | 'nothing_to_complete'
  | 'persist_failed';

export interface IdentityCompletionResult {
  ok: boolean;
  status: IdentityCompletionStatus;
  /** Hay (o ya había) un LinkedIn tras este intento. */
  linkedinAvailable: boolean;
  /** Hay (o ya había) un correo tras este intento. */
  emailAvailable: boolean;
  /** La privacidad del reveal ya es evaluable (hay identidad nativa del proveedor). */
  providerIdentityAvailable: boolean;
  /** Quién trajo el LinkedIn nuevo, si se trajo uno. */
  linkedinProvider: 'apollo' | 'lusha' | null;
  /** Quién trajo el correo nuevo, si se trajo uno. */
  emailProvider: 'apollo' | 'lusha' | null;
}

function result(
  status: IdentityCompletionStatus,
  extra: Partial<Omit<IdentityCompletionResult, 'status' | 'ok'>> = {},
): IdentityCompletionResult {
  return {
    ok: status === 'completed' || status === 'nothing_to_complete',
    status,
    linkedinAvailable: extra.linkedinAvailable ?? false,
    emailAvailable: extra.emailAvailable ?? false,
    providerIdentityAvailable: extra.providerIdentityAvailable ?? false,
    linkedinProvider: extra.linkedinProvider ?? null,
    emailProvider: extra.emailProvider ?? null,
  };
}

// ── Orquestación ─────────────────────────────────────────────────

/**
 * Identifica a la persona del candidato y completa lo que falta. Nunca lanza por un proveedor:
 * los errores de proveedor son desenlaces. Sólo `persist` puede fallar hacia `persist_failed`.
 *
 * Orden de gasto (se detiene en cuanto lo pedido aparece):
 *   1. Apollo por correo (si hay correo);
 *   2. Apollo por LinkedIn (si hay LinkedIn y lo pedido sigue faltando);
 *   3. Lusha — sólo para «Revelar LinkedIn» / «Revelar correo», nunca en el camino del teléfono.
 */
export async function runCandidateIdentityCompletion(
  input: {
    candidateId: unknown;
    purpose: IdentityCompletionPurpose;
    /**
     * AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE — también un candidato YA APROBADO (desde la ficha
     * del contacto que nació de él). Sólo lo pasa el servidor después de comprobar ese vínculo
     * durable; nunca llega desde el navegador.
     */
    allowApproved?: boolean;
    /**
     * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — también candidatos que no son de HubSpot. Sólo
     * lo pasa el servidor desde la ficha del contacto oficial; nunca llega desde el navegador.
     */
    allowAnySource?: boolean;
  },
  deps: IdentityCompletionDeps,
): Promise<IdentityCompletionResult> {
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return result('unauthorized_role');
  const candidateId = clean(input.candidateId);
  if (!candidateId) return result('invalid_candidate');

  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return result('candidate_not_found');
  const reviewable =
    candidate.status === 'pending_review' || (input.allowApproved === true && candidate.status === 'approved');
  if (!reviewable) return result('not_pending_review');
  if (input.allowAnySource !== true && clean(candidate.source)?.toLowerCase() !== 'hubspot') {
    return result('not_hubspot_candidate');
  }

  const email = normalizeCandidateEmail(candidate.email);
  const linkedinUrl = canonicalLinkedin(candidate.linkedinUrl);
  const before = evaluateCandidateIdentityCompletion(
    {
      email: candidate.email,
      linkedinUrl: candidate.linkedinUrl,
      apolloPersonId: candidate.apolloPersonId,
      source: candidate.source,
      sourceContactId: candidate.sourceContactId,
    },
    { anySource: input.allowAnySource === true },
  );

  // Con qué se busca, según lo pedido: el LinkedIn se busca por correo, el correo por LinkedIn,
  // y la identidad para el teléfono con los dos, uno después del otro.
  const channels: IdentityChannel[] =
    input.purpose === 'linkedin'
      ? before.identityChannels.filter((c) => c === 'email')
      : input.purpose === 'email'
        ? before.identityChannels.filter((c) => c === 'linkedin')
        : before.identityChannels;
  if (channels.length === 0) return result('missing_identifier');

  const needed =
    input.purpose === 'linkedin'
      ? before.missingLinkedin
      : input.purpose === 'email'
        ? before.missingEmail
        : before.missingProviderIdentity;
  if (!needed) {
    return result('nothing_to_complete', {
      linkedinAvailable: !before.missingLinkedin,
      emailAvailable: !before.missingEmail,
      providerIdentityAvailable: !before.missingProviderIdentity,
    });
  }

  const baseQuery = {
    email,
    linkedinUrl,
    firstName: clean(candidate.firstName),
    lastName: clean(candidate.lastName),
    organizationName: clean(candidate.companyName),
    domain: clean(candidate.companyDomain),
    wantsEmail: input.purpose === 'email',
  };
  const providers: string[] = [];
  const log = async (usage: IdentityProviderUsage[], channel: IdentityChannel) => {
    for (const entry of usage) {
      try {
        await deps.logUsage(entry, { purpose: input.purpose, channel });
      } catch {
        // La observabilidad no cambia el desenlace de un gasto que ya ocurrió.
      }
    }
  };

  let apolloPersonId: string | null = null;
  let foundLinkedin: string | null = null;
  let linkedinProvider: 'apollo' | 'lusha' | null = null;
  let foundEmail: string | null = null;
  let emailProvider: 'apollo' | 'lusha' | null = null;
  // El correo que devolvió el proveedor aunque no se pidiera (evidencia de cambio de empresa).
  let providerEmail: string | null = null;
  let providerEmailFrom: 'apollo' | 'lusha' | null = null;
  let mismatch = false;
  let anyAnswered = false;
  let employmentSnapshot: CurrentEmploymentSnapshot | null = null;
  let failure: 'provider_unavailable' | 'provider_error' | null = null;

  const providerIdentityNow = () =>
    !before.missingProviderIdentity || (!clean(candidate.apolloPersonId) && apolloPersonId !== null);
  const satisfied = () =>
    input.purpose === 'linkedin'
      ? foundLinkedin !== null
      : input.purpose === 'email'
        ? foundEmail !== null
        : providerIdentityNow();

  const absorb = (lookup: IdentityLookup, provider: 'apollo' | 'lusha'): void => {
    if (lookup.kind === 'found') {
      anyAnswered = true;
      if (!isProviderNameConsistent(candidate, lookup.person)) {
        mismatch = true;
        return;
      }
      if (provider === 'apollo' && apolloPersonId === null) apolloPersonId = normalizeApolloPersonId(lookup.person.id);
      if (provider === 'apollo' && !employmentSnapshot && lookup.person.currentEmployment) {
        employmentSnapshot = lookup.person.currentEmployment;
      }
      const li = canonicalLinkedin(lookup.person.linkedinUrl);
      if (li && foundLinkedin === null && before.missingLinkedin) {
        foundLinkedin = li;
        linkedinProvider = provider;
      }
      const em = normalizeCandidateEmail(lookup.person.email);
      if (em && providerEmail === null) {
        providerEmail = em;
        providerEmailFrom = provider;
      }
      if (em && foundEmail === null && before.missingEmail) {
        foundEmail = em;
        emailProvider = provider;
      }
    } else if (lookup.kind === 'not_found') {
      anyAnswered = true;
    } else if (failure === null) {
      failure = lookup.kind === 'unavailable' ? 'provider_unavailable' : 'provider_error';
    }
  };

  // 1–2. Apollo, canal por canal.
  for (const channel of channels) {
    if (satisfied()) break;
    const lookup = await deps.lookupApollo({ ...baseQuery, channel });
    if (lookup.usage.length > 0 && !providers.includes('apollo')) providers.push('apollo');
    await log(lookup.usage, channel);
    absorb(lookup, 'apollo');
  }

  // 3. Lusha: sólo para el canal que se pidió revelar. No aporta identidad para el reveal (el
  //    gate de privacidad del START lee columnas nativas del candidato, no esta búsqueda), así
  //    que en el camino del teléfono no se gasta.
  if (input.purpose !== 'phone' && !satisfied() && deps.lookupLusha) {
    const channel = channels[0];
    const lookup = await deps.lookupLusha({ ...baseQuery, channel });
    if (lookup.usage.length > 0) providers.push('lusha');
    await log(lookup.usage, channel);
    absorb(lookup, 'lusha');
    // Un hallazgo coherente de Lusha corrige el «otra persona» de Apollo para este canal.
    if (satisfied()) mismatch = false;
  }

  // Sólo se completan columnas VACÍAS.
  const newApolloPersonId = !clean(candidate.apolloPersonId) && apolloPersonId ? apolloPersonId : null;
  const newLinkedin = foundLinkedin;

  // AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — el empleo que dice la MISMA respuesta de Apollo
  // y el correo que trajo deciden si ese correo es de esta empresa. Uno de OTRA empresa nunca se
  // guarda en este registro (Bryan 18-11): queda como evidencia para el flujo de cambio.
  const employmentCheck = employmentSnapshot
    ? assessCurrentEmployment({
        snapshot: employmentSnapshot,
        shownTitle: clean(candidate.title),
        companyName: clean(candidate.companyName),
        companyDomain: clean(candidate.companyDomain),
        checkedAt: deps.nowIso,
      })
    : null;
  const emailCheck = classifyEmailChange({
    currentEmail: candidate.email,
    foundEmail: providerEmail,
    companyDomains: [candidate.companyDomain],
    employment: employmentCheck,
  });
  const emailWithheld = foundEmail !== null && EMAIL_WITHHELD_CASES.has(emailCheck.case);
  const newEmail = emailWithheld ? null : foundEmail;
  const gainedSomething = !!newApolloPersonId || !!newLinkedin || !!newEmail;

  // El desenlace responde a lo que se PIDIÓ: un dato traído de paso es un extra, no convierte en
  // éxito lo que no apareció. Es también lo que se anota, y un desenlace sin fruto retira los
  // botones para no volver a gastar en lo mismo.
  const outcome: IdentityCompletionOutcome = emailWithheld
    ? 'company_change_detected'
    : satisfied()
    ? 'completed'
    : mismatch
      ? 'identity_mismatch'
      : failure && !anyAnswered && !gainedSomething
        ? failure
        : 'not_found';

  // Nada que anotar si no se llamó a ningún proveedor (p. ej. Apollo sin clave configurada).
  // CONTACT-CURRENT-EMPLOYMENT-1 — la misma respuesta de Apollo dice dónde trabaja HOY: se compara
  // con la empresa y el cargo de HubSpot, sin gastar nada más (`employmentCheck`, arriba).
  const usefulEmploymentCheck = employmentCheck && employmentCheck.status !== 'unknown' ? employmentCheck : null;
  const currentTitle = usefulEmploymentCheck
    ? titleAfterEmploymentCheck(usefulEmploymentCheck, clean(candidate.title))
    : null;
  const newTitle = currentTitle && currentTitle !== clean(candidate.title) ? currentTitle : null;

  // Sólo se anota la comprobación de correo hecha DE PASO cuando apunta a un cambio de empresa:
  // un «todo igual» no pisa una verificación anterior.
  const incidentalEmailCheck = COMPANY_CHANGE_CASES.has(emailCheck.case)
    ? buildEmailCheckBlock({
        classification: emailCheck,
        purpose: input.purpose,
        checkedAt: deps.nowIso,
        checkedBy: deps.actor.internalUserId,
        provider: providerEmailFrom ?? (employmentSnapshot ? 'apollo' : null),
        employment: buildEmailCheckEmployment(employmentCheck, employmentSnapshot),
      })
    : null;

  if (providers.length > 0 || gainedSomething) {
    const patch: IdentityCompletionPatch = {
      enrichment_metadata: {
        ...candidate.enrichmentMetadata,
        ...(usefulEmploymentCheck ? { [CURRENT_EMPLOYMENT_METADATA_KEY]: usefulEmploymentCheck } : {}),
        ...(incidentalEmailCheck ? { [EMAIL_CHECK_METADATA_KEY]: incidentalEmailCheck } : {}),
        [IDENTITY_COMPLETION_METADATA_KEY]: {
          outcome,
          input_key: identityCompletionInputKey({ email: candidate.email, linkedinUrl: candidate.linkedinUrl }),
          purpose: input.purpose,
          channels,
          attempted_at: deps.nowIso,
          attempted_by: deps.actor.internalUserId,
          providers,
          apollo_identity_saved: !!newApolloPersonId,
          linkedin_saved_from: newLinkedin ? linkedinProvider : null,
          email_saved_from: newEmail ? emailProvider : null,
          hito: CANDIDATE_IDENTITY_COMPLETION_HITO,
        },
      },
    };
    if (newApolloPersonId) patch.apollo_person_id = newApolloPersonId;
    if (newLinkedin) patch.linkedin_url = newLinkedin;
    if (newEmail) patch.email = newEmail;
    if (newTitle) patch.title = newTitle;
    try {
      await deps.persist(candidate.id, patch);
    } catch {
      return result('persist_failed');
    }
  }

  return result(outcome, {
    linkedinAvailable: !before.missingLinkedin || !!newLinkedin,
    emailAvailable: !before.missingEmail || !!newEmail,
    providerIdentityAvailable: providerIdentityNow(),
    linkedinProvider: newLinkedin ? linkedinProvider : null,
    emailProvider: newEmail ? emailProvider : null,
  });
}

// ── Copy (español) ───────────────────────────────────────────────

export const REVEAL_LINKEDIN_BUTTON_LABEL = 'Revelar LinkedIn';
export const REVEAL_EMAIL_BUTTON_LABEL = 'Revelar correo';

export const IDENTITY_COMPLETION_COPY = {
  linkedinHelper: `Busca a la persona en Apollo por su correo (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito) y, si Apollo no trae el LinkedIn, en Lusha. No revela teléfonos.`,
  emailHelper: `Busca a la persona en Apollo por su LinkedIn (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito) y, si Apollo no trae el correo, en Lusha. No revela teléfonos.`,
  linkedinCompleted: 'LinkedIn encontrado y guardado en el candidato.',
  emailCompleted: 'Correo encontrado y guardado en el candidato.',
  identityCompleted: 'Persona identificada en Apollo.',
  notFound: 'No encontramos a esta persona en los proveedores. No se volverá a ofrecer para no gastar créditos.',
  mismatch: 'El proveedor devolvió a una persona con otro nombre. No se guardó nada.',
  companyChange:
    'El correo que encontramos es de otra empresa: parece que esta persona cambió de trabajo. No se guardó en este registro.',
  phoneIdentityNotFound: 'No pudimos identificar a esta persona en Apollo, así que no se buscó el teléfono (no se usaron créditos de teléfono).',
  unavailable: 'El proveedor no está disponible en este momento. Intenta más tarde.',
  error: 'No fue posible completar la búsqueda. Intenta de nuevo.',
  unauthorized: 'No tienes permisos para usar créditos de proveedores.',
} as const;

/** Lo que el operador lee ANTES de pulsar «Revelar teléfono» en un candidato sin identidad. */
export function phoneIdentityHelperCopy(channels: readonly IdentityChannel[]): string {
  const prefix = 'Este contacto vino de HubSpot sin identidad de Apollo: antes de buscar el teléfono se identifica';
  if (channels.includes('email') && channels.includes('linkedin')) {
    return `${prefix} por su correo y, si no aparece, por su LinkedIn (hasta ${2 * IDENTITY_COMPLETION_APOLLO_CREDITS} créditos adicionales de Apollo).`;
  }
  const by = channels.includes('linkedin') ? 'su LinkedIn' : 'su correo';
  return `${prefix} por ${by} (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito adicional de Apollo).`;
}

/** Copy del desenlace para la UI. */
export function identityCompletionMessage(
  status: IdentityCompletionStatus,
  purpose: IdentityCompletionPurpose,
): { tone: 'success' | 'info' | 'error'; text: string } {
  switch (status) {
    case 'completed':
      return {
        tone: 'success',
        text:
          purpose === 'linkedin'
            ? IDENTITY_COMPLETION_COPY.linkedinCompleted
            : purpose === 'email'
              ? IDENTITY_COMPLETION_COPY.emailCompleted
              : IDENTITY_COMPLETION_COPY.identityCompleted,
      };
    case 'nothing_to_complete':
      return {
        tone: 'info',
        text:
          purpose === 'linkedin'
            ? 'Este candidato ya tiene LinkedIn.'
            : purpose === 'email'
              ? 'Este candidato ya tiene correo.'
              : 'Este candidato ya está identificado.',
      };
    case 'not_found':
      return {
        tone: 'info',
        text: purpose === 'phone' ? IDENTITY_COMPLETION_COPY.phoneIdentityNotFound : IDENTITY_COMPLETION_COPY.notFound,
      };
    case 'identity_mismatch':
      return { tone: 'info', text: IDENTITY_COMPLETION_COPY.mismatch };
    case 'company_change_detected':
      return { tone: 'info', text: IDENTITY_COMPLETION_COPY.companyChange };
    case 'provider_unavailable':
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.unavailable };
    case 'unauthorized_role':
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.unauthorized };
    default:
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.error };
  }
}
