// FEEDBACK 29-10 — cuándo se ofrece «Verificar ahora». Puro, para la ficha y para la acción.
// Sólo prospectos en revisión cuya duplicidad no se pudo comprobar: lo ya verificado no se
// vuelve a mirar desde aquí (su veredicto lo decide una persona con «Marcar duplicado»).

const UNVERIFIED_STATUSES = new Set(['unchecked', 'insufficient_data']);

export function canRecheckDuplicates(input: {
  status: string | null | undefined;
  duplicateStatus: string | null | undefined;
}): boolean {
  return input.status === 'needs_review' && UNVERIFIED_STATUSES.has(input.duplicateStatus ?? 'unchecked');
}
