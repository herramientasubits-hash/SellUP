/**
 * country-source-fresh-window.ts — la ventana de lectura de la capa gratuita que
 * NO se agota (AUDIT-A1-WS7, hallazgo 4).
 *
 * ── El defecto ───────────────────────────────────────────────────────────────
 *
 * Las lecturas de 14 fuentes (PE, US, HN, NI, PA, PY, SV, UY, VE, ES, CR, BR, GT y
 * la capa curada latam) leían SIEMPRE las mismas N primeras filas por
 * `priority_score` y el filtro «ya está en SellUp / HubSpot» corría DESPUÉS. Una
 * vez vistas, la corrida siguiente leía exactamente las mismas: 0 nuevas para
 * siempre y la búsqueda pagaba Apollo/Tavily por lo que la fuente gratuita tenía.
 *
 * ── El arreglo ───────────────────────────────────────────────────────────────
 *
 * Se lee por páginas (mismo orden determinista) y en la LECTURA se saltan las
 * filas que SellUp ya conoce por identidad FUERTE (número fiscal o web exactos):
 *
 *   · candidata VIVA de cualquier lote (una descartada NO bloquea: § 9);
 *   · Descartadas de la capa gratuita (`tax:<id>`), con las mismas excepciones que
 *     `buildFindAlreadyInSellup` (sin web y nunca buscada ⇒ vuelve; descartada
 *     sólo por falta de web ⇒ vuelve si ahora trae dominio);
 *   · cuenta en `accounts` (clientes y empresas sincronizadas desde HubSpot) con el
 *     mismo número fiscal o la misma web: el detector canónico las daría por
 *     conocidas, así que no deben gastar la comprobación por empresa ni ocupar la
 *     ventana.
 *
 * Se siguen pidiendo páginas hasta reunir `size` filas frescas, con un techo de
 * páginas. El filtro canónico del runner (`splitAlreadyInSellup` + HubSpot por
 * empresa) sigue siendo la autoridad final: esto sólo evita leer lo ya visto.
 *
 * Sólo lectura, consultas parametrizadas y en trozos acotados. Fail-open: si la
 * lectura de «conocidas» falla, la página se devuelve entera (como antes).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from '@/server/agents/prospecting-toolkit/normalization';
import { isUnsearchedFreeLayerDiscard } from './country-source-prior-sightings';

/** Techo de páginas por lectura: 5 × la ventana de siempre. */
export const FRESH_WINDOW_MAX_PAGES = 5;

/** Identificadores por consulta `in (...)` (la URL de PostgREST tiene límite). */
const KNOWN_IN_CHUNK = 100;
/** Webs por consulta: cada una viaja en varias formas de host. */
const KNOWN_DOMAIN_CHUNK = 25;
const DOMAIN_HOST_PREFIXES = ['www.', 'www2.', 'www3.'];

/** Estados de candidata que NO bloquean volver a proponerla (§ 9: reconsideración). */
const NON_BLOCKING_CANDIDATE_STATUSES = ['discarded', 'rejected', 'archived', 'duplicate', 'qa_cleanup'];

export type KnownSnapshotIdentities = {
  /** Números fiscales que bloquean siempre. */
  taxIds: ReadonlySet<string>;
  /** Números fiscales descartados sólo por falta de web: bloquean mientras la fila no traiga web. */
  taxIdsUnlessDomain: ReadonlySet<string>;
  /** Webs canónicas (sin `www.`) que bloquean siempre. */
  domains: ReadonlySet<string>;
};

/** READ-ONLY: qué identidades de esta página ya conoce SellUp. */
export type ReadKnownSnapshotIdentities = (input: {
  countryCode: string;
  taxIds: readonly string[];
  domains: readonly string[];
}) => Promise<KnownSnapshotIdentities>;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

function canonical(domain: string | null | undefined): string | null {
  return domain ? normalizeDomain(domain) : null;
}

/** Lector real con el cliente de servicio (sólo SELECT). Cualquier error ⇒ lanza (el llamador decide). */
export function buildReadKnownSnapshotIdentities(client: SupabaseClient): ReadKnownSnapshotIdentities {
  return async ({ countryCode, taxIds, domains }) => {
    const knownTax = new Set<string>();
    const unlessDomain = new Set<string>();
    const knownDomains = new Set<string>();
    const nowMs = Date.now();

    for (const ids of chunks(taxIds, KNOWN_IN_CHUNK)) {
      const candidates = await client
        .from('prospect_candidates')
        .select('tax_identifier')
        .in('tax_identifier', ids)
        .not('status', 'in', `(${NON_BLOCKING_CANDIDATE_STATUSES.join(',')})`);
      if (candidates.error) throw new Error('known_candidates_read_failed');
      for (const row of (candidates.data ?? []) as Array<{ tax_identifier: string | null }>) {
        if (row.tax_identifier) knownTax.add(row.tax_identifier);
      }

      const accounts = await client.from('accounts').select('tax_identifier').in('tax_identifier', ids);
      if (accounts.error) throw new Error('known_accounts_read_failed');
      for (const row of (accounts.data ?? []) as Array<{ tax_identifier: string | null }>) {
        if (row.tax_identifier) knownTax.add(row.tax_identifier);
      }

      const discards = await client
        .from('prospect_discarded_dispositions')
        .select('provider_identifier, status, reason_code, created_at, decision:evidence->claude_rescue->>decision')
        .eq('source_primary', 'public_source')
        .in('status', ['discarded', 'sent_to_review'])
        .in('provider_identifier', ids.map((id) => `tax:${id}`));
      if (discards.error) throw new Error('known_discards_read_failed');
      type DiscardRow = {
        provider_identifier: string | null;
        status: string | null;
        reason_code: string | null;
        created_at: string | null;
        decision: string | null;
      };
      for (const row of (discards.data ?? []) as DiscardRow[]) {
        const taxId = row.provider_identifier?.startsWith('tax:') ? row.provider_identifier.slice(4) : null;
        if (!taxId || isUnsearchedFreeLayerDiscard(row, nowMs)) continue;
        const openMissingDomain =
          row.status === 'discarded' &&
          row.reason_code === 'missing_domain_final' &&
          row.decision !== 'discard' &&
          row.decision !== 'duplicate';
        (openMissingDomain ? unlessDomain : knownTax).add(taxId);
      }
    }

    for (const ids of chunks(domains, KNOWN_DOMAIN_CHUNK)) {
      const forms = ids.flatMap((d) => [d, ...DOMAIN_HOST_PREFIXES.map((prefix) => `${prefix}${d}`)]);
      const candidates = await client
        .from('prospect_candidates')
        .select('domain')
        .eq('country_code', countryCode.toUpperCase())
        .in('domain', forms)
        .not('status', 'in', `(${NON_BLOCKING_CANDIDATE_STATUSES.join(',')})`);
      if (candidates.error) throw new Error('known_candidate_domains_read_failed');
      const accounts = await client.from('accounts').select('domain').in('domain', forms);
      if (accounts.error) throw new Error('known_account_domains_read_failed');
      for (const row of [...(candidates.data ?? []), ...(accounts.data ?? [])] as Array<{ domain: string | null }>) {
        const d = canonical(row.domain);
        if (d) knownDomains.add(d);
      }
    }

    return { taxIds: knownTax, taxIdsUnlessDomain: unlessDomain, domains: knownDomains };
  };
}

/** `raw_data.website_domain` de una fila de `source_company_snapshots`, o `null`. */
export function snapshotWebsiteDomain(raw: Record<string, unknown> | null | undefined): string | null {
  const value = raw?.['website_domain'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** ¿La fila es de una empresa que SellUp ya conoce? Puro. */
export function isKnownSnapshotRow(
  identity: { taxId: string | null; domain: string | null },
  known: KnownSnapshotIdentities,
): boolean {
  const domain = canonical(identity.domain);
  if (identity.taxId && known.taxIds.has(identity.taxId)) return true;
  if (identity.taxId && domain === null && known.taxIdsUnlessDomain.has(identity.taxId)) return true;
  return domain !== null && known.domains.has(domain);
}

export type FreshSnapshotWindowInput<Row> = {
  /** Cuántas filas frescas se quieren (la ventana de siempre de la fuente). */
  size: number;
  countryCode: string;
  /** Lee las filas `[from, to]` (inclusive) en el orden determinista de la fuente. Lanza si falla. */
  readRange: (from: number, to: number) => Promise<Row[]>;
  taxIdOf: (row: Row) => string | null;
  domainOf: (row: Row) => string | null;
  /** Ausente ⇒ comportamiento de siempre: una sola página. */
  readKnown: ReadKnownSnapshotIdentities | null;
  maxPages?: number;
};

/**
 * Lee páginas de la fuente hasta reunir `size` filas que SellUp no conoce, o hasta
 * agotar la fuente o el techo de páginas. Un fallo en la PRIMERA página se
 * propaga (el llamador ya degrada a vacío); en las siguientes se devuelve lo
 * reunido.
 */
export async function readFreshSnapshotWindow<Row>(input: FreshSnapshotWindowInput<Row>): Promise<Row[]> {
  const size = Math.max(0, Math.trunc(input.size));
  if (size === 0) return [];
  const maxPages = input.readKnown ? Math.max(1, Math.trunc(input.maxPages ?? FRESH_WINDOW_MAX_PAGES)) : 1;
  const fresh: Row[] = [];

  for (let page = 0; page < maxPages && fresh.length < size; page++) {
    let rows: Row[];
    try {
      rows = await input.readRange(page * size, page * size + size - 1);
    } catch (error) {
      if (page === 0) throw error;
      break;
    }
    if (!input.readKnown) return rows;

    let known: KnownSnapshotIdentities | null = null;
    try {
      known = await input.readKnown({
        countryCode: input.countryCode,
        taxIds: [...new Set(rows.map(input.taxIdOf).filter((id): id is string => Boolean(id)))],
        domains: [...new Set(rows.map((row) => canonical(input.domainOf(row))).filter((d): d is string => d !== null))],
      });
    } catch {
      known = null; // fail-open: la página cuenta entera, como antes.
    }
    for (const row of rows) {
      if (fresh.length >= size) break;
      if (known && isKnownSnapshotRow({ taxId: input.taxIdOf(row), domain: input.domainOf(row) }, known)) continue;
      fresh.push(row);
    }
    if (known === null || rows.length < size) break;
  }

  return fresh;
}
