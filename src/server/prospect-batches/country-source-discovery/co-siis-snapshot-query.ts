/**
 * co-siis-snapshot-query.ts — la ÚNICA frontera de E/S del descubrimiento
 * gratuito de Colombia.
 *
 * AGENT1-COUNTRY-SOURCE-PREPAID-NOVELTY-GATE-1 §§ 6, 27, 28.
 *
 * ── SOURCES-CO-CLOSE-1 (06-10-2026) ──────────────────────────────────────────
 *
 *   - Orden por ingresos (de mayor a menor), no por NIT: antes cada corrida leía
 *     siempre las mismas filas, las de NIT más bajo.
 *   - Se lee de más (×3, techo 600) y se marca lo que SellUp ya vio por NIT
 *     (candidatas y descartes del buscador gratuito), patrón de Argentina (#611).
 *   - Se devuelve la web cargada (`raw_data.website_domain`).
 *   - Gobierno se lee del directorio de entidades públicas (`co_public_entities`),
 *     ordenado por servidores públicos.
 *
 * ── 🔴 Sólo lectura, y acotada ───────────────────────────────────────────────
 *
 * Un `SELECT … LIMIT` sobre `source_company_snapshots`, filtrado a
 * `source_key = 'co_siis'` / `country_code = 'CO'` y a los códigos CIIU que el
 * índice canónico resolvió. No hay `insert`, `update`, `delete` ni `upsert`, y no
 * existe ninguna dep que pudiera hacerlos. Fail-soft: cualquier error resuelve a
 * `[]`, que el orquestador traduce a «la fuente no aportó» y sigue hacia el
 * proveedor de pago.
 *
 * ── 🔴 No es la ruta de enriquecimiento oficial ──────────────────────────────
 *
 * `colombia-snapshot-query.ts` sigue existiendo, intacta, sirviendo a la
 * identidad legal (nombre → NIT) por `querySnapshotByName`. Esta consulta es otra
 * cosa: filtra por INDUSTRIA para descubrir empresas, no por nombre para
 * identificar una. Se separan a propósito (§ 6) para que ampliar el
 * descubrimiento no le cambie el significado a un dato del que ya dependen la
 * deduplicación fiscal y el enriquecimiento post-aprobación.
 *
 * ── 🔴 El cero a la izquierda ────────────────────────────────────────────────
 *
 * El CIIU es de 4 dígitos, pero 575 de las 10.000 filas de co_siis lo guardan con
 * 3 caracteres porque la importación perdió el cero inicial ('111' por '0111').
 * Por eso cada código viaja en sus DOS formas: filtrar sólo por la canónica
 * dejaría fuera, en silencio, a todo el sector agropecuario y minero.
 *
 * ── 🔴 El CIIU es un NÚMERO en JSON, no una cadena ───────────────────────────
 *
 * MEDIDO en Producción (AGENT1-CO-SIIS-CIIU-NUMERIC-FIX-1): de las 10.000 filas
 * `co_siis`, `jsonb_typeof(raw_data->'CIIU')` devuelve `number` en 10.000 y
 * `string` en 0. La importación guardó el código como número JSON.
 *
 * Eso NO afecta al filtro — `raw_data->>CIIU` es el operador de PostgREST que
 * extrae el valor YA como texto, y la consulta se verificó REAL contra Producción
 * (HTTP 200, 50 filas) — pero SÍ afectaba a la proyección: leer la clave con un
 * `typeof === 'string'` la descartaba en el 100% de las filas. Con `ciiu = null`
 * no hay industria declarada, sin industria declarada nada se confirma, y la
 * fuente gratuita quedaba INERTE: `macroConfirmed = 0` siempre, y el proveedor de
 * pago pasaba a ser obligatorio aun cuando la evidencia ya estaba en la tabla.
 *
 * `normalizeSnapshotCiiu` es la única respuesta a eso: acepta el número que
 * Producción entrega de verdad y sigue rechazando, fail-closed, todo lo que no
 * sea un código plausible. NO ensancha la evidencia — recupera el MISMO CIIU que
 * ya estaba ahí.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CO_PUBLIC_ENTITY_DISCOVERY_MACROS,
  CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS,
  type CoPriorSighting,
  type CoSiisSnapshotQuery,
  type CoSiisSnapshotRow,
} from './co-siis-discovery-adapter';

/** `source_key` de la porción colombiana del snapshot. */
export const CO_SIIS_SNAPSHOT_SOURCE_KEY = 'co_siis' as const;

/** `source_key` del directorio de entidades públicas (CHIP + SIGEP II). */
export const CO_PUBLIC_ENTITIES_SOURCE_KEY = 'co_public_entities' as const;

/** Cuántas filas se leen por cada una que se pide (se saltan las ya vistas). */
export const CO_DISCOVERY_READ_OVERSAMPLE = 3;
/** Techo de filas leídas por consulta. */
export const CO_DISCOVERY_READ_CAP = 600;
/** NIT por consulta al marcar lo ya visto (la URL de PostgREST tiene límite). */
const SIGHTING_CHUNK = 150;

/** Nombre de la clave CIIU dentro de `raw_data`. */
const CO_SIIS_RAW_CIIU_KEY = 'CIIU';

/** Decisiones del rescate de Claude que cierran el caso de una empresa descartada. */
const DEFINITIVE_RESCUE_DECISIONS: ReadonlySet<string> = new Set(['discard', 'duplicate']);

const SIGHTING_RANK: Record<CoPriorSighting, number> = { candidate: 3, definitive_discard: 2, discard: 1 };

function strongest(a: CoPriorSighting | undefined, b: CoPriorSighting): CoPriorSighting {
  return a !== undefined && SIGHTING_RANK[a] >= SIGHTING_RANK[b] ? a : b;
}

/** Las dos formas con las que un mismo código puede estar guardado. */
function expandCiiuCodeForms(codes: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const code of codes) {
    const trimmed = code.trim();
    if (trimmed === '') continue;
    forms.add(trimmed);
    forms.add(trimmed.replace(/^0+/, '') || trimmed);
  }
  return [...forms];
}

/**
 * Normaliza el CIIU tal y como Producción lo guarda de verdad.
 *
 * `raw_data.CIIU` es `number` en 10.000/10.000 filas de `co_siis`, así que la
 * lectura tiene que aceptar el número. Contrato deliberadamente estrecho: sólo
 * pasan los códigos plausibles, y cualquier otra forma es `null` (fail-closed).
 * El relleno del cero a la izquierda lo hace quien resuelve la industria.
 */
function normalizeSnapshotCiiu(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isInteger(raw) || raw <= 0) return null;
    return String(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);

function toInteger(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) ? n : null;
}

type SnapshotSelectRow = {
  record_identity_key: string;
  legal_name: string | null;
  normalized_legal_name: string | null;
  tax_id: string | null;
  sector: string | null;
  city: string | null;
  department: string | null;
  raw_data: Record<string, unknown> | null;
};

const SELECTED_COLUMNS =
  'record_identity_key, legal_name, normalized_legal_name, tax_id, sector, city, department, raw_data';

function toSiisRow(row: SnapshotSelectRow): CoSiisSnapshotRow {
  return {
    record_identity_key: row.record_identity_key,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    tax_id: row.tax_id,
    sector: row.sector,
    city: row.city,
    department: row.department,
    ciiu: normalizeSnapshotCiiu(row.raw_data?.[CO_SIIS_RAW_CIIU_KEY]),
    website_domain: text(row.raw_data?.['website_domain']),
    origin: 'siis',
  };
}

function toPublicEntityRow(row: SnapshotSelectRow): CoSiisSnapshotRow {
  return {
    record_identity_key: row.record_identity_key,
    legal_name: row.legal_name,
    normalized_legal_name: row.normalized_legal_name,
    tax_id: row.tax_id,
    sector: row.sector,
    city: row.city,
    department: row.department,
    ciiu: null,
    website_domain: text(row.raw_data?.['website_domain']),
    origin: 'public_entity',
    macro_industry_key: text(row.raw_data?.['macro_industry_key']),
    workers: toInteger(row.raw_data?.['workers']),
  };
}

/**
 * NIT → lo que SellUp ya sabe de él: candidata en algún lote, descartada de forma
 * definitiva (el rescate de Claude dijo otra industria, otro tamaño o duplicada)
 * o descartada sin cierre (p. ej. sin web). Sólo lectura; si una consulta falla,
 * esa parte no marca nada (fail-open, como el resto de la capa gratuita).
 */
async function readPriorSightings(
  client: SupabaseClient,
  nits: readonly string[],
): Promise<Map<string, CoPriorSighting>> {
  const out = new Map<string, CoPriorSighting>();
  for (let i = 0; i < nits.length; i += SIGHTING_CHUNK) {
    const chunk = nits.slice(i, i + SIGHTING_CHUNK);
    try {
      const { data, error } = await client.from('prospect_candidates').select('tax_identifier').in('tax_identifier', chunk);
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
        .in('provider_identifier', chunk.map((nit) => `tax:${nit}`));
      if (!error && Array.isArray(data)) {
        for (const row of data as Array<{ provider_identifier: string | null; decision: string | null }>) {
          const nit = row.provider_identifier?.startsWith('tax:') ? row.provider_identifier.slice(4) : null;
          if (!nit) continue;
          const sighting: CoPriorSighting =
            row.decision && DEFINITIVE_RESCUE_DECISIONS.has(row.decision) ? 'definitive_discard' : 'discard';
          out.set(nit, strongest(out.get(nit), sighting));
        }
      }
    } catch {
      /* fail-open */
    }
  }
  return out;
}

async function readSiisRows(client: SupabaseClient, ciiuCodes: readonly string[], limit: number): Promise<CoSiisSnapshotRow[]> {
  const forms = expandCiiuCodeForms(ciiuCodes);
  if (forms.length === 0) return [];
  const base = () =>
    client
      .from('source_company_snapshots')
      .select(SELECTED_COLUMNS)
      .eq('source_key', CO_SIIS_SNAPSHOT_SOURCE_KEY)
      .eq('country_code', 'CO')
      .in(`raw_data->>${CO_SIIS_RAW_CIIU_KEY}`, forms);
  // De la que más factura a la que menos; el NIT desempata para que dos corridas
  // idénticas lean las mismas filas.
  let { data, error } = await base()
    .order('financials->operatingRevenueCurrent', { ascending: false, nullsFirst: false })
    .order('record_identity_key', { ascending: true })
    .limit(limit);
  if (error) {
    // Si el orden por ingresos no se puede aplicar, el orden estable de siempre.
    ({ data, error } = await base().order('record_identity_key', { ascending: true }).limit(limit));
  }
  if (error || !Array.isArray(data)) return [];
  return (data as unknown as SnapshotSelectRow[]).map(toSiisRow);
}

async function readPublicEntityRows(client: SupabaseClient, macroIndustryKey: string, limit: number): Promise<CoSiisSnapshotRow[]> {
  const { data, error } = await client
    .from('source_company_snapshots')
    .select(SELECTED_COLUMNS)
    .eq('source_key', CO_PUBLIC_ENTITIES_SOURCE_KEY)
    .eq('country_code', 'CO')
    .eq('raw_data->>macro_industry_key', macroIndustryKey)
    .gte('priority_score', CO_PUBLIC_ENTITY_DISCOVERY_MIN_WORKERS)
    .order('priority_score', { ascending: false })
    .order('record_identity_key', { ascending: true })
    .limit(limit);
  if (error || !Array.isArray(data)) return [];
  return (data as unknown as SnapshotSelectRow[]).map(toPublicEntityRow);
}

/**
 * Adapta un cliente (de `service_role`) a la consulta de descubrimiento.
 *
 * Este módulo NO construye el cliente: lo recibe. Quien lo construye usa la
 * factoría aprobada y env-guarded, igual que el resto de lecturas de esta tabla.
 */
export function buildCoSiisDiscoverySnapshotQuery(client: SupabaseClient): CoSiisSnapshotQuery {
  return async ({ macroIndustryKey, ciiuCodes, limit }): Promise<readonly CoSiisSnapshotRow[]> => {
    if (limit <= 0) return [];
    const readLimit = Math.min(limit * CO_DISCOVERY_READ_OVERSAMPLE, CO_DISCOVERY_READ_CAP);
    try {
      const rows = CO_PUBLIC_ENTITY_DISCOVERY_MACROS.has(macroIndustryKey)
        ? await readPublicEntityRows(client, macroIndustryKey, readLimit)
        : await readSiisRows(client, ciiuCodes, readLimit);
      const nits = [...new Set(rows.map((row) => row.tax_id?.trim()).filter((nit): nit is string => Boolean(nit)))];
      const sightings = nits.length > 0 ? await readPriorSightings(client, nits) : new Map<string, CoPriorSighting>();
      return rows.map((row) => ({ ...row, prior_sighting: sightings.get(row.tax_id?.trim() ?? '') ?? null }));
    } catch {
      return [];
    }
  };
}
