import type { CatalogSubindustryOption } from './types';

// ── Geographic filter helper ──────────────────────────────────────────────────
// null means "applicable to all countries"
// Non-null array must include the countryCode

export function isSubindustryApplicable(
  sub: Pick<CatalogSubindustryOption, 'applicableCountries'>,
  countryCode: string,
): boolean {
  if (sub.applicableCountries === null) return true;
  return sub.applicableCountries.includes(countryCode);
}

// ── Incompatible selection detector ──────────────────────────────────────────
// Returns ids of selected subindustries that are NOT applicable to the new country.

export function detectIncompatibleSubindustries(
  selectedIds: string[],
  allSubindustries: CatalogSubindustryOption[],
  countryCode: string,
): string[] {
  const subMap = new Map(allSubindustries.map((s) => [s.id, s]));
  return selectedIds.filter((id) => {
    const sub = subMap.get(id);
    if (!sub) return true; // unknown = incompatible
    return !isSubindustryApplicable(sub, countryCode);
  });
}
