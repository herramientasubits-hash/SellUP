'use server';

// Agente 2A — Lusha Phone Reveal Fallback: Server Action wrapper
// (LUSHA-PHONE-FALLBACK-1)
//
// Thin 'use server' wrapper that wires real dependencies into the pure core
// (lusha-phone-fallback-core.ts): the flag, the authenticated actor + role,
// the candidate load, the single Lusha /v3/contacts/enrich call, the
// service-role persistence write and the PII-free usage log. All validation
// and decision logic live in the core so this file stays declarative.
//
// Gated behind ENABLE_LUSHA_PHONE_REVEAL_FALLBACK, OFF in every environment as
// of this milestone: with the flag off the core short-circuits to
// `feature_disabled` before resolving the actor, loading the candidate or
// calling Lusha. Manual, admin-only, single candidate (no bulk — the input
// type is a scalar candidateId). Lusha only — never Apollo, never HubSpot;
// this action neither creates an official contact nor approves the candidate.

import { redirect } from 'next/navigation';
import { createClient as createServiceRoleClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { isLushaPhoneRevealFallbackEnabled, resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { enrichLushaContactPhonesForFallback } from '@/server/integrations/lusha-phone-fallback-client';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  runLushaPhoneFallbackReveal,
  type LushaPhoneFallbackActionInput,
  type LushaPhoneFallbackActionResult,
  type LushaPhoneFallbackCandidateRecord,
  type LushaPhoneFallbackPersistencePatch,
  type LushaPhoneFallbackUsageLogEntry,
} from './lusha-phone-fallback-core';
import type { ContactCandidateEnrichmentMetadata, ContactSource } from './types';

// ── Auth + rol del actor ──────────────────────────────────────

/** Cliente service_role para mutar staging (mismo patrón que phone-reveal-actions). */
function getServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service credentials not configured');
  return createServiceRoleClient(url, key);
}

/**
 * Resuelve el usuario interno activo y su role key. Redirige a /login si no
 * hay usuario. Espejo de resolveActorForReveal en phone-reveal-actions.ts.
 */
async function resolveActorForLushaFallback(): Promise<{
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

const LUSHA_FALLBACK_CANDIDATE_SELECT =
  'id, status, source, source_contact_id, phone, enrichment_metadata, phone_reveal_status, phone_reveal_attempt_count';

function mapLushaFallbackCandidate(row: unknown): LushaPhoneFallbackCandidateRecord {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    status: (r.status as string | null) ?? null,
    source: (r.source as ContactSource | null) ?? null,
    sourceContactId: (r.source_contact_id as string | null) ?? null,
    existingPhone: (r.phone as string | null) ?? null,
    phoneRevealStatus: (r.phone_reveal_status as string | null) ?? null,
    phoneRevealAttemptCount:
      typeof r.phone_reveal_attempt_count === 'number' ? r.phone_reveal_attempt_count : 0,
    enrichmentMetadata: (r.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
  };
}

// ── Server Action ──────────────────────────────────────────────

/**
 * Reveals ONE candidate's phone via the Lusha fallback (manual, admin-only,
 * single-candidate, only after Apollo's own reveal returned `no_phone_found`).
 * Synchronous: unlike Apollo's async reveal, /v3/contacts/enrich answers in
 * the same request — no webhook, no in-flight state. Never returns a raw
 * phone number, credentials or Lusha contact id: the phone is persisted
 * server-side and the UI refetches the candidate to display it.
 */
export async function revealCandidatePhoneViaLushaFallbackAction(
  input: LushaPhoneFallbackActionInput,
): Promise<LushaPhoneFallbackActionResult> {
  const flagEnabled = isLushaPhoneRevealFallbackEnabled();
  if (!flagEnabled) {
    return runLushaPhoneFallbackReveal(input, {
      flagEnabled: false,
      actor: { internalUserId: '', roleKey: null },
      nowIso: new Date().toISOString(),
      loadCandidate: async () => null,
      callLusha: async () => ({ ok: false, errorMessage: 'disabled' }),
      persist: async () => {},
      logUsage: async () => {},
    });
  }

  const actor = await resolveActorForLushaFallback();
  const supabase = await createClient();
  const admin = getServiceRoleClient();

  return runLushaPhoneFallbackReveal(input, {
    flagEnabled: true,
    actor,
    nowIso: new Date().toISOString(),

    loadCandidate: async (candidateId): Promise<LushaPhoneFallbackCandidateRecord | null> => {
      const { data, error } = await supabase
        .from('contact_enrichment_candidates')
        .select(LUSHA_FALLBACK_CANDIDATE_SELECT)
        .eq('id', candidateId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? mapLushaFallbackCandidate(data) : null;
    },

    callLusha: async ({ contactId }) => {
      const apiKey = await getLushaApiKey();
      if (!apiKey) {
        return { ok: false, errorMessage: 'Lusha API key not configured' };
      }
      return enrichLushaContactPhonesForFallback({
        apiKey,
        timeoutMs: resolveLushaSearchTimeoutMs(),
        contactId,
        allowPhoneReveal: true,
      });
    },

    persist: async (
      candidateId: string,
      patch: LushaPhoneFallbackPersistencePatch,
    ): Promise<void> => {
      const update: Record<string, unknown> = {
        phone_reveal_status: patch.phone_reveal_status,
        phone_reveal_provider: patch.phone_reveal_provider,
        // Higiene del id de correlación (AGENT2A-PHONE-REVEAL-UI-STATE-1 § 10).
        // Se escribe SIEMPRE, incluso cuando vale `null`: omitirlo es lo que dejaba
        // el id del intento Apollo anterior en una fila cuyo proveedor final es
        // Lusha. El valor lo resuelve el core con `resolveFinalPhoneRevealRequestId`.
        phone_reveal_request_id: patch.phone_reveal_request_id,
        phone_revealed_at: patch.phone_revealed_at,
        phone_reveal_completed_at: patch.phone_reveal_completed_at,
        phone_revealed_by: patch.phone_revealed_by,
        phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
        phone_reveal_cost_source: patch.phone_reveal_cost_source,
        phone_reveal_error_code: patch.phone_reveal_error_code,
        phone_reveal_attempt_count: patch.phone_reveal_attempt_count,
      };
      // Solo se escribe cuando el core resolvió un teléfono (camino `revealed`).
      // No aplicable en `no_phone_found` / `error`: no se toca el teléfono previo.
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

    logUsage: async (entry: LushaPhoneFallbackUsageLogEntry): Promise<void> => {
      await logProviderUsage({
        provider_key: entry.provider,
        operation_key: entry.operationKey,
        credits_used: entry.creditsUsed ?? undefined,
        status: entry.status,
        error_code: entry.errorCode ?? undefined,
        triggered_by: entry.triggeredBy,
        results_returned: entry.status === 'success' ? 1 : 0,
        metadata: { ...entry.metadata },
      });
    },
  });
}
