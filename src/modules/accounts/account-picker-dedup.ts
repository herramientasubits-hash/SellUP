export interface PickerRow {
  id: string;
  name: string;
  domain: string | null;
  hubspot_company_id: string | null;
}

export interface AccountPickerOption {
  id: string;
  name: string;
  domain: string | null;
}

/**
 * Deduplicates active account rows by normalized domain.
 * When multiple rows share the same domain:
 *   - Prefers the row with a hubspot_company_id.
 *   - Otherwise keeps the first row encountered (caller should pre-sort).
 * Rows without a domain are always included (no dedup applied).
 */
export function dedupAccountsForPicker(rows: PickerRow[]): AccountPickerOption[] {
  const byDomain = new Map<string, { option: AccountPickerOption; hasHubspot: boolean }>();
  const noDomain: AccountPickerOption[] = [];

  for (const row of rows) {
    const norm = row.domain?.trim().toLowerCase() ?? null;
    const option: AccountPickerOption = { id: row.id, name: row.name, domain: norm };
    const hasHubspot = !!row.hubspot_company_id;

    if (!norm) {
      noDomain.push(option);
      continue;
    }

    const existing = byDomain.get(norm);
    if (!existing || (!existing.hasHubspot && hasHubspot)) {
      byDomain.set(norm, { option, hasHubspot });
    }
  }

  return [...Array.from(byDomain.values()).map((v) => v.option), ...noDomain];
}

/** Builds the display label for an account picker option. */
export function accountPickerLabel(option: AccountPickerOption): string {
  return option.domain ? `${option.name} · ${option.domain}` : option.name;
}
