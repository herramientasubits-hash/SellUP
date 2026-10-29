// Agente 2A — Completar un candidato que ya existe en HubSpot: «Revelar LinkedIn» e identidad
// para «Revelar teléfono» (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// ═══════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE
// ═══════════════════════════════════════════════════════════════════
//
// «Primero HubSpot» ofrece como candidatos contactos que YA están en el CRM. Muchos llegan sólo
// con correo: sin LinkedIn y sin teléfono. Para esos candidatos:
//
//   * no había forma de traer el LinkedIn;
//   * «Revelar teléfono» quedaba DESHABILITADO para siempre: su `source_contact_id` es un id de
//     HubSpot, no de Apollo ni de Lusha, así que la privacidad (supresión por identidad NATIVA
//     del proveedor, PR #289) no se podía evaluar y el reveal se bloqueaba fail-closed.
//
// Este núcleo identifica a la persona en Apollo con un `people/match` por CORREO (el mismo
// endpoint que la búsqueda por LinkedIn y la completion de #589; nunca `reveal_phone_number`).
// Con lo que devuelve:
//
//   * guarda el `apollo_person_id` (columna de la mig. 098) ⇒ la privacidad pasa a ser
//     evaluable con la MISMA función que usan los cuatro gates del servidor
//     (`resolvePhoneRevealProviderIdentity`) y «Revelar teléfono» sigue su flujo de siempre;
//   * guarda el LinkedIn si el candidato no lo tenía. Si Apollo no lo trae, se intenta una
//     búsqueda de Lusha por correo (vista sin revelar, nunca teléfonos).
//
// ═══════════════════════════════════════════════════════════════════
// LÍMITES (deliberados)
// ═══════════════════════════════════════════════════════════════════
//
//   * NUNCA sobrescribe: sólo completa columnas vacías (`apollo_person_id`, `linkedin_url`).
//   * NUNCA revela teléfonos ni correos personales. El teléfono sigue siendo el waterfall.
//   * Un match cuyo nombre no se parece al del candidato NO se guarda (`identity_mismatch`):
//     guardar la identidad de otra persona haría que la privacidad se evaluara sobre ella.
//   * Sólo candidatos de origen HubSpot, en `pending_review` y con correo. Sólo roles que pueden
//     revelar teléfono. Los candidatos de Apollo/Lusha no cambian en nada.
//   * Es PURO: sin red, sin Supabase, sin env. Todo efecto entra por `deps`.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import { resolvePhoneRevealProviderIdentity } from './provider-suppression-core';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import { normalizeLinkedinProfileUrl } from './linkedin-profile-url';

export const CANDIDATE_IDENTITY_COMPLETION_HITO = 'AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION';

/** Clave en `enrichment_metadata` donde queda el rastro del último intento. */
export const IDENTITY_COMPLETION_METADATA_KEY = 'identity_completion';

/** Créditos de Apollo de una identificación (`people/match` respondido). */
export const IDENTITY_COMPLETION_APOLLO_CREDITS = 1;

/** Para qué se pide la identificación: cambia qué carencia la justifica. */
export type IdentityCompletionPurpose = 'linkedin' | 'phone';

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
  /** El candidato tiene un correo con el que buscar. */
  hasEmail: boolean;
  /** No tiene LinkedIn. */
  missingLinkedin: boolean;
  /** No tiene identidad NATIVA de proveedor: la privacidad del reveal no es evaluable. */
  missingProviderIdentity: boolean;
  /** Un intento anterior ya terminó sin resultado: no se vuelve a ofrecer para no gastar. */
  previousAttemptFruitless: boolean;
  /** ¿Se ofrece «Revelar LinkedIn»? */
  canRevealLinkedin: boolean;
  /** ¿«Revelar teléfono» necesita identificar primero (y puede)? */
  phoneRevealNeedsIdentity: boolean;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const FRUITLESS_OUTCOMES = new Set<IdentityCompletionOutcome>(['not_found', 'identity_mismatch']);

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

export function evaluateCandidateIdentityCompletion(facts: IdentityCompletionFacts): IdentityCompletionEligibility {
  const isHubSpotCandidate = clean(facts.source)?.toLowerCase() === 'hubspot';
  const hasEmail = !!clean(facts.email);
  const missingLinkedin = !clean(facts.linkedinUrl);
  const missingProviderIdentity =
    resolvePhoneRevealProviderIdentity({
      apolloPersonId: facts.apolloPersonId ?? null,
      source: facts.source ?? null,
      sourceContactId: facts.sourceContactId ?? null,
    }) === null;
  const last = readLastIdentityCompletionOutcome(facts.enrichmentMetadata ?? null);
  const previousAttemptFruitless = last !== null && FRUITLESS_OUTCOMES.has(last);
  return {
    isHubSpotCandidate,
    hasEmail,
    missingLinkedin,
    missingProviderIdentity,
    previousAttemptFruitless,
    canRevealLinkedin: isHubSpotCandidate && hasEmail && missingLinkedin && !previousAttemptFruitless,
    phoneRevealNeedsIdentity:
      isHubSpotCandidate && hasEmail && missingProviderIdentity && !previousAttemptFruitless,
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
 * compartan un nombre o un apellido. Sin nombre en alguno de los dos lados se acepta: el correo
 * es una coincidencia exacta y no hay con qué contradecirla.
 */
export function isProviderNameConsistent(
  candidate: { firstName?: string | null; lastName?: string | null; fullName?: string | null },
  provider: { firstName?: string | null; lastName?: string | null },
): boolean {
  const local = nameTokens(candidate.firstName, candidate.lastName, candidate.fullName);
  const remote = nameTokens(provider.firstName, provider.lastName);
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
  enrichmentMetadata: Record<string, unknown>;
}

export interface IdentityProviderUsage {
  provider_key: 'apollo' | 'lusha';
  operation_key: 'person_match' | 'lusha_contact_search';
  /** null ⇒ desconocido, nunca 0 inventado. */
  credits_used: number | null;
  status: 'success' | 'error';
  results_returned: number;
  error_code?: string;
}

export interface ApolloIdentityQuery {
  email: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  domain: string | null;
}

export type ApolloIdentityLookup =
  | {
      kind: 'found';
      person: { id: string | null; firstName: string | null; lastName: string | null; linkedinUrl: string | null };
      usage: IdentityProviderUsage[];
    }
  | { kind: 'not_found'; usage: IdentityProviderUsage[] }
  | { kind: 'unavailable'; usage: IdentityProviderUsage[] }
  | { kind: 'error'; usage: IdentityProviderUsage[] };

export type LushaLinkedinLookup =
  | {
      kind: 'found';
      person: { firstName: string | null; lastName: string | null; fullName: string | null; linkedinUrl: string | null };
      usage: IdentityProviderUsage[];
    }
  | { kind: 'not_found' | 'unavailable' | 'error'; usage: IdentityProviderUsage[] };

export interface IdentityCompletionPatch {
  apollo_person_id?: string;
  linkedin_url?: string;
  enrichment_metadata: Record<string, unknown>;
}

export interface IdentityCompletionDeps {
  actor: { internalUserId: string; roleKey: string | null };
  nowIso: string;
  loadCandidate: (candidateId: string) => Promise<IdentityCompletionCandidate | null>;
  lookupApollo: (query: ApolloIdentityQuery) => Promise<ApolloIdentityLookup>;
  /** Opcional: sin él no hay segunda vía para el LinkedIn. */
  lookupLushaLinkedin?: (query: ApolloIdentityQuery) => Promise<LushaLinkedinLookup>;
  persist: (candidateId: string, patch: IdentityCompletionPatch) => Promise<void>;
  logUsage: (entry: IdentityProviderUsage, context: { purpose: IdentityCompletionPurpose }) => Promise<void>;
}

export const IDENTITY_COMPLETION_OUTCOMES = [
  'completed',
  'not_found',
  'identity_mismatch',
  'provider_unavailable',
  'provider_error',
] as const;
export type IdentityCompletionOutcome = (typeof IDENTITY_COMPLETION_OUTCOMES)[number];

export type IdentityCompletionStatus =
  | IdentityCompletionOutcome
  | 'unauthorized_role'
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'not_pending_review'
  | 'not_hubspot_candidate'
  | 'missing_email'
  | 'nothing_to_complete'
  | 'persist_failed';

export interface IdentityCompletionResult {
  ok: boolean;
  status: IdentityCompletionStatus;
  /** Se guardó (o ya estaba) un LinkedIn tras este intento. */
  linkedinAvailable: boolean;
  /** La privacidad del reveal ya es evaluable (hay identidad nativa del proveedor). */
  providerIdentityAvailable: boolean;
  /** Quién trajo el LinkedIn nuevo, si se trajo uno. */
  linkedinProvider: 'apollo' | 'lusha' | null;
}

function result(
  status: IdentityCompletionStatus,
  extra: Partial<Omit<IdentityCompletionResult, 'status' | 'ok'>> = {},
): IdentityCompletionResult {
  return {
    ok: status === 'completed' || status === 'nothing_to_complete',
    status,
    linkedinAvailable: extra.linkedinAvailable ?? false,
    providerIdentityAvailable: extra.providerIdentityAvailable ?? false,
    linkedinProvider: extra.linkedinProvider ?? null,
  };
}

// ── Orquestación ─────────────────────────────────────────────────

/**
 * Identifica a la persona del candidato y completa lo que falta. Nunca lanza por un proveedor:
 * los errores de proveedor son desenlaces. Sólo `persist` puede fallar hacia `persist_failed`.
 */
export async function runCandidateIdentityCompletion(
  input: { candidateId: unknown; purpose: IdentityCompletionPurpose },
  deps: IdentityCompletionDeps,
): Promise<IdentityCompletionResult> {
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return result('unauthorized_role');
  const candidateId = clean(input.candidateId);
  if (!candidateId) return result('invalid_candidate');

  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return result('candidate_not_found');
  if (candidate.status !== 'pending_review') return result('not_pending_review');
  if (clean(candidate.source)?.toLowerCase() !== 'hubspot') return result('not_hubspot_candidate');

  const email = clean(candidate.email)?.toLowerCase() ?? null;
  if (!email) return result('missing_email');

  const before = evaluateCandidateIdentityCompletion({
    email,
    linkedinUrl: candidate.linkedinUrl,
    apolloPersonId: candidate.apolloPersonId,
    source: candidate.source,
    sourceContactId: candidate.sourceContactId,
  });
  // Lo que justifica gastar depende de para qué se pidió.
  const needed = input.purpose === 'linkedin' ? before.missingLinkedin : before.missingProviderIdentity;
  if (!needed) {
    return result('nothing_to_complete', {
      linkedinAvailable: !before.missingLinkedin,
      providerIdentityAvailable: !before.missingProviderIdentity,
    });
  }

  const query: ApolloIdentityQuery = {
    email,
    firstName: clean(candidate.firstName),
    lastName: clean(candidate.lastName),
    organizationName: clean(candidate.companyName),
    domain: clean(candidate.companyDomain),
  };
  const providers: string[] = [];
  const log = async (usage: IdentityProviderUsage[]) => {
    for (const entry of usage) {
      try {
        await deps.logUsage(entry, { purpose: input.purpose });
      } catch {
        // La observabilidad no cambia el desenlace de un gasto que ya ocurrió.
      }
    }
  };

  // 1. Apollo: identidad + LinkedIn.
  const apollo = await deps.lookupApollo(query);
  if (apollo.usage.length > 0) providers.push('apollo');
  await log(apollo.usage);

  let apolloPersonId: string | null = null;
  let linkedin: string | null = null;
  let linkedinProvider: 'apollo' | 'lusha' | null = null;
  let mismatch = false;
  let apolloFailure: 'provider_unavailable' | 'provider_error' | null = null;

  if (apollo.kind === 'found') {
    if (isProviderNameConsistent(candidate, apollo.person)) {
      apolloPersonId = normalizeApolloPersonId(apollo.person.id);
      const normalized = normalizeLinkedinProfileUrl(apollo.person.linkedinUrl);
      if (normalized.ok) {
        linkedin = normalized.canonicalUrl;
        linkedinProvider = 'apollo';
      }
    } else {
      mismatch = true;
    }
  } else if (apollo.kind === 'unavailable') {
    apolloFailure = 'provider_unavailable';
  } else if (apollo.kind === 'error') {
    apolloFailure = 'provider_error';
  }

  // 2. Lusha: sólo para el LinkedIn, sólo si sigue faltando y sólo si se pidió el LinkedIn.
  //    No aporta identidad para el reveal (el gate de privacidad del START lee columnas de
  //    Apollo/Lusha nativas del candidato, no esta búsqueda), así que en el camino del teléfono
  //    no se gasta.
  if (input.purpose === 'linkedin' && before.missingLinkedin && !linkedin && deps.lookupLushaLinkedin) {
    const lusha = await deps.lookupLushaLinkedin(query);
    if (lusha.usage.length > 0) providers.push('lusha');
    await log(lusha.usage);
    if (lusha.kind === 'found') {
      if (isProviderNameConsistent(candidate, lusha.person)) {
        const normalized = normalizeLinkedinProfileUrl(lusha.person.linkedinUrl);
        if (normalized.ok) {
          linkedin = normalized.canonicalUrl;
          linkedinProvider = 'lusha';
          mismatch = false;
        }
      } else if (!linkedin) {
        mismatch = true;
      }
    }
  }

  // 3. Sólo se completan columnas VACÍAS.
  const newApolloPersonId = !clean(candidate.apolloPersonId) && apolloPersonId ? apolloPersonId : null;
  const newLinkedin = before.missingLinkedin && linkedin ? linkedin : null;

  const providerIdentityAvailable =
    !before.missingProviderIdentity ||
    evaluateCandidateIdentityCompletion({
      email,
      apolloPersonId: newApolloPersonId ?? candidate.apolloPersonId,
      source: candidate.source,
      sourceContactId: candidate.sourceContactId,
    }).missingProviderIdentity === false;
  const linkedinAvailable = !before.missingLinkedin || !!newLinkedin;

  const satisfied = input.purpose === 'linkedin' ? !!newLinkedin : providerIdentityAvailable;
  const gainedSomething = !!newApolloPersonId || !!newLinkedin;
  // El desenlace responde a lo que se PIDIÓ: un LinkedIn traído en el camino del teléfono es un
  // extra, no convierte en éxito una identidad que no apareció. Es también lo que se anota, y
  // un desenlace sin fruto retira el botón para no volver a gastar en lo mismo.
  const outcome: IdentityCompletionOutcome = satisfied
    ? 'completed'
    : mismatch
      ? 'identity_mismatch'
      : apolloFailure && !gainedSomething
        ? apolloFailure
        : 'not_found';

  // Nada que anotar si no se llamó a ningún proveedor (p. ej. Apollo sin clave configurada).
  if (providers.length > 0 || gainedSomething) {
    const patch: IdentityCompletionPatch = {
      enrichment_metadata: {
        ...candidate.enrichmentMetadata,
        [IDENTITY_COMPLETION_METADATA_KEY]: {
          outcome,
          purpose: input.purpose,
          attempted_at: deps.nowIso,
          attempted_by: deps.actor.internalUserId,
          providers,
          apollo_identity_saved: !!newApolloPersonId,
          linkedin_saved_from: newLinkedin ? linkedinProvider : null,
          hito: CANDIDATE_IDENTITY_COMPLETION_HITO,
        },
      },
    };
    if (newApolloPersonId) patch.apollo_person_id = newApolloPersonId;
    if (newLinkedin) patch.linkedin_url = newLinkedin;
    try {
      await deps.persist(candidate.id, patch);
    } catch {
      return result('persist_failed');
    }
  }

  const status: IdentityCompletionStatus = outcome;
  return result(status, {
    linkedinAvailable,
    providerIdentityAvailable,
    linkedinProvider: newLinkedin ? linkedinProvider : null,
  });
}

// ── Copy (español) ───────────────────────────────────────────────

export const REVEAL_LINKEDIN_BUTTON_LABEL = 'Revelar LinkedIn';

export const IDENTITY_COMPLETION_COPY = {
  linkedinHelper: `Busca a la persona en Apollo por su correo (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito) y, si Apollo no trae el LinkedIn, en Lusha. No revela teléfonos.`,
  phoneIdentityHelper: `Este contacto vino de HubSpot sin identidad de Apollo: antes de buscar el teléfono se identifica por su correo (${IDENTITY_COMPLETION_APOLLO_CREDITS} crédito adicional de Apollo).`,
  linkedinCompleted: 'LinkedIn encontrado y guardado en el candidato.',
  notFound: 'No encontramos a esta persona por su correo en los proveedores. No se volverá a ofrecer para no gastar créditos.',
  mismatch: 'El proveedor devolvió a una persona con otro nombre. No se guardó nada.',
  phoneIdentityNotFound: 'No pudimos identificar a esta persona en Apollo por su correo, así que no se buscó el teléfono (no se usaron créditos de teléfono).',
  unavailable: 'El proveedor no está disponible en este momento. Intenta más tarde.',
  error: 'No fue posible completar la búsqueda. Intenta de nuevo.',
  unauthorized: 'No tienes permisos para usar créditos de proveedores.',
} as const;

/** Copy del desenlace para la UI. */
export function identityCompletionMessage(
  status: IdentityCompletionStatus,
  purpose: IdentityCompletionPurpose,
): { tone: 'success' | 'info' | 'error'; text: string } {
  switch (status) {
    case 'completed':
      return {
        tone: 'success',
        text: purpose === 'linkedin' ? IDENTITY_COMPLETION_COPY.linkedinCompleted : 'Persona identificada en Apollo.',
      };
    case 'nothing_to_complete':
      return { tone: 'info', text: purpose === 'linkedin' ? 'Este candidato ya tiene LinkedIn.' : 'Este candidato ya está identificado.' };
    case 'not_found':
      return { tone: 'info', text: purpose === 'phone' ? IDENTITY_COMPLETION_COPY.phoneIdentityNotFound : IDENTITY_COMPLETION_COPY.notFound };
    case 'identity_mismatch':
      return { tone: 'info', text: IDENTITY_COMPLETION_COPY.mismatch };
    case 'provider_unavailable':
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.unavailable };
    case 'unauthorized_role':
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.unauthorized };
    default:
      return { tone: 'error', text: IDENTITY_COMPLETION_COPY.error };
  }
}
