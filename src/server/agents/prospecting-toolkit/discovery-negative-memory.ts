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

type BatchRow = { id: string };
type CandidateRow = { domain: string | null; name: string | null };

/**
 * Carga la memoria negativa de dominios ya sugeridos recientemente por agent_1.
 *
 * Estrategia de consulta en dos pasos:
 *   1. Obtiene IDs de batches de agent_1 creados en los últimos lookbackDays.
 *   2. Obtiene dominios de prospect_candidates en esos batches.
 *
 * No filtra por country/industry a nivel DB (no hay columna directa en prospect_candidates).
 * Todos los candidatos de agent_1 recientes son relevantes porque compiten por el
 * mismo universo de empresas que el discovery intenta encontrar.
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

  // Paso 1: obtener batch IDs de agent_1 recientes
  const { data: batchRows, error: batchError } = await client
    .from('prospect_batches')
    .select('id')
    .eq('source', 'agent_1')
    .gte('created_at', lookbackIso);

  if (batchError || !batchRows || (batchRows as BatchRow[]).length === 0) {
    return emptyNegativeMemory(scope);
  }

  const batchIds = (batchRows as BatchRow[]).map((r) => r.id);

  // Paso 2: obtener dominios y nombres de candidatos en esos batches
  const { data: candidateRows, error: candidateError } = await client
    .from('prospect_candidates')
    .select('domain, name')
    .in('batch_id', batchIds);

  if (candidateError || !candidateRows) {
    return emptyNegativeMemory(scope);
  }

  const rows = candidateRows as CandidateRow[];

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
    previousBatchCount: batchIds.length,
    scope,
  };
}
