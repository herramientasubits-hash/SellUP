// BULK-COMPANY-ASSIGNMENT-1 — Reglas puras de «Asignar a…»
//
// Un líder busca empresas y las reparte entre sus vendedores, en «Empresas»
// (accounts.owner_id) y en «Por revisar» (prospect_candidates.assigned_to,
// migración 145). Aquí viven las decisiones sin base de datos para poder
// probarlas: validar la petición, quién es el responsable efectivo de un
// prospecto, cómo se filtra por persona y el texto del aviso.
//
// Sin 'use server' y sin Supabase: importable desde pruebas y desde el cliente.

/** Tope por petición: una selección masiva razonable de la tabla. */
export const MAX_ASSIGNMENT_BATCH = 500;

export type AssignmentKind = 'accounts' | 'candidates';

/** Lo que devuelven las acciones de asignar. Nunca lanzan hacia la pantalla. */
export type AssignmentActionResult =
  | { success: true; assigned: number; alreadyOwned: number; skipped: number; targetName: string }
  | { success: false; error: string };

export type AssignmentRequestValidation =
  | { ok: true; ids: string[]; targetUserId: string }
  | { ok: false; error: string };

/**
 * Normaliza la petición: ids únicos y no vacíos, destinatario presente y un
 * tope para que una selección enorme no bloquee el servidor.
 */
export function validateAssignmentRequest(input: {
  ids: readonly unknown[];
  targetUserId: unknown;
}): AssignmentRequestValidation {
  const targetUserId = typeof input.targetUserId === 'string' ? input.targetUserId.trim() : '';
  if (!targetUserId) return { ok: false, error: 'Elige a quién asignar.' };

  const ids = [
    ...new Set(
      input.ids
        .filter((id): id is string => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return { ok: false, error: 'No hay nada seleccionado para asignar.' };
  if (ids.length > MAX_ASSIGNMENT_BATCH) {
    return {
      ok: false,
      error: `Puedes asignar hasta ${MAX_ASSIGNMENT_BATCH} a la vez; seleccionaste ${ids.length}.`,
    };
  }
  return { ok: true, ids, targetUserId };
}

/**
 * Estados en los que un prospecto ya no está «por revisar»: convertido en
 * empresa (su responsable es el de la empresa), descartado o duplicado.
 * Asignarlos no tendría efecto visible.
 */
export const NON_ASSIGNABLE_CANDIDATE_STATUSES = [
  'converted_to_account',
  'discarded',
  'duplicate',
] as const;

export function isAssignableCandidateStatus(status: string | null | undefined): boolean {
  return !(NON_ASSIGNABLE_CANDIDATE_STATUSES as readonly string[]).includes(status ?? '');
}

/**
 * Responsable efectivo de un prospecto: el asignado a mano o, si no hay, el del
 * lote (owner_id y, si falta, quien lo creó). Es la misma regla con la que se
 * filtra por persona y con la que se muestra la columna «Responsable».
 */
export function resolveCandidateResponsibleId(input: {
  assignedTo: string | null | undefined;
  batchOwnerId: string | null | undefined;
  batchCreatedBy: string | null | undefined;
}): string | null {
  return input.assignedTo || input.batchOwnerId || input.batchCreatedBy || null;
}

/**
 * A nombre de quién queda la empresa al aprobar un prospecto (antes de que
 * HubSpot, si ya tiene dueño, mande). Decisión de la dueña 08-10: si alguien
 * asignó el prospecto, el asignado; si no, quien lanzó la búsqueda (como hasta
 * ahora); sin creador del lote, quien aprueba.
 */
export function resolveConversionOwnerUserId(input: {
  assignedTo: string | null | undefined;
  batchCreatedBy: string | null | undefined;
  approverUserId: string;
}): string {
  return input.assignedTo || input.batchCreatedBy || input.approverUserId;
}

/**
 * Filtro PostgREST (`.or(...)`) de los prospectos cuyo responsable efectivo
 * está en `userIds`:
 *   - asignados a mano a uno de ellos, o
 *   - sin asignar y en un lote que es de uno de ellos (`ownedBatchIds`).
 *
 * Devuelve null cuando no hay nadie (la llamada debe responder vacío sin
 * consultar).
 */
export function buildCandidateOwnershipOrClause(
  userIds: readonly string[],
  ownedBatchIds: readonly string[],
): string | null {
  if (userIds.length === 0) return null;
  const byAssignment = `assigned_to.in.(${userIds.join(',')})`;
  if (ownedBatchIds.length === 0) return byAssignment;
  return `${byAssignment},and(assigned_to.is.null,batch_id.in.(${ownedBatchIds.join(',')}))`;
}

/**
 * Combina el alcance comercial con el filtro por persona. `null` = sin
 * restricción en esa dimensión. El filtro nunca amplía el alcance.
 */
export function intersectOptionalUserIds(
  scopeUserIds: readonly string[] | null,
  filterUserIds: readonly string[] | null,
): string[] | null {
  if (scopeUserIds === null) return filterUserIds === null ? null : [...new Set(filterUserIds)];
  if (filterUserIds === null) return [...new Set(scopeUserIds)];
  const scope = new Set(scopeUserIds);
  return [...new Set(filterUserIds.filter((id) => scope.has(id)))];
}

/** Separa lo que de verdad cambia de lo que ya era del destinatario. */
export function partitionByCurrentOwner<T extends { id: string; currentOwnerId: string | null }>(
  rows: readonly T[],
  targetUserId: string,
): { toChange: T[]; alreadyOwned: T[] } {
  const toChange: T[] = [];
  const alreadyOwned: T[] = [];
  for (const row of rows) {
    (row.currentOwnerId === targetUserId ? alreadyOwned : toChange).push(row);
  }
  return { toChange, alreadyOwned };
}

const NOUNS: Record<AssignmentKind, [string, string]> = {
  accounts: ['empresa', 'empresas'],
  candidates: ['empresa por revisar', 'empresas por revisar'],
};

export function assignmentNoun(kind: AssignmentKind, count: number): string {
  const [singular, plural] = NOUNS[kind];
  return count === 1 ? singular : plural;
}

export interface AssignmentNotification {
  title: string;
  message: string;
  actionLabel: string;
  actionUrl: string;
}

/** Aviso en la campanita para quien recibe la asignación. */
export function buildAssignmentNotification(input: {
  kind: AssignmentKind;
  count: number;
  actorName: string | null;
  targetUserId: string;
  sampleNames: readonly string[];
}): AssignmentNotification {
  const noun = assignmentNoun(input.kind, input.count);
  const who = input.actorName?.trim() || 'Alguien';
  const title =
    input.count === 1 ? `Te asignaron 1 ${noun}` : `Te asignaron ${input.count} ${noun}`;

  const sample = input.sampleNames.filter(Boolean).slice(0, 3);
  const rest = input.count - sample.length;
  const list =
    sample.length === 0
      ? ''
      : `: ${sample.join(', ')}${rest > 0 ? ` y ${rest} más` : ''}`;

  const actionUrl =
    input.kind === 'accounts'
      ? '/accounts'
      : `/accounts?tab=prospectos&userId=${encodeURIComponent(input.targetUserId)}`;

  return {
    title,
    message: `${who} te asignó ${input.count === 1 ? 'una' : input.count} ${noun}${list}.`,
    actionLabel: input.kind === 'accounts' ? 'Ver empresas' : 'Ver por revisar',
    actionUrl,
  };
}

/** Texto del aviso de éxito en pantalla. */
export function describeAssignmentResult(input: {
  kind: AssignmentKind;
  assigned: number;
  alreadyOwned: number;
  skipped: number;
  targetName: string;
}): string {
  const parts: string[] = [];
  if (input.assigned > 0) {
    parts.push(
      `${input.assigned} ${assignmentNoun(input.kind, input.assigned)} ${
        input.assigned === 1 ? 'asignada' : 'asignadas'
      } a ${input.targetName}`,
    );
  }
  if (input.alreadyOwned > 0) {
    parts.push(
      `${input.alreadyOwned} ya ${input.alreadyOwned === 1 ? 'era suya' : 'eran suyas'}`,
    );
  }
  if (input.skipped > 0) {
    parts.push(
      `${input.skipped} no se ${input.skipped === 1 ? 'pudo' : 'pudieron'} asignar`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nada que asignar';
}
