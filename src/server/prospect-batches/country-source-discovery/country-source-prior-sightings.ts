/**
 * country-source-prior-sightings.ts — ¿SellUp ya vio esta empresa? Lectura (SÓLO
 * LECTURA) por número fiscal para el buscador gratuito de un país.
 *
 * SOURCES-EC-CLOSE-1. La misma regla que Argentina y República Dominicana
 * (SOURCES-AR-NO-RECYCLE-1, #611), en un módulo común para que Ecuador no copie
 * una tercera vez la consulta. Argentina y RD conservan la suya (otras sesiones).
 *
 *   - `candidate`: ya es candidata en algún lote.
 *   - `definitive_discard`: descartada y el rescate de Claude cerró el caso
 *     (otra industria, otro tamaño, duplicada).
 *   - `discard`: descartada sin cierre (p. ej. sin web).
 *
 * Fail-open: si una consulta falla, esa parte no marca nada y la empresa se
 * ofrece como antes, igual que el resto de la capa gratuita.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type CountrySourcePriorSighting = 'candidate' | 'definitive_discard' | 'discard';

/** Números fiscales por consulta (la URL de PostgREST tiene límite). */
const SIGHTING_CHUNK = 150;

/** Decisiones del rescate de Claude que cierran el caso de una empresa descartada. */
const DEFINITIVE_RESCUE_DECISIONS: ReadonlySet<string> = new Set(['discard', 'duplicate']);

const SIGHTING_RANK: Record<CountrySourcePriorSighting, number> = {
  candidate: 3,
  definitive_discard: 2,
  discard: 1,
};

function strongest(
  a: CountrySourcePriorSighting | undefined,
  b: CountrySourcePriorSighting,
): CountrySourcePriorSighting {
  return a !== undefined && SIGHTING_RANK[a] >= SIGHTING_RANK[b] ? a : b;
}

/** Número fiscal → lo que SellUp ya sabe de esa empresa. */
export async function readCountrySourcePriorSightings(
  client: SupabaseClient,
  taxIds: readonly string[],
): Promise<Map<string, CountrySourcePriorSighting>> {
  const out = new Map<string, CountrySourcePriorSighting>();
  for (let i = 0; i < taxIds.length; i += SIGHTING_CHUNK) {
    const chunk = taxIds.slice(i, i + SIGHTING_CHUNK);
    try {
      const { data, error } = await client
        .from('prospect_candidates')
        .select('tax_identifier')
        .in('tax_identifier', chunk);
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ tax_identifier: string | null }>) {
          if (row.tax_identifier) out.set(row.tax_identifier, strongest(out.get(row.tax_identifier), 'candidate'));
        }
      }
    } catch {
      /* fail-open */
    }
    try {
      const { data, error } = await client
        .from('prospect_discarded_dispositions')
        .select('provider_identifier, decision:evidence->claude_rescue->>decision')
        .eq('source_primary', 'public_source')
        .in('provider_identifier', chunk.map((taxId) => `tax:${taxId}`));
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ provider_identifier: string | null; decision: string | null }>) {
          const taxId = row.provider_identifier?.startsWith('tax:') ? row.provider_identifier.slice(4) : null;
          if (!taxId) continue;
          const sighting: CountrySourcePriorSighting =
            row.decision && DEFINITIVE_RESCUE_DECISIONS.has(row.decision) ? 'definitive_discard' : 'discard';
          out.set(taxId, strongest(out.get(taxId), sighting));
        }
      }
    } catch {
      /* fail-open */
    }
  }
  return out;
}

/**
 * ¿Proponerla otra vez sólo repetiría lo de una corrida anterior? Sí si ya es
 * candidata, si su descarte quedó cerrado, o si fue descartada y SIGUE sin web.
 * Una descartada que AHORA tiene dominio vuelve a ofrecerse. Puro.
 */
export function isRecycledCountrySourceCompany(
  sighting: CountrySourcePriorSighting | null | undefined,
  hasDomain: boolean,
): boolean {
  switch (sighting) {
    case 'candidate':
    case 'definitive_discard':
      return true;
    case 'discard':
      return !hasDomain;
    default:
      return false;
  }
}
