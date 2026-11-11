// ============================================================
// Nombre de quien hizo algo (dueña 11-11): las tablas de descartados muestran
// quién descartó cada empresa y cada contacto, para que el líder lo vea.
// ============================================================

/** Cliente mínimo: sólo lo que esta lectura usa (inyectable en pruebas). */
export interface UserNamesClient {
  from(table: 'internal_users'): {
    select(columns: 'id, full_name, email'): {
      in(column: 'id', values: readonly string[]): PromiseLike<{
        data: ReadonlyArray<{ id: string; full_name: string | null; email: string | null }> | null;
        error: unknown;
      }>;
    };
  };
}

/** El nombre visible: nombre completo, o el correo sin el dominio. */
export function displayUserName(user: { full_name: string | null; email: string | null }): string | null {
  const name = user.full_name?.trim();
  if (name) return name;
  const email = user.email?.trim();
  return email ? email.split('@')[0] : null;
}

/**
 * id de `internal_users` → nombre. Nunca lanza: si la lectura falla, la tabla
 * sigue mostrándose (la columna sale vacía).
 */
export async function loadUserNames(
  client: UserNamesClient,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  if (unique.length === 0) return new Map();
  try {
    const { data, error } = await client.from('internal_users').select('id, full_name, email').in('id', unique);
    if (error || !data) return new Map();
    const names = new Map<string, string>();
    for (const user of data) {
      const name = displayUserName(user);
      if (name) names.set(user.id, name);
    }
    return names;
  } catch {
    return new Map();
  }
}
