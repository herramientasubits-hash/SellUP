// Commercial scope for Contactos. A contact has no owner of its own: it
// inherits visibility from its account, with the exact rule Empresas uses
// (src/modules/accounts/actions.ts) — a non-admin sees an account when they, or
// someone in their scope, own it or created it. So a user sees the contacts of
// the companies they can see, and nothing else.
//
// Pure helpers (no Supabase, no cookies) so the rule is testable under
// `node --test`; the server actions in ./actions.ts do the I/O.

/** Columns on `accounts` that attribute a row to an internal user. */
export const CONTACT_ACCOUNT_OWNER_COLUMNS = ['owner_id', 'created_by'] as const;

export interface ContactAccountOwnership {
  owner_id: string | null;
  created_by: string | null;
}

/**
 * PostgREST `.or()` clause for the embedded `account` resource: matches when
 * any owner column is in `ids`. Callers must not pass an empty list — an empty
 * scope means "see nothing" and is short-circuited before querying.
 */
export function contactAccountScopeOrClause(ids: readonly string[]): string {
  return CONTACT_ACCOUNT_OWNER_COLUMNS.map((col) => `${col}.in.(${ids.join(',')})`).join(
    ',',
  );
}

/**
 * Whether a contact's account falls inside the scope.
 * `scopeIds === null` means no constraint (flag off, or admin).
 */
export function isContactAccountInScope(
  account: ContactAccountOwnership | null,
  scopeIds: readonly string[] | null,
): boolean {
  if (scopeIds === null) return true;
  if (!account) return false;
  const allowed = new Set(scopeIds);
  return CONTACT_ACCOUNT_OWNER_COLUMNS.some((col) => {
    const id = account[col];
    return id != null && allowed.has(id);
  });
}
