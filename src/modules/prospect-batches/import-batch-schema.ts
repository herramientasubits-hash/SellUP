// ── Importar candidatos — contrato del cuerpo de `create-import-batch` ────────
//
// AGENT1-AUDIT-WS5-IMPORT-SCHEMA-1 — la ruta confiaba en `request.json() as
// ImportBatchInput`: sin tope de filas, sin largos máximos, sin exigir el
// nombre y con cualquier código de país. Este esquema es el MISMO en los dos
// lados: el drawer lo aplica antes de enviar (para mostrar el error sin ir al
// servidor) y la ruta lo aplica ANTES de crear el lote (para no confiar en el
// cliente). Puro: sin red, sin Supabase.

import { z } from 'zod';
import { LATAM_COUNTRIES } from '@/modules/accounts/types';

/** Tope de filas por importación (el mismo del parser). */
export const IMPORT_BATCH_MAX_ROWS = 500;

const SUPPORTED_COUNTRY_CODES = new Set(LATAM_COUNTRIES.map((c) => c.code));

/** Largos máximos por campo: holgados para datos reales, cerrados para abuso. */
export const IMPORT_FIELD_MAX_LENGTH = {
  companyName: 300,
  short: 300,
  url: 2048,
  long: 5000,
  id: 64,
} as const;

/**
 * Texto opcional: `null`/vacío ⇒ ausente; un número (celdas de XLSX como el
 * NIT o el tamaño) se acepta como texto. Cualquier otro tipo es inválido.
 */
function optionalText(max: number) {
  return z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
      return value;
    },
    z.string().max(max).optional(),
  );
}

export const importCandidateSchema = z.object({
  company_name: z.preprocess(
    (value) => (typeof value === 'string' ? value.trim() : value),
    z.string().min(1, 'Falta el nombre de la empresa.').max(IMPORT_FIELD_MAX_LENGTH.companyName),
  ),
  country: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  country_code: z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== 'string') return value;
      const code = value.trim().toUpperCase();
      return code === '' ? undefined : code;
    },
    z
      .string()
      .refine((code) => SUPPORTED_COUNTRY_CODES.has(code), { message: 'País no soportado.' })
      .optional(),
  ),
  website: optionalText(IMPORT_FIELD_MAX_LENGTH.url),
  industry: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  subindustry: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  /** Corrección manual de la revisión: id del catálogo; el servidor lo valida contra el catálogo vivo. */
  industry_id: optionalText(IMPORT_FIELD_MAX_LENGTH.id),
  subindustry_id: optionalText(IMPORT_FIELD_MAX_LENGTH.id),
  city: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  region: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  tax_identifier: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  tax_identifier_type: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  linkedin_url: optionalText(IMPORT_FIELD_MAX_LENGTH.url),
  company_size: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  description: optionalText(IMPORT_FIELD_MAX_LENGTH.long),
  notes: optionalText(IMPORT_FIELD_MAX_LENGTH.long),
  source_url: optionalText(IMPORT_FIELD_MAX_LENGTH.url),
  contact_name: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  contact_role: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  contact_email: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  owner_email: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  source_evidence: optionalText(IMPORT_FIELD_MAX_LENGTH.long),
  confidence: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
  industryOriginalValue: optionalText(IMPORT_FIELD_MAX_LENGTH.short).nullable(),
  subindustryOriginalValue: optionalText(IMPORT_FIELD_MAX_LENGTH.short).nullable(),
});

const columnListSchema = z.array(z.string().max(IMPORT_FIELD_MAX_LENGTH.short)).max(200);
const countSchema = z.number().int().min(0).max(100_000);

export const importBatchInputSchema = z.object({
  import_type: z.enum(['paste', 'csv', 'xlsx']),
  candidates: z
    .array(importCandidateSchema)
    .min(1, 'No hay filas para importar.')
    .max(IMPORT_BATCH_MAX_ROWS, `Máximo ${IMPORT_BATCH_MAX_ROWS} filas por importación.`),
  recognized_columns: columnListSchema.default([]),
  unrecognized_columns: columnListSchema.default([]),
  duplicate_columns: columnListSchema.optional(),
  total_rows: countSchema,
  valid_rows: countSchema,
  invalid_rows: countSchema,
  warning_rows: countSchema,
  defaults: z
    .object({
      country: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
      country_code: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
      industry: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
      subindustry: optionalText(IMPORT_FIELD_MAX_LENGTH.short),
    })
    .optional(),
});

export type ImportCandidateInput = z.infer<typeof importCandidateSchema>;
export type ImportBatchInput = z.infer<typeof importBatchInputSchema>;

export type ImportBatchInputValidation =
  | { ok: true; data: ImportBatchInput }
  | { ok: false; message: string; issues: Array<{ path: string; message: string }> };

/** Un mensaje legible: «Fila 3 · company_name: Falta el nombre de la empresa.» */
function describeIssue(issue: z.core.$ZodIssue): { path: string; message: string } {
  const path = issue.path.map(String).join('.');
  const [root, index, field] = issue.path;
  if (root === 'candidates' && typeof index === 'number') {
    const where = field !== undefined ? ` · ${String(field)}` : '';
    return { path, message: `Fila ${index + 1}${where}: ${issue.message}` };
  }
  return { path, message: path ? `${path}: ${issue.message}` : issue.message };
}

/** Valida el cuerpo completo; nunca lanza. */
export function validateImportBatchInput(input: unknown): ImportBatchInputValidation {
  const parsed = importBatchInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = parsed.error.issues.slice(0, 20).map(describeIssue);
  return {
    ok: false,
    message: issues[0]?.message ?? 'Los datos de la importación no son válidos.',
    issues,
  };
}
