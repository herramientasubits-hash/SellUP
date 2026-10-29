'use server';

// Agente 2A — Completar un candidato que ya existe en HubSpot: acciones del servidor
// (AGENT2A-HUBSPOT-CANDIDATE-IDENTITY-COMPLETION).
//
// Cablea el núcleo puro (`candidate-identity-completion-core.ts`) con Supabase, Apollo y Lusha:
//
//   * `revealCandidateLinkedinAction` — «Revelar LinkedIn»: identifica por correo y guarda el
//     LinkedIn (y, de paso, la identidad de Apollo).
//   * `revealCandidatePhoneWithIdentityAction` — «Revelar teléfono» para un candidato SIN
//     identidad nativa de proveedor (los de «Primero HubSpot»): identifica primero y, sólo si
//     aparece la identidad, delega en `revealCandidatePhoneAction` sin cambiar NADA de su
//     gobierno (flag, rol, corrida del waterfall, techo de créditos, presupuesto, privacidad).
//
// No escribe en HubSpot. El LinkedIn y el teléfono llegan a HubSpot al aprobar: el sync completa
// las propiedades VACÍAS del contacto que ya existía (nunca sobrescribe).

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isApolloPhoneRevealEnabled } from '@/lib/feature-flags.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import { canSeeContactCandidate } from './candidate-scope.server';
import {
  CANDIDATE_IDENTITY_COMPLETION_HITO,
  evaluateCandidateIdentityCompletion,
  runCandidateIdentityCompletion,
  type IdentityCompletionCandidate,
  type IdentityCompletionPurpose,
  type IdentityCompletionResult,
  type IdentityCompletionStatus,
} from './candidate-identity-completion-core';
import {
  lookupApolloIdentityByEmail,
  lookupLushaLinkedinByEmail,
} from './candidate-identity-completion-providers.server';
import { revealCandidatePhoneAction } from './phone-reveal-actions';
import type { RevealCandidatePhoneInput, RevealCandidatePhoneResult } from './phone-reveal-core';

function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

/** Usuario interno activo + rol (mismo patrón que el reveal de teléfono). */
async function resolveActor(): Promise<{ internalUserId: string; roleKey: string | null }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: internalUser } = await supabase
    .from('internal_users')
    .select('id, role_id')
    .eq('auth_user_id', user.id)
    .eq('access_status', 'active')
    .single();
  if (!internalUser) redirect('/login');

  let roleKey: string | null = null;
  if (internalUser.role_id) {
    const { data: role } = await supabase.from('roles').select('key').eq('id', internalUser.role_id).single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }
  return { internalUserId: internalUser.id, roleKey };
}

const CANDIDATE_SELECT = `id, status, source, source_contact_id, apollo_person_id, email, linkedin_url,
   first_name, last_name, full_name, enrichment_metadata,
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
    enrichmentMetadata:
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
  };
}

async function runCompletion(
  candidateId: string,
  purpose: IdentityCompletionPurpose,
  actor: { internalUserId: string; roleKey: string | null },
): Promise<IdentityCompletionResult> {
  const supabase = await createClient();
  const admin = getServiceRoleClient();

  return runCandidateIdentityCompletion(
    { candidateId, purpose },
    {
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
      lookupApollo: (query) => lookupApolloIdentityByEmail(query),
      lookupLushaLinkedin: (query) => lookupLushaLinkedinByEmail(query),
      async persist(id, patch) {
        const update: Record<string, unknown> = { enrichment_metadata: patch.enrichment_metadata };
        if (patch.apollo_person_id) update.apollo_person_id = patch.apollo_person_id;
        if (patch.linkedin_url) update.linkedin_url = patch.linkedin_url;
        let query = admin.from('contact_enrichment_candidates').update(update).eq('id', id);
        // Nunca se pisa un valor que otro proceso escribió entre la lectura y esta escritura.
        if (patch.apollo_person_id) query = query.is('apollo_person_id', null);
        const { error } = await query;
        if (error) throw new Error(error.message);
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
            candidate_id: candidateId,
            hito: CANDIDATE_IDENTITY_COMPLETION_HITO,
          },
        });
      },
    },
  );
}

// ── «Revelar LinkedIn» ───────────────────────────────────────────

export type RevealCandidateLinkedinActionResult = IdentityCompletionResult;

export async function revealCandidateLinkedinAction(input: {
  candidateId: string;
}): Promise<RevealCandidateLinkedinActionResult> {
  const candidateId = typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';
  const actor = await resolveActor();
  const supabase = await createClient();
  // Alcance comercial ANTES de gastar: un candidato ajeno no existe para este actor.
  if (!candidateId || !(await canSeeContactCandidate(supabase, candidateId))) {
    return { ok: false, status: 'candidate_not_found', linkedinAvailable: false, providerIdentityAvailable: false, linkedinProvider: null };
  }
  try {
    return await runCompletion(candidateId, 'linkedin', actor);
  } catch {
    return { ok: false, status: 'provider_error', linkedinAvailable: false, providerIdentityAvailable: false, linkedinProvider: null };
  }
}

// ── «Revelar teléfono» con identificación previa ──────────────────

export type RevealCandidatePhoneWithIdentityResult =
  | (RevealCandidatePhoneResult & { identityCompleted?: boolean })
  | {
      ok: false;
      status: 'identity_not_found';
      identityStatus: IdentityCompletionStatus;
      requestAccepted: false;
      errorCode: string | null;
    };

export async function revealCandidatePhoneWithIdentityAction(
  input: RevealCandidatePhoneInput,
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

  const actor = await resolveActor();
  let identity: IdentityCompletionResult;
  try {
    identity = await runCompletion(candidateId, 'phone', actor);
  } catch {
    identity = { ok: false, status: 'provider_error', linkedinAvailable: false, providerIdentityAvailable: false, linkedinProvider: null };
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
