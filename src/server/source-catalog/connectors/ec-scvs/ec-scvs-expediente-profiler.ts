/**
 * EC SCVS — Expediente Profiler (Catálogo.EC.3B)
 *
 * Profiling EXPERIMENTAL del campo nativo "expediente" para evaluar si puede
 * fundamentar una futura source-record identity. Este módulo:
 *
 *   - NO reemplaza el profiler D3 (ec-scvs-duplicate-profiler.ts, grouping por
 *     RUC normalizado). Lo complementa.
 *   - NO declara un normalizador productivo. Solo trim + clasificación de
 *     shape (numeric-only / alphanumeric / punctuation / leading zeros) con
 *     fines de profiling.
 *   - NO deduplica candidatos ni escribe nada.
 *
 * Puro / sin IO / sin DB. Hito: Catálogo.EC.3B.
 */

import { createHash } from 'node:crypto';
import type {
  EcScvsRawRow,
  EcScvsNormalizedCandidate,
  EcScvsExpedienteProfilingNormalization,
  EcScvsExpedienteGlobalProfile,
  EcScvsExpedienteRucCardinalityProfile,
  EcScvsExpedienteRucRelationshipClass,
  EcScvsExpedienteDuplicateClass,
  EcScvsExpedienteDuplicateGroup,
  EcScvsExpedienteDuplicateClassSummary,
  EcScvsExpedienteDuplicateProfilingResult,
  EcScvsRucExpedienteCrossReferenceBucket,
  EcScvsRucExpedienteCrossReferenceResult,
} from './ec-scvs-types';
import { normalizeEcuadorRuc } from './ec-ruc-normalizer';
import { classifyDuplicateGroup } from './ec-scvs-duplicate-profiler';

const EXPEDIENTE_DUPLICATE_CLASS_ORDER: EcScvsExpedienteDuplicateClass[] = [
  'X1_EXACT_DUPLICATE_ROWS',
  'X2_SAME_IDENTITY_LOCATION_VARIANT',
  'X3_SAME_EXPEDIENTE_RUC_VARIANT',
  'X4_SAME_EXPEDIENTE_NAME_VARIANT',
  'X5_SAME_EXPEDIENTE_TYPE_VARIANT',
  'X6_MULTI_FIELD_CONFLICT',
];

/** Hash seguro y corto de un valor de expediente. Nunca reversible en reportes. */
export function hashExpedienteForProfiling(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function trimOrNull(raw: string | null): string | null {
  if (raw === null) return null;
  return raw.trim();
}

function normalizeWhitespace(raw: string | null): string {
  if (!raw) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function allEqual<T>(values: T[]): boolean {
  if (values.length === 0) return true;
  const first = values[0];
  return values.every((v) => v === first);
}

// ─── Tarea 2 — Normalización experimental (helper puro por fila) ──────────────

/**
 * Normaliza (solo con fines de profiling) un expediente crudo.
 * Reglas permitidas: trim + clasificación de shape. NUNCA elimina leading
 * zeros, NUNCA reemplaza caracteres, NUNCA infiere desde row index.
 */
export function normalizeScvsExpedienteForProfiling(
  raw: string | null,
): EcScvsExpedienteProfilingNormalization {
  if (raw === null) {
    return {
      trimmed: null,
      isUsable: false,
      length: null,
      isNumericOnly: false,
      hasLetters: false,
      hasPunctuation: false,
      hasLeadingZero: false,
    };
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return {
      trimmed: '',
      isUsable: false,
      length: 0,
      isNumericOnly: false,
      hasLetters: false,
      hasPunctuation: false,
      hasLeadingZero: false,
    };
  }

  const isNumericOnly = /^\d+$/.test(trimmed);
  const hasLetters = /[A-Za-z]/.test(trimmed);
  const hasPunctuation = /[^A-Za-z0-9]/.test(trimmed);
  const hasLeadingZero = isNumericOnly && trimmed.length > 1 && trimmed.startsWith('0');

  return {
    trimmed,
    isUsable: true,
    length: trimmed.length,
    isNumericOnly,
    hasLetters,
    hasPunctuation,
    hasLeadingZero,
  };
}

// ─── Tarea 3 — Profiling global raw + trimmed ─────────────────────────────────

export function profileExpedienteGlobal(rows: EcScvsRawRow[]): EcScvsExpedienteGlobalProfile {
  let nonNullCount = 0;
  let nullCount = 0;
  let emptyAfterTrimCount = 0;
  let numericOnlyCount = 0;
  let alphanumericCount = 0;
  let punctuationCount = 0;
  let leadingZeroCount = 0;
  let minLength: number | null = null;
  let maxLength: number | null = null;

  const rawCounts = new Map<string, number>();
  const trimmedCounts = new Map<string, number>();
  const lengthCounts = new Map<number, number>();

  for (const row of rows) {
    if (row.expediente === null) {
      nullCount++;
      continue;
    }
    nonNullCount++;
    rawCounts.set(row.expediente, (rawCounts.get(row.expediente) ?? 0) + 1);

    const norm = normalizeScvsExpedienteForProfiling(row.expediente);
    const trimmedKey = norm.trimmed ?? '';
    trimmedCounts.set(trimmedKey, (trimmedCounts.get(trimmedKey) ?? 0) + 1);

    if (!norm.isUsable) {
      emptyAfterTrimCount++;
      continue;
    }

    const length = norm.length ?? 0;
    minLength = minLength === null ? length : Math.min(minLength, length);
    maxLength = maxLength === null ? length : Math.max(maxLength, length);
    lengthCounts.set(length, (lengthCounts.get(length) ?? 0) + 1);

    if (norm.isNumericOnly) numericOnlyCount++;
    if (norm.hasLetters && /\d/.test(norm.trimmed ?? '')) alphanumericCount++;
    if (norm.hasPunctuation) punctuationCount++;
    if (norm.hasLeadingZero) leadingZeroCount++;
  }

  let duplicateRawGroups = 0;
  for (const count of rawCounts.values()) if (count > 1) duplicateRawGroups++;

  let duplicateTrimmedGroups = 0;
  let duplicateRowsExcess = 0;
  for (const count of trimmedCounts.values()) {
    if (count > 1) {
      duplicateTrimmedGroups++;
      duplicateRowsExcess += count - 1;
    }
  }

  const lengthDistribution = Array.from(lengthCounts.entries())
    .map(([length, count]) => ({ length, count }))
    .sort((a, b) => a.length - b.length);

  return {
    totalRows: rows.length,
    nonNullCount,
    nullCount,
    emptyAfterTrimCount,
    distinctRawCount: rawCounts.size,
    distinctTrimmedCount: trimmedCounts.size,
    duplicateRawGroups,
    duplicateTrimmedGroups,
    duplicateRowsExcess,
    minLength,
    maxLength,
    lengthDistribution,
    numericOnlyCount,
    alphanumericCount,
    punctuationCount,
    leadingZeroCount,
  };
}

// ─── Tarea 4 — Cardinalidad expediente ↔ RUC ──────────────────────────────────

export function profileExpedienteRucCardinality(
  rows: EcScvsRawRow[],
): EcScvsExpedienteRucCardinalityProfile {
  const byExpediente = new Map<string, Set<string>>();
  const byRuc = new Map<string, Set<string>>();

  let usableExpedienteRows = 0;
  let rowsWithoutUsableExpediente = 0;
  let rowsWithoutUsableExpedienteButValidRuc = 0;

  for (const row of rows) {
    const norm = normalizeScvsExpedienteForProfiling(row.expediente);
    const rucResult = normalizeEcuadorRuc(row.ruc);
    const hasValidRuc = rucResult.status === 'valid' && !!rucResult.normalized;

    if (!norm.isUsable || norm.trimmed === null) {
      rowsWithoutUsableExpediente++;
      if (hasValidRuc) rowsWithoutUsableExpedienteButValidRuc++;
      continue;
    }

    usableExpedienteRows++;
    const expedienteKey = norm.trimmed;

    let rucSet = byExpediente.get(expedienteKey);
    if (!rucSet) {
      rucSet = new Set<string>();
      byExpediente.set(expedienteKey, rucSet);
    }

    if (hasValidRuc) {
      rucSet.add(rucResult.normalized as string);

      let expSet = byRuc.get(rucResult.normalized as string);
      if (!expSet) {
        expSet = new Set<string>();
        byRuc.set(rucResult.normalized as string, expSet);
      }
      expSet.add(expedienteKey);
    }
  }

  let expedientesWithZeroValidRuc = 0;
  let expedientesWithExactlyOneRuc = 0;
  let expedientesWithMoreThanOneRuc = 0;
  let maxDistinctRucPerExpediente = 0;

  for (const rucSet of byExpediente.values()) {
    maxDistinctRucPerExpediente = Math.max(maxDistinctRucPerExpediente, rucSet.size);
    if (rucSet.size === 0) expedientesWithZeroValidRuc++;
    else if (rucSet.size === 1) expedientesWithExactlyOneRuc++;
    else expedientesWithMoreThanOneRuc++;
  }

  let rucWithExactlyOneExpediente = 0;
  let rucWithMoreThanOneExpediente = 0;
  let maxExpedientesPerRuc = 0;

  for (const expSet of byRuc.values()) {
    maxExpedientesPerRuc = Math.max(maxExpedientesPerRuc, expSet.size);
    if (expSet.size === 1) rucWithExactlyOneExpediente++;
    else rucWithMoreThanOneExpediente++;
  }

  const hasB = rucWithMoreThanOneExpediente > 0;
  const hasC = expedientesWithMoreThanOneRuc > 0;

  let relationshipClass: EcScvsExpedienteRucRelationshipClass;
  if (!hasB && !hasC) {
    relationshipClass = 'A_ONE_TO_ONE';
  } else if (hasB && !hasC) {
    relationshipClass = 'B_ONE_RUC_TO_MANY_EXPEDIENTES';
  } else if (!hasB && hasC) {
    relationshipClass = 'C_ONE_EXPEDIENTE_TO_MANY_RUCS';
  } else {
    relationshipClass = 'D_MANY_TO_MANY';
  }

  return {
    usableExpedienteRows,
    rowsWithoutUsableExpediente,
    rowsWithoutUsableExpedienteButValidRuc,
    expedientesWithZeroValidRuc,
    expedientesWithExactlyOneRuc,
    expedientesWithMoreThanOneRuc,
    maxDistinctRucPerExpediente,
    rucWithExactlyOneExpediente,
    rucWithMoreThanOneExpediente,
    maxExpedientesPerRuc,
    relationshipClass,
  };
}

// ─── Tarea 5 — Duplicate expediente groups (X1–X6) ────────────────────────────

/**
 * Clasifica un grupo de filas que comparten el mismo expediente trimmed.
 * El grupo debe tener 2 o más filas (llamador garantiza esto).
 * Espejo estructural de classifyDuplicateGroup (D3) con el eje invertido.
 */
export function classifyExpedienteDuplicateGroup(
  rowsInGroup: EcScvsRawRow[],
): EcScvsExpedienteDuplicateClass {
  const sameRuc = allEqual(rowsInGroup.map((r) => trimOrNull(r.ruc)));
  const sameName = allEqual(rowsInGroup.map((r) => normalizeWhitespace(r.nombre)));
  const sameType = allEqual(rowsInGroup.map((r) => trimOrNull(r.tipo)));
  const sameLocation = allEqual(
    rowsInGroup.map((r) => `${trimOrNull(r.pro_codigo) ?? ''}|${trimOrNull(r.provincia) ?? ''}`),
  );

  if (sameRuc && sameName && sameType && sameLocation) {
    return 'X1_EXACT_DUPLICATE_ROWS';
  }

  if (sameRuc && sameName && sameType && !sameLocation) {
    return 'X2_SAME_IDENTITY_LOCATION_VARIANT';
  }

  if (!sameRuc && sameName && sameType) {
    return 'X3_SAME_EXPEDIENTE_RUC_VARIANT';
  }

  if (sameRuc && !sameName && sameType) {
    return 'X4_SAME_EXPEDIENTE_NAME_VARIANT';
  }

  if (sameRuc && sameName && !sameType) {
    return 'X5_SAME_EXPEDIENTE_TYPE_VARIANT';
  }

  return 'X6_MULTI_FIELD_CONFLICT';
}

export function profileDuplicateExpedienteGroups(
  rows: EcScvsRawRow[],
): EcScvsExpedienteDuplicateProfilingResult {
  const byExpediente = new Map<string, EcScvsRawRow[]>();

  for (const row of rows) {
    const norm = normalizeScvsExpedienteForProfiling(row.expediente);
    if (!norm.isUsable || norm.trimmed === null) continue;

    const bucket = byExpediente.get(norm.trimmed);
    if (bucket) bucket.push(row);
    else byExpediente.set(norm.trimmed, [row]);
  }

  const groups: EcScvsExpedienteDuplicateGroup[] = [];
  const classCounts = new Map<EcScvsExpedienteDuplicateClass, { groups: number; rows: number }>();
  for (const cls of EXPEDIENTE_DUPLICATE_CLASS_ORDER) classCounts.set(cls, { groups: 0, rows: 0 });

  let maxGroupSize = 0;
  let groupsWithTwoRows = 0;
  let groupsWithThreeRows = 0;
  let groupsWithMoreThanThreeRows = 0;
  let totalDuplicateRows = 0;
  let totalExcessRows = 0;

  for (const [expediente, rowsInGroup] of byExpediente.entries()) {
    if (rowsInGroup.length < 2) continue;

    const duplicateClass = classifyExpedienteDuplicateGroup(rowsInGroup);
    const groupHash = hashExpedienteForProfiling(expediente);

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

  const classSummary: EcScvsExpedienteDuplicateClassSummary[] = EXPEDIENTE_DUPLICATE_CLASS_ORDER.map(
    (cls) => {
      const counter = classCounts.get(cls)!;
      return {
        duplicateClass: cls,
        groups: counter.groups,
        rows: counter.rows,
        excessRows: counter.groups > 0 ? counter.rows - counter.groups : 0,
      };
    },
  );

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

// ─── Tarea 6 — Cruce duplicate-RUC groups (D3) ↔ expediente ───────────────────

function emptyBucket(): EcScvsRucExpedienteCrossReferenceBucket {
  return {
    groups: 0,
    groupsWithAllDistinctExpediente: 0,
    groupsWithSharedExpedienteWithinGroup: 0,
    expedienteReusedElsewhereCount: 0,
    unresolvedExcessRows: 0,
  };
}

/**
 * Cruza los duplicate-RUC groups (clases C y F del profiler D3, agrupados por
 * normalizedRuc) contra expediente, para responder si expediente separa de
 * forma inequívoca los registros que hoy colisionan por RUC.
 */
export function crossReferenceRucExpedienteCollisions(
  candidates: EcScvsNormalizedCandidate[],
): EcScvsRucExpedienteCrossReferenceResult {
  const byRuc = new Map<string, EcScvsNormalizedCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byRuc.get(candidate.normalizedRuc);
    if (bucket) bucket.push(candidate);
    else byRuc.set(candidate.normalizedRuc, [candidate]);
  }

  // Mapa global: expediente trimmed → set de RUC normalizados asociados,
  // para responder "¿este expediente se reutiliza en otro RUC?".
  const globalExpedienteToRuc = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const norm = normalizeScvsExpedienteForProfiling(candidate.expediente);
    if (!norm.isUsable || norm.trimmed === null) continue;
    let set = globalExpedienteToRuc.get(norm.trimmed);
    if (!set) {
      set = new Set<string>();
      globalExpedienteToRuc.set(norm.trimmed, set);
    }
    set.add(candidate.normalizedRuc);
  }

  const classC = emptyBucket();
  const classF = emptyBucket();

  for (const rowsInGroup of byRuc.values()) {
    if (rowsInGroup.length < 2) continue;

    const legacyClass = classifyDuplicateGroup(rowsInGroup);
    if (legacyClass !== 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS' && legacyClass !== 'F_MULTI_FIELD_CONFLICT') {
      continue;
    }

    const bucket = legacyClass === 'C_SAME_COMPANY_MULTIPLE_EXPEDIENTS' ? classC : classF;
    bucket.groups++;

    const expedienteValues = rowsInGroup.map(
      (r) => normalizeScvsExpedienteForProfiling(r.expediente).trimmed,
    );
    const usableValues = expedienteValues.filter((v): v is string => v !== null && v !== '');
    const distinctCount = new Set(usableValues).size;
    const allDistinct = usableValues.length === rowsInGroup.length && distinctCount === usableValues.length;

    if (allDistinct) {
      bucket.groupsWithAllDistinctExpediente++;
    } else {
      bucket.groupsWithSharedExpedienteWithinGroup++;
      bucket.unresolvedExcessRows += rowsInGroup.length - distinctCount;
    }

    for (const value of new Set(usableValues)) {
      const rucSet = globalExpedienteToRuc.get(value);
      if (rucSet && rucSet.size > 1) {
        bucket.expedienteReusedElsewhereCount++;
      }
    }
  }

  const totalUnresolvedGroups =
    classC.groupsWithSharedExpedienteWithinGroup + classF.groupsWithSharedExpedienteWithinGroup;
  const totalUnresolvedExcessRows = classC.unresolvedExcessRows + classF.unresolvedExcessRows;

  return {
    classC,
    classF,
    resolvesRucCollisions: totalUnresolvedGroups === 0,
    totalUnresolvedGroups,
    totalUnresolvedExcessRows,
  };
}
