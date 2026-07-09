/**
 * EC SCVS — Duplicate Profiler
 *
 * Perfila los grupos de RUC normalizado duplicado producidos por el adapter,
 * clasificando cada grupo en exactamente una categoría (A–F) según prioridad
 * A > B > C > D > E > F, y perfila las anomalías de identificadores raw
 * non-numeric (Tarea 8).
 *
 * NUNCA imprime el RUC completo. Usa un hash corto (SHA-256, primeros 12 hex)
 * como identificador seguro de grupo para logs/reportes.
 *
 * Puro / sin IO / sin DB. Hito: Catálogo.EC.3.
 */

import { createHash } from 'node:crypto';
import type {
  EcScvsNormalizedCandidate,
  EcScvsDuplicateClass,
  EcScvsDuplicateGroup,
  EcScvsDuplicateClassSummary,
  EcScvsDuplicateProfilingResult,
  EcScvsAnomalyClass,
} from './ec-scvs-types';

const DUPLICATE_CLASS_ORDER: EcScvsDuplicateClass[] = [
  'A_EXACT_DUPLICATE_ROWS',
  'B_SAME_COMPANY_SAME_EXPEDIENT_LOCATION_VARIANT',
  'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS',
  'D_NAME_VARIANT_SAME_RUC',
  'E_COMPANY_TYPE_VARIANT_SAME_RUC',
  'F_MULTI_FIELD_CONFLICT',
];

/** Hash seguro y corto del RUC normalizado. Nunca reversible en el reporte. */
export function hashNormalizedRuc(normalizedRuc: string): string {
  return createHash('sha256').update(normalizedRuc).digest('hex').slice(0, 12);
}

function allEqual<T>(values: T[]): boolean {
  if (values.length === 0) return true;
  const first = values[0];
  return values.every((v) => v === first);
}

/**
 * Clasifica un grupo de filas que comparten el mismo RUC normalizado.
 * El grupo debe tener 2 o más filas (llamador garantiza esto).
 */
export function classifyDuplicateGroup(
  rowsInGroup: EcScvsNormalizedCandidate[],
): EcScvsDuplicateClass {
  const sameName = allEqual(rowsInGroup.map((r) => r.sourceReportedName));
  const sameType = allEqual(rowsInGroup.map((r) => r.companyType));
  const sameExpediente = allEqual(rowsInGroup.map((r) => r.expediente));
  const sameLocation = allEqual(
    rowsInGroup.map((r) => `${r.provinceCode ?? ''}|${r.province ?? ''}`),
  );

  if (sameName && sameType && sameExpediente && sameLocation) {
    return 'A_EXACT_DUPLICATE_ROWS';
  }

  if (sameName && sameType && sameExpediente && !sameLocation) {
    return 'B_SAME_COMPANY_SAME_EXPEDIENT_LOCATION_VARIANT';
  }

  if (sameName && sameType && !sameExpediente) {
    return 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS';
  }

  if (!sameName && sameType && sameExpediente && sameLocation) {
    return 'D_NAME_VARIANT_SAME_RUC';
  }

  if (sameName && !sameType && sameExpediente && sameLocation) {
    return 'E_COMPANY_TYPE_VARIANT_SAME_RUC';
  }

  return 'F_MULTI_FIELD_CONFLICT';
}

/**
 * Perfila todos los grupos de RUC duplicado a partir de candidates aceptados
 * (post-normalización RUC, pre-dedup) producidos por el adapter.
 */
export function profileDuplicateRucGroups(
  candidates: EcScvsNormalizedCandidate[],
): EcScvsDuplicateProfilingResult {
  const byRuc = new Map<string, EcScvsNormalizedCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byRuc.get(candidate.normalizedRuc);
    if (bucket) {
      bucket.push(candidate);
    } else {
      byRuc.set(candidate.normalizedRuc, [candidate]);
    }
  }

  const groups: EcScvsDuplicateGroup[] = [];
  const classCounts = new Map<EcScvsDuplicateClass, { groups: number; rows: number }>();
  for (const cls of DUPLICATE_CLASS_ORDER) classCounts.set(cls, { groups: 0, rows: 0 });

  let maxGroupSize = 0;
  let groupsWithTwoRows = 0;
  let groupsWithThreeRows = 0;
  let groupsWithMoreThanThreeRows = 0;
  let totalDuplicateRows = 0;
  let totalExcessRows = 0;

  for (const [normalizedRuc, rowsInGroup] of byRuc.entries()) {
    if (rowsInGroup.length < 2) continue;

    const duplicateClass = classifyDuplicateGroup(rowsInGroup);
    const groupHash = hashNormalizedRuc(normalizedRuc);

    groups.push({ groupHash, rowCount: rowsInGroup.length, duplicateClass });

    const counter = classCounts.get(duplicateClass)!;
    counter.groups += 1;
    counter.rows += rowsInGroup.length;

    maxGroupSize = Math.max(maxGroupSize, rowsInGroup.length);
    if (rowsInGroup.length === 2) groupsWithTwoRows++;
    else if (rowsInGroup.length === 3) groupsWithThreeRows++;
    else groupsWithMoreThanThreeRows++;

    totalDuplicateRows += rowsInGroup.length;
    totalExcessRows += rowsInGroup.length - 1;
  }

  const classSummary: EcScvsDuplicateClassSummary[] = DUPLICATE_CLASS_ORDER.map((cls) => {
    const counter = classCounts.get(cls)!;
    return {
      duplicateClass: cls,
      groups: counter.groups,
      rows: counter.rows,
      excessRows: counter.groups > 0 ? counter.rows - counter.groups : 0,
    };
  });

  return {
    groups,
    classSummary,
    totalDuplicateGroups: groups.length,
    totalDuplicateRows,
    totalExcessRows,
    maxGroupSize,
    groupsWithTwoRows,
    groupsWithThreeRows,
    groupsWithMoreThanThreeRows,
  };
}

// ─── Identifier anomaly profiling (raw non-numeric RUC) ───────────────────────

/**
 * Puntuación de agrupación conservadora tolerada al evaluar recuperabilidad:
 * espacio, guion, punto, barra, barra invertida, paréntesis, coma.
 * NO incluye letras. NO aplica sustitución de caracteres (O→0, I→1, etc.).
 */
const EC_RUC_BROAD_PUNCTUATION = /[\s.\-/\\(),]/g;
const EC_RUC_EXPECTED_LENGTH = 13;

/**
 * Clasifica un RUC crudo que ya fue rechazado por normalizeEcuadorRuc
 * (status !== 'valid', reason !== 'missing') en una de 4 clases de anomalía.
 * No corrige contenido — solo clasifica.
 */
export function classifyEcScvsRucAnomaly(raw: string): EcScvsAnomalyClass {
  const trimmed = raw.trim();
  const punctuationStripped = trimmed.replace(EC_RUC_BROAD_PUNCTUATION, '');

  if (/[A-Za-z]/.test(punctuationStripped)) {
    return 'B_ALPHABETIC_CONTAMINATION';
  }

  if (!/^\d+$/.test(punctuationStripped)) {
    return 'D_OTHER_INVALID_FORMAT';
  }

  if (punctuationStripped.length === EC_RUC_EXPECTED_LENGTH) {
    return 'A_PUNCTUATION_ONLY_RECOVERABLE';
  }

  return 'C_INVALID_LENGTH_AFTER_NORMALIZATION';
}
