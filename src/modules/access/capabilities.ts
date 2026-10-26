// Quién puede hacer qué, en un solo sitio y sin base de datos (se prueba solo).
//
// SellUp tiene dos formas de prospectar:
//  - el BD (vendedor) prospecta A MANO: agrega empresas una a una, busca los
//    contactos de las suyas y decide sobre las candidatas que son suyas;
//  - el equipo de Growth prospecta EN MASA: búsquedas con IA por lotes,
//    importación de archivos, enriquecimiento masivo, y revisa todo lo que esas
//    búsquedas traen.
//
// Las reglas viven detrás de `ENABLE_ROLE_CAPABILITIES` (ver
// `capabilities.server.ts`). Apagada —lo de fábrica— todo se comporta como
// antes: cualquier usuario activo lanza búsquedas e importa, y sólo un admin
// decide sobre candidatas. Se enciende después de asignar el rol Growth a quien
// corresponda; si no, nadie salvo admin podría prospectar en masa.

/** El rol del equipo que prospecta en masa (migración 158). */
export const GROWTH_ROLE_KEY = 'growth';

export type Capability =
  /** Búsquedas con IA por lotes e importación de archivos. */
  | 'prospectarMasivo'
  /** Buscar contactos de muchas empresas a la vez. */
  | 'enriquecerMasivo'
  /** Aprobar, descartar o marcar duplicada CUALQUIER candidata. */
  | 'revisarTodasLasCandidatas';

export interface AccessSnapshot {
  /** `internal_users.id`; null si no hay usuario interno activo. */
  userId: string | null;
  roleKey: string | null;
  isAdmin: boolean;
}

/** De quién es una candidata: su responsable o quien es dueño de su búsqueda. */
export interface CandidateOwnership {
  assignedTo?: string | null;
  batchOwnerId?: string | null;
  batchCreatedBy?: string | null;
}

const normalize = (roleKey: string | null): string | null => roleKey?.trim().toLowerCase() || null;

export function isGrowthRole(roleKey: string | null): boolean {
  return normalize(roleKey) === GROWTH_ROLE_KEY;
}

/**
 * ¿Tiene esta persona la capacidad? Con las reglas apagadas responde lo de
 * siempre: lo masivo es de cualquier usuario activo, revisar todo es de admin.
 */
export function hasCapability(
  access: AccessSnapshot,
  capability: Capability,
  { enforced }: { enforced: boolean },
): boolean {
  if (!access.userId) return false;
  if (access.isAdmin) return true;
  if (!enforced) return capability !== 'revisarTodasLasCandidatas';
  return isGrowthRole(access.roleKey);
}

/**
 * ¿Puede decidir (aprobar, descartar, marcar duplicada) sobre ESTA candidata?
 * Admin y Growth, sobre cualquiera. Con las reglas encendidas, además, quien es
 * su responsable o dueño de la búsqueda de la que salió: un BD decide sobre lo
 * suyo sin esperar a un admin.
 */
export function canReviewCandidate(
  access: AccessSnapshot,
  owner: CandidateOwnership,
  { enforced }: { enforced: boolean },
): boolean {
  if (hasCapability(access, 'revisarTodasLasCandidatas', { enforced })) return true;
  if (!enforced || !access.userId) return false;
  return [owner.assignedTo, owner.batchOwnerId, owner.batchCreatedBy].some(
    (id) => typeof id === 'string' && id.length > 0 && id === access.userId,
  );
}

/** Lo que se le dice a quien intenta algo que no le toca. */
export const CAPABILITY_DENIED_MESSAGE: Readonly<Record<Capability, string>> = {
  prospectarMasivo:
    'La prospección masiva es del equipo de Growth. Desde tu vista puedes agregar empresas a mano y buscar sus contactos.',
  enriquecerMasivo:
    'Buscar contactos de muchas empresas a la vez es del equipo de Growth. Puedes buscar los contactos de cada empresa desde su ficha.',
  revisarTodasLasCandidatas: 'Solo puedes decidir sobre las candidatas que son tuyas.',
};
