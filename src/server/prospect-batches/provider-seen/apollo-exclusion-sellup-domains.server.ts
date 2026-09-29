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

/** Máximo de dominios vivos que se leen: el mismo orden de magnitud que el tope de la petición. */
export const APOLLO_EXCLUSION_LIVE_DOMAINS_LIMIT = 500;

/** Trozos de la consulta `.in()` sobre los dominios vistos. */
const SEEN_DOMAINS_CHUNK = 100;

export type ApolloExclusionSellupDomains = {
  liveDomains: string[];
  releasedDomains: string[];
  degraded: boolean;
};

const EMPTY: ApolloExclusionSellupDomains = { liveDomains: [], releasedDomains: [], degraded: false };

/** El MISMO normalizador que el plan de exclusión: sin esquema, sin `www.`. */
function normalize(value: unknown): string | null {
  return typeof value === 'string' ? normalizeExclusionDomain(value) : null;
}

const RELEASING = new Set<string>(GLOBAL_IDENTITY_RELEASING_STATUSES);

export async function loadApolloExclusionSellupDomains(
  client: SupabaseClient,
  input: { countryCode: string; seenDomains: readonly string[]; liveLimit?: number },
): Promise<ApolloExclusionSellupDomains> {
  const liveLimit = Math.max(0, Math.trunc(input.liveLimit ?? APOLLO_EXCLUSION_LIVE_DOMAINS_LIMIT));
  let degraded = false;

  // 1. Vivos del país — orden estable: dos corridas iguales piden lo mismo.
  const liveDomains = new Set<string>();
  if (liveLimit > 0) {
    try {
      const { data, error } = await client
        .from('prospect_candidates')
        .select('domain')
        .eq('country_code', input.countryCode)
        .not('domain', 'is', null)
        .not('status', 'in', `(${[...RELEASING].join(',')})`)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(liveLimit);
      if (error || !Array.isArray(data)) {
        degraded = true;
      } else {
        for (const row of data as Array<{ domain?: unknown }>) {
          const domain = normalize(row.domain);
          if (domain !== null) liveDomains.add(domain);
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
  }

  const releasedDomains = [...releasedCandidates]
    .filter((d) => !stillLive.has(d) && !liveDomains.has(d))
    .sort();

  if (liveDomains.size === 0 && releasedDomains.length === 0 && !degraded) return EMPTY;
  return { liveDomains: [...liveDomains], releasedDomains, degraded };
}
