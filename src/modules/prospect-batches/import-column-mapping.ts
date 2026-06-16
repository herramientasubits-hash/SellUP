// ── Column mapping utility — Hito 16AB.40 ─────────────────────────────────────
// Client-safe. Detects Industry/Subindustry columns from file headers.

import type {
  ImportColumnTarget,
  ImportColumnMapping,
} from './import-classification/import-classification-ui-types';
import {
  INDUSTRY_HEADER_ALIASES,
  SUBINDUSTRY_HEADER_ALIASES,
} from './import-classification/import-classification-ui-types';

// ── Normalize header for comparison ───────────────────────────────────────────

function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Auto-detect column mappings from file headers ─────────────────────────────

export function detectColumnMappings(
  headers: string[],
  sampleRows: Array<Record<string, string | undefined>>,
): ImportColumnMapping[] {
  const mappings: ImportColumnMapping[] = [];
  const usedTargets = new Set<ImportColumnTarget>();

  for (const header of headers) {
    const normalized = normalizeHeader(header);
    const target = resolveTarget(normalized, usedTargets);
    const sampleValues = sampleRows
      .slice(0, 5)
      .map((row) => row[header] ?? '')
      .filter((v) => v.length > 0);

    mappings.push({
      sourceColumn: header,
      targetField: target,
      detectedAutomatically: target !== 'ignore',
      sampleValues,
    });

    if (target !== 'ignore') {
      usedTargets.add(target);
    }
  }

  return mappings;
}

// ── Resolve a single header to a target field ─────────────────────────────────

function resolveTarget(
  normalizedHeader: string,
  usedTargets: Set<ImportColumnTarget>,
): ImportColumnTarget {
  // Check Industry aliases
  if (INDUSTRY_HEADER_ALIASES.includes(normalizedHeader)) {
    if (!usedTargets.has('industry')) return 'industry';
  }

  // Check Subindustry aliases
  if (SUBINDUSTRY_HEADER_ALIASES.includes(normalizedHeader)) {
    if (!usedTargets.has('subindustry')) return 'subindustry';
  }

  // Check known field patterns (from EXTERNAL_IMPORT_CONTRACT)
  const FIELD_PATTERNS: Array<{ pattern: RegExp; target: ImportColumnTarget }> = [
    { pattern: /^empresa|^company|^nombre empresa|^razon social/i, target: 'company_name' },
    { pattern: /^pais|^country|^pa[ií]s/i, target: 'country' },
    { pattern: /^sitio web|^website|^url|^pagina|^p[aá]gina web/i, target: 'website' },
    { pattern: /^linkedin/i, target: 'linkedin' },
    { pattern: /^ciudad|^city/i, target: 'city' },
    { pattern: /^tam[aá]no|^size|^empleados|^employee/i, target: 'employee_size' },
    { pattern: /^descripci[oó]n|^description/i, target: 'description' },
    { pattern: /^url evidencia|^evidence url|^fuente principal/i, target: 'primary_evidence_url' },
    { pattern: /^fuente|^evidence|^evidencia/i, target: 'evidence_source' },
    { pattern: /^confianza|^confidence/i, target: 'confidence' },
    { pattern: /^notas|^notes/i, target: 'notes' },
  ];

  for (const { pattern, target } of FIELD_PATTERNS) {
    if (pattern.test(normalizedHeader) && !usedTargets.has(target)) {
      return target;
    }
  }

  return 'ignore';
}

// ── Check if a target is already mapped ───────────────────────────────────────

export function isTargetMapped(
  target: ImportColumnTarget,
  mappings: ImportColumnMapping[],
  excludeSource?: string,
): boolean {
  return mappings.some(
    (m) => m.targetField === target && m.sourceColumn !== excludeSource,
  );
}

// ── Get unique industry/subindustry original values for bulk correction ────────

export function groupRowsByOriginalValues(
  rows: Array<{
    rowNumber: number;
    industryOriginalValue: string | null;
    subindustryOriginalValue: string | null;
    countryCode: string | null;
  }>,
): Map<string, Array<number>> {
  const groups = new Map<string, Array<number>>();

  for (const row of rows) {
    const key = [
      (row.industryOriginalValue ?? '').toLowerCase().trim(),
      (row.subindustryOriginalValue ?? '').toLowerCase().trim(),
      (row.countryCode ?? '').toUpperCase(),
    ].join('|||');

    const existing = groups.get(key);
    if (existing) {
      existing.push(row.rowNumber);
    } else {
      groups.set(key, [row.rowNumber]);
    }
  }

  return groups;
}
