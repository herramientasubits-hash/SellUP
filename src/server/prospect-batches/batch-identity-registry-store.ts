/**
 * AGENT1-CUT3B23 · CUT-3B3 — siembra del registro de identidad de lote.
 *
 * Único punto que LEE base de datos para el registro. El registro en sí
 * (`prospecting-toolkit/batch-identity-registry`) es puro; separar la lectura
 * es lo que permite probar toda la semántica de decisión sin Supabase.
 *
 * Lee EXCLUSIVAMENTE las filas del lote indicado, y sólo las que ocupan el lote
 * (`BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES`). No hay lectura histórica ni
 * entre lotes: eso es la memoria de novedad global, que es de otra capa.
 *
 * Degrada CERRADO en el sentido correcto para la admisión: si la lectura falla,
 * la siembra queda vacía y el escritor ADMITE (falso negativo de deduplicación),
 * nunca suprime un candidato legítimo por una consulta caída. Un fallo de
 * consulta no puede convertirse en «este candidato ya existía».
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
  createBatchIdentityRegistry,
  seedBatchIdentityRegistry,
  type BatchIdentityRegistry,
  type RegisteredBatchIdentity,
} from '@/server/agents/prospecting-toolkit/batch-identity-registry';
import {
  buildCompanyIdentityEvidence,
  buildProviderEntityKey,
} from '@/server/agents/prospecting-toolkit/company-identity-evidence';

/**
 * Columnas leídas. Todas existen desde las migraciones 040/045: este corte NO
 * añade ninguna (MIGRATION_CREATED = NO).
 *
 * 🔴 `linkedin_url` se deja FUERA del `select` a propósito: la columna puede no
 * existir en un entorno donde su migración no se haya aplicado —`candidate-writer`
 * ya arrastra un reintento para ese caso exacto— y una consulta que la pida
 * fallaría entera, dejando la siembra vacía por una columna opcional. El
 * LinkedIn se recupera de la metadata, que es donde los tres escritores lo
 * escriben de todos modos.
 */
const SEED_COLUMNS =
  'id, name, domain, website, country_code, tax_id, tax_identifier, status, metadata, source_trace';

export type BatchIdentitySeedRow = {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  tax_id: string | null;
  tax_identifier: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  source_trace: Record<string, unknown> | null;
};

export type BatchIdentitySeedOutcome = {
  registry: BatchIdentityRegistry;
  /** Filas realmente sembradas. */
  seededCount: number;
  /** `true` cuando la lectura falló o degradó: la cobertura es MENOR, no mayor. */
  degraded: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * LinkedIn de empresa tal como los tres escritores lo dejan en metadata:
 * la ruta canónica `linkedin_enrichment.company_url` y la plana `linkedin_url`
 * que las filas antiguas conservan. `normalizeLinkedinUrl` (dentro del
 * constructor de evidencia) rechaza después cualquier perfil personal.
 */
function readLinkedInFromMetadata(metadata: Record<string, unknown> | null): string | null {
  const enrichment = asRecord(metadata?.['linkedin_enrichment']);
  return readString(enrichment, 'company_url') ?? readString(metadata, 'linkedin_url');
}

/**
 * Identidad nativa del proveedor de una fila persistida.
 *
 * Se compone SÓLO cuando `source_trace` trae proveedor E id de empresa del
 * proveedor. Hoy eso ocurre en la ruta Lusha (`providerCompanyId`). Ninguna otra
 * ruta lo escribe, y no se inventa: sin las dos partes la clave es `null`.
 */
function readProviderEntityKey(sourceTrace: Record<string, unknown> | null): string | null {
  return buildProviderEntityKey({
    providerKey: readString(sourceTrace, 'sourceProvider'),
    providerEntityId: readString(sourceTrace, 'providerCompanyId'),
  });
}

/** Convierte una fila persistida en identidad registrada. Puro. */
export function toRegisteredBatchIdentity(row: BatchIdentitySeedRow): RegisteredBatchIdentity {
  const metadata = asRecord(row.metadata);
  const sourceTrace = asRecord(row.source_trace);
  return {
    candidateId: row.id,
    evidence: buildCompanyIdentityEvidence({
      countryCode: row.country_code,
      taxId: row.tax_id,
      taxIdentifier: row.tax_identifier,
      domain: row.domain,
      website: row.website,
      linkedinUrl: readLinkedInFromMetadata(metadata),
      providerKey: readString(sourceTrace, 'sourceProvider'),
      providerEntityId: readString(sourceTrace, 'providerCompanyId'),
    }),
  };
}

/** Expuesto para las guardas: la clave de proveedor de una fila persistida. */
export function providerEntityKeyForSeedRow(row: BatchIdentitySeedRow): string | null {
  return readProviderEntityKey(asRecord(row.source_trace));
}

/**
 * Construye y siembra el registro de identidad de UN lote.
 *
 * `batchId` nulo ⇒ registro vacío sin consulta: un lote que aún no existe no
 * puede contener nada.
 */
export async function loadBatchIdentityRegistry(
  client: SupabaseClient,
  batchId: string | null,
): Promise<BatchIdentitySeedOutcome> {
  const registry = createBatchIdentityRegistry(batchId);
  if (!batchId) return { registry, seededCount: 0, degraded: false };

  try {
    const { data, error } = await client
      .from('prospect_candidates')
      .select(SEED_COLUMNS)
      .eq('batch_id', batchId)
      .in('status', [...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES]);

    if (error || !Array.isArray(data)) {
      return { registry, seededCount: 0, degraded: true };
    }

    const seeds = (data as unknown as BatchIdentitySeedRow[]).map(toRegisteredBatchIdentity);
    return {
      registry: seedBatchIdentityRegistry(registry, seeds),
      seededCount: seeds.length,
      degraded: false,
    };
  } catch {
    return { registry, seededCount: 0, degraded: true };
  }
}
