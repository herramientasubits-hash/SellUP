/**
 * Los textos de las acciones que hace Rumbo, la IA de SellUp (dueña 19-10): cada botón
 * que lanza un agente dice qué hace «con Rumbo IA», para que se distinga de las acciones
 * manuales en toda la plataforma. Un solo lugar para que no se desalineen.
 */

export const RUMBO_IA = 'Rumbo IA';

/** «Buscar contactos» → «Buscar contactos con Rumbo IA». */
export function withRumbo(action: string): string {
  return `${action} con ${RUMBO_IA}`;
}

export const RUMBO_ACTION_LABELS = {
  /** Agente 1: buscar empresas nuevas. */
  generate: withRumbo('Generar'),
  /** Agente 1: la búsqueda final del asistente. */
  search: withRumbo('Buscar'),
  /** Agente 2: los decisores de una empresa. */
  findContacts: withRumbo('Buscar contactos'),
  /** Agente 3: la primera preparación de una empresa. */
  prepareFirstContact: withRumbo('Preparar primer contacto'),
  /** Agente 3: con preparaciones hechas (otro decisor, canal o enfoque). */
  newPreparation: withRumbo('Nueva preparación'),
  /** Agente 3: rehacer una preparación. */
  anotherVersion: withRumbo('Otra versión'),
} as const;
