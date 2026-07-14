/**
 * PanamaCompra Panamá — Snapshot Builder Convenio Marco
 *
 * Construye filas para source_company_snapshots agrupando proveedores
 * PanamaCompra por RUC (normalizedTaxId) o por providerId cuando no hay RUC.
 *
 * Deduplicación: por IdEmpresa → IdProveedor → normalizedTaxId (en ese orden de
 * prioridad si están disponibles). Agrupa convenios participados por proveedor.
 *
 * Guardrails semánticos en raw_data:
 *   source_type: 'procurement_signal'
 *   coverage_scope: 'convenio_marco'
 *   legal_validation_status: 'not_applicable'   — no es fuente legal
 *   tax_validation_status: 'not_applicable'      — no es fuente fiscal
 *   human_review_required: true
 *
 * No escribe en Supabase. No toca accounts, source_coverage_summaries.
 *
 * Hito: Centroamérica.5B
 */

import type { PanaNormalizedProvider } from './panamacompra-pa-normalizer';
import { buildRecordIdentityKey, deriveTaxRecordIdentity } from '../../record-identity';
import type { RecordIdentityResult } from '../../record-identity';

// ─── Constantes ────────────────────────────────────────────────────────────────

export const PANAMACOMPRA_SOURCE_KEY = 'pa_panamacompra_convenio' as const;
export const PANAMACOMPRA_COUNTRY_CODE = 'PA' as const;
export const PANAMACOMPRA_SOURCE_URL = 'https://www.panamacompra.gob.pa/Inicio/';

// ─── Tipos ─────────────────────────────────────────────────────────────────────

export type PanamaConvenioRef = {
  id: string | number;
  nombre?: string | null;
};

export type PanamaProviderEntry = {
  provider: PanaNormalizedProvider;
  conveniosParticipados: PanamaConvenioRef[];
};

export type PanamaSnapshotRawData = {
  source_type: 'procurement_signal';
  coverage_scope: 'convenio_marco';
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  human_review_required: true;
  provider_id: string | null;
  company_id: string | null;
  convenios: PanamaConvenioRef[];
  representative_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  branches: PanaNormalizedProvider['branches'];
};

export type PanamaSnapshotRow = {
  source_key: typeof PANAMACOMPRA_SOURCE_KEY;
  country_code: typeof PANAMACOMPRA_COUNTRY_CODE;
  tax_id: string | null;
  normalized_tax_id: string | null;
  legal_name: string | null;
  status: 'active_or_listed';
  source_url: string;
  raw_data: PanamaSnapshotRawData;
};

// ─── Deduplicación ─────────────────────────────────────────────────────────────

/**
 * Clave de deduplicación para un proveedor normalizado.
 * Prioridad: companyId → providerId → normalizedTaxId → legalName
 */
export function deduplicationKey(provider: PanaNormalizedProvider): string {
  if (provider.companyId) return `company:${provider.companyId}`;
  if (provider.providerId) return `provider:${provider.providerId}`;
  if (provider.normalizedTaxId) return `ruc:${provider.normalizedTaxId}`;
  return `name:${(provider.legalName ?? '').toLowerCase().trim()}`;
}

/**
 * Deduplica un array de entradas provider+convenio por clave de deduplicación.
 * Acumula los convenios participados de duplicados en el proveedor superviviente.
 * Cuando hay múltiples versiones del mismo proveedor, retiene la que tenga más
 * campos completos (email > phone > address).
 */
export function deduplicateProviderEntries(
  entries: PanamaProviderEntry[],
): PanamaProviderEntry[] {
  const map = new Map<string, PanamaProviderEntry>();

  for (const entry of entries) {
    const key = deduplicationKey(entry.provider);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        provider: entry.provider,
        conveniosParticipados: [...entry.conveniosParticipados],
      });
    } else {
      // Acumular convenios únicos
      const seen = new Set(existing.conveniosParticipados.map((c) => String(c.id)));
      for (const conv of entry.conveniosParticipados) {
        if (!seen.has(String(conv.id))) {
          existing.conveniosParticipados.push(conv);
          seen.add(String(conv.id));
        }
      }

      // Retener la versión más completa del proveedor
      const existingScore = completenessScore(existing.provider);
      const newScore = completenessScore(entry.provider);
      if (newScore > existingScore) {
        map.set(key, { provider: entry.provider, conveniosParticipados: existing.conveniosParticipados });
      }
    }
  }

  return Array.from(map.values());
}

function completenessScore(p: PanaNormalizedProvider): number {
  let score = 0;
  if (p.email) score += 3;
  if (p.phone) score += 2;
  if (p.address) score += 2;
  if (p.representativeName) score += 2;
  if (p.normalizedTaxId) score += 3;
  if (p.branches.length > 0) score += 1;
  return score;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

/**
 * Construye una fila de snapshot para un proveedor PanamaCompra.
 * No escribe en DB — solo construye la estructura en memoria.
 */
export function buildPanamaSnapshotRow(entry: PanamaProviderEntry): PanamaSnapshotRow {
  const { provider, conveniosParticipados } = entry;

  const rawData: PanamaSnapshotRawData = {
    source_type: 'procurement_signal',
    coverage_scope: 'convenio_marco',
    legal_validation_status: 'not_applicable',
    tax_validation_status: 'not_applicable',
    human_review_required: true,
    provider_id: provider.providerId,
    company_id: provider.companyId,
    convenios: conveniosParticipados,
    representative_name: provider.representativeName,
    phone: provider.phone,
    email: provider.email,
    address: provider.address,
    branches: provider.branches,
  };

  return {
    source_key: PANAMACOMPRA_SOURCE_KEY,
    country_code: PANAMACOMPRA_COUNTRY_CODE,
    tax_id: provider.rucOriginal,
    normalized_tax_id: provider.normalizedTaxId,
    legal_name: provider.legalName,
    status: 'active_or_listed',
    source_url: PANAMACOMPRA_SOURCE_URL,
    raw_data: rawData,
  };
}

/**
 * Construye el array de snapshots en memoria desde las entradas deduplicadas.
 * No escribe en Supabase. No toca source_company_snapshots.
 */
export function buildPanamaSnapshotRows(entries: PanamaProviderEntry[]): PanamaSnapshotRow[] {
  return entries.map((e) => buildPanamaSnapshotRow(e));
}

// ─── Record identity (EC4D5.C3 — shadow dual-write, additive) ─────────────────

export type PanamaRecordIdentityInput = {
  companyId: string | null;
  providerId: string | null;
  normalizedTaxId: string | null;
};

/**
 * Deriva record_identity_key para un proveedor PanamaCompra.
 * Precedencia: company_id (nativo) → provider_id (nativo) → normalized_tax_id.
 * Nunca deriva de nombre/razón social/slug/hash. Si nada está disponible,
 * retorna 'unavailable' — la fila sigue llegando al writer sin bloquearse.
 */
export function derivePanamaRecordIdentity(input: PanamaRecordIdentityInput): RecordIdentityResult {
  if (input.companyId) {
    return buildRecordIdentityKey('company', input.companyId);
  }
  if (input.providerId) {
    return buildRecordIdentityKey('provider', input.providerId);
  }
  return deriveTaxRecordIdentity(input.normalizedTaxId);
}
