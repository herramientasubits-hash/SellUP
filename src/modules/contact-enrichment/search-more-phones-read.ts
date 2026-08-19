// Agente 2A — «Buscar más números»: LA lectura de preflight
// (AGENT2A-SEARCH-MORE-PHONES-1)
//
// ═══════════════════════════════════════════════════════════════════
// UNA SOLA LECTURA, Y POR QUÉ ESO IMPORTA
// ═══════════════════════════════════════════════════════════════════
//
// Este módulo reúne TODOS los hechos que deciden si una compra puede ocurrir, y devuelve
// además el PLAN que el planificador puro derivó de ellos. Lo consumen los DOS lados:
//
//   * la UI, para saber si pinta el CTA, con qué copy y con qué techo;
//   * la server action, que antes de reservar un solo crédito vuelve a llamar aquí y
//     recomputa el plan.
//
// Que sea la MISMA lectura y el MISMO planificador es la propiedad que se compra. Dos
// implementaciones de la elegibilidad se separarían en la primera corrección, y la primera
// divergencia sería un botón que ofrece una compra que el servidor rechaza — o peor, un
// botón que la ofrece cuando el servidor la ACEPTA y no debería.
//
// ── SÓLO `SELECT` ──────────────────────────────────────────────
//
// Este archivo no tiene un `.insert()`, un `.update()`, un `.delete()` ni un `.rpc()`, y un
// test estático lo verifica leyendo el fichero: la garantía «mirar si se puede buscar no
// gasta nada» no se sostiene en la intención de quien lo escribió, sino en que no exista
// aquí la llamada que gastaría. Tampoco importa el cliente de Lusha, el de Apollo, el
// reservador de créditos ni el logger de uso.
//
// ── POR QUÉ SERVICE ROLE ───────────────────────────────────────
//
// Las tablas de la colección (migración 109) y `phone_reveal_waterfall_runs` (102) tienen
// RLS activa y sólo `service_role` conserva privilegios. El drawer no puede leerlas con el
// cliente de sesión como sí lee el candidato. Mismo patrón que
// `candidate-stored-phones-read.ts` y `phone-reveal-waterfall-actions.ts`: la lectura
// privilegiada vive detrás de una acción que YA autenticó y YA exigió rol. Aquí NO se
// comprueba autorización —eso es trabajo del llamador, y hacerlo en dos sitios invita a que
// uno de los dos se relaje— y por eso este módulo no lleva `'use server'` y no exporta
// ninguna server action: no es invocable desde el navegador.
//
// ── LA PRIVACIDAD SE RESUELVE AQUÍ, DE VERDAD ──────────────────
//
// La lectura llama a `checkPhoneRevealPrivacyGate`, que es la MISMA puerta que corre
// inmediatamente antes de cualquier llamada de teléfono a Lusha. No se aproxima, no se
// hereda de la corrida anterior y no se deja en `unknown`: un veredicto real, o
// `check_unavailable`, que bloquea igual.
//
// Eso significa que la UI recibe una decisión de privacidad AUTORITATIVA. Aun así, la server
// action vuelve a resolverla —dos veces: aquí, y otra vez bajo el lock de la 122— porque
// entre el render y el clic pueden pasar minutos y una DSAR registrada en ese hueco tiene
// que ganar.
//
// ── PRIVACIDAD DE LO QUE SE DEVUELVE ───────────────────────────
//
// NINGÚN número sale de aquí. El conteo de teléfonos vivos es un entero; la procedencia son
// nombres de proveedor; y el id nativo de Lusha NO viaja al resultado — sólo un booleano que
// dice si existe. El servidor lo vuelve a leer cuando le hace falta de verdad. Los `catch`
// imprimen el código de la operación, nunca la fila.

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { checkPhoneRevealPrivacyGate } from './phone-reveal-privacy-gate';
import {
  PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES,
  PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES,
} from './phone-reveal-waterfall-core';
import {
  planSearchMorePhones,
  resolveSearchMoreNativeProviders,
  type SearchMorePlan,
  type SearchMorePrivacyState,
} from './search-more-phones-planner';

export const CANDIDATES_TABLE = 'contact_enrichment_candidates';
export const CANDIDATE_PHONES_TABLE = 'contact_enrichment_candidate_phones';
export const CANDIDATE_PHONE_SOURCES_TABLE =
  'contact_enrichment_candidate_phone_sources';
export const WATERFALL_RUNS_TABLE = 'phone_reveal_waterfall_runs';

/**
 * Columnas del candidato. Lista EXPLÍCITA y no `*`: `select('*')` arrastraría toda columna
 * que una migración futura añada, y la proyección tendría que acordarse de volver a
 * quitarlas. `phone` NO se pide — este módulo no necesita el número para nada, y no pedirlo
 * es lo más barato que se puede hacer con un dato que no se usa.
 */
const CANDIDATE_COLUMNS = 'id, status, source, source_contact_id';

/**
 * Hechos crudos del candidato, ya leídos. Se expone porque la server action los necesita
 * para construir la llamada a Lusha, y volver a leerlos sería una segunda lectura del mismo
 * estado con una ventana de carrera entre las dos.
 */
export interface SearchMorePreflightFacts {
  readonly candidateId: string;
  readonly candidateStatus: string | null;
  readonly source: string | null;
  /**
   * El id nativo. VIAJA dentro del servidor —la llamada a Lusha lo necesita— y NUNCA sale
   * al resultado que ve el navegador.
   */
  readonly sourceContactId: string | null;
  readonly storedUnsuppressedPhoneCount: number;
  readonly providersWithStoredProvenance: readonly string[];
  readonly providersAlreadySearchedForMore: readonly string[];
  readonly hasActivePhoneRun: boolean;
  readonly privacyState: SearchMorePrivacyState;
}

/**
 * El resumen PII-FREE que cruza al navegador. Es deliberadamente más pobre que los hechos:
 * un booleano en vez del id de Lusha, un entero en vez de los números.
 */
export interface SearchMorePreflightSummary {
  readonly candidateId: string;
  /** Cuántos teléfonos DISTINTOS y no suprimidos hay hoy. Decide «Ver más números». */
  readonly storedPhoneCount: number;
  /** ¿La fila declara identidad nativa de Lusha? Nunca el id. */
  readonly hasLushaNativeIdentity: boolean;
  readonly hasActivePhoneRun: boolean;
  /** ¿Lusha ya fue consultada por adicionales en una corrida terminal? */
  readonly lushaAlreadySearched: boolean;
  /** ¿La procedencia de Lusha ya está en la colección? (Lusha ya contestó.) */
  readonly lushaHasStoredProvenance: boolean;
  /** El plan, derivado por el planificador PURO de los hechos de arriba. */
  readonly plan: SearchMorePlan;
}

export interface SearchMorePreflight {
  readonly facts: SearchMorePreflightFacts;
  readonly summary: SearchMorePreflightSummary;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Traduce el veredicto de la puerta de privacidad al vocabulario del planificador.
 *
 * Son dos tipos distintos a propósito: el planificador es PURO y admite `unknown` (el
 * cliente que todavía no lo sabe), y la puerta —que es I/O— nunca produce `unknown`, sólo
 * hechos o `check_unavailable`. Mapear explícitamente hace imposible que un `unknown`
 * fabricado por el servidor se cuele como si fuera un permiso.
 */
function toPlannerPrivacyState(
  gate: Awaited<ReturnType<typeof checkPhoneRevealPrivacyGate>>,
): SearchMorePrivacyState {
  switch (gate) {
    case 'clear':
      return 'clear';
    case 'blocked_suppressed':
      return 'blocked_suppressed';
    case 'do_not_contact':
      return 'do_not_contact';
    case 'check_unavailable':
    default:
      // FAIL-CLOSED en el default: un veredicto que este módulo no reconoce bloquea igual
      // que un tombstone confirmado, y se REGISTRA como lo que es — una lectura que no
      // produjo respuesta, no una supresión que nadie declaró.
      return 'check_unavailable';
  }
}

/**
 * Lee TODO lo que decide la compra y devuelve los hechos + el plan.
 *
 * ORDEN DE LAS LECTURAS: barato→caro, y cada una puede acortar la siguiente. El candidato
 * primero (sin él no hay nada), la colección después, la procedencia sólo si hay teléfonos,
 * las corridas siempre (son el bloqueo más barato de una segunda autorización) y la
 * privacidad AL FINAL: es la más costosa —consulta `contacts` y `provider_suppressions`— y
 * no tiene sentido resolver la supresión de una operación que ya está descartada.
 *
 * LANZA si una lectura falla. No devuelve un preflight degradado: «no pudimos leer» y «no se
 * puede buscar» son hechos distintos, y confundirlos le diría al operador que la operación
 * no aplica cuando lo que ocurrió es que SellUp no pudo mirar. El llamador convierte la
 * excepción en un bloqueo, que es fail-closed igual, pero se registra distinto.
 */
export async function readSearchMorePreflight(args: {
  candidateId: string;
  featureEnabled: boolean;
  actorRoleKey: string | null;
}): Promise<SearchMorePreflight> {
  const admin = createSupabaseAdminClient();
  const candidateId = args.candidateId;

  // ── 1. El candidato ──────────────────────────────────────────
  const { data: candidateRow, error: candidateError } = await admin
    .from(CANDIDATES_TABLE)
    .select(CANDIDATE_COLUMNS)
    .eq('id', candidateId)
    .maybeSingle();
  if (candidateError) {
    throw new Error('search more preflight: candidate read failed');
  }

  const candidateStatus = cleanText(candidateRow?.status);
  const source = cleanText(candidateRow?.source);
  const sourceContactId = cleanText(candidateRow?.source_contact_id);

  // ── 2. La colección viva ─────────────────────────────────────
  // `suppressed_at IS NULL` se filtra ya en la consulta: un tombstone no lleva número, pero
  // sí lleva su razón y quién lo suprimió, y no traerlo es lo más barato que se puede hacer
  // con datos que no se necesitan. Sólo se piden `id` y `dedupe_key`: el número no hace
  // falta para contar ni para resolver procedencia.
  const { data: phoneRows, error: phonesError } = await admin
    .from(CANDIDATE_PHONES_TABLE)
    .select('id, dedupe_key')
    .eq('candidate_id', candidateId)
    .is('suppressed_at', null);
  if (phonesError) {
    throw new Error('search more preflight: collection read failed');
  }
  const phones = (phoneRows ?? []) as { id: string; dedupe_key: string }[];

  // Teléfonos DISTINTOS: la clave canónica, no el conteo de filas. Hoy el índice UNIQUE
  // `(candidate_id, dedupe_key)` los hace coincidir; contar por clave lo deja verdadero
  // aunque ese índice cambie.
  const storedUnsuppressedPhoneCount = new Set(
    phones.map((phone) => phone.dedupe_key),
  ).size;

  // ── 3. La procedencia ────────────────────────────────────────
  // Sólo si hay teléfonos: sin filas no hay `candidate_phone_id` que buscar, y una consulta
  // con un `in ()` vacío es una consulta que se sabe estéril.
  let providersWithStoredProvenance: readonly string[] = [];
  if (phones.length > 0) {
    const { data: sourceRows, error: sourcesError } = await admin
      .from(CANDIDATE_PHONE_SOURCES_TABLE)
      .select('provider')
      .in(
        'candidate_phone_id',
        phones.map((phone) => phone.id),
      );
    if (sourcesError) {
      throw new Error('search more preflight: provenance read failed');
    }
    providersWithStoredProvenance = Array.from(
      new Set(
        (sourceRows ?? [])
          .map((row) => cleanText((row as { provider?: unknown }).provider)?.toLowerCase())
          .filter((provider): provider is string => !!provider),
      ),
    );
  }

  // ── 4. Las corridas de teléfono ──────────────────────────────
  // UNA lectura para las dos preguntas —¿hay una viva? y ¿ya se buscó adicionales?— porque
  // las dos salen de la misma tabla y el mismo candidato. Dos consultas abrirían una ventana
  // en la que una corrida puede volverse terminal entre ellas, y entonces el preflight
  // afirmaría a la vez «hay una activa» y «no hay historial».
  const { data: runRows, error: runsError } = await admin
    .from(WATERFALL_RUNS_TABLE)
    .select('status, run_mode')
    .eq('candidate_id', candidateId);
  if (runsError) {
    throw new Error('search more preflight: phone run read failed');
  }
  const runs = (runRows ?? []) as { status?: unknown; run_mode?: unknown }[];

  const hasActivePhoneRun = runs.some((run) =>
    (PHONE_REVEAL_WATERFALL_ACTIVE_STATUSES as readonly string[]).includes(
      String(run.status),
    ),
  );

  // §18 — el agotamiento se decide por que la corrida sea TERMINAL, no por CÓMO terminó.
  // `revealed`, `no_phone_found`, `no_new_distinct_phone` y `error` agotan igual: los cuatro
  // consumieron la autorización, y tres de ellos consumieron créditos. Un error del
  // proveedor no compra un reintento pagado automático.
  const lushaAlreadySearched = runs.some(
    (run) =>
      String(run.run_mode) === 'search_more' &&
      (PHONE_REVEAL_WATERFALL_TERMINAL_STATUSES as readonly string[]).includes(
        String(run.status),
      ),
  );
  const providersAlreadySearchedForMore: readonly string[] = lushaAlreadySearched
    ? ['lusha']
    : [];

  // ── 5. La privacidad, AUTORITATIVA ───────────────────────────
  // La MISMA puerta que corre inmediatamente antes de llamar a Lusha. Nunca lanza: cualquier
  // fallo de lectura vuelve como `check_unavailable`.
  const privacyState = toPlannerPrivacyState(
    await checkPhoneRevealPrivacyGate(candidateId),
  );

  const facts: SearchMorePreflightFacts = {
    candidateId,
    candidateStatus,
    source,
    sourceContactId,
    storedUnsuppressedPhoneCount,
    providersWithStoredProvenance,
    providersAlreadySearchedForMore,
    hasActivePhoneRun,
    privacyState,
  };

  // EL plan. Mismo módulo puro que consume la UI: no se reimplementa ni se ajusta aquí.
  // `candidateId` viaja como null cuando la fila no existe, para que el planificador
  // devuelva `invalid_candidate` en vez de razonar sobre un candidato ausente.
  const plan = planSearchMorePhones({
    featureEnabled: args.featureEnabled,
    actorRoleKey: args.actorRoleKey,
    candidateId: candidateRow ? candidateId : null,
    candidateStatus,
    storedUnsuppressedPhoneCount,
    source,
    sourceContactId,
    providersWithStoredProvenance,
    providersAlreadySearchedForMore,
    hasActivePhoneRun,
    privacyState,
  });

  return {
    facts,
    summary: {
      candidateId,
      storedPhoneCount: storedUnsuppressedPhoneCount,
      hasLushaNativeIdentity:
        resolveSearchMoreNativeProviders({ source, sourceContactId }).length > 0,
      hasActivePhoneRun,
      lushaAlreadySearched,
      lushaHasStoredProvenance: providersWithStoredProvenance.includes('lusha'),
      plan,
    },
  };
}
