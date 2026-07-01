export function checkAccountActiveForContact(
  account: { archived_at: string | null; pipeline_status: string } | null,
): { ok: true } | { ok: false; error: string } {
  if (!account) return { ok: false, error: 'Cuenta no encontrada' };
  if (account.archived_at !== null || account.pipeline_status === 'archived') {
    return { ok: false, error: 'No se puede crear un contacto en una cuenta archivada.' };
  }
  return { ok: true };
}
