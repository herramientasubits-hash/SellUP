/**
 * Context Assembler — Output Transformer (Hotfix 16AB.24.5)
 *
 * Transforma un CompactVerificationRecord (output del modelo) en la fila
 * oficial de 12 columnas para importación en SellUp.
 *
 * No llama APIs externas. No modifica producción. No contiene lógica específica
 * por nombre de empresa.
 */

import type {
  CompactVerificationRecord,
  TwelveColumnRow,
  VerificationOutputValidationResult,
  VerificationOutputValidationIssue,
} from './types';
import { validateVerificationOutput } from './output-validator';

// ─── Columnas oficiales (orden exacto) ───────────────────────────────────────

export const TWELVE_COLUMN_NAMES = [
  'Empresa',
  'País',
  'Sector',
  'Sitio web',
  'LinkedIn',
  'Ciudad',
  'Tamaño estimado',
  'Descripción',
  'URL evidencia principal',
  'Fuente / evidencia',
  'Confianza',
  'Notas',
] as const;

// ─── Construcción de Notas ────────────────────────────────────────────────────

function buildNotes(record: CompactVerificationRecord): string {
  const parts: string[] = [];

  const commercialName = record.identity.commercial_name || record.candidate_name;
  const legalNameValue = record.identity.legal_name.value;
  if (legalNameValue && legalNameValue !== commercialName) {
    parts.push(`Razón social: ${legalNameValue}`);
  }

  if (record.colombia_operation.other_cities.length > 0) {
    parts.push(`Otras ciudades: ${record.colombia_operation.other_cities.join(', ')}`);
  }

  if (record.size.scope && record.size.scope !== 'colombia' && record.size.scope !== 'unknown') {
    const scopeLabel: Record<string, string> = {
      global_group: 'Tamaño corresponde al grupo global',
      legal_entity: 'Tamaño corresponde a la entidad legal',
    };
    const label = scopeLabel[record.size.scope];
    if (label) parts.push(label);
  }

  if (record.company_facts.incorporation_date) {
    parts.push(`Fecha de constitución: ${record.company_facts.incorporation_date}`);
  } else if (record.company_facts.incorporation_year !== null) {
    parts.push(`Año de constitución: ${record.company_facts.incorporation_year}`);
  }

  if (record.conflicts.length > 0) {
    parts.push(`Conflictos: ${record.conflicts.join('; ')}`);
  }

  if (record.notes) {
    parts.push(record.notes);
  }

  return parts.join(' | ');
}

// ─── Transformación principal ─────────────────────────────────────────────────

export function transformToTwelveColumns(record: CompactVerificationRecord): TwelveColumnRow {
  const empresa = record.identity.commercial_name || record.candidate_name;
  const ciudad = record.colombia_operation.primary_city ?? '';
  const tamano = record.size.value ?? '';
  const sitioWeb = record.identity.official_website ?? '';
  const linkedin = record.identity.linkedin_company_url ?? '';
  const evidenceUrl = record.primary_evidence_url ?? '';

  return {
    empresa,
    pais: 'Colombia',
    sector: 'Tecnología',
    sitio_web: sitioWeb,
    linkedin,
    ciudad,
    tamano_estimado: tamano,
    descripcion: '',
    url_evidencia_principal: evidenceUrl,
    fuente_evidencia: '',
    confianza: record.confidence,
    notas: buildNotes(record),
  };
}

// ─── Transformación con validación previa ─────────────────────────────────────

export type TransformResult =
  | { ok: true; row: TwelveColumnRow; issues: VerificationOutputValidationIssue[] }
  | { ok: false; issues: VerificationOutputValidationIssue[] };

export function transformWithValidation(raw: unknown): TransformResult {
  const validation: VerificationOutputValidationResult = validateVerificationOutput(raw);

  if (validation.sanitizedOutput === null) {
    return { ok: false, issues: validation.issues };
  }

  if (validation.blockingIssues.length > 0) {
    return { ok: false, issues: validation.issues };
  }

  const row = transformToTwelveColumns(validation.sanitizedOutput);
  return { ok: true, row, issues: validation.issues };
}

// ─── Serialización TSV ────────────────────────────────────────────────────────

export function rowToTsv(row: TwelveColumnRow): string {
  const fields = [
    row.empresa,
    row.pais,
    row.sector,
    row.sitio_web,
    row.linkedin,
    row.ciudad,
    row.tamano_estimado,
    row.descripcion.replace(/\t/g, ' ').replace(/\n/g, ' '),
    row.url_evidencia_principal,
    row.fuente_evidencia.replace(/\t/g, ' '),
    row.confianza,
    row.notas.replace(/\t/g, ' ').replace(/\n/g, ' '),
  ];
  return fields.join('\t');
}

export function assertTwelveColumns(row: TwelveColumnRow): void {
  const keys: Array<keyof TwelveColumnRow> = [
    'empresa', 'pais', 'sector', 'sitio_web', 'linkedin', 'ciudad',
    'tamano_estimado', 'descripcion', 'url_evidencia_principal',
    'fuente_evidencia', 'confianza', 'notas',
  ];
  for (const key of keys) {
    if (!(key in row)) {
      throw new Error(`Columna faltante en TwelveColumnRow: ${key}`);
    }
  }
  if (Object.keys(row).length !== 12) {
    throw new Error(`TwelveColumnRow debe tener exactamente 12 columnas, tiene ${Object.keys(row).length}`);
  }
}
