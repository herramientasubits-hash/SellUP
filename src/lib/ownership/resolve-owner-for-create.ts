// ALWAYS-OWNER-ON-CREATE-1 — Todo lo que se crea en SellUp lleva responsable.
//
// Decisión de la dueña (14-10): una empresa (`accounts`) o un lote
// (`prospect_batches`) nunca nace sin `owner_id`. Si nadie eligió responsable,
// el responsable es quien lo crea (el usuario interno que actúa, el mismo id que
// va en `created_by`). En procesos de fondo sin persona delante, el humano que
// disparó la corrida (triggered_by / requested_by / dueño del lote / dueño de la
// empresa relacionada).
//
// Todo camino que inserta en `accounts` o `prospect_batches` pasa por aquí; la
// guarda estática `always-owner-on-create-guard.test.ts` lo exige.

type MaybeUserId = string | null | undefined;

export interface ResolveOwnerForCreateInput {
  /** Responsable elegido explícitamente (formulario, asignación, dueño del lote). */
  chosenOwnerId?: MaybeUserId;
  /** Quien crea el registro (`internal_users.id`, el mismo que `created_by`). */
  actorUserId?: MaybeUserId;
  /**
   * Respaldo para procesos sin persona delante, en orden de preferencia
   * (quien disparó la corrida, quien la pidió, dueño del lote…).
   */
  fallbackUserIds?: readonly MaybeUserId[];
}

function clean(id: MaybeUserId): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Responsable con el que nace el registro: el elegido; si no, quien lo crea; si
 * no, el primer respaldo humano. `null` sólo cuando no hay ningún humano: el
 * llamador decide (fallar cerrado en lo que ve el usuario, registrar y omitir en
 * procesos de fondo). Nunca inventa un responsable.
 */
export function resolveOwnerForCreate(input: ResolveOwnerForCreateInput): string | null {
  const ordered: MaybeUserId[] = [
    input.chosenOwnerId,
    input.actorUserId,
    ...(input.fallbackUserIds ?? []),
  ];
  for (const candidate of ordered) {
    const id = clean(candidate);
    if (id) return id;
  }
  return null;
}

export class OwnerRequiredError extends Error {
  readonly code = 'OWNER_REQUIRED';
  constructor(context: string) {
    super(`No se puede crear ${context} sin responsable: no hay usuario que lo cree ni lo haya pedido.`);
    this.name = 'OwnerRequiredError';
  }
}

/** Igual que `resolveOwnerForCreate`, pero falla cerrado si no hay humano. */
export function requireOwnerForCreate(input: ResolveOwnerForCreateInput, context: string): string {
  const owner = resolveOwnerForCreate(input);
  if (!owner) throw new OwnerRequiredError(context);
  return owner;
}
