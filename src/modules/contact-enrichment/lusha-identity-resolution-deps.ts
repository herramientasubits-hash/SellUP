// Agente 2A — Resolución de la identidad nativa de Lusha: dependencias REALES
// (AGENT2A-CROSS-PROVIDER-PHONE-IDENTITY-RESOLUTION-1)
//
// Cableado server-only del core puro (lusha-identity-resolution-runtime-core.ts). Sigue
// exactamente la convención de phone-reveal-waterfall-deps.ts: este módulo NO decide
// NADA. No elige la query, no interpreta la respuesta, no decide si el reveal puede
// continuar y no decide si hace falta pagar. Sólo provee I/O:
//
//   Supabase service-role (candidato, identidades, claim, persistencia, sello)
//   + la ÚNICA llamada a `POST /v3/contacts/search`
//   + la fila de `provider_usage_logs` que la declara.
//
// NO es 'use server': exporta builders sincrónicos además de acciones async. Es
// server-only por sus imports (admin client + API key de Lusha) y nunca se importa
// desde un componente cliente.
//
// ── AUTORIDADES REUTILIZADAS, NO REIMPLEMENTADAS ─────────────────────────────
//
// No hay un segundo cliente de Lusha aquí. La llamada usa las MISMAS autoridades que
// el resto del repositorio:
//
//   * `getLushaApiKey()`            — credencial desde Vault, nunca desde env
//   * `resolveLushaSearchTimeoutMs()` — el timeout canónico de búsqueda
//   * `searchLushaContactsV3()`     — el cliente ya validado en vivo (17B.4C/4D), que
//     además ya omite emails y teléfonos de su proyección: la búsqueda de identidad no
//     revela nada, y eso lo garantiza el cliente, no un cuidado nuestro.
//
// ── FLAG ─────────────────────────────────────────────────────────────────────
//
// Nada de este módulo se invoca con `ENABLE_PHONE_REVEAL_WATERFALL` apagado. Quien lo
// garantiza es el punto de cableado (`buildContinueWaterfallDeps`), que sólo añade la
// dep cuando el flag está encendido. Con el flag apagado no se lee
// `contact_provider_identities`, no se lee `operation_key`, no se invoca
// `claim_lusha_identity_search` y no se emite ninguna petición: el código queda
// DESPLEGADO E INERTE, que es lo que permite que la migración 124 se aplique después.
//
// ── PII ──────────────────────────────────────────────────────────────────────
//
// Contrato heredado del core y verificado por su suite: no se imprime ni se registra
// teléfono, email, URL de LinkedIn, nombre, nombre de empresa, el contactId de Lusha ni
// el personId de Apollo. Al ledger sólo viajan códigos mecánicos, ids opacos de
// correlación PROPIOS y cifras.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { resolveLushaSearchTimeoutMs } from '@/lib/feature-flags.server';
import { getLushaApiKey } from '@/server/services/lusha-connection';
import { searchLushaContactsV3 } from '@/server/integrations/lusha-client';
import { logProviderUsage } from '@/modules/usage-tracking/logging';
import {
  resolveLushaIdentityForWaterfall,
  resolutionSourceForMatchKey,
  type LushaIdentityPersistResult,
  type LushaIdentitySearchClaimResult,
  type LushaIdentitySearchPreflightResult,
  type LushaIdentitySearchProviderResponse,
  type LushaIdentitySearchRunOutcome,
  type ResolveLushaIdentityResult,
} from './lusha-identity-resolution-runtime-core';
import {
  parseProviderContactIdentityResolutionSource,
  type ProviderContactIdentityRecord,
} from './provider-contact-identity-core';
import type {
  LushaIdentitySearchCandidateFacts,
  LushaIdentitySearchMatchKey,
  LushaIdentitySearchResultItem,
} from './lusha-identity-search-core';
import { buildLushaIdentitySearchUsageLog } from './phone-reveal-usage-log-core';

// ── Nombres de esquema (migración 124) ─────────────────────────

export const CONTACT_PROVIDER_IDENTITIES_TABLE = 'contact_provider_identities';
export const LUSHA_IDENTITY_SEARCH_CLAIM_FN = 'claim_lusha_identity_search';
export const PERSIST_CONTACT_PROVIDER_IDENTITY_FN = 'persist_contact_provider_identity';

const PHONE_REVEAL_WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

/**
 * Columnas del candidato con las que se puede construir UNA búsqueda. `first_name`,
 * `last_name`, `linkedin_url` y `email` son de la migración 068 —existen desde siempre—
 * y el ancla de empresa se lee del run del candidato, que es donde vive
 * (`contact_enrichment_runs.company_name` es NOT NULL desde 068).
 *
 * Ninguno de estos valores se registra en ningún log: sólo alimentan la decisión pura
 * de qué identificador se le manda al proveedor.
 */
export const IDENTITY_SEARCH_CANDIDATE_SELECT = `id, source, source_contact_id,
   first_name, last_name, linkedin_url, email,
   run:contact_enrichment_runs ( company_name, company_domain )`;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Mensaje MECÁNICO del driver, recortado. Nunca el payload ni un dato del candidato. */
function redactDriverMessage(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : 'unknown error';
}

/**
 * PostgREST devuelve un embed `to-one` como objeto, pero según la relación inferida
 * puede llegar como array de un elemento. Se normalizan las dos formas en vez de
 * asumir una: asumir la equivocada deja el ancla de empresa en null, y sin ancla un
 * candidato con nombre y apellido deja de ser buscable.
 */
function firstEmbedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const head = value[0];
    return head && typeof head === 'object' ? (head as Record<string, unknown>) : null;
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

// ── Lectura del contexto de resolución ─────────────────────────

/** Todo lo que el core necesita para decidir, leído en DOS consultas y ninguna más. */
export interface LushaIdentityResolutionContext {
  candidateId: string;
  candidateSource: string | null;
  candidateSourceContactId: string | null;
  identities: readonly ProviderContactIdentityRecord[];
  facts: LushaIdentitySearchCandidateFacts;
}

/**
 * Identidades provider-native YA persistidas para un candidato.
 *
 * Una fila con `resolution_source` fuera del vocabulario se DESCARTA en vez de
 * castearse: llegaría a la auditoría como una procedencia que el contrato no reconoce,
 * y la procedencia es precisamente lo que distingue «nació aquí» (0 créditos) de «lo
 * compramos» (1). Un `provider_key` desconocido se descarta por la misma razón.
 *
 * Un fallo de lectura LANZA. No devuelve `[]`: un `[]` inventado significaría «Lusha no
 * conoce a esta persona» y llevaría a pagar una búsqueda que quizá no hacía falta.
 */
export async function loadCandidateProviderIdentities(
  candidateId: string,
): Promise<readonly ProviderContactIdentityRecord[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(CONTACT_PROVIDER_IDENTITIES_TABLE)
    .select('candidate_id, provider_key, provider_contact_id, resolution_source')
    .eq('candidate_id', candidateId);
  if (error) throw new Error(error.message);

  const rows = Array.isArray(data) ? data : [];
  return rows.flatMap((row) => {
    const entry = row as Record<string, unknown>;
    const providerKey = cleanText(entry.provider_key);
    const providerContactId = cleanText(entry.provider_contact_id);
    const resolutionSource = parseProviderContactIdentityResolutionSource(
      entry.resolution_source,
    );
    if (providerKey !== 'apollo' && providerKey !== 'lusha') return [];
    if (!providerContactId || !resolutionSource) return [];
    return [
      {
        candidateId,
        providerKey,
        providerContactId,
        resolutionSource,
      } satisfies ProviderContactIdentityRecord,
    ];
  });
}

/**
 * Hechos del candidato + identidades persistidas. `null` cuando el candidato no existe.
 *
 * Un fallo de lectura LANZA por la misma razón que arriba: el llamador lo traduce a un
 * desenlace fail-closed explícito, que es mejor que una lectura vacía disfrazada de
 * hecho.
 */
export async function loadLushaIdentityResolutionContext(
  candidateId: string,
): Promise<LushaIdentityResolutionContext | null> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('contact_enrichment_candidates')
    .select(IDENTITY_SEARCH_CANDIDATE_SELECT)
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const run = firstEmbedded(row.run);
  const identities = await loadCandidateProviderIdentities(candidateId);

  return {
    candidateId,
    candidateSource: cleanText(row.source),
    candidateSourceContactId: cleanText(row.source_contact_id),
    identities,
    facts: {
      firstName: cleanText(row.first_name),
      lastName: cleanText(row.last_name),
      linkedinUrl: cleanText(row.linkedin_url),
      email: cleanText(row.email),
      companyName: run ? cleanText(run.company_name) : null,
      companyDomain: run ? cleanText(run.company_domain) : null,
    },
  };
}

/**
 * Correlación económica de la corrida: a qué autorización pertenece esta búsqueda y
 * quién la autorizó. Se lee con su PROPIO select mínimo en vez de reutilizar el del
 * waterfall para no crear un ciclo de imports entre los dos módulos de deps.
 */
export interface LushaIdentityRunCorrelation {
  reservationGroupId: string | null;
  authorizedBy: string | null;
}

export async function loadIdentitySearchRunCorrelation(
  runId: string,
): Promise<LushaIdentityRunCorrelation> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
      .select('credit_reservation_group_id, authorized_by')
      .eq('id', runId)
      .maybeSingle();
    if (error || !data) return { reservationGroupId: null, authorizedBy: null };
    const row = data as Record<string, unknown>;
    return {
      reservationGroupId: cleanText(row.credit_reservation_group_id),
      authorizedBy: cleanText(row.authorized_by),
    };
  } catch (err) {
    // La correlación es para la CONTABILIDAD, no para la decisión: si no se puede
    // leer, la fila de usage sale sin ella antes que no salir.
    console.error(
      '[lusha-identity] run correlation read failed:',
      redactDriverMessage(err),
    );
    return { reservationGroupId: null, authorizedBy: null };
  }
}

// ── Claim atómico de la búsqueda ───────────────────────────────

const CLAIM_RESULTS: readonly LushaIdentitySearchClaimResult[] = [
  'claimed',
  'already_claimed',
  'run_not_found',
  'run_terminal',
  'authorization_expired',
];

/**
 * `claim_lusha_identity_search` (migración 124). Devuelve TEXT, no boolean, así que
 * «otro lo tiene» y «la autorización venció» no se colapsan en un mismo false.
 *
 * FAIL-CLOSED en el borde de I/O: cualquier fallo —función ausente porque la 124 no
 * está aplicada, timeout, credenciales— se traduce a `run_not_found`, que NO reclama
 * nada y por tanto NO emite ninguna petición pagada. Un fallo de infraestructura jamás
 * se lee como permiso para gastar.
 */
export async function claimLushaIdentitySearch(
  runId: string,
): Promise<LushaIdentitySearchClaimResult> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(LUSHA_IDENTITY_SEARCH_CLAIM_FN, {
      p_run_id: runId,
    });
    if (error) {
      console.error(
        '[lusha-identity] identity search claim failed:',
        error.message.slice(0, 200),
      );
      return 'run_not_found';
    }
    const value = cleanText(data);
    return CLAIM_RESULTS.includes(value as LushaIdentitySearchClaimResult)
      ? (value as LushaIdentitySearchClaimResult)
      : 'run_not_found';
  } catch (err) {
    console.error(
      '[lusha-identity] identity search claim threw:',
      redactDriverMessage(err),
    );
    return 'run_not_found';
  }
}

// ── Persistencia write-once de la identidad ────────────────────

/**
 * `persist_contact_provider_identity` (migración 124). Write-once por índice único
 * `(candidate_id, provider_key)`: `inserted` y `already_present` son AMBOS durables, y
 * el segundo devuelve el id del GANADOR — que es el que hay que revelar.
 *
 * Todo lo demás (`invalid_input`, `candidate_not_found`, error del driver, excepción)
 * es `failed`, y el core lo convierte en «no hay reveal». No se recorta ni se
 * reinterpreta: si no podemos afirmar que existe una fila, no existe.
 */
export async function persistContactProviderIdentity(args: {
  candidateId: string;
  runId: string;
  providerContactId: string;
  matchKey: LushaIdentitySearchMatchKey;
}): Promise<LushaIdentityPersistResult> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc(PERSIST_CONTACT_PROVIDER_IDENTITY_FN, {
      p_candidate_id: args.candidateId,
      p_provider_key: 'lusha',
      p_provider_contact_id: args.providerContactId,
      p_resolution_source: resolutionSourceForMatchKey(args.matchKey),
      p_resolved_run_id: args.runId,
    });
    if (error) {
      console.error(
        '[lusha-identity] identity persistence failed:',
        error.message.slice(0, 200),
      );
      return { status: 'failed' };
    }

    const envelope = (data ?? {}) as Record<string, unknown>;
    const status = cleanText(envelope.status);
    if (status === 'inserted') {
      return { status: 'persisted', providerContactId: args.providerContactId };
    }
    if (status === 'already_present') {
      // El ganador manda. Si por cualquier razón no devolvió su id, NO se asume que sea
      // el nuestro: sin id que podamos afirmar almacenado, esto es `failed`.
      const winner = cleanText(envelope.provider_contact_id);
      return winner
        ? { status: 'persisted', providerContactId: winner }
        : { status: 'failed' };
    }
    // `invalid_input` | `candidate_not_found` | cualquier envelope inesperado.
    console.error('[lusha-identity] identity not persisted, status:', status ?? 'unreadable');
    return { status: 'failed' };
  } catch (err) {
    console.error(
      '[lusha-identity] identity persistence threw:',
      redactDriverMessage(err),
    );
    return { status: 'failed' };
  }
}

// ── Sello del desenlace en la corrida ──────────────────────────

/**
 * Sella `lusha_identity_search_outcome`. BEST-EFFORT: el cierre de la corrida no puede
 * depender de un sello de auditoría.
 *
 * `creditsCharged` NO se escribe aquí porque la migración 124 deliberadamente NO crea
 * una columna de costo para esta pata: su costo ya tiene dos hogares autoritativos —la
 * fila de reserva (`credits_confirmed` + `cost_truth`) y la de `provider_usage_logs`
 * con `operation_key='lusha_contact_search'`— y una tercera copia sólo podría
 * contradecirlos. Se recibe en la firma porque el core la reporta; se usa en el ledger.
 */
export async function recordLushaIdentitySearchOutcome(args: {
  runId: string;
  outcome: LushaIdentitySearchRunOutcome;
  creditsCharged: number | null;
}): Promise<void> {
  void args.creditsCharged;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from(PHONE_REVEAL_WATERFALL_RUNS_TABLE)
      .update({
        lusha_identity_search_outcome: args.outcome,
        updated_at: new Date().toISOString(),
      })
      .eq('id', args.runId);
    if (error) {
      console.error(
        '[lusha-identity] outcome seal failed:',
        error.message.slice(0, 200),
      );
    }
  } catch (err) {
    console.error('[lusha-identity] outcome seal threw:', redactDriverMessage(err));
  }
}

// ── La ÚNICA petición ──────────────────────────────────────────

/** Telemetría de la petición, para el ledger. Ningún campo es un dato personal. */
interface IdentitySearchTelemetry {
  matchKey: LushaIdentitySearchMatchKey;
  durationMs: number;
  resultsReturned: number;
  providerRequestId: string | null;
}

/**
 * Traduce el desenlace del cliente canónico al vocabulario del core.
 *
 * `insufficient_credits`, `provider_auth_error`, `feature_unavailable`,
 * `rate_limited` y `compliance_blocked` son TODOS `provider_error`: ninguno afirma que
 * Lusha no conozca a la persona, y tratarlos como `no_results` escribiría un
 * `not_found` que nadie comprobó.
 */
function mapSearchStatusToCoreOutcome(
  result: Awaited<ReturnType<typeof searchLushaContactsV3>>,
): LushaIdentitySearchProviderResponse['outcome'] {
  if (result.status === 'provider_timeout') return { status: 'provider_timeout' };
  if (result.status === 'no_results') return { status: 'no_results' };
  if (result.status !== 'success') return { status: 'provider_error' };

  const sanitized = result.sanitizedResults;
  if (!Array.isArray(sanitized)) return { status: 'unreadable' };

  // Sólo id + anclas de empresa. `fullName`, `title` y `linkedinUrl` SÍ vienen del
  // cliente y se descartan aquí a propósito: el core no los necesita para decidir, y
  // lo que no se propaga no se puede filtrar por accidente.
  const results: LushaIdentitySearchResultItem[] = sanitized.map((item) => ({
    id: item.id ?? null,
    companyName: item.companyName ?? null,
    companyDomain: item.companyDomain ?? null,
  }));
  return { status: 'success', results };
}

// ── Punto de entrada: la dep del waterfall ─────────────────────

/**
 * Resuelve la identidad nativa de Lusha para un candidato de una corrida viva. Es la
 * función que `buildContinueWaterfallDeps` cablea como `resolveLushaIdentity`.
 *
 * La SECUENCIA la decide el core; aquí sólo se le dan los medios y se registra lo que
 * pasó. El orden observable es:
 *
 *   candidato + identidades → (core) ¿ya lo sabemos? → ¿hay con qué buscar? →
 *   claim → UNA petición → evaluación → persistencia OBLIGATORIA → id nativo
 *
 * La fila de `provider_usage_logs` se emite DESPUÉS de que el core decida, y sólo si se
 * emitió la petición: es el único momento en que se conocen a la vez los hechos del
 * proveedor (duración, resultados, créditos) y el desenlace (`resolved`, `ambiguous`,
 * `resolved_not_persisted`…). Emitirla antes obligaría a inventar el desenlace.
 *
 * NUNCA lanza: un fallo aquí se traduce a un desenlace fail-closed, porque una
 * excepción subiendo hasta el webhook lo convertiría en 5xx y provocaría reintentos de
 * Apollo que no arreglan nada.
 */
export async function resolveLushaIdentityForCandidate(args: {
  candidateId: string;
  runId: string;
}): Promise<ResolveLushaIdentityResult> {
  let context: LushaIdentityResolutionContext | null;
  try {
    context = await loadLushaIdentityResolutionContext(args.candidateId);
  } catch (err) {
    // No se pudo leer si Lusha ya conocía a esta persona. Buscar ahora sería arriesgar
    // pagar por algo que ya teníamos, así que se bloquea sin llamar a nadie.
    console.error(
      '[lusha-identity] resolution context read failed:',
      redactDriverMessage(err),
    );
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
      searched: false,
      searchCreditsCharged: null,
    };
  }

  if (!context) {
    return {
      status: 'blocked',
      skippedReason: 'lusha_identity_error',
      runOutcome: 'error',
      searched: false,
      searchCreditsCharged: null,
    };
  }

  let telemetry: IdentitySearchTelemetry | null = null;
  /**
   * Credencial de Lusha, retenida entre el preflight y la ÚNICA petición.
   *
   * Es deliberadamente una variable LOCAL de esta invocación y no un módulo-caché: una
   * credencial cacheada entre corridas sobreviviría a su propia rotación, y este valor
   * no tiene por qué durar más que la petición que lo necesita. No se registra, no se
   * devuelve y no cruza a ningún core.
   */
  let resolvedApiKey: string | null = null;

  const result = await resolveLushaIdentityForWaterfall(
    {
      candidateId: context.candidateId,
      runId: args.runId,
      candidateSource: context.candidateSource,
      candidateSourceContactId: context.candidateSourceContactId,
      identities: context.identities,
      facts: context.facts,
    },
    {
      // ── PREFLIGHT: la credencial se resuelve ANTES del claim (PR331-R3) ─────
      //
      // La credencial NO sale de este closure: no viaja al core, no entra en la
      // telemetría, no se registra. Lo que cruza la frontera es un veredicto.
      //
      // El closure vive UNA invocación de `resolveLushaIdentityForCandidate`, así que
      // el valor retenido no sobrevive a la corrida ni se comparte entre corridas.
      preflightSearch: async (): Promise<LushaIdentitySearchPreflightResult> => {
        try {
          const apiKey = await getLushaApiKey();
          if (!apiKey) {
            // Sin credencial no hay `fetch` y por tanto no hay cobro. Al devolverlo
            // como preflight —y no como error del proveedor— el core sale SIN tomar el
            // claim, y la reserva de la búsqueda se libera en vez de confirmarse al
            // tope por una petición que nunca salió.
            console.error('[lusha-identity] no Lusha credential available');
            return { status: 'unavailable', reason: 'no_credential' };
          }
          resolvedApiKey = apiKey;
          return { status: 'ready' };
        } catch (err) {
          // El mensaje del driver se recorta y NUNCA incluye la credencial: lo que se
          // registra es el fallo mecánico de resolverla.
          console.error(
            '[lusha-identity] Lusha credential resolution failed:',
            redactDriverMessage(err),
          );
          return { status: 'unavailable', reason: 'preflight_failed' };
        }
      },

      claimIdentitySearch: claimLushaIdentitySearch,

      searchIdentity: async ({ matchKey, contact }) => {
        const startedAt = Date.now();
        const apiKey = resolvedApiKey;
        if (!apiKey) {
          // INALCANZABLE por contrato: el core no llega aquí sin un preflight `ready`,
          // y `ready` sólo se devuelve con la credencial ya retenida. Se conserva como
          // red de seguridad y se declara CONSERVADORAMENTE como error del proveedor:
          // si el contrato se rompiera, el claim ya estaría tomado, y en ese estado
          // asumir «no costó nada» sería la suposición cara.
          console.error('[lusha-identity] preflight contract violated: no credential');
          return { outcome: { status: 'provider_error' }, creditsCharged: null };
        }

        const response = await searchLushaContactsV3({
          apiKey,
          timeoutMs: resolveLushaSearchTimeoutMs(),
          // UN solo item: una petición, un candidato. El core ya eligió el mejor
          // identificador disponible y aquí no se añade ninguno más.
          contacts: [contact],
        });

        telemetry = {
          matchKey,
          durationMs: Date.now() - startedAt,
          resultsReturned: response.resultsReturned,
          providerRequestId: cleanText(response.requestId),
        };

        return {
          outcome: mapSearchStatusToCoreOutcome(response),
          // `creditsCharged` viaja TAL CUAL. `undefined` y `null` colapsan a null, que
          // significa «no lo reportó» — y no reportar no es no cobrar: la liquidación
          // lo confirma al tope con `assumed_cap`.
          creditsCharged:
            typeof response.creditsCharged === 'number' ? response.creditsCharged : null,
        };
      },

      persistIdentity: (persistArgs) => persistContactProviderIdentity(persistArgs),
    },
  );

  // Ledger: sólo si esta invocación EMITIÓ la petición. Un `reused_persisted` o un
  // `no_identifier` no llamaron a nadie, así que una fila de usage afirmaría un gasto
  // que no existió.
  const searched = result.status !== 'claim_lost' && result.searched;
  if (searched && telemetry) {
    await logIdentitySearchUsageBestEffort({
      runId: args.runId,
      telemetry,
      outcome: result.runOutcome,
      creditsCharged: result.searchCreditsCharged,
    });
  }

  return result;
}

/**
 * Emite la fila de `provider_usage_logs` de la búsqueda. BEST-EFFORT: la contabilidad
 * no puede tumbar la operación, y la exposición reservada sigue cubriendo el gasto
 * incluso si esta fila no llega.
 */
async function logIdentitySearchUsageBestEffort(args: {
  runId: string;
  telemetry: IdentitySearchTelemetry;
  outcome: LushaIdentitySearchRunOutcome;
  creditsCharged: number | null;
}): Promise<void> {
  try {
    const correlation = await loadIdentitySearchRunCorrelation(args.runId);
    await logProviderUsage(
      buildLushaIdentitySearchUsageLog({
        // La correlación con la autorización es el punto de esta fila: sin ella el
        // costo de la búsqueda no se puede sumar al del reveal. Un grupo ilegible se
        // declara como tal en vez de omitir la clave.
        reservationGroupId: correlation.reservationGroupId ?? 'unknown',
        runId: args.runId,
        ...(correlation.authorizedBy ? { triggeredBy: correlation.authorizedBy } : {}),
        matchKey: args.telemetry.matchKey,
        outcome: args.outcome,
        creditsCharged: args.creditsCharged,
        resultsReturned: args.telemetry.resultsReturned,
        durationMs: args.telemetry.durationMs,
        providerRequestId: args.telemetry.providerRequestId,
      }),
    );
  } catch (err) {
    console.error(
      '[lusha-identity] identity search usage log failed:',
      redactDriverMessage(err),
    );
  }
}
