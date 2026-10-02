/**
 * apollo-exclusion-sellup-domains.server.ts — lo que SellUp sabe de cada dominio
 * cuando decide qué pedirle a Apollo que NO devuelva.
 *
 * AGENT1-APOLLO-SEEN-DOMAIN-EXCLUSION-SCOPE-1.
 *
 * Dos lecturas acotadas, sólo cuando la exclusión está encendida:
 *
 *   · `liveDomains` — dominios de candidatos VIVOS de SellUp en el país (de
 *     cualquier vendedor). Con «una empresa, un vendedor» (migración 140) nunca
 *     pueden volver a ser un candidato nuevo: pagar por verlos es tirar el crédito.
 *     Antes la exclusión sólo conocía `accounts`.
 *   · `releasedDomains` — de los dominios que la memoria provider-seen tiene por
 *     «vistos», los que en SellUp sólo existen DESCARTADOS. El descarte libera la
 *     empresa para los demás vendedores; excluirla de Apollo 30 días contradecía
 *     esa regla.
 *
 * Cliente ADMINISTRATIVO a propósito: la sesión del vendedor sólo ve sus lotes
 * (RLS) y la regla es global. Sólo se leen dominios y status: ni nombres ni
 * contactos.
 *
 * Nunca lanza. Un fallo degrada a listas vacías y `degraded: true`: la exclusión
 * queda como antes de este corte (sólo cuentas + lo visto), nunca más amplia.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { GLOBAL_IDENTITY_RELEASING_STATUSES } from '@/server/agents/prospecting-toolkit/global-identity-claims';
import { normalizeExclusionDomain } from '@/modules/prospect-batches/prepaid-novelty/provider-exclusion-domains';
import { DELIVERY_CAP_DISPOSITION } from '@/modules/prospect-discards/delivery-capped-dispositions';
import {
  classifyBatchScope,
  isBatchCorrelationId,
  isSeenDomainOutOfScope,
  resolveRunMacroIndustryKey,
  type ApolloExclusionBatchRow,
  type ApolloExclusionBatchScope,
  type ApolloExclusionIndustryIdentity,
} from './apollo-exclusion-scope';

/** Máximo de dominios vivos que se leen: el mismo orden de magnitud que el tope de la petición. */
export const APOLLO_EXCLUSION_LIVE_DOMAINS_LIMIT = 500;

/** Trozos de la consulta `.in()` sobre los dominios vistos. */
const SEEN_DOMAINS_CHUNK = 100;

/**
 * AGENT1-APOLLO-EXCLUSION-SAME-INDUSTRY-1 — con alcance hay que leer más vivos de
 * los que caben en la lista, porque una parte se descarta por ser de otra
 * industria. El doble del tope coincide con el máximo de filas que PostgREST
 * devuelve por consulta; no es un límite nuevo del proveedor.
 */
export const APOLLO_EXCLUSION_SCOPED_LIVE_READ_LIMIT = APOLLO_EXCLUSION_LIVE_DOMAINS_LIMIT * 2;

/** La memoria provider-seen de Apollo (la tabla no guarda país ni industria). */
const PROVIDER_SEEN_TABLE_NAME = 'provider_seen_entities';
const BATCH_CHUNK = 100;

export type ApolloExclusionSellupDomains = {
  liveDomains: string[];
  releasedDomains: string[];
  degraded: boolean;
  /**
   * SAME-INDUSTRY-1 — sólo con alcance. Dominios vistos que sobran en la lista
   * porque TODO lo que se sabe de ellos los sitúa en otro país u otra industria.
   */
  outOfScopeSeenDomains?: string[];
  /** SAME-INDUSTRY-1 — vivos del país que se dejaron fuera por ser de otra industria. */
  liveOutOfScopeCount?: number;
};

/** La industria de la corrida; el lector la resuelve a su macro. Sin macro conocida ⇒ sin alcance. */
export type ApolloExclusionScopeInput = ApolloExclusionIndustryIdentity;

const EMPTY: ApolloExclusionSellupDomains = { liveDomains: [], releasedDomains: [], degraded: false };

/** El MISMO normalizador que el plan de exclusión: sin esquema, sin `www.`. */
function normalize(value: unknown): string | null {
  return typeof value === 'string' ? normalizeExclusionDomain(value) : null;
}

const RELEASING = new Set<string>(GLOBAL_IDENTITY_RELEASING_STATUSES);

export async function loadApolloExclusionSellupDomains(
  client: SupabaseClient,
  input: {
    countryCode: string;
    seenDomains: readonly string[];
    liveLimit?: number;
    /** SAME-INDUSTRY-1 — ausente ⇒ el comportamiento de siempre (todas las industrias). */
    scope?: ApolloExclusionScopeInput;
  },
): Promise<ApolloExclusionSellupDomains> {
  const macroIndustryKey = input.scope ? resolveRunMacroIndustryKey(input.scope) : null;
  const scope = macroIndustryKey !== null ? { macroIndustryKey } : null;
  const liveLimit = Math.max(
    0,
    Math.trunc(
      input.liveLimit ??
        (scope ? APOLLO_EXCLUSION_SCOPED_LIVE_READ_LIMIT : APOLLO_EXCLUSION_LIVE_DOMAINS_LIMIT),
    ),
  );
  let degraded = false;
  let liveOutOfScopeCount = 0;

  // 1. Vivos del país — orden estable: dos corridas iguales piden lo mismo.
  const liveDomains = new Set<string>();
  if (liveLimit > 0) {
    try {
      const { data, error } = await client
        .from('prospect_candidates')
        .select(scope ? 'domain, batch_id' : 'domain')
        .eq('country_code', input.countryCode)
        .not('domain', 'is', null)
        .not('status', 'in', `(${[...RELEASING].join(',')})`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(liveLimit);
      if (error || !Array.isArray(data)) {
        degraded = true;
      } else {
        const rows = data as unknown as Array<{ domain?: unknown; batch_id?: unknown }>;
        // SAME-INDUSTRY-1 — el alcance de cada lote. Si no se puede leer, NADIE se
        // descarta: la exclusión queda como antes.
        let scopeByBatchId: ReadonlyMap<string, ApolloExclusionBatchScope> | null = null;
        if (scope) {
          const batchIds = [
            ...new Set(
              rows.map((r) => r.batch_id as string | null | undefined).filter(isBatchCorrelationId),
            ),
          ];
          const loaded = await loadBatchScopes(client, batchIds, {
            countryCode: null,
            macroIndustryKey: scope.macroIndustryKey,
          });
          if (loaded.failed) degraded = true;
          else scopeByBatchId = loaded.scopeByBatchId;
        }
        for (const row of rows) {
          const domain = normalize(row.domain);
          if (domain === null) continue;
          if (
            scopeByBatchId !== null &&
            typeof row.batch_id === 'string' &&
            scopeByBatchId.get(row.batch_id) === 'out_of_scope'
          ) {
            liveOutOfScopeCount++;
            continue;
          }
          liveDomains.add(domain);
        }
      }
    } catch {
      degraded = true;
    }
  }

  // 2. De lo visto, lo que en SellUp sólo está descartado.
  const seen = [...new Set(input.seenDomains.map(normalize).filter((d): d is string => d !== null))];
  const releasedCandidates = new Set<string>();
  const stillLive = new Set<string>();
  for (let i = 0; i < seen.length; i += SEEN_DOMAINS_CHUNK) {
    const chunk = seen.slice(i, i + SEEN_DOMAINS_CHUNK);
    // La columna guarda a veces el `www.` (medido en Prod: ~1 de cada 4); se
    // pregunta por las dos formas y se compara ya normalizado.
    const variants = [...chunk, ...chunk.map((d) => `www.${d}`)];
    try {
      const { data, error } = await client
        .from('prospect_candidates')
        .select('domain, status')
        .in('domain', variants);
      if (error || !Array.isArray(data)) {
        degraded = true;
        // Sin saber cuáles se descartaron, no se libera ninguna de este trozo.
        continue;
      }
      for (const row of data as Array<{ domain?: unknown; status?: unknown }>) {
        const domain = normalize(row.domain);
        if (domain === null) continue;
        if (row.status === 'discarded') releasedCandidates.add(domain);
        else if (typeof row.status === 'string' && !RELEASING.has(row.status)) stillLive.add(domain);
      }
    } catch {
      degraded = true;
    }
    // AGENT1-DELIVERY-CAP-STAYS-FREE-1 — lo que el tope de entrega dejó fuera
    // vive en «Descartadas» como `target_cap_reached` (nunca fue candidato). Se
    // libera igual que un descarte: tiene que poder llegarle a otro vendedor.
    try {
      const { data, error } = await client
        .from('prospect_discarded_dispositions')
        .select('domain')
        .eq('disposition', DELIVERY_CAP_DISPOSITION)
        .eq('status', 'discarded')
        .in('domain', variants);
      if (error || !Array.isArray(data)) {
        degraded = true;
        continue;
      }
      for (const row of data as Array<{ domain?: unknown }>) {
        const domain = normalize(row.domain);
        if (domain !== null) releasedCandidates.add(domain);
      }
    } catch {
      degraded = true;
    }
  }

  const releasedDomains = [...releasedCandidates]
    .filter((d) => !stillLive.has(d) && !liveDomains.has(d))
    .sort();

  // 3. SAME-INDUSTRY-1 — de lo visto, lo que sobra por ser de otro país u otra
  //    industria. Un fallo de lectura deja la lista de vistos íntegra.
  let outOfScopeSeenDomains: string[] | undefined;
  if (scope) {
    const scoped = await loadOutOfScopeSeenDomains(client, seen, {
      countryCode: input.countryCode,
      macroIndustryKey: scope.macroIndustryKey,
    });
    if (scoped.failed) degraded = true;
    outOfScopeSeenDomains = scoped.domains.filter((d) => !liveDomains.has(d));
  }

  if (
    scope === null &&
    liveDomains.size === 0 &&
    releasedDomains.length === 0 &&
    !degraded
  ) {
    return EMPTY;
  }
  return {
    liveDomains: [...liveDomains],
    releasedDomains,
    degraded,
    ...(scope ? { outOfScopeSeenDomains: outOfScopeSeenDomains ?? [], liveOutOfScopeCount } : {}),
  };
}

/** El alcance de cada lote pedido; `failed` si CUALQUIER lectura falló. */
async function loadBatchScopes(
  client: SupabaseClient,
  batchIds: readonly string[],
  run: { countryCode: string | null; macroIndustryKey: string },
): Promise<{ scopeByBatchId: Map<string, ApolloExclusionBatchScope>; failed: boolean }> {
  const scopeByBatchId = new Map<string, ApolloExclusionBatchScope>();
  let failed = false;
  for (let i = 0; i < batchIds.length; i += BATCH_CHUNK) {
    const chunk = batchIds.slice(i, i + BATCH_CHUNK);
    try {
      const { data, error } = await client
        .from('prospect_batches')
        .select('id, country_code, industry')
        .in('id', chunk);
      if (error || !Array.isArray(data)) {
        failed = true;
        continue;
      }
      for (const row of data as unknown as ApolloExclusionBatchRow[]) {
        if (typeof row.id === 'string') scopeByBatchId.set(row.id, classifyBatchScope(row, run));
      }
    } catch {
      failed = true;
    }
  }
  return { scopeByBatchId, failed };
}

type SeenCorrelationRow = {
  normalized_domain?: unknown;
  first_seen_correlation?: unknown;
  last_seen_correlation?: unknown;
};

/**
 * Dominios vistos por Apollo que sólo se vieron en corridas de otro país u otra
 * industria. Un dominio sin correlación, con una que no es un lote, o con un lote
 * no encontrado o de alcance desconocido NO se devuelve (se queda en la lista).
 */
async function loadOutOfScopeSeenDomains(
  client: SupabaseClient,
  seen: readonly string[],
  run: { countryCode: string; macroIndustryKey: string },
): Promise<{ domains: string[]; failed: boolean }> {
  let failed = false;
  const correlationsByDomain = new Map<string, Set<string | null>>();
  for (let i = 0; i < seen.length; i += SEEN_DOMAINS_CHUNK) {
    const chunk = seen.slice(i, i + SEEN_DOMAINS_CHUNK);
    try {
      const { data, error } = await client
        .from(PROVIDER_SEEN_TABLE_NAME)
        .select('normalized_domain, first_seen_correlation, last_seen_correlation')
        .eq('provider', 'apollo')
        .in('normalized_domain', chunk);
      if (error || !Array.isArray(data)) {
        failed = true;
        continue;
      }
      for (const row of data as unknown as SeenCorrelationRow[]) {
        const domain = normalize(row.normalized_domain);
        if (domain === null) continue;
        const set = correlationsByDomain.get(domain) ?? new Set<string | null>();
        for (const c of [row.first_seen_correlation, row.last_seen_correlation]) {
          // `null` marca «hay una visita sin lote conocido»: nunca es `out_of_scope`,
          // así que el dominio se queda (`isSeenDomainOutOfScope` exige TODOS fuera).
          set.add(isBatchCorrelationId(c as string | null | undefined) ? (c as string) : null);
        }
        correlationsByDomain.set(domain, set);
      }
    } catch {
      failed = true;
    }
  }

  const batchIds = [
    ...new Set(
      [...correlationsByDomain.values()].flatMap((set) => [...set].filter((c): c is string => c !== null)),
    ),
  ];
  const loaded = await loadBatchScopes(client, batchIds, run);
  if (loaded.failed) failed = true;

  const domains: string[] = [];
  for (const [domain, set] of correlationsByDomain) {
    if (isSeenDomainOutOfScope([...set] as string[], loaded.scopeByBatchId)) domains.push(domain);
  }
  return { domains: domains.sort(), failed };
}
