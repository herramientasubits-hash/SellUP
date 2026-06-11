'use server';

import { createClient } from '@/lib/supabase/server';
import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import {
  exploratorySearchSchema,
  detectPromptInjection,
  normalizeCriteria,
} from './schema';
import { isSubindustryApplicable } from './loader';
import type { ExploratorySearchFormInput, ExploratorySearchValidationResult } from './types';

// ── Employee size threshold — always derived server-side ───────────────────────

const EMPLOYEE_SIZE_CRITERIA = {
  minEmployeeCountExclusive: 200 as const,
  enforcement: 'hard_filter' as const,
  scope: 'local_legal_entity' as const,
};

// ── Server action: validate exploratory search ────────────────────────────────
// Validates the form without creating any batch, candidate, or AI call.
// Re-queries the catalog to confirm version consistency and referential integrity.

export async function validateExploratorySearch(
  input: ExploratorySearchFormInput,
): Promise<ExploratorySearchValidationResult> {
  // 1. Verify authenticated user
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: { _auth: ['Debes iniciar sesión para continuar.'] },
    };
  }

  // 2. Parse and validate form input
  const parsed = exploratorySearchSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_root';
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    return { valid: false, preview: null, warnings: [], fieldErrors };
  }

  const {
    countryCode,
    industryId,
    subindustryIds,
    additionalCriteriaRaw,
    requestedCount,
    catalogVersion,
  } = parsed.data;

  const warnings: string[] = [];
  const fieldErrors: Record<string, string[]> = {};

  // 3. Re-query the published catalog to verify version and referential integrity
  const { data: catalogRows, error: catalogError } = await supabase
    .from('active_industry_catalog')
    .select(
      'catalog_version, industry_id, industry_name, subindustry_id, subindustry_name, applicable_countries',
    );

  if (catalogError || !catalogRows || catalogRows.length === 0) {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: { _catalog: ['No se pudo verificar el catálogo. Intenta nuevamente.'] },
    };
  }

  // 4. Confirm submitted version matches current published version
  const publishedVersion = catalogRows[0].catalog_version as string;
  if (catalogVersion !== publishedVersion) {
    return {
      valid: false,
      preview: null,
      warnings: [],
      fieldErrors: {
        catalogVersion: [
          'El catálogo ha sido actualizado. Por favor recarga la página e intenta nuevamente.',
        ],
      },
    };
  }

  // 5. Validate industry exists in current catalog
  const industryRow = catalogRows.find((r) => r.industry_id === industryId);
  if (!industryRow) {
    fieldErrors.industryId = ['La industria seleccionada no existe en el catálogo activo.'];
    return { valid: false, preview: null, warnings, fieldErrors };
  }

  const industryName = industryRow.industry_name as string;

  // 6. Build subindustry map for this industry
  type SubRow = { industry_id: string; subindustry_id: string; subindustry_name: string; applicable_countries: string[] | null };
  const industrySubRows = (catalogRows as SubRow[]).filter(
    (r) => r.industry_id === industryId,
  );
  const subMap = new Map(
    industrySubRows.map((r) => [
      r.subindustry_id,
      { name: r.subindustry_name, applicableCountries: r.applicable_countries },
    ]),
  );

  // 7. Validate each subindustry: belongs to industry + applicable to country
  const validatedSubindustries: Array<{ id: string; name: string }> = [];
  for (const subId of subindustryIds) {
    const sub = subMap.get(subId);
    if (!sub) {
      if (!fieldErrors.subindustryIds) fieldErrors.subindustryIds = [];
      fieldErrors.subindustryIds.push(
        `Una subindustria seleccionada no pertenece a la industria elegida o no existe.`,
      );
      break;
    }
    if (!isSubindustryApplicable({ applicableCountries: sub.applicableCountries }, countryCode)) {
      if (!fieldErrors.subindustryIds) fieldErrors.subindustryIds = [];
      fieldErrors.subindustryIds.push(
        `La subindustria "${sub.name}" no está disponible para el país seleccionado.`,
      );
      break;
    }
    validatedSubindustries.push({ id: subId, name: sub.name });
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, preview: null, warnings, fieldErrors };
  }

  // 8. Detect prompt injection in additional criteria (warn, do not block)
  const normalizedCriteria = normalizeCriteria(additionalCriteriaRaw);
  if (normalizedCriteria && detectPromptInjection(normalizedCriteria)) {
    warnings.push(
      'El criterio específico contiene instrucciones que no se procesarán. Solo se usará como contexto descriptivo.',
    );
  }

  // 9. Resolve country name
  const countryEntry = LATAM_COUNTRIES.find((c) => c.code === countryCode);
  const countryName = countryEntry?.name ?? countryCode;

  // 10. Return preview — no writes
  return {
    valid: true,
    preview: {
      catalogVersion: publishedVersion,
      countryCode,
      countryName,
      industryId,
      industryName,
      subindustries: validatedSubindustries,
      additionalCriteriaRaw: additionalCriteriaRaw ?? null,
      additionalCriteriaNormalized: normalizedCriteria,
      employeeSizeCriteria: EMPLOYEE_SIZE_CRITERIA,
      requestedCount,
    },
    warnings,
    fieldErrors: {},
  };
}
