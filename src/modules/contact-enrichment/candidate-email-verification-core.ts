// Agente 2A — «Verificar correo» (AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE, Bryan 18-11).
//
// Núcleo PURO. Para un contacto que YA tiene correo y LinkedIn: se le pregunta a Apollo por su
// LinkedIn (1 crédito; `people/match` trae su trabajo actual y su correo) y, si Apollo no trae
// correo, a Lusha (búsqueda + enrich sólo de correos). La respuesta se CLASIFICA
// (`email-change-classifier-core.ts`) y se guarda en `enrichment_metadata.email_check` del
// candidato de origen.
//
// Lo que este núcleo NO hace, a propósito:
//   * no escribe el correo en ninguna columna: qué hacer con él (principal, personal, cambio de
//     empresa) lo decide la acción con la clasificación;
//   * no le pasa a Apollo la empresa actual como desempate: si la persona se fue, esa pista
//     empuja hacia la ficha vieja;
//   * no toca el bloque `identity_completion`: verificar no es «revelar» y su desenlace no debe
//     retirar ni reabrir los botones de revelar.
//
// Sólo guarda, además de la comprobación, lo que ya guardaba la identificación: la identidad de
// Apollo si faltaba y el cargo actual si sigue en la empresa con otro cargo.

import { normalizeApolloPersonId } from '@/server/integrations/apollo-person-id';
import { isPhoneRevealRoleAuthorized } from './phone-reveal-authorized-roles';
import {
  CURRENT_EMPLOYMENT_METADATA_KEY,
  assessCurrentEmployment,
  titleAfterEmploymentCheck,
  type CurrentEmploymentSnapshot,
} from './current-employment-check';
import {
  canonicalLinkedin,
  isProviderNameConsistent,
  normalizeCandidateEmail,
  type IdentityCompletionDeps,
  type IdentityCompletionPatch,
  type IdentityLookup,
  type IdentityProviderUsage,
} from './candidate-identity-completion-core';
import {
  EMAIL_CHECK_METADATA_KEY,
  buildEmailCheckBlock,
  buildEmailCheckEmployment,
  classifyEmailChange,
  type EmailCheckBlock,
} from './email-change-classifier-core';

export type EmailVerificationStatus =
  | 'checked'
  | 'not_found'
  | 'identity_mismatch'
  | 'provider_unavailable'
  | 'provider_error'
  | 'unauthorized_role'
  | 'invalid_candidate'
  | 'candidate_not_found'
  | 'not_reviewable'
  | 'missing_linkedin'
  | 'persist_failed';

export interface EmailVerificationResult {
  ok: boolean;
  status: EmailVerificationStatus;
  /** La comprobación guardada (null si no se llegó a consultar). */
  check: EmailCheckBlock | null;
  /** Cargo actual escrito en el candidato (sigue en la empresa con otro cargo). */
  newTitle: string | null;
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function done(status: EmailVerificationStatus, check: EmailCheckBlock | null = null, newTitle: string | null = null): EmailVerificationResult {
  return { ok: status === 'checked' || status === 'not_found', status, check, newTitle };
}

export async function runCandidateEmailVerification(
  input: {
    candidateId: unknown;
    /** El correo que tiene HOY el contacto (manda sobre el del candidato). */
    currentEmail?: string | null;
    /** El LinkedIn del contacto, si el candidato no lo tiene. */
    linkedinUrl?: string | null;
    /** Dominios de la empresa actual (la cuenta del contacto). */
    companyDomains?: readonly (string | null | undefined)[];
    /** Sólo el servidor, después de comprobar el vínculo durable con el contacto. */
    allowApproved?: boolean;
  },
  deps: IdentityCompletionDeps,
): Promise<EmailVerificationResult> {
  if (!isPhoneRevealRoleAuthorized(deps.actor.roleKey)) return done('unauthorized_role');
  const candidateId = clean(input.candidateId);
  if (!candidateId) return done('invalid_candidate');
  const candidate = await deps.loadCandidate(candidateId);
  if (!candidate) return done('candidate_not_found');
  const reviewable =
    candidate.status === 'pending_review' || (input.allowApproved === true && candidate.status === 'approved');
  if (!reviewable) return done('not_reviewable');

  const linkedinUrl = canonicalLinkedin(candidate.linkedinUrl) ?? canonicalLinkedin(input.linkedinUrl);
  if (!linkedinUrl) return done('missing_linkedin');
  const currentEmail = normalizeCandidateEmail(input.currentEmail ?? null) ?? normalizeCandidateEmail(candidate.email);

  const query = {
    channel: 'linkedin' as const,
    email: null,
    linkedinUrl,
    firstName: clean(candidate.firstName),
    lastName: clean(candidate.lastName),
    // Sin empresa: si la persona se fue, la empresa vieja empujaría hacia la ficha vieja.
    organizationName: null,
    domain: null,
    wantsEmail: true,
  };

  const providers: string[] = [];
  const log = async (usage: IdentityProviderUsage[]) => {
    for (const entry of usage) {
      try {
        await deps.logUsage(entry, { purpose: 'verify_email', channel: 'linkedin' });
      } catch {
        // La observabilidad no cambia el desenlace de un gasto que ya ocurrió.
      }
    }
  };

  let apolloPersonId: string | null = null;
  let foundEmail: string | null = null;
  let emailProvider: 'apollo' | 'lusha' | null = null;
  let snapshot: CurrentEmploymentSnapshot | null = null;
  let personFound = false;
  let mismatch = false;
  let anyAnswered = false;
  let failure: 'provider_unavailable' | 'provider_error' | null = null;

  const absorb = (lookup: IdentityLookup, provider: 'apollo' | 'lusha') => {
    if (lookup.kind === 'found') {
      anyAnswered = true;
      if (!isProviderNameConsistent(candidate, lookup.person)) {
        mismatch = true;
        return;
      }
      personFound = true;
      if (provider === 'apollo') {
        apolloPersonId = apolloPersonId ?? normalizeApolloPersonId(lookup.person.id);
        snapshot = snapshot ?? lookup.person.currentEmployment ?? null;
      }
      const email = normalizeCandidateEmail(lookup.person.email);
      if (email && !foundEmail) {
        foundEmail = email;
        emailProvider = provider;
      }
    } else if (lookup.kind === 'not_found') {
      anyAnswered = true;
    } else if (failure === null) {
      failure = lookup.kind === 'unavailable' ? 'provider_unavailable' : 'provider_error';
    }
  };

  const apollo = await deps.lookupApollo(query);
  if (apollo.usage.length > 0) providers.push('apollo');
  await log(apollo.usage);
  absorb(apollo, 'apollo');

  // Lusha sólo si Apollo no trajo correo (el empleo sólo lo da Apollo).
  if (!foundEmail && deps.lookupLusha) {
    const lusha = await deps.lookupLusha(query);
    if (lusha.usage.length > 0) providers.push('lusha');
    await log(lusha.usage);
    absorb(lusha, 'lusha');
  }

  if (!anyAnswered && failure) return done(failure);
  if (!personFound && mismatch) return done('identity_mismatch');

  const employmentCheck = snapshot
    ? assessCurrentEmployment({
        snapshot,
        shownTitle: clean(candidate.title),
        companyName: clean(candidate.companyName),
        companyDomain: clean(candidate.companyDomain),
        checkedAt: deps.nowIso,
      })
    : null;
  const classification = classifyEmailChange({
    currentEmail,
    foundEmail,
    companyDomains: [candidate.companyDomain, ...(input.companyDomains ?? [])],
    employment: employmentCheck,
  });
  const check = buildEmailCheckBlock({
    classification,
    purpose: 'verify_email',
    checkedAt: deps.nowIso,
    checkedBy: deps.actor.internalUserId,
    provider: emailProvider ?? (snapshot ? 'apollo' : null),
    employment: buildEmailCheckEmployment(employmentCheck, snapshot),
  });

  const usefulEmployment = employmentCheck && employmentCheck.status !== 'unknown' ? employmentCheck : null;
  const currentTitle = usefulEmployment ? titleAfterEmploymentCheck(usefulEmployment, clean(candidate.title)) : null;
  const newTitle = currentTitle && currentTitle !== clean(candidate.title) ? currentTitle : null;
  const newApolloPersonId = !clean(candidate.apolloPersonId) && apolloPersonId ? apolloPersonId : null;

  const patch: IdentityCompletionPatch = {
    enrichment_metadata: {
      ...candidate.enrichmentMetadata,
      ...(usefulEmployment ? { [CURRENT_EMPLOYMENT_METADATA_KEY]: usefulEmployment } : {}),
      [EMAIL_CHECK_METADATA_KEY]: { ...check, providers },
    },
  };
  if (newApolloPersonId) patch.apollo_person_id = newApolloPersonId;
  if (newTitle) patch.title = newTitle;
  try {
    await deps.persist(candidate.id, patch);
  } catch {
    return done('persist_failed', check, null);
  }
  return done(personFound ? 'checked' : 'not_found', check, newTitle);
}
