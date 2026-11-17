/**
 * Búsqueda general en TODO SellUp — lo que no se carga al abrir el buscador: empresas por
 * revisar, empresas descartadas, búsquedas y candidatos de contacto (por revisar,
 * duplicados y rechazados).
 *
 * Reutiliza las MISMAS lecturas de cada lista (mismo permiso y mismo alcance comercial);
 * no hay consulta nueva con reglas propias. Si una lista falla, las demás se muestran.
 * Sólo lectura.
 */

import { getGlobalCandidatesList, getSearchesForViewer } from '@/modules/prospect-batches/actions';
import { getDiscardedProspectsList } from '@/modules/prospect-discards/queries';
import { searchContactCandidatesForGlobalSearch } from '@/modules/contact-enrichment/actions';
import {
  SELLUP_RECORDS_PER_KIND,
  foldedIncludes,
  normalizeRecordsQuery,
  type ContactCandidateQueue,
  type SellUpRecordHit,
  type SellUpRecordKind,
  type SellUpRecordsResult,
} from './types';

/** Los estados de «Por revisar» (los mismos que su lista). */
const PENDING_PROSPECT_STATUSES = ['needs_review', 'generated', 'normalized'];

function compact(values: ReadonlyArray<string | null | undefined>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

async function prospectHits(query: string): Promise<SellUpRecordHit[]> {
  const { candidates } = await getGlobalCandidatesList({
    search: query,
    statuses: PENDING_PROSPECT_STATUSES,
    limit: SELLUP_RECORDS_PER_KIND,
    offset: 0,
  });
  return candidates.map((c) => {
    const batch = (c as { batch?: { name?: string | null } | null }).batch;
    return {
      kind: 'prospect' as const,
      id: c.id,
      title: c.name,
      meta: compact([c.industry, c.country ?? c.country_code, batch?.name ? `Búsqueda: ${batch.name}` : null]),
      keywords: compact([c.domain, c.website]),
    };
  });
}

async function discardedHits(query: string): Promise<SellUpRecordHit[]> {
  const { items } = await getDiscardedProspectsList({ search: query, limit: SELLUP_RECORDS_PER_KIND });
  return items.slice(0, SELLUP_RECORDS_PER_KIND).map((item) => ({
    kind: 'discarded_company' as const,
    id: item.itemId,
    title: item.name,
    meta: compact([item.industry, item.countryCode, item.batchName ? `Búsqueda: ${item.batchName}` : null]),
    keywords: compact([item.domain]),
  }));
}

/**
 * La lista de búsquedas de quien mira (con sus cifras) es pesada: se lee una vez por
 * persona cada minuto y se filtra en memoria mientras escribe. La clave es la persona:
 * cada una ve sólo su alcance.
 */
const SEARCHES_CACHE_TTL_MS = 60 * 1000;
const SEARCHES_CACHE_MAX = 200;
type SearchSummary = { id: string; name: string; total: number | null; assigned: boolean };
const searchesCache = new Map<string, { at: number; list: SearchSummary[] }>();

async function viewerSearches(userId: string): Promise<SearchSummary[]> {
  const hit = searchesCache.get(userId);
  if (hit && Date.now() - hit.at < SEARCHES_CACHE_TTL_MS) return hit.list;
  const list = (await getSearchesForViewer()).map((s) => ({
    id: s.id,
    name: s.name,
    total: typeof s.total_candidates === 'number' ? s.total_candidates : null,
    assigned: s.visibility === 'assigned',
  }));
  if (searchesCache.size >= SEARCHES_CACHE_MAX) searchesCache.delete(searchesCache.keys().next().value as string);
  searchesCache.set(userId, { at: Date.now(), list });
  return list;
}

async function searchHits(query: string, userId: string): Promise<SellUpRecordHit[]> {
  const searches = await viewerSearches(userId);
  return searches
    .filter((s) => foldedIncludes(s.name, query))
    .slice(0, SELLUP_RECORDS_PER_KIND)
    .map((s) => ({
      kind: 'search' as const,
      id: s.id,
      title: s.name,
      meta: compact([s.total !== null ? `${s.total} empresas` : null, s.assigned ? 'Te asignaron empresas' : null]),
      keywords: [],
    }));
}

const CANDIDATE_QUEUES: ReadonlySet<string> = new Set<ContactCandidateQueue>(['pending_review', 'duplicate', 'discarded']);

async function contactCandidateHits(query: string): Promise<SellUpRecordHit[]> {
  const candidates = await searchContactCandidatesForGlobalSearch(query, SELLUP_RECORDS_PER_KIND);
  return candidates
    .filter((c) => CANDIDATE_QUEUES.has(c.status))
    .map((c) => ({
      kind: 'contact_candidate' as const,
      id: c.id,
      title: c.full_name,
      meta: compact([c.title, c.company_name]),
      keywords: compact([c.email]),
      queue: c.status as ContactCandidateQueue,
    }));
}

const READERS: ReadonlyArray<{ kind: SellUpRecordKind; read: (query: string, userId: string) => Promise<SellUpRecordHit[]> }> = [
  { kind: 'prospect', read: prospectHits },
  { kind: 'discarded_company', read: discardedHits },
  { kind: 'search', read: searchHits },
  { kind: 'contact_candidate', read: contactCandidateHits },
];

/** Busca lo escrito en las listas de SellUp que no se cargan al abrir el buscador. */
export async function searchSellUpRecords(rawQuery: unknown, userId: string): Promise<SellUpRecordsResult> {
  const query = normalizeRecordsQuery(rawQuery);
  if (!query) return { hits: [], failed: [] };
  const settled = await Promise.allSettled(READERS.map((reader) => reader.read(query, userId)));
  const hits: SellUpRecordHit[] = [];
  const failed: SellUpRecordKind[] = [];
  settled.forEach((result, index) => {
    const { kind } = READERS[index];
    if (result.status === 'fulfilled') {
      hits.push(...result.value);
    } else {
      failed.push(kind);
      console.error(`[global-search] ${kind}:`, result.reason instanceof Error ? result.reason.message : result.reason);
    }
  });
  return { hits, failed };
}
