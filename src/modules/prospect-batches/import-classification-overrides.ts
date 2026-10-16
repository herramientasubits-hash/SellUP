// ── Importar candidatos — correcciones manuales de industria al crear el lote ─
//
// AGENT1-AUDIT-WS5-IMPORT-OVERRIDES-1 — la revisión del drawer guardaba la
// corrección manual sólo en su estado (`classificationRows`) y al confirmar
// enviaba la industria CRUDA del archivo: el servidor la volvía a clasificar,
// la fila seguía «requiere revisión» y la ruta respondía 422. Ahora el drawer
// envía el id del catálogo elegido y la ruta lo aplica AQUÍ, después de
// clasificar y antes de decidir si el lote se bloquea.
//
// El id NO se cree: se valida contra el catálogo vivo (mismas reglas que
// `revalidate-classification`). Un id que no existe, inactivo, o una
// subindustria de otra industria ⇒ error explícito, nunca se ignora en silencio.
// Puro: sin red, sin Supabase.

import type {
  ImportClassificationCatalog,
  ImportedProspectClassification,
} from './import-classification/import-classification-types';
import type {
  ClassifiedImportRow,
  ImportClassificationBlockingIssue,
  ImportClassificationValidationResult,
} from './import-classification-service';

export interface ManualIndustryOverride {
  industryId: string;
  subindustryId: string | null;
}

export type ManualOverrideError = {
  rowNumber: number;
  code: 'industry_not_found' | 'subindustry_not_found' | 'subindustry_wrong_industry';
  message: string;
};

export type ApplyManualOverridesResult =
  | { ok: true; result: ImportClassificationValidationResult; appliedCount: number }
  | { ok: false; errors: ManualOverrideError[] };

function buildManualClassification(
  base: ImportedProspectClassification,
  catalog: ImportClassificationCatalog,
  override: ManualIndustryOverride,
): ImportedProspectClassification | ManualOverrideError['code'] {
  const industry = catalog.industries.find((i) => i.id === override.industryId && i.active !== false);
  if (!industry) return 'industry_not_found';

  let subindustry: ImportClassificationCatalog['subindustries'][number] | null = null;
  if (override.subindustryId) {
    subindustry = catalog.subindustries.find((s) => s.id === override.subindustryId && s.active !== false) ?? null;
    if (!subindustry) return 'subindustry_not_found';
    if (subindustry.industryId !== industry.id) return 'subindustry_wrong_industry';
  }

  return {
    ...base,
    catalogVersion: catalog.version,
    industryId: industry.id,
    industrySlug: industry.slug,
    industryName: industry.name,
    industryMatchStatus: 'exact_match',
    industryMatchSource: 'manual',
    subindustryId: subindustry?.id ?? null,
    subindustrySlug: subindustry?.slug ?? null,
    subindustryName: subindustry?.name ?? null,
    subindustryMatchStatus: subindustry ? 'exact_match' : 'missing',
    subindustryMatchSource: subindustry ? 'manual' : 'none',
    suggestedIndustryId: null,
    classificationWarnings: [],
    requiresHumanReview: false,
  };
}

const OVERRIDE_ERROR_MESSAGES: Record<ManualOverrideError['code'], string> = {
  industry_not_found: 'La industria elegida no existe en el catálogo publicado.',
  subindustry_not_found: 'La subindustria elegida no existe en el catálogo publicado.',
  subindustry_wrong_industry: 'La subindustria elegida no pertenece a la industria elegida.',
};

/**
 * Aplica las correcciones manuales (por número de fila, base 1) sobre el
 * resultado de `classifyImportRows` y recalcula validez, resumen y bloqueos.
 * No muta la entrada.
 */
export function applyManualClassificationOverrides(
  result: ImportClassificationValidationResult,
  catalog: ImportClassificationCatalog,
  overrides: ReadonlyMap<number, ManualIndustryOverride>,
): ApplyManualOverridesResult {
  if (overrides.size === 0) return { ok: true, result, appliedCount: 0 };

  const errors: ManualOverrideError[] = [];
  let appliedCount = 0;
  const rows: ClassifiedImportRow[] = result.rows.map((row) => {
    const override = overrides.get(row.rowNumber);
    if (!override) return row;
    const manual = buildManualClassification(row.classification, catalog, override);
    if (typeof manual === 'string') {
      errors.push({ rowNumber: row.rowNumber, code: manual, message: OVERRIDE_ERROR_MESSAGES[manual] });
      return row;
    }
    appliedCount++;
    return {
      ...row,
      classification: manual,
      // Industria resuelta por el vendedor contra el catálogo: lista para persistir.
      validationStatus: manual.subindustryMatchStatus === 'missing' ? 'warning' : 'valid',
      canPersistAutomatically: true,
    };
  });

  if (errors.length > 0) return { ok: false, errors };

  const overriddenRows = new Set(
    rows.filter((r) => overrides.has(r.rowNumber)).map((r) => r.rowNumber),
  );
  const blockingIssues: ImportClassificationBlockingIssue[] = result.blockingIssues.filter(
    (issue) => !overriddenRows.has(issue.rowNumber),
  );

  return {
    ok: true,
    appliedCount,
    result: {
      ...result,
      rows,
      valid: blockingIssues.length === 0,
      blockingIssues,
      summary: {
        totalRows: rows.length,
        readyRows: rows.filter((r) => r.validationStatus === 'valid').length,
        normalizedRows: rows.filter((r) => r.validationStatus === 'normalized').length,
        warningRows: rows.filter((r) => r.validationStatus === 'warning').length,
        reviewRows: rows.filter((r) => r.validationStatus === 'requires_review').length,
        invalidRows: rows.filter((r) => r.validationStatus === 'invalid').length,
      },
    },
  };
}
