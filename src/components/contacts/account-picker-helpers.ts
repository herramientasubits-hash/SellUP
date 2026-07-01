export interface AccountOption {
  id: string;
  name: string;
  domain?: string | null;
}

export function accountPickerLabel(a: AccountOption): string {
  return a.domain ? `${a.name} · ${a.domain}` : a.name;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the human-readable label for a selected account id, or null if one
 * cannot be resolved. Never returns a raw UUID as a label.
 */
export function resolveSelectedAccountLabel(
  selectedAccountId: string,
  accounts: AccountOption[] | undefined,
  fallbackLabel: string | undefined,
): string | null {
  if (!selectedAccountId) return null;

  const found = accounts?.find((a) => a.id === selectedAccountId);
  if (found) return accountPickerLabel(found);

  if (fallbackLabel) return fallbackLabel;

  // Never render a raw UUID as visible text.
  if (UUID_RE.test(selectedAccountId)) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[CreateContactDrawer] selectedAccountId is a UUID but was not found in the accounts list.',
        selectedAccountId,
      );
    }
    return null;
  }

  return null;
}
