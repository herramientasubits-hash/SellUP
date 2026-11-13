// ============================================================
// Directorio de personas (servidor): nombres y correos de OTRAS personas.
//
// La RLS de `internal_users` sólo deja a un no-admin leer SU fila. Por eso
// cualquier pantalla que muestre «quién» (responsable, quién lanzó, quién
// descartó, autor de un cambio) o que necesite el correo de otra persona (dueño
// en HubSpot) debe leerlo aquí, con el cliente de servicio, DESPUÉS de haber
// comprobado que quien pide puede ver ese registro. Nunca devuelve más que
// nombre y correo. Sin 'use server': no es una acción.
// ============================================================

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { displayUserName } from './user-names';

export interface DirectoryUser {
  id: string;
  name: string;
  fullName: string | null;
  email: string | null;
}

type Row = { id: string; full_name: string | null; email: string | null };

/** Personas por id (máx. 1.000 por llamada). Ids vacíos o repetidos se ignoran. */
export async function loadDirectoryUsers(
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, DirectoryUser>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const out = new Map<string, DirectoryUser>();
  if (unique.length === 0) return out;
  for (let i = 0; i < unique.length; i += 1000) {
    const { data, error } = await createSupabaseAdminClient()
      .from('internal_users')
      .select('id, full_name, email')
      .in('id', unique.slice(i, i + 1000));
    if (error) throw new Error(`loadDirectoryUsers: ${error.message}`);
    for (const row of (data ?? []) as Row[]) {
      out.set(row.id, {
        id: row.id,
        name: displayUserName(row) ?? 'Sin nombre',
        fullName: row.full_name,
        email: row.email,
      });
    }
  }
  return out;
}

/** Sólo los nombres (para «Responsable», «Lanzada por», «Descartó», autor de un cambio). */
export async function loadDirectoryNames(
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const users = await loadDirectoryUsers(ids);
  return new Map([...users.values()].map((u) => [u.id, u.name]));
}

/** Una persona (p. ej. el correo del dueño para HubSpot). `null` si no existe. */
export async function loadDirectoryUser(id: string | null | undefined): Promise<DirectoryUser | null> {
  if (!id) return null;
  return (await loadDirectoryUsers([id])).get(id) ?? null;
}
