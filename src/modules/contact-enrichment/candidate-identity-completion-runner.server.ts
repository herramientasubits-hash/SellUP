// Agente 2A — Completar un candidato que ya existe en HubSpot: el ejecutor (server-only)
// (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// AGENT2A-HUBSPOT-IMPORT-APPROVED-CANDIDATE — vive fuera del archivo 'use server' para que
// `allowApproved` NO sea un parámetro que el navegador pueda mandar: sólo lo pasan las acciones
// de la ficha del contacto, después de comprobar el vínculo durable con su candidato.
//
// Cablea el núcleo puro (`candidate-identity-completion-core.ts`) con Supabase, Apollo y Lusha:
//
//   * `runIdentityCompletionForCandidate` — «Revelar LinkedIn» (identifica por correo) y «Revelar
//     correo» (identifica por LinkedIn); de paso guarda la identidad de Apollo.
//   * `revealCandidatePhoneWithIdentity` — «Revelar teléfono» para un candidato SIN
//     identidad nativa de proveedor (los de «Primero HubSpot»): identifica primero —por correo y,
//     si no aparece, por LinkedIn— y, sólo si
//     aparece la identidad, delega en `revealCandidatePhoneAction` sin cambiar NADA de su
//     gobierno (flag, rol, corrida del waterfall, techo de créditos, presupuesto, privacidad).
//
// AGENT2A-HUBSPOT-REVEAL-PUSH — lo revelado (LinkedIn, correo) viaja a HubSpot EN CUANTO se
// guarda, sin esperar a la aprobación: se completan sólo las propiedades VACÍAS del contacto que
// ya existía (nunca sobrescribe). El teléfono lo envían los caminos que lo guardan.

import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { requireActiveActor } from './current-actor.server';
import { isApolloPhoneRevealEnabled } from '@/lib/feature-flags.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { canSeeContactCandidate } from './candidate-scope.server';
import {
  CANDIDATE_IDENTITY_COMPLETION_HITO,
  evaluateCandidateIdentityCompletion,
  runCandidateIdentityCompletion,
  type IdentityCompletionCandidate,
  type IdentityCompletionDeps,
  type IdentityCompletionPurpose,
  type IdentityCompletionResult,
  type IdentityCompletionStatus,
} from './candidate-identity-completion-core';
import { lookupApolloIdentity, lookupLushaIdentity } from './candidate-identity-completion-providers.server';
import { runCandidateEmailVerification, type EmailVerificationResult } from './candidate-email-verification-core';
import { revealCandidatePhoneAction } from './phone-reveal-actions';
import { pushCandidateRevealToHubSpot } from './candidate-reveal-hubspot-push.server';
import type { RevealCandidatePhoneInput, RevealCandidatePhoneResult } from './phone-reveal-core';

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

const CANDIDATE_SELECT = `id, status, source, source_contact_id, apollo_person_id, email, linkedin_url,
   first_name, last_name, full_name, title, enrichment_metadata,
   run:contact_enrichment_runs ( company_name, company_domain )`;

function mapCandidate(row: unknown): IdentityCompletionCandidate {
  const r = row as Record<string, unknown>;
  const runRaw = r.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { company_name: string | null; company_domain: string | null }
    | null
    | undefined;
  const str = (value: unknown) => (typeof value === 'string' ? value : null);
  const metadata = r.enrichment_metadata;
  return {
    id: r.id as string,
    status: str(r.status),
    source: str(r.source),
    sourceContactId: str(r.source_contact_id),
    apolloPersonId: str(r.apollo_person_id),
    email: str(r.email),
    linkedinUrl: str(r.linkedin_url),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    fullName: str(r.full_name),
    companyName: run?.company_name ?? null,
    companyDomain: run?.company_domain ?? null,
    title: str(r.title),
    enrichmentMetadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
  };
}

export interface IdentityCompletionRunOptions {
  /** También un candidato aprobado (sólo desde la ficha del contacto que nació de él). */
  allowApproved?: boolean;
  /**
   * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — también candidatos de Apollo, Lusha o creados a
   * mano (sólo desde la ficha del contacto oficial, después de comprobar el vínculo durable).
   */
  allowAnySource?: boolean;
  /** Pantalla desde la que se gasta, para el registro de consumo. */
  surface?: 'candidate_review' | 'official_contact';
}

export async function runIdentityCompletionForCandidate(
  candidateId: string,
  purpose: IdentityCompletionPurpose,
  actor: { internalUserId: string; roleKey: string | null },
  options: IdentityCompletionRunOptions = {},
): Promise<IdentityCompletionResult> {
  return runCandidateIdentityCompletion(
    {
      candidateId,
      purpose,
      allowApproved: options.allowApproved === true,
      allowAnySource: options.allowAnySource === true,
    },
    await buildIdentityCompletionDeps(candidateId, actor, options),
  );
}

/**
 * AGENT2A-CONTACT-EMAIL-VERIFY-COMPANY-CHANGE — «Verificar correo» desde la ficha del contacto
 * oficial: mismas dependencias (proveedores, persistencia, registro de consumo) que revelar.
 */
export async function runEmailVerificationForCandidate(
  candidateId: string,
  actor: { internalUserId: string; roleKey: string | null },
  input: { currentEmail: string | null; linkedinUrl: string | null; companyDomains: readonly (string | null)[] },
  options: IdentityCompletionRunOptions = {},
): Promise<EmailVerificationResult> {
  return runCandidateEmailVerification(
    {
      candidateId,
      currentEmail: input.currentEmail,
      linkedinUrl: input.linkedinUrl,
      companyDomains: input.companyDomains,
      allowApproved: options.allowApproved === true,
    },
    await buildIdentityCompletionDeps(candidateId, actor, options),
  );
}

async function buildIdentityCompletionDeps(
  candidateId: string,
  actor: { internalUserId: string; roleKey: string | null },
  options: IdentityCompletionRunOptions,
): Promise<IdentityCompletionDeps> {
  const supabase = await createClient();
  const admin = getServiceRoleClient();
  return {
    actor,
    nowIso: new Date().toISOString(),
    async loadCandidate(id) {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select(CANDIDATE_SELECT)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapCandidate(data) : null;
    },
    lookupApollo: (query) => lookupApolloIdentity(query),
    lookupLusha: (query) => lookupLushaIdentity(query),
    async persist(id, patch) {
      const update: Record<string, unknown> = { enrichment_metadata: patch.enrichment_metadata };
      if (patch.apollo_person_id) update.apollo_person_id = patch.apollo_person_id;
      if (patch.linkedin_url) update.linkedin_url = patch.linkedin_url;
      if (patch.email) update.email = patch.email;
      if (patch.title) update.title = patch.title;
      let query = admin.from('contact_enrichment_candidates').update(update).eq('id', id);
      // Nunca se pisa un valor que otro proceso escribió entre la lectura y esta escritura.
      if (patch.apollo_person_id) query = query.is('apollo_person_id', null);
      const { error } = await query;
      if (error) throw new Error(error.message);
      // AGENT2A-HUBSPOT-REVEAL-PUSH — sólo si de verdad se guardó un canal nuevo.
      if (patch.linkedin_url || patch.email) {
        await pushCandidateRevealToHubSpot(id, patch.linkedin_url ? 'reveal_linkedin' : 'reveal_email');
      }
    },
    async logUsage(entry, context) {
      await logProviderUsage({
        provider_key: entry.provider_key,
        operation_key: entry.operation_key,
        // null ⇒ desconocido (queda NULL), nunca 0 inventado.
        ...(entry.credits_used === null ? {} : { credits_used: entry.credits_used }),
        estimated_cost_usd: null,
        results_returned: entry.results_returned,
        status: entry.status,
        ...(entry.error_code ? { error_code: entry.error_code } : {}),
        triggered_by: actor.internalUserId,
        agent_key: 'agent2a',
        agent_step: 'identificar_contacto',
        // Sin correo ni LinkedIn: datos personales.
        metadata: {
          entry_mode: 'candidate_identity_completion',
          purpose: context.purpose,
          // Con qué se buscó (correo / linkedin), nunca el valor.
          channel: context.channel,
          candidate_id: candidateId,
          // Desde dónde se gastó (ficha del contacto o «Por revisar»): el consumo por persona
          // ya lo da `triggered_by`; esto dice en qué pantalla.
          surface: options.surface ?? 'candidate_review',
          hito: CANDIDATE_IDENTITY_COMPLETION_HITO,
        },
      });
    },
  };
}

// ── «Revelar teléfono» con identificación previa ──────────────────

function failed(status: IdentityCompletionStatus): IdentityCompletionResult {
  return {
    ok: false,
    status,
    linkedinAvailable: false,
    emailAvailable: false,
    providerIdentityAvailable: false,
    linkedinProvider: null,
    emailProvider: null,
  };
}

export type RevealCandidatePhoneWithIdentityResult =
  | (RevealCandidatePhoneResult & { identityCompleted?: boolean })
  | {
      ok: false;
      status: 'identity_not_found';
      identityStatus: IdentityCompletionStatus;
      requestAccepted: false;
      errorCode: string | null;
    };

export async function revealCandidatePhoneWithIdentity(
  input: RevealCandidatePhoneInput,
  options: IdentityCompletionRunOptions = {},
): Promise<RevealCandidatePhoneWithIdentityResult> {
  // Con el reveal apagado no se gasta una identificación que no llevaría a ningún teléfono: se
  // delega tal cual y el reveal contesta `disabled` sin tocar nada.
  if (!isApolloPhoneRevealEnabled()) return revealCandidatePhoneAction(input);

  const candidateId = typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  const supabase = await createClient();
  if (!candidateId || !(await canSeeContactCandidate(supabase, candidateId))) {
    return revealCandidatePhoneAction(input);
  }

  const { data } = await supabase
    .from('contact_enrichment_candidates')
    .select('email, linkedin_url, apollo_person_id, source, source_contact_id, enrichment_metadata')
    .eq('id', candidateId)
    .maybeSingle();
  const needs = data
    ? evaluateCandidateIdentityCompletion({
        email: data.email as string | null,
        linkedinUrl: data.linkedin_url as string | null,
        apolloPersonId: data.apollo_person_id as string | null,
        source: data.source as string | null,
        sourceContactId: data.source_contact_id as string | null,
        enrichmentMetadata: data.enrichment_metadata as Record<string, unknown> | null,
      })
    : null;

  // Ya identificado, sin forma de identificarlo, no es de HubSpot o un intento anterior ya salió
  // sin resultado: el reveal de siempre decide (y bloquea fail-closed si no hay identidad).
  if (!needs?.phoneRevealNeedsIdentity) return revealCandidatePhoneAction(input);

  const { internalUserId, roleKey } = await requireActiveActor();
  const actor = { internalUserId, roleKey };
  let identity: IdentityCompletionResult;
  try {
    identity = await runIdentityCompletionForCandidate(candidateId, 'phone', actor, options);
  } catch {
    identity = failed('provider_error');
  }
  // El rol lo vuelve a decir el reveal con su propio copy.
  if (identity.status === 'unauthorized_role') return revealCandidatePhoneAction(input);
  if (!identity.providerIdentityAvailable) {
    return {
      ok: false,
      status: 'identity_not_found',
      identityStatus: identity.status,
      requestAccepted: false,
      errorCode: null,
    };
  }

  const revealed = await revealCandidatePhoneAction(input);
  return { ...revealed, identityCompleted: true };
}
