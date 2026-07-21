/**
 * EC SCVS — Adapter
 *
 * Pipeline puro (sin IO):
 *   raw rows → validar headers (responsabilidad del reader) → contar total →
 *   excluir RUC missing → normalizar RUC → separar invalid_format →
 *   normalizar espacios de nombre/tipo/provincia → producir candidates
 *
 * NO deduplica. La deduplicación y su semántica es responsabilidad exclusiva
 * de ec-scvs-duplicate-profiler.ts (Catálogo.EC.3, tarea 7).
 *
 * Hito: Catálogo.EC.3 — sin writes DB.
 */

import type {
  EcScvsRawRow,
  EcScvsNormalizedCandidate,
  EcScvsAdapterResult,
  EcScvsAdapterStats,
} from './ec-scvs-types';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';

/** Trim + colapso de espacios internos repetidos, sin inventar contenido. */
function normalizeWhitespace(raw: string | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function normalizeNullableWhitespace(raw: string | null): string | null {
  if (raw === null) return null;
  const normalized = normalizeWhitespace(raw);
  return normalized === '' ? null : normalized;
}

export function adaptEcScvsRows(rows: EcScvsRawRow[]): EcScvsAdapterResult {
  const stats: EcScvsAdapterStats = {
    totalSourceRows: rows.length,
    missingRucRows: 0,
    invalidRucRows: 0,
    acceptedPreDedupRows: 0,
    distinctNormalizedRuc: 0,
    duplicateRucGroups: 0,
    duplicateRowsExcess: 0,
  };

  const candidates: EcScvsNormalizedCandidate[] = [];
  const invalidCandidates: EcScvsNormalizedCandidate[] = [];
  const missingRucCandidates: EcScvsNormalizedCandidate[] = [];
  const rucCounts = new Map<string, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const rucResult = normalizeEcuadorRuc(row.ruc);

    if (rucResult.status === 'missing') {
      // EC-SCVS-2: retener en vez de descartar. En NATIVE_RECORD_GRAIN una
      // fila con expediente válido y sin RUC puede ser admisible en el
      // snapshot builder. NO entra en candidates (keyed-by-RUC) para no
      // contaminar el profiling de duplicados.
      stats.missingRucRows++;
      missingRucCandidates.push({
        sourceRowIndex: i,
        expediente: row.expediente,
        rawRuc: row.ruc,
        normalizedRuc: '',
        sourceReportedName: normalizeWhitespace(row.nombre),
        companyType: normalizeNullableWhitespace(row.tipo),
        provinceCode: normalizeNullableWhitespace(row.pro_codigo),
        province: normalizeNullableWhitespace(row.provincia),
      });
      continue;
    }

    if (rucResult.status === 'invalid_format' || !rucResult.normalized) {
      stats.invalidRucRows++;
      invalidCandidates.push({
        sourceRowIndex: i,
        expediente: row.expediente,
        rawRuc: row.ruc,
        normalizedRuc: '',
        sourceReportedName: normalizeWhitespace(row.nombre),
        companyType: normalizeNullableWhitespace(row.tipo),
        provinceCode: normalizeNullableWhitespace(row.pro_codigo),
        province: normalizeNullableWhitespace(row.provincia),
      });
      continue;
    }

    stats.acceptedPreDedupRows++;
    rucCounts.set(rucResult.normalized, (rucCounts.get(rucResult.normalized) ?? 0) + 1);

    candidates.push({
      sourceRowIndex: i,
      expediente: row.expediente,
      rawRuc: row.ruc,
      normalizedRuc: rucResult.normalized,
      sourceReportedName: normalizeWhitespace(row.nombre),
      companyType: normalizeNullableWhitespace(row.tipo),
      provinceCode: normalizeNullableWhitespace(row.pro_codigo),
      province: normalizeNullableWhitespace(row.provincia),
    });
  }

  stats.distinctNormalizedRuc = rucCounts.size;

  let duplicateRucGroups = 0;
  let duplicateRowsExcess = 0;
  for (const count of rucCounts.values()) {
    if (count > 1) {
      duplicateRucGroups++;
      duplicateRowsExcess += count - 1;
    }
  }
  stats.duplicateRucGroups = duplicateRucGroups;
  stats.duplicateRowsExcess = duplicateRowsExcess;

  return { candidates, invalidCandidates, missingRucCandidates, stats };
}
