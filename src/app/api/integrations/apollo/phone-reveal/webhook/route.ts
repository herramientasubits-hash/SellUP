// Agente 2A — Apollo Phone Reveal WEBHOOK route (APOLLO-PHONE-ASYNC-1)
//
// Public callback endpoint where Apollo delivers the phone numbers of an async
// reveal started by revealCandidatePhoneAction. Thin adapter over the pure core
// (phone-reveal-webhook-core.ts): it wires the expected secret token (env),
// parses the JSON body WITHOUT logging it, and injects the service-role
// candidate lookup / persistence / usage-log. All validation, correlation and
// PII-free decisions live in the core.
//
// Security (Apollo does NOT document a webhook signature): the endpoint is
// protected by a shared secret token in the URL query param `token`, compared
// in constant time inside the core. If APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN is not
// configured, the core returns 401 (fail-closed) and nothing is processed.
//
// This route never creates an official contact, never approves a candidate,
// never writes HubSpot, never touches Lusha, and never prints the raw body or
// any phone / email / name / linkedin. The whole reveal path stays gated behind
// ENABLE_APOLLO_PHONE_REVEAL, which is OFF in every environment.
//
// Webhook validation handshake (APOLLO-PHONE-ASYNC-9): Apollo may prevalidate
// `webhook_url` before accepting the async reveal (verb/expectation undocumented)
// — a non-2xx probe (405/400/401) would make Apollo reject the reveal with HTTP
// 422. To stay validation-safe this route also answers GET / HEAD / OPTIONS and
// a POST "ping" (valid token but no request_id) with a 2xx, but ONLY when the
// shared token is valid: without a valid token nothing returns 2xx. Those
// validation responses touch no Supabase, make no Apollo call, write nothing and
// leak no secret.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isApolloPhoneCacheEnabled,
  isPhoneRevealWaterfallEnabled,
} from '@/lib/feature-flags.server';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  readPhoneCacheSuppression,
  writePhoneCacheEntry,
} from '@/modules/contact-enrichment/phone-cache-store';
import { persistCandidatePhoneCollection } from '@/modules/contact-enrichment/candidate-phone-collection-persistence';
import { persistTerminalPhoneSuppression } from '@/modules/contact-enrichment/candidate-phone-suppression-persistence';
import {
  continuePhoneRevealWaterfallForCandidate,
  resolveActiveWaterfallRunId,
} from '@/modules/contact-enrichment/phone-reveal-waterfall-deps';
import {
  runApolloPhoneRevealWebhook,
  isApolloWebhookTokenAuthorized,
  extractWebhookRequestId,
  type ApolloPhoneRevealWebhookPayload,
  type WebhookCandidateRecord,
  type WebhookRevealPersistencePatch,
  type WebhookUsageLogEntry,
} from '@/modules/contact-enrichment/phone-reveal-webhook-core';
import { PHONE_REVEAL_OPERATION_KEY } from '@/modules/contact-enrichment/phone-reveal-core';
import type { ContactCandidateEnrichmentMetadata } from '@/modules/contact-enrichment/types';

/** Nombre de la env con la URL pública del webhook (solo referencia). */
export const APOLLO_PHONE_REVEAL_WEBHOOK_URL_ENV = 'APOLLO_PHONE_REVEAL_WEBHOOK_URL';
/** Nombre de la env con el token secreto del webhook. */
export const APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN_ENV = 'APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN';

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// `country` + `run.company_country_code` alimentan el alcance de la caché
// (APOLLO-PHONE-CACHE-1b). Se leen siempre; con el flag de caché apagado no se
// usan para nada y el webhook se comporta exactamente igual que antes.
// `apollo_person_id` / `source` / `source_contact_id` alimentan la comprobación de
// SUPRESIÓN en vuelo (FIX 3) cuando el payload del webhook no trae `person.id`.
// Son ids opacos de correlación, NO PII, y se leen SIEMPRE: la supresión no
// depende de ENABLE_APOLLO_PHONE_CACHE.
const WEBHOOK_CANDIDATE_SELECT =
  'id, enrichment_metadata, phone_reveal_status, country, apollo_person_id, source, source_contact_id, run:contact_enrichment_runs ( account_id, company_country_code )';

function mapWebhookCandidate(row: Record<string, unknown>): WebhookCandidateRecord {
  const runRaw = row.run;
  const run = (Array.isArray(runRaw) ? runRaw[0] : runRaw) as
    | { account_id: string | null; company_country_code: string | null }
    | null
    | undefined;
  return {
    id: row.id as string,
    accountId: run?.account_id ?? null,
    enrichmentMetadata:
      (row.enrichment_metadata as ContactCandidateEnrichmentMetadata) ?? {},
    phoneRevealStatus: (row.phone_reveal_status as string | null) ?? null,
    candidateCountry: (row.country as string | null) ?? null,
    runCompanyCountryCode: run?.company_country_code ?? null,
    apolloPersonId: (row.apollo_person_id as string | null) ?? null,
    source: (row.source as string | null) ?? null,
    sourceContactId: (row.source_contact_id as string | null) ?? null,
  };
}

/** Extrae el token del query param `token` (o el header equivalente). */
function extractToken(request: NextRequest): string | null {
  const fromQuery = request.nextUrl.searchParams.get('token');
  if (typeof fromQuery === 'string' && fromQuery.trim()) return fromQuery;
  const fromHeader = request.headers.get('x-apollo-webhook-token');
  if (typeof fromHeader === 'string' && fromHeader.trim()) return fromHeader;
  return null;
}

/** Extrae el ref opaco de correlación del query param `ref` (ASYNC-21). */
function extractRef(request: NextRequest): string | null {
  const fromQuery = request.nextUrl.searchParams.get('ref');
  return typeof fromQuery === 'string' && fromQuery.trim() ? fromQuery.trim() : null;
}

/** ¿La petición trae un token válido? (mismo gate para GET/HEAD/OPTIONS/POST). */
function isRequestAuthorized(request: NextRequest): boolean {
  const expectedToken = process.env[APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN_ENV] ?? null;
  return isApolloWebhookTokenAuthorized(extractToken(request), expectedToken);
}

// ── Handshake de validación de webhook ─────────────────────────
//
// Apollo puede prevalidar `webhook_url` antes de aceptar el reveal (sin
// documentar método ni verbo). Si la URL respondiera no-2xx (405/400/401),
// Apollo rechazaría el reveal con HTTP 422. Para evitarlo, respondemos 2xx a
// GET/HEAD/OPTIONS y a POST-ping SOLO cuando el token es válido: sin token no
// hay 2xx. Estos handlers NO tocan Supabase, NO llaman a Apollo, NO escriben,
// NO loguean y NO exponen secretos.

/** GET con token válido → 200 JSON seguro; sin token → 401. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isRequestAuthorized(request)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json(
    { ok: true, purpose: 'apollo_phone_reveal_webhook_validation' },
    { status: 200 },
  );
}

/** HEAD con token válido → 200 sin body; sin token → 401. */
export async function HEAD(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: isRequestAuthorized(request) ? 200 : 401,
  });
}

/** OPTIONS con token válido → 204; sin token → 401. */
export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: isRequestAuthorized(request) ? 204 : 401,
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const nowIso = new Date().toISOString();
  const expectedToken = process.env[APOLLO_PHONE_REVEAL_WEBHOOK_TOKEN_ENV] ?? null;
  const tokenProvided = extractToken(request);
  const ref = extractRef(request);

  // Body: se parsea sin loguearlo jamás. Un JSON inválido queda como payload null.
  let payload: ApolloPhoneRevealWebhookPayload | null = null;
  try {
    const text = await request.text();
    if (text) payload = JSON.parse(text) as ApolloPhoneRevealWebhookPayload;
  } catch {
    payload = null;
  }

  // Token inválido/ausente → 401 (fail-closed, sin tocar Supabase).
  if (!isApolloWebhookTokenAuthorized(tokenProvided, expectedToken)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Ping de validación: token válido pero SIN request_id NI ref (body vacío o
  // callback sin señal de correlación) → 200 no-op. SIN Supabase, SIN escrituras,
  // SIN logs. Con ref presente se procesa abajo (correlación robusta ASYNC-21).
  if (!extractWebhookRequestId(payload) && !ref) {
    return NextResponse.json({ ok: true, status: 'validation_ack' }, { status: 200 });
  }

  const admin = getAdminClient();
  if (!admin) {
    // No confirmamos si el token es válido: fail-closed genérico.
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const result = await runApolloPhoneRevealWebhook(
    { tokenProvided, payload, ref },
    {
      expectedToken,
      nowIso,
      loadCandidateByRequestId: async (
        requestId,
      ): Promise<WebhookCandidateRecord | null> => {
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select(WEBHOOK_CANDIDATE_SELECT)
          .eq('phone_reveal_request_id', requestId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapWebhookCandidate(data as Record<string, unknown>) : null;
      },
      // Correlación robusta por ref opaco (ASYNC-21): resuelve el candidato desde
      // el start log guardado en provider_usage_logs (metadata segura, sin PII).
      // Sólo los logs del START tienen `apollo_trace.webhook_ref`, así que este
      // filtro nunca colisiona con el log del propio webhook.
      loadCandidateByWebhookRef: async (
        webhookRef,
      ): Promise<WebhookCandidateRecord | null> => {
        const { data: startLog, error: logError } = await admin
          .from('provider_usage_logs')
          .select('metadata')
          .eq('operation_key', PHONE_REVEAL_OPERATION_KEY)
          .eq('metadata->apollo_trace->>webhook_ref', webhookRef)
          .limit(1)
          .maybeSingle();
        if (logError) throw new Error(logError.message);
        const meta = (startLog?.metadata as Record<string, unknown> | null) ?? null;
        const candidateId =
          meta && typeof meta.candidate_id === 'string' ? meta.candidate_id : null;
        if (!candidateId) return null;
        const { data, error } = await admin
          .from('contact_enrichment_candidates')
          .select(WEBHOOK_CANDIDATE_SELECT)
          .eq('id', candidateId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data ? mapWebhookCandidate(data as Record<string, unknown>) : null;
      },
      persist: async (
        candidateId,
        patch: WebhookRevealPersistencePatch,
      ): Promise<void> => {
        const update: Record<string, unknown> = {
          phone_reveal_status: patch.phone_reveal_status,
          phone_reveal_completed_at: patch.phone_reveal_completed_at,
          phone_reveal_webhook_received_at: patch.phone_reveal_webhook_received_at,
          phone_reveal_provider: patch.phone_reveal_provider,
          phone_reveal_cost_credits: patch.phone_reveal_cost_credits,
          // Procedencia de la cifra anterior (AGENT2A-PHONE-REVEAL-4N § 6). Se escribe
          // siempre: dejarla en null junto a un costo desconocido era indistinguible de
          // "nadie lo ha mirado".
          phone_reveal_cost_source: patch.phone_reveal_cost_source,
          phone_reveal_error_code: patch.phone_reveal_error_code,
        };
        // Solo el camino `revealed` la emite, y por eso solo ahí se escribe: un
        // no_phone_found no puede sobrescribir la fecha de un reveal anterior con null.
        if (patch.phone_revealed_at !== undefined) {
          update.phone_revealed_at = patch.phone_revealed_at;
        }
        if (patch.phone !== undefined) update.phone = patch.phone;
        if (patch.enrichment_metadata !== undefined) {
          update.enrichment_metadata = patch.enrichment_metadata;
        }
        // Apollo person id (APOLLO-PHONE-CACHE-1a): sólo se escribe cuando el core
        // extrajo un id Apollo válido del payload. Nunca fuerza ni sobrescribe con
        // null/inválido.
        if (patch.apollo_person_id) {
          update.apollo_person_id = patch.apollo_person_id;
        }
        const { error } = await admin
          .from('contact_enrichment_candidates')
          .update(update)
          .eq('id', candidateId);
        if (error) throw new Error(error.message);
      },
      logUsage: async (entry: WebhookUsageLogEntry): Promise<void> => {
        await logProviderUsage({
          provider_key: entry.provider,
          operation_key: entry.operationKey,
          credits_used: entry.creditsUsed ?? undefined,
          status: entry.status,
          // FIX 3: código mecánico del bloqueo / de la comprobación no verificable.
          error_code: entry.errorCode ?? undefined,
          results_returned: entry.metadata.phone_revealed ? 1 : 0,
          metadata: entry.metadata,
        });
      },
      // Caché del reveal (APOLLO-PHONE-CACHE-1b). El flag se evalúa aquí y se
      // pasa al store: con ENABLE_APOLLO_PHONE_CACHE apagado (default de
      // producción) `writePhoneCacheEntry` sale inmediatamente sin leer ni
      // escribir nada. Nunca lanza: la caché no puede romper el webhook.
      cacheRevealedPhone: async (cacheInput) =>
        writePhoneCacheEntry(cacheInput, isApolloPhoneCacheEnabled()),
      // Colección COMPLETA de teléfonos (AGENT2A-PHONE-REVEAL-4O-C). Se cablea
      // SIN flag y SIN condicionarla al de caché: no es una optimización que se
      // pueda apagar, es la única forma de que los números que Apollo ya entregó
      // —y que la operadora ya pagó— dejen de perderse al escribir. El flag de
      // caché gobierna la REUTILIZACIÓN de un teléfono; esto es la CAPTURA.
      //
      // A diferencia de la caché NO es best-effort: si lanza, el core no cierra
      // el reveal y el candidato queda recuperable con 0 créditos.
      persistCandidatePhoneCollection,
      // Cierre terminal por supresión (AGENT2A-PHONE-REVEAL-4O-E1). Se cablea SIN
      // flag, igual que la captura: cuando la transacción responde `suppressed` el
      // resultado NUNCA va a poder persistirse, así que dejar el candidato en vuelo no
      // lo hacía «recuperable» sino permanentemente pendiente — con la corrida activa
      // y su reserva sin liquidar pese a que Apollo ya había cobrado.
      //
      // La escritura es CONDICIONAL sobre el estado en vuelo, así que un `revealed`
      // que llegue por otra vía en el intervalo sobrevive intacto.
      persistTerminalSuppression: persistTerminalPhoneSuppression,
      // Supresión en vuelo (FIX 3). Se cablea SIN condicionar al flag de caché: una
      // DSAR registrada mientras el reveal estaba en curso tiene que bloquear la
      // persistencia tardía del teléfono con la caché encendida o apagada. La
      // lectura pide solo `suppressed_at`, así que con el flag apagado el webhook
      // comprueba la supresión SIN leer ningún número. Si LANZA, el core no
      // persiste teléfono (fail-closed).
      lookupPhoneCacheSuppression: readPhoneCacheSuppression,
      // Mensaje ya redactado por el core: nunca teléfono/person id/email/nombre.
      onSuppressionCheckUnavailable: (message) => {
        console.error(
          '[phone-reveal-webhook] suppression check unavailable:',
          message,
        );
      },
      // FIX 4: la comprobación no se pudo EVALUAR (sin person id resoluble o sin
      // cuenta). No se empareja por otros datos ni se rellena el id que falta; el
      // caso se registra con un evento de forma cerrada y sin PII.
      onSuppressionNotEvaluable: (event) => {
        console.warn(
          '[phone-reveal-webhook] suppression not evaluable:',
          event,
        );
      },
      // Waterfall Apollo → Lusha (AGENT2A-PHONE-WATERFALL-1). Las DOS deps se
      // cablean SOLO con ENABLE_PHONE_REVEAL_WATERFALL encendido: con el flag
      // apagado llegan ausentes y el core no resuelve corrida, no añade la clave a
      // la metadata y no continúa nada — el webhook queda igual que antes del hito.
      //
      // Ambas son best-effort DENTRO del core: correlacionar y continuar son
      // deseables, pero un fallo suyo no puede convertir este callback en 5xx (eso
      // haría a Apollo reintentar sin resolver nada) ni perder un teléfono pagado.
      // La garantía de UNA sola llamada a Lusha es el claim atómico, no este caller.
      ...(isPhoneRevealWaterfallEnabled()
        ? {
            resolveWaterfallRunId: resolveActiveWaterfallRunId,
            continueWaterfall: continuePhoneRevealWaterfallForCandidate,
          }
        : {}),
    },
  );

  return NextResponse.json({ ok: result.httpStatus < 400 }, { status: result.httpStatus });
}
