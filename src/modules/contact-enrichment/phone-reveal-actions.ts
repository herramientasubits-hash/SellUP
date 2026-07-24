'use server';

// Agente 2A — Apollo Phone Reveal: Server Action wrapper (PHONE-3D.3)
//
// Thin 'use server' wrapper that wires real dependencies into the pure core
// (phone-reveal-core.ts): the flag, the authenticated actor + role, the
// candidate load, the do-not-contact check, the single Apollo call, the
// service-role persistence write and the PII-free usage log. All validation and
// decision logic live in the core so this file stays declarative.
//
// Gated behind ENABLE_APOLLO_PHONE_REVEAL, which is OFF in every environment as
// of this milestone: with the flag off the core short-circuits to `disabled`
// before touching auth, Apollo or the DB. This milestone adds NO UI (no button,
// no modal), NO migration, does NOT activate the flag and makes NO real provider
// calls in tests. Apollo only — never Lusha, never HubSpot; the action neither
// creates an official contact nor approves the candidate.

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isApolloPhoneRevealEnabled } from '@/lib/feature-flags.server';
import { matchApolloPerson } from '@/server/integrations/apollo-client';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  runRevealCandidatePhone,
  type RevealCandidatePhoneInput,
  type RevealCandidatePhoneResult,
  type RevealCandidateRecord,
  type ApolloPhoneRevealCallResult,
  type RevealPersistencePatch,
  type PhoneRevealUsageLogEntry,
} from './phone-reveal-core';
import type { ContactCandidateEnrichmentMetadata } from './types';

// ── Auth + rol del actor ──────────────────────────────────────

/** Cliente service_role para mutar staging (mismo patrón que candidate-review). */
function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

/**
 * Resuelve el usuario interno activo y su role key. Redirige a /login si no hay
 * usuario. El role key alimenta el gate de rol del core (admin /
 * commercial_manager). No hay fallback dev que salte el rol: un actor sin rol
 * conocido queda no autorizado en el core.
 */
async function resolveActorForReveal(): Promise<{
  internalUserId: string;
  roleKey: string | null;
}> {
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
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }

  return { internalUserId: internalUser.id, roleKey };
}

// ── Carga del candidato ────────────────────────────────────────

const REVEAL_CANDIDATE_SELECT = `id, source_contact_id, email, linkedin_url,
   first_name, last_name, phone, enrichment_metadata, phone_reveal_status,
   run:contact_enrichment_runs ( account_id, company_name )`;

function mapRevealCandidate(row: unknown): RevealCandidateRecord {
  const r = row as Record<string, unknown>;
  const runRaw = r.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null; company_name: string | null }
    | null
    | undefined;
  return {
    id: r.id as string,
    accountId: run?.account_id ?? null,
    sourceContactId: (r.source_contact_id as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    linkedinUrl: (r.linkedin_url as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    lastName: (r.last_name as string | null) ?? null,
    organizationName: run?.company_name ?? null,
    existingPhone: (r.phone as string | null) ?? null,
    enrichmentMetadata:
      (r.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    phoneRevealStatus: (r.phone_reveal_status as string | null) ?? null,
  };
}

// ── Normalización del error Apollo (sin PII) ───────────────────

function safeApolloErrorCode(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'apollo_reveal_failed';
  // Solo códigos cortos/mecánicos (p.ej. HTTP_500). Nada de mensajes libres.
  const code = raw.trim().slice(0, 40);
  return /^[A-Za-z0-9_.-]+$/.test(code) ? code : 'apollo_reveal_failed';
}

// ── Server Action ──────────────────────────────────────────────

/**
 * Revela el teléfono de UN candidato vía Apollo, de forma explícita, confirmada
 * y auditada. Individual (no bulk), no automática, detrás de
 * ENABLE_APOLLO_PHONE_REVEAL. Devuelve un resultado seguro para la UI (sin PII;
 * el teléfono revelado se persiste en el candidato, no se retorna en crudo).
 */
export async function revealCandidatePhoneAction(
  input: RevealCandidatePhoneInput,
): Promise<RevealCandidatePhoneResult> {
  // Con el flag apagado no resolvemos actor ni tocamos DB: el core corta antes.
  const flagEnabled = isApolloPhoneRevealEnabled();
  if (!flagEnabled) {
    return runRevealCandidatePhone(input, {
      flagEnabled: false,
      actor: { internalUserId: '', roleKey: null },
      nowIso: new Date().toISOString(),
      loadCandidate: async () => null,
      isDoNotContact: async () => false,
      revealViaApollo: async () => ({ ok: false, errorCode: 'disabled' }),
      persist: async () => {},
      logUsage: async () => {},
    });
  }

  const actor = await resolveActorForReveal();
  const supabase = await createClient();
  const admin = getServiceRoleClient();

  return runRevealCandidatePhone(input, {
    flagEnabled: true,
    actor,
    nowIso: new Date().toISOString(),

    loadCandidate: async (candidateId): Promise<RevealCandidateRecord | null> => {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select(REVEAL_CANDIDATE_SELECT)
        .eq('id', candidateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapRevealCandidate(data) : null;
    },

    isDoNotContact: async (candidate): Promise<boolean> => {
      // Detección fiable solo cuando hay cuenta + identidad (email/linkedin).
      // Sin cuenta (HubSpot-only/manual) no hay forma segura → no bloquea.
      const accountId = candidate.accountId;
      if (!accountId) return false;
      const identifiers: string[] = [];
      if (candidate.email) identifiers.push(candidate.email);
      if (candidate.linkedinUrl) identifiers.push(candidate.linkedinUrl);
      if (identifiers.length === 0) return false;

      const { data, error } = await supabase
        .from('contacts')
        .select('id, email, linkedin_url, contact_status')
        .eq('account_id', accountId)
        .eq('contact_status', 'do_not_contact');
      if (error) throw new Error(error.message);

      const email = candidate.email?.toLowerCase() ?? null;
      const linkedin = candidate.linkedinUrl?.toLowerCase() ?? null;
      return (data ?? []).some((c) => {
        const cEmail =
          typeof c.email === 'string' ? c.email.toLowerCase() : null;
        const cLinkedin =
          typeof c.linkedin_url === 'string' ? c.linkedin_url.toLowerCase() : null;
        return (
          (email !== null && cEmail === email) ||
          (linkedin !== null && cLinkedin === linkedin)
        );
      });
    },

    revealViaApollo: async (params): Promise<ApolloPhoneRevealCallResult> => {
      const result = await matchApolloPerson(params);
      if (!result.success) {
        return { ok: false, errorCode: safeApolloErrorCode(result.error?.error) };
      }
      return { ok: true, phoneNumbers: result.data?.phone_numbers ?? [] };
    },

    persist: async (candidateId, patch: RevealPersistencePatch): Promise<void> => {
      const update: Record<string, unknown> = {
        phone_reveal_status: patch.phone_reveal_status,
        phone_revealed_at: patch.phone_revealed_at,
        phone_revealed_by: patch.phone_revealed_by,
        phone_reveal_provider: patch.phone_reveal_provider,
        phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
        phone_reveal_cost_usd: patch.phone_reveal_cost_usd,
        phone_reveal_error_code: patch.phone_reveal_error_code,
        phone_processing_basis: patch.phone_processing_basis,
        phone_processing_basis_note: patch.phone_processing_basis_note,
      };
      if (patch.phone !== undefined) update.phone = patch.phone;
      if (patch.enrichment_metadata !== undefined) {
        update.enrichment_metadata = patch.enrichment_metadata;
      }
      const { error } = await admin
        .from('contact_enrichment_candidates')
        .update(update)
        .eq('id', candidateId);
      if (error) throw new Error(error.message);
    },

    logUsage: async (entry: PhoneRevealUsageLogEntry): Promise<void> => {
      await logProviderUsage({
        provider_key: entry.provider,
        operation_key: entry.operationKey,
        credits_used: entry.creditsUsed ?? undefined,
        estimated_cost_usd: entry.costUsd,
        status: entry.status,
        error_code: entry.errorCode ?? undefined,
        triggered_by: entry.triggeredBy,
        results_returned: entry.metadata.phone_revealed ? 1 : 0,
        metadata: entry.metadata,
      });
    },
  });
}
