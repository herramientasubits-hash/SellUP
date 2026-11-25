// Dónde aterriza cada estado de acceso. Lo usan el callback de Google, el
// layout de la app y las pantallas de acceso (/access-*), para que las tres
// piezas decidan igual.
//
// Las pantallas de acceso revisan el estado REAL antes de pintarse: el
// navegador recuerda la última dirección (p. ej. /access-suspended cuando la
// persona estaba inactiva) y, si un admin ya la activó, volver a abrirla debe
// llevarla a la app en vez de seguir diciendo «inactivo» (feedback 25-11).

export const ACCESS_HOME_PATH = '/pipeline';

export const ACCESS_STATUS_PATHS = {
  active: ACCESS_HOME_PATH,
  pending_approval: '/access-pending',
  rejected: '/access-rejected',
  suspended: '/access-suspended',
  archived: '/access-archived',
} as const;

export type AccessStatus = keyof typeof ACCESS_STATUS_PATHS;

const DEFAULT_STATUS: AccessStatus = 'pending_approval';

/** Estado efectivo: sin fila o con un valor desconocido = pendiente. */
export function normalizeAccessStatus(status: string | null | undefined): AccessStatus {
  if (status && Object.prototype.hasOwnProperty.call(ACCESS_STATUS_PATHS, status)) {
    return status as AccessStatus;
  }
  return DEFAULT_STATUS;
}

/** Pantalla que le corresponde a un estado (activo = la app). */
export function accessPathForStatus(status: string | null | undefined): string {
  return ACCESS_STATUS_PATHS[normalizeAccessStatus(status)];
}

/**
 * Para una pantalla de acceso: `null` si el estado real coincide con la
 * pantalla (se pinta), o la dirección a la que hay que mandar a la persona.
 */
export function accessScreenRedirect(
  screen: Exclude<AccessStatus, 'active'>,
  status: string | null | undefined,
): string | null {
  const effective = normalizeAccessStatus(status);
  return effective === screen ? null : ACCESS_STATUS_PATHS[effective];
}
