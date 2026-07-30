'use server';

// Agente 2A — Apollo Phone Reveal: RECOVERY runtime Server Actions
// (APOLLO-PHONE-RECOVERY-RUNTIME-1)
//
// Wrapper 'use server' ADMIN-ONLY que cablea las dependencias reales del recovery
// core ya mergeado (phone-reveal-recovery-core.ts, PR #139) y las ejecuta a través
// del runtime core puro (phone-reveal-recovery-runtime-core.ts). Toda la lógica de
// decisión (gate de rol, dryRun, caps, mapeo a resumen sin PII) vive en los cores;
// este archivo solo resuelve el actor autenticado y provee el I/O real
// (Supabase service-role, Apollo GET de recuperación, provider_usage_logs).
//
// NO existe UI ni cron para estas acciones en este hito: quedan expuestas para un
// paso posterior, autorizado, de recuperación controlada. Recovery NO está gateado
// por ENABLE_APOLLO_PHONE_REVEAL (ese flag solo gobierna el START, que crea
// reveals nuevos). Recovery solo LEE un resultado ya producido por un reveal
// previo autorizado: no llama a /people/match, no crea reveals y no consume
// créditos nuevos.
//
// Seguridad:
//   * ADMIN-only: sesión → internal_user activo → role key === 'admin'. Anónimo
//     redirige a /login; no-admin (seller / commercial_manager / lead) redirige a
//     /settings (fail-closed). El runtime core RE-verifica el rol (defensa en
//     profundidad).
//   * dryRun por defecto true (single y batch). Ejecución real exige dryRun=false.
//   * El resultado devuelto NUNCA incluye teléfono, raw_number, sanitized_number,
//     email, linkedin, nombre, empresa, API key, token ni el payload crudo.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
} from './phone-reveal-recovery-core';
import {
  buildRecoveryCoreDeps,
  findStaleApolloPhoneRevealCandidateIds,
} from './phone-reveal-recovery-deps';
import {
  runAdminSingleCandidateRecovery,
  runAdminStaleBatchRecovery,
  type RecoveryRuntimeActor,
  type SingleRecoveryRuntimeInput,
  type SingleRecoveryRuntimeResult,
  type BatchRecoveryRuntimeInput,
  type BatchRecoveryRuntimeResult,
} from './phone-reveal-recovery-runtime-core';

// ── Auth: ADMIN-only ───────────────────────────────────────────

/**
 * Resuelve el actor admin activo. Redirige a /login si no hay sesión y a
 * /settings si el usuario no es admin (mismo patrón que usage-tracking/actions).
 * Devuelve el actor para el runtime core (que re-verifica el rol). Solo retorna
 * cuando roleKey === 'admin'.
 */
async function requireAdminActor(): Promise<RecoveryRuntimeActor> {
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
  if (!internalUser) redirect('/settings');

  let roleKey: string | null = null;
  if (internalUser.role_id) {
    const { data: role } = await supabase
      .from('roles')
      .select('key')
      .eq('id', internalUser.role_id)
      .single();
    roleKey = typeof role?.key === 'string' ? role.key : null;
  }
  if (roleKey !== 'admin') redirect('/settings');

  return { internalUserId: internalUser.id as string, roleKey };
}

// ── Server Action — Modo 1: recuperación de UN candidato ───────

/**
 * Recupera de forma controlada UN reveal Apollo en vuelo (requested/pending) cuyo
 * webhook nunca llegó. ADMIN-only. dryRun default true (valida y resuelve el
 * recovery id sin consultar Apollo ni escribir). Devuelve un resumen seguro (sin
 * PII). Para escribir de verdad hay que pasar dryRun=false explícito.
 */
export async function recoverCandidatePhoneAction(
  input: SingleRecoveryRuntimeInput,
): Promise<SingleRecoveryRuntimeResult> {
  const actor = await requireAdminActor();
  const deps = buildRecoveryCoreDeps(actor.internalUserId);
  return runAdminSingleCandidateRecovery(input, {
    actor,
    recoverCandidate: (coreInput) =>
      recoverApolloPhoneRevealForCandidate(coreInput, deps),
  });
}

// ── Server Action — Modo 2: recuperación batch de stale ────────

/**
 * Recupera en lote reveals Apollo stale (requested/pending sin webhook). ADMIN-only.
 * dryRun default true, maxCandidates default 5 (hard cap 10), minAgeMinutes default
 * 15 (los caps los aplica el recovery core). NO es cron ni auto-run: un humano
 * admin la dispara. Devuelve solo conteos (sin PII).
 */
export async function recoverStalePhonesAction(
  input: BatchRecoveryRuntimeInput,
): Promise<BatchRecoveryRuntimeResult> {
  const actor = await requireAdminActor();
  const deps = buildRecoveryCoreDeps(actor.internalUserId);
  return runAdminStaleBatchRecovery(input, {
    actor,
    recoverStale: (coreInput) =>
      recoverStaleApolloPhoneRevealRequests(coreInput, {
        nowIso: deps.nowIso,
        findStaleCandidateIds: findStaleApolloPhoneRevealCandidateIds,
        recoverOne: async (candidateId) => {
          const result = await recoverApolloPhoneRevealForCandidate(
            {
              candidateId,
              actorUserId: actor.internalUserId,
              reason: input.reason ?? 'manual_admin_stale_recovery',
            },
            deps,
          );
          return result.outcome;
        },
      }),
  });
}
