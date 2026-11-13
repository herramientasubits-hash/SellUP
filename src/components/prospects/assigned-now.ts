import type { CandidateResponsible } from '@/modules/prospect-batches/types';

/** Quien quedó como responsable tras «Asignar a…», mientras la página no vuelve. */
export type AssignedNow = ReadonlyMap<string, CandidateResponsible>;

interface AssignedUser {
  id: string;
  full_name: string | null;
  email: string;
}

/** Anota (sin mutar) que esas filas ahora son de esa persona. */
export function markAssigned(prev: AssignedNow, ids: readonly string[], user: AssignedUser): AssignedNow {
  const next = new Map(prev);
  const responsible: CandidateResponsible = {
    id: user.id,
    name: user.full_name?.trim() || user.email,
    isAssigned: true,
  };
  for (const id of ids) next.set(id, responsible);
  return next;
}

/**
 * Pinta lo recién asignado sobre las filas del servidor. Si la base ya dice lo
 * mismo, la fila del servidor manda (y la marca deja de importar).
 */
export function applyAssignedNow<TRow extends { id: string; responsible?: CandidateResponsible | null }>(
  rows: readonly TRow[],
  assignedNow: AssignedNow,
): TRow[] {
  if (assignedNow.size === 0) return rows as TRow[];
  return rows.map((row) => {
    const assigned = assignedNow.get(row.id);
    if (!assigned || row.responsible?.id === assigned.id) return row;
    return { ...row, responsible: assigned };
  });
}
