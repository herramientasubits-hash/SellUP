/**
 * DGCP RD Connector — Snapshot Builder
 *
 * Construye filas para source_company_snapshots agrupando contratos
 * por proveedor (RNC normalizado) y año de adjudicación.
 *
 * Clave única: (source_key, country_code, source_year, normalized_tax_id)
 *
 * Schema real de source_company_snapshots:
 *   source_key, country_code, source_year, tax_id, normalized_tax_id,
 *   legal_name, normalized_legal_name, sector, city, department, region,
 *   priority_score, signals (JSONB), financials (JSONB), raw_data (JSONB), imported_at
 *
 * Guardrails semánticos obligatorios (van en raw_data):
 *   source_type: 'procurement_signal'
 *   legal_validation_status: 'not_applicable'  — DGCP no es fuente fiscal
 *   tax_validation_status: 'not_applicable'
 *   official_ciiu_available: false
 *   ciiu_status: 'unavailable_for_mvp'
 *   sector_source: 'procurement_category_or_not_official'
 *   human_review_required: true
 *   priority_boost: true
 */

import type { DgcpProveedor } from './dgcp-rd-client';
import type { NormalizedContrato } from './dgcp-rd-normalizer';

export const DGCP_SOURCE_KEY = 'do_dgcp';
export const DGCP_COUNTRY_CODE = 'DO';
const MAX_SAMPLE_CONTRACTS = 10;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DgcpSampleContract = {
  codigo_proceso: string | null;
  codigo_contrato: string | null;
  award_status: string | null;
  award_date: string | null;
  award_amount_dop: number | null;
  buyer_name: string | null;
  buyer_code: string | null;
  descripcion: string | null;
  url_contrato: string | null;
};

export type DgcpSnapshotRawData = {
  rpe: string;
  razon_social: string | null;
  source_type: 'procurement_signal';
  legal_validation_status: 'not_applicable';
  tax_validation_status: 'not_applicable';
  official_ciiu_available: false;
  ciiu_status: 'unavailable_for_mvp';
  sector_source: 'procurement_category_or_not_official';
  human_review_required: true;
  priority_boost: true;
  total_contracts_year: number;
  total_awarded_amount_dop: number;
  currency: string;
  last_award_date: string | null;
  sample_contracts: DgcpSampleContract[];
  provider: {
    tipo_documento: string | null;
    numero_documento: string | null;
    estado_proveedor: string | null;
    es_mipyme: boolean | null;
    clasificacion: string | null;
    pais: string | null;
    region: string | null;
    provincia: string | null;
    municipio: string | null;
  };
};

export type DgcpSnapshotRow = {
  source_key: 'do_dgcp';
  country_code: 'DO';
  source_year: number;
  tax_id: string;
  normalized_tax_id: string;
  legal_name: string | null;
  sector: null;
  city: null;
  department: null;
  region: string | null;
  priority_score: number;
  signals: {
    total_contracts_year: number;
    total_awarded_amount_dop: number;
    last_award_date: string | null;
  };
  financials: Record<string, never>;
  raw_data: DgcpSnapshotRawData;
  imported_at: string;
};

// ─── Accumulator ───────────────────────────────────────────────────────────────

export type ProviderAccumulator = {
  rpe: string;
  sourceYear: number;
  contracts: NormalizedContrato[];
  totalAmountDop: number;
  lastAwardDate: string | null;
};

/**
 * Agrupa contratos normalizados por (rpe, award_year).
 * Solo incluye contratos con rpe válido y año parseable.
 */
export function accumulateByRpeYear(
  contratos: NormalizedContrato[],
): Map<string, ProviderAccumulator> {
  const map = new Map<string, ProviderAccumulator>();

  for (const contrato of contratos) {
    if (!contrato.rpe || !contrato.award_year) continue;

    const key = `${contrato.rpe}::${contrato.award_year}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, {
        rpe: contrato.rpe,
        sourceYear: contrato.award_year,
        contracts: [contrato],
        totalAmountDop: contrato.valor_contratado ?? 0,
        lastAwardDate: contrato.fecha_adjudicacion,
      });
    } else {
      existing.contracts.push(contrato);
      existing.totalAmountDop += contrato.valor_contratado ?? 0;
      if (
        contrato.fecha_adjudicacion &&
        (!existing.lastAwardDate || contrato.fecha_adjudicacion > existing.lastAwardDate)
      ) {
        existing.lastAwardDate = contrato.fecha_adjudicacion;
      }
    }
  }

  return map;
}

// ─── Builder ───────────────────────────────────────────────────────────────────

/**
 * Construye una fila de source_company_snapshots para un proveedor/año.
 * Todos los guardrails semánticos van en raw_data (no son columnas top-level).
 */
export function buildDgcpSnapshotRow(params: {
  acc: ProviderAccumulator;
  proveedor: DgcpProveedor;
  normalizedRnc: string;
  importedAt?: string;
}): DgcpSnapshotRow {
  const { acc, proveedor, normalizedRnc } = params;
  const importedAt = params.importedAt ?? new Date().toISOString();

  const sampleContracts: DgcpSampleContract[] = acc.contracts
    .slice(0, MAX_SAMPLE_CONTRACTS)
    .map((c) => ({
      codigo_proceso: c.codigo_proceso,
      codigo_contrato: c.codigo_contrato,
      award_status: c.estado_adjudicacion,
      award_date: c.fecha_adjudicacion,
      award_amount_dop: c.valor_contratado,
      buyer_name: c.unidad_compra,
      buyer_code: c.codigo_unidad_compra,
      descripcion: c.descripcion,
      url_contrato: c.url_contrato,
    }));

  const rawData: DgcpSnapshotRawData = {
    rpe: acc.rpe,
    razon_social: proveedor.razon_social,
    source_type: 'procurement_signal',
    legal_validation_status: 'not_applicable',
    tax_validation_status: 'not_applicable',
    official_ciiu_available: false,
    ciiu_status: 'unavailable_for_mvp',
    sector_source: 'procurement_category_or_not_official',
    human_review_required: true,
    priority_boost: true,
    total_contracts_year: acc.contracts.length,
    total_awarded_amount_dop: acc.totalAmountDop,
    currency: 'DOP',
    last_award_date: acc.lastAwardDate,
    sample_contracts: sampleContracts,
    provider: {
      tipo_documento: proveedor.tipo_documento,
      numero_documento: proveedor.numero_documento,
      estado_proveedor: proveedor.estado,
      es_mipyme: proveedor.es_mipyme,
      clasificacion: proveedor.clasificacion,
      pais: proveedor.pais,
      region: proveedor.region,
      provincia: proveedor.provincia,
      municipio: proveedor.municipio,
    },
  };

  return {
    source_key: DGCP_SOURCE_KEY,
    country_code: DGCP_COUNTRY_CODE,
    source_year: acc.sourceYear,
    tax_id: normalizedRnc,
    normalized_tax_id: normalizedRnc,
    legal_name: proveedor.razon_social,
    sector: null,
    city: null,
    department: null,
    region: proveedor.region ?? null,
    priority_score: Math.min(acc.contracts.length * 10, 100),
    signals: {
      total_contracts_year: acc.contracts.length,
      total_awarded_amount_dop: acc.totalAmountDop,
      last_award_date: acc.lastAwardDate,
    },
    financials: {},
    raw_data: rawData,
    imported_at: importedAt,
  };
}
