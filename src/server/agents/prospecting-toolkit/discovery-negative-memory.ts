/**
 * Discovery Negative Memory — Hito 16AB.43.24
 *
 * Carga el historial de dominios ya sugeridos por agent_1 en los últimos N días.
 * Permite excluir dominios ya vistos antes de contar candidatos como "nuevos",
 * evitando gastar créditos Tavily en resultados que novelty bloqueará de todas formas.
 *
 * Solo hace SELECTs — sin writes, sin LLM, sin proveedores externos.
 * Si Supabase no está disponible, devuelve memoria vacía (graceful fallback).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from './normalization';
import { buildIdentityKey } from './canonical-company-identity';
import { deriveRecordOriginClassification } from '@/modules/agent1-effectiveness/classification';
// AGENT1-APOLLO-HISTORICAL-DELIVERY-FINALITY § 2 — el conjunto de procedencias
// que NO son entregas productivas vive en UN solo sitio. Antes había una copia
// local aquí; dos listas del mismo concepto habrían divergido en el primer corte
// que tocara una sola de ellas.
import { NON_DELIVERY_RECORD_ORIGINS } from './apollo-prepaid-historical-parity';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type DiscoveryNegativeMemoryScope = {
  countryCode: string;
  industryName: string;
  subindustryNames: string[];
  lookbackDays: number;
};

export type DiscoveryNegativeMemory = {
  excludedDomains: Set<string>;
  /** Muestra de dominios excluidos (máx 20) para metadata/trazabilidad. */
  excludedDomainsSample: string[];
  /**
   * Claves de identidad canónica de empresas ya sugeridas.
   * Permite bloquear "Siesa Enterprise" cuando "Siesa" ya fue sugerida.
   * Hito 16AB.43.25.
   */
  excludedIdentityKeys: Set<string>;
  /** Muestra de identity keys excluidas (máx 20) para trazabilidad. */
  excludedIdentityKeysSample: string[];
  previousCandidateCount: number;
  previousBatchCount: number;
  scope: DiscoveryNegativeMemoryScope;
};

// ─── Helpers públicos ─────────────────────────────────────────────────────────

export function emptyNegativeMemory(scope: DiscoveryNegativeMemoryScope): DiscoveryNegativeMemory {
  return {
    excludedDomains: new Set(),
    excludedDomainsSample: [],
    excludedIdentityKeys: new Set(),
    excludedIdentityKeysSample: [],
    previousCandidateCount: 0,
    previousBatchCount: 0,
    scope,
  };
}

/**
 * Verifica si un dominio (raw, con protocolo o path) está en la memoria negativa.
 * Normaliza antes de comparar para soportar variantes como http/https/www.
 */
export function isDomainInNegativeMemory(
  domain: string | null,
  memory: DiscoveryNegativeMemory,
): boolean {
  if (!domain || memory.excludedDomains.size === 0) return false;
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return memory.excludedDomains.has(normalized);
}

/**
 * Verifica si la identity key canónica de un nombre de empresa ya está en la
 * memoria negativa (empresa ya sugerida con otro nombre/dominio).
 * Hito 16AB.43.25.
 */
export function isIdentityKeyInNegativeMemory(
  name: string | null,
  memory: DiscoveryNegativeMemory,
): boolean {
  if (!name || memory.excludedIdentityKeys.size === 0) return false;
  const key = buildIdentityKey(name);
  if (!key) return false;
  return memory.excludedIdentityKeys.has(key);
}

/**
 * Cuenta cuántos dominios de una lista de candidatos (domain | null) están en
 * la memoria negativa. Útil para tracking de round metadata.
 */
export function countDomainsInNegativeMemory(
  domains: (string | null)[],
  memory: DiscoveryNegativeMemory,
): number {
  if (memory.excludedDomains.size === 0) return 0;
  return domains.filter((d) => isDomainInNegativeMemory(d, memory)).length;
}

// ─── Carga desde Supabase ─────────────────────────────────────────────────────

type CandidateRow = {
  batch_id?: string | null;
  domain: string | null;
  name: string | null;
  status?: string | null;
  duplicate_status?: string | null;
  source_primary?: string | null;
  review_notes?: string | null;
  metadata?: Record<string, unknown> | null;
};


/**
 * Carga la memoria negativa de empresas ya sugeridas recientemente.
 *
 * AGENT1-APOLLO-PREPAID-HISTORICAL-PARITY § 2 — antes esta memoria se construía
 * en dos pasos, y el primero era `prospect_batches.eq('source','agent_1')`. Ese
 * filtro hacía INVISIBLES los lotes históricos válidos con cualquier otra fuente
 * (`socrata_colombia`, `denue_mexico`, `datos_gob_cl`, `apollo`, `imported`,
 * `external_import`, `manual`), de modo que una empresa entregada por la ruta
 * gratuita podía volver a costar un enrichment de Apollo.
 *
 * La autoridad de ámbito ya no es la etiqueta del LOTE: es la FILA del candidato.
 * `prospect_candidates` es el libro de entregas de Agente 1 —ninguna entrega
 * existe sin una fila aquí— y el clasificador canónico de procedencia
 * (`deriveRecordOriginClassification`, la misma autoridad que lee el modelo de
 * efectividad) decide si esa fila salió de una corrida real o de smoke/QA/
 * limpieza/dato fabricado. No se abre una segunda fuente de verdad y no se
 * enumera ninguna lista de `source`.
 *
 * Ámbito GLOBAL SELLUP por construcción: no se filtra por usuario, organización,
 * lote ni `client_request_id`. Si la empresa X se entregó, X es histórica.
 *
 * No filtra por country/industry a nivel DB (no hay columna directa que lo
 * permita sin perder filas). Todos los candidatos recientes son relevantes porque
 * compiten por el mismo universo de empresas que el discovery intenta encontrar.
 *
 * Graceful fallback: devuelve emptyNegativeMemory ante cualquier error de Supabase.
 */
export async function loadDiscoveryNegativeMemory(
  supabase: SupabaseClient,
  scope: DiscoveryNegativeMemoryScope,
): Promise<DiscoveryNegativeMemory> {
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - scope.lookbackDays);
  const lookbackIso = lookbackDate.toISOString();

  type SupabaseBase = ReturnType<typeof import('@supabase/supabase-js').createClient>;
  const client = supabase as unknown as SupabaseBase;

  // Una sola consulta, sobre la tabla que ES el libro de entregas. Sin filtro de
  // `source` y sin join al lote: la procedencia se juzga por fila.
  const { data: candidateRows, error: candidateError } = await client
    .from('prospect_candidates')
    .select(
      'batch_id, domain, name, status, duplicate_status, source_primary, review_notes, metadata',
    )
    .gte('created_at', lookbackIso);

  if (candidateError || !candidateRows) {
    return emptyNegativeMemory(scope);
  }

  const rows = (candidateRows as CandidateRow[]).filter((row) => {
    const classification = deriveRecordOriginClassification({
      status: row.status ?? null,
      duplicate_status: row.duplicate_status ?? null,
      source_primary: row.source_primary ?? null,
      review_notes: row.review_notes ?? null,
      metadata: row.metadata ?? null,
    });
    return !NON_DELIVERY_RECORD_ORIGINS.has(classification.recordOrigin);
  });

  // Normalizar y deduplicar dominios
  const excludedDomains = new Set<string>();
  for (const row of rows) {
    if (row.domain) {
      const normalized = normalizeDomain(row.domain);
      if (normalized) excludedDomains.add(normalized);
    }
  }

  // Construir identity keys desde nombres previos (Hito 16AB.43.25)
  const excludedIdentityKeys = new Set<string>();
  for (const row of rows) {
    if (row.name) {
      const key = buildIdentityKey(row.name);
      if (key) excludedIdentityKeys.add(key);
    }
  }

  const excludedDomainsSample = [...excludedDomains].slice(0, 20);
  const excludedIdentityKeysSample = [...excludedIdentityKeys].slice(0, 20);

  return {
    excludedDomains,
    excludedDomainsSample,
    excludedIdentityKeys,
    excludedIdentityKeysSample,
    previousCandidateCount: rows.length,
    // Se deriva de las filas que SÍ entraron en el ámbito. Antes contaba lotes de
    // `agent_1`; ahora cuenta los lotes que realmente aportaron entregas, sin
    // depender de la etiqueta `source`.
    previousBatchCount: new Set(
      rows.map((row) => row.batch_id).filter((id): id is string => typeof id === 'string'),
    ).size,
    scope,
  };
}
