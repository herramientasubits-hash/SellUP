'use server';

// Agente 2A — Apollo Phone Reveal: RECOVERY L3 Server Action
// (APOLLO-PHONE-RECOVERY-L3)
//
// Wrapper 'use server' de la revisión manual de UN candidato desde el sidepanel.
// Toda la decisión vive en los cores puros (elegibilidad L3 + runtime L3 + recovery
// core ya mergeado); este archivo solo resuelve el actor autenticado, lee la foto
// del candidato con el cliente de sesión (RLS) y reutiliza `buildRecoveryCoreDeps`
// para el I/O real del poll (Apollo GET, service-role write, provider_usage_logs).
//
// POR QUÉ EXISTE
// El recovery L2 (cron) es DIARIO — el plan de Vercel no admite cadencias
// sub-diarias — así que un reveal cuyo webhook se pierde puede quedar "en proceso"
// hasta 24 h. Apollo confirmó que `webhook_result` se puede consultar a los 1–2 min
// y sigue disponible 30 días. Esta acción da al operador ese camino, sin iniciar un
// reveal nuevo y sin gastar créditos de reveal.
//
// Seguridad:
//   * Sesión obligatoria: sin usuario ⇒ redirect /login. Rol: los MISMOS del Phone
//     Reveal (admin / commercial_manager); el runtime core lo revalida y devuelve
//     `unauthorized_role` fail-closed (no se lee ni se consulta nada).
//   * UN solo candidato, UN solo GET de recuperación, sin retry, sin loop, sin bulk.
//   * NO inicia reveals (no /people/match, no `reveal_phone_number`), NO consume
//     créditos de reveal, NO toca Lusha, NO escribe HubSpot, NO crea contactos.
//   * Doble candado anti-doble-clic: un lock en memoria por candidato (best-effort,
//     por instancia) + la ventana durable de 60 s sobre
//     `phone_reveal_last_checked_at`, que es la que realmente frena el abuso.
//   * El resultado NUNCA incluye teléfono, raw_number, sanitized_number, email,
//     linkedin, nombre, empresa, API key, token, request id ni payload crudo.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { recoverApolloPhoneRevealForCandidate } from './phone-reveal-recovery-core';
import { buildRecoveryCoreDeps } from './phone-reveal-recovery-deps';
import { PHONE_CACHE_HIT_PHONE_SOURCE } from './phone-cache-core';
import type {
  ManualRecoveryActor,
  ManualRecoveryCandidateSnapshot,
} from './phone-reveal-manual-recovery-core';
import {
  runManualPhoneRevealRecovery,
  type ManualRecoveryRuntimeInput,
  type ManualRecoveryRuntimeResult,
} from './phone-reveal-manual-recovery-runtime-core';
import type {
  ContactCandidateEnrichmentMetadata,
  ContactCandidatePhoneMetadata,
} from './types';

// ── Columnas de la foto (sin PII más allá del propio teléfono) ──
// `phone` no se devuelve: solo alimenta el booleano `hasPhone`. `enrichment_metadata`
// se lee para replicar el criterio del recovery core (un número servido desde caché
// también cuenta como "ya tiene teléfono").
const MANUAL_RECOVERY_SNAPSHOT_SELECT = `id, phone, enrichment_metadata,
   phone_reveal_provider, phone_reveal_status, phone_reveal_request_id,
   phone_reveal_requested_at, phone_reveal_last_checked_at`;

/**
 * Lock en memoria contra el doble clic. Es best-effort a propósito: en serverless
 * solo cubre la misma instancia. El freno real y durable es la ventana de 60 s
 * sobre `phone_reveal_last_checked_at`, que evalúa el core de elegibilidad.
 */
const inFlightCandidateIds = new Set<string>();

function hasPersistedPhone(
  phone: string | null,
  metadata: ContactCandidateEnrichmentMetadata,
): boolean {
  if (typeof phone === 'string' && phone.trim().length > 0) return true;
  const phoneMeta = metadata.phone as ContactCandidatePhoneMetadata | null | undefined;
  const source = typeof phoneMeta?.source === 'string' ? phoneMeta.source : null;
  return source === 'apollo_reveal' || source === PHONE_CACHE_HIT_PHONE_SOURCE;
}

function mapSnapshot(row: Record<string, unknown>): ManualRecoveryCandidateSnapshot {
  const metadata =
    (row.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {};
  const requestId = row.phone_reveal_request_id;
  return {
    phoneRevealProvider: (row.phone_reveal_provider as string | null) ?? null,
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    hasPhone: hasPersistedPhone((row.phone as string | null) ?? null, metadata),
    // Solo la PRESENCIA del id de correlación viaja a la decisión: el id nunca sale
    // de aquí. El id real de recuperación (apollo_http_request_id) lo resuelve el
    // recovery core del START log; si falta, devuelve `missing_recovery_request_id`.
    recoveryIdPresent: typeof requestId === 'string' && requestId.trim().length > 0,
    requestedAtIso: (row.phone_reveal_requested_at as string | null) ?? null,
    lastCheckedAtIso: (row.phone_reveal_last_checked_at as string | null) ?? null,
  };
}

// ── Auth ───────────────────────────────────────────────────────

/**
 * Resuelve el internal_user activo y su role key. Sin sesión o sin usuario interno
 * activo ⇒ redirect a /login. El gate de ROL no redirige: lo aplica el runtime core
 * y devuelve `unauthorized_role` (la UI ya oculta el CTA a roles no autorizados).
 */
async function resolveManualRecoveryActor(): Promise<ManualRecoveryActor> {
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

  return { internalUserId: internalUser.id as string, roleKey };
}

// ── Server Action ──────────────────────────────────────────────

/**
 * Revisa AHORA el resultado de un reveal Apollo en vuelo para UN candidato, a
 * petición explícita del operador. NO inicia un reveal nuevo: hace como máximo un
 * `GET /webhook_result/{apollo_http_request_id}` a través del recovery core ya
 * mergeado, que es quien comprueba la supresión, persiste el resultado y registra
 * el usage-log `recovery_poll`. Devuelve un resumen seguro (sin PII).
 */
export async function recoverCandidatePhoneRevealNowAction(
  input: ManualRecoveryRuntimeInput,
): Promise<ManualRecoveryRuntimeResult> {
  const actor = await resolveManualRecoveryActor();
  const candidateId =
    typeof input?.candidateId === 'string' ? input.candidateId.trim() : '';

  // Candado anti-doble-clic (best-effort por instancia). Se toma ANTES de cualquier
  // I/O y se libera siempre; una segunda invocación concurrente no consulta Apollo.
  if (candidateId && inFlightCandidateIds.has(candidateId)) {
    return {
      ok: false,
      mode: 'manual_single',
      status: 'not_eligible',
      phoneRevealStatus: null,
      phoneRevealed: false,
      noPhoneFound: false,
      stillPending: false,
      retryAfterSeconds: null,
      phoneType: null,
      creditsUsed: null,
      message: 'recovery_already_in_progress',
    };
  }
  if (candidateId) inFlightCandidateIds.add(candidateId);

  try {
    const supabase = await createClient();
    const deps = buildRecoveryCoreDeps(actor.internalUserId);

    return await runManualPhoneRevealRecovery(
      { candidateId },
      {
        actor,
        nowIso: deps.nowIso,

        loadSnapshot: async (id): Promise<ManualRecoveryCandidateSnapshot | null> => {
          const { data, error } = await supabase
            .from('contact_enrichment_candidates')
            .select(MANUAL_RECOVERY_SNAPSHOT_SELECT)
            .eq('id', id)
            .maybeSingle();
          if (error) throw new Error(error.message);
          return data ? mapSnapshot(data as Record<string, unknown>) : null;
        },

        // Recovery core con las MISMAS deps reales que usan la acción admin y el
        // cron L2: mismo GET, misma comprobación de supresión, misma persistencia y
        // el mismo usage-log `recovery_poll`. Aquí no se duplica nada de ese I/O.
        recoverCandidate: (coreInput) =>
          recoverApolloPhoneRevealForCandidate(coreInput, deps),
      },
    );
  } finally {
    if (candidateId) inFlightCandidateIds.delete(candidateId);
  }
}
