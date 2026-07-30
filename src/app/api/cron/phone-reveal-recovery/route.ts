// Agente 2A — Apollo Phone Reveal: endpoint del RECOVERY L2 programado
// (APOLLO-PHONE-RECOVERY-CRON-1)
//
// Adaptador FINO sobre el núcleo puro (phone-reveal-recovery-cron-core.ts). Aquí
// solo vive el I/O de borde: leer el secreto del header/query, leer el flag, leer
// la env del secreto, cablear las deps reales del recovery core y loguear un
// resumen SIN PII. Toda la decisión (autorización, gate de flag, caps) está en el
// core.
//
// Disparadores:
//   * Vercel Cron (vercel.json) manda `Authorization: Bearer $CRON_SECRET`.
//   * Un admin puede dispararlo a mano con el mismo header (mismo patrón que
//     /api/cron/enrich). Sin el secreto correcto NO hay ejecución: 401.
//
// Doble candado para activarlo: `CRON_SECRET` (autoriza al llamante) +
// ENABLE_APOLLO_PHONE_REVEAL_RECOVERY_CRON en `true` (habilita el trabajo). Con el
// flag apagado — el default de todos los entornos en este hito — responde 200
// `disabled` sin consultar Apollo y sin escribir.
//
// Lo que este endpoint NO hace: no inicia reveals (no llama /people/match, no
// manda `reveal_phone_number`), no consume créditos nuevos, no crea contactos
// oficiales, no aprueba candidatos, no escribe HubSpot, no toca Lusha, no
// reintenta dentro de la corrida y no imprime teléfono / email / linkedin /
// nombre / empresa / API key / token ni el payload crudo de Apollo.

import { NextRequest, NextResponse } from 'next/server';
import { isApolloPhoneRevealRecoveryCronEnabled } from '@/lib/feature-flags.server';
import {
  recoverApolloPhoneRevealForCandidate,
  recoverStaleApolloPhoneRevealRequests,
} from '@/modules/contact-enrichment/phone-reveal-recovery-core';
import {
  buildRecoveryCoreDeps,
  findStaleApolloPhoneRevealCandidateIds,
} from '@/modules/contact-enrichment/phone-reveal-recovery-deps';
import {
  extractCronSecretFromAuthorizationHeader,
  runScheduledStalePhoneRevealRecovery,
  RECOVERY_CRON_SECRET_ENV,
  type RecoveryCronRunResult,
} from '@/modules/contact-enrichment/phone-reveal-recovery-cron-core';

export const dynamic = 'force-dynamic';

/**
 * Hasta 5 candidatos × 1 GET a Apollo por corrida. 60 s da margen de sobra sin
 * dejar la función colgada si Apollo va lento.
 */
export const maxDuration = 60;

/** `reason` que queda en el usage-log de cada poll (opaco, sin PII). */
const CRON_RECOVERY_REASON = 'scheduled_stale_recovery_cron';

/**
 * Extrae el secreto del `Authorization: Bearer …` (lo que manda Vercel Cron). No
 * se acepta por query string: un secreto en la URL termina en logs de acceso.
 */
function extractProvidedSecret(request: NextRequest): string | null {
  return extractCronSecretFromAuthorizationHeader(
    request.headers.get('Authorization'),
  );
}

/** `?dryRun=1` / `?dryRun=true` ⇒ solo selecciona, sin Apollo y sin escrituras. */
function extractDryRun(request: NextRequest): boolean {
  const raw = request.nextUrl.searchParams.get('dryRun');
  if (typeof raw !== 'string') return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

/** Cuerpo de respuesta: solo conteos y estados. Nunca ids de candidato ni PII. */
function responseBody(result: RecoveryCronRunResult) {
  return {
    ok: result.ok,
    status: result.status,
    checked: result.checked,
    recovered: result.recovered,
    still_pending: result.stillPending,
    no_phone_found: result.noPhoneFound,
    failed: result.failed,
    skipped: result.skipped,
    dry_run: result.dryRun,
    max_candidates: result.maxCandidates,
    min_age_minutes: result.minAgeMinutes,
  };
}

async function handleCronRequest(request: NextRequest): Promise<NextResponse> {
  const dryRun = extractDryRun(request);

  let result: RecoveryCronRunResult;
  try {
    result = await runScheduledStalePhoneRevealRecovery(
      { providedSecret: extractProvidedSecret(request), dryRun },
      {
        expectedSecret: process.env[RECOVERY_CRON_SECRET_ENV] ?? null,
        enabled: isApolloPhoneRevealRecoveryCronEnabled(),
        // Las deps reales se construyen SOLO cuando el core llega a ejecutar:
        // con 401 o con el flag apagado este callback nunca se invoca, así que no
        // se abre cliente de Supabase ni se toca Apollo.
        recoverStale: (coreInput) => {
          const deps = buildRecoveryCoreDeps(null);
          return recoverStaleApolloPhoneRevealRequests(coreInput, {
            nowIso: deps.nowIso,
            findStaleCandidateIds: findStaleApolloPhoneRevealCandidateIds,
            recoverOne: async (candidateId) => {
              const single = await recoverApolloPhoneRevealForCandidate(
                {
                  candidateId,
                  actorUserId: null,
                  reason: CRON_RECOVERY_REASON,
                },
                deps,
              );
              return single.outcome;
            },
          });
        },
      },
    );
  } catch (error) {
    // Mensaje mecánico: el detalle puede traer texto de Supabase/Apollo, así que
    // no se devuelve al llamante. Se loguea sin payload ni PII.
    console.error(
      '[phone-reveal-recovery-cron] run failed:',
      error instanceof Error ? error.message : 'unknown_error',
    );
    return NextResponse.json(
      { ok: false, status: 'error' },
      { status: 500 },
    );
  }

  if (result.status === 'unauthorized') {
    // El motivo mecánico (no configurado / ausente / distinto) queda solo en el
    // log del servidor: la respuesta no distingue los casos.
    console.warn(
      '[phone-reveal-recovery-cron] unauthorized:',
      result.denialCode ?? 'unknown',
    );
    return NextResponse.json({ ok: false, status: 'unauthorized' }, { status: 401 });
  }

  console.info('[phone-reveal-recovery-cron]', responseBody(result));
  return NextResponse.json(responseBody(result), { status: result.httpStatus });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCronRequest(request);
}
