// Uso de IA › panel del Agente 1 — alcance de personas (puro, sin I/O).

/**
 * Intersección de las personas pedidas (filtros de la página) con el alcance
 * del equipo. `teamIds` null = sin restricción (administración).
 * `requested` undefined = sin filtro de personas ⇒ todo el equipo.
 */
export function restrictCreatedByIds(
  requested: string[] | undefined,
  teamIds: string[] | null,
): string[] | undefined {
  if (teamIds === null) return requested;
  if (requested === undefined) return [...teamIds];
  const allowed = new Set(teamIds);
  return requested.filter((id) => allowed.has(id));
}
