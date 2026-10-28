// Quién puede hacer qué, en un solo sitio y sin base de datos (se prueba solo).
//
// Growth es un vendedor más (dueña 28-10): ve lo suyo, busca con Rumbo, revisa
// sus candidatas y busca contactos igual que cualquier BD. Lo ÚNICO que tiene de
// más es prospectar EN MASA: la búsqueda masiva («Muchas empresas por criterios»)
// e importar archivos. Revisar CUALQUIER candidata es sólo de admin.
//
// Las reglas viven detrás de `ENABLE_ROLE_CAPABILITIES` (ver
// `capabilities.server.ts`). Apagada, todo se comporta como antes de las reglas:
// cualquier usuario activo importa, y sólo un admin decide sobre candidatas.

/** El rol del equipo que prospecta en masa (migración 158). */
export const GROWTH_ROLE_KEY = 'growth';

export type Capability =
  /**
   * Traer empresas EN MASA: importar archivos y la búsqueda masiva («Muchas empresas
   * por criterios»). Las cuatro formas normales de Rumbo son de cualquier usuario
   * activo (dueña 28-10).
   */
  | 'prospectarMasivo'
  /** Buscar contactos de muchas empresas a la vez: de cualquier usuario activo, como antes. */
  | 'enriquecerMasivo'
  /** Aprobar, descartar o marcar duplicada CUALQUIER candidata: sólo admin. */
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
 * Quien, además de admin, trabaja en masa: sólo Growth (dueña 28-10: los líderes
 * no). Búsqueda masiva, importar archivos y buscar contactos de muchas empresas.
 */
export function isBulkRole(roleKey: string | null): boolean {
  return isGrowthRole(roleKey);
}

/**
 * ¿Tiene esta persona la capacidad? Revisar todo es siempre de admin y buscar
 * contactos en masa, de cualquiera. Prospectar en masa: con las reglas apagadas,
 * de cualquiera (lo de siempre); encendidas, de admin y Growth.
 */
export function hasCapability(
  access: AccessSnapshot,
  capability: Capability,
  { enforced }: { enforced: boolean },
): boolean {
  if (!access.userId) return false;
  if (access.isAdmin) return true;
  if (capability === 'revisarTodasLasCandidatas') return false;
  if (capability === 'enriquecerMasivo' || !enforced) return true;
  return isBulkRole(access.roleKey);
}

/**
 * ¿Puede decidir (aprobar, descartar, marcar duplicada) sobre ESTA candidata?
 * Admin, sobre cualquiera. Con las reglas encendidas, además, quien es
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

/** Lo que la revisión de duplicados dijo de una candidata. */
export interface CandidateDuplicateSignals {
  duplicateStatus?: string | null;
  matchedHubSpotCompanyId?: string | null;
}

/**
 * ¿Hay riesgo de llevar a HubSpot una empresa repetida? Todo lo que no sea un
 * «no_match» limpio, o una coincidencia con una empresa de HubSpot.
 */
export function hasDuplicateRisk(signals: CandidateDuplicateSignals): boolean {
  const status = signals.duplicateStatus?.trim().toLowerCase() ?? null;
  return (status !== null && status !== 'no_match') || Boolean(signals.matchedHubSpotCompanyId);
}

export type CandidateReviewDecision =
  | { ok: true }
  | { ok: false; reason: 'not_allowed' | 'needs_growth_review' | 'needs_assignee' };

/**
 * ¿Puede APROBAR esta candidata? Igual que `canReviewCandidate`, con una regla
 * más: el dueño que no es admin solo aprueba lo limpio. Un posible duplicado o
 * una empresa que ya está en HubSpot la decide un administrador — así el mismo
 * vendedor (o Growth) no confirma «no es duplicado» sobre lo suyo.
 */
export function decideCandidateApproval(
  access: AccessSnapshot,
  owner: CandidateOwnership,
  signals: CandidateDuplicateSignals,
  { enforced }: { enforced: boolean },
): CandidateReviewDecision {
  if (hasCapability(access, 'revisarTodasLasCandidatas', { enforced })) return { ok: true };
  if (!canReviewCandidate(access, owner, { enforced })) return { ok: false, reason: 'not_allowed' };
  return hasDuplicateRisk(signals) ? { ok: false, reason: 'needs_growth_review' } : { ok: true };
}

/** Lo que se le dice a quien intenta algo que no le toca. */
export const CAPABILITY_DENIED_MESSAGE: Readonly<Record<Capability, string>> = {
  prospectarMasivo:
    'Importar archivos y la búsqueda masiva son del equipo de Growth. Puedes buscar empresas con Rumbo o agregarlas a mano.',
  enriquecerMasivo: 'Tu sesión no está activa. Vuelve a entrar.',
  revisarTodasLasCandidatas: 'Solo puedes decidir sobre las candidatas que son tuyas.',
};

/** Cuando un vendedor (o Growth) intenta aprobar un posible duplicado propio. */
export const NEEDS_GROWTH_REVIEW_MESSAGE =
  'Esta empresa puede estar duplicada o ya existe en HubSpot: la decide un administrador.';

/**
 * Cuando una candidata de una búsqueda de admin no tiene responsable: sin él, la
 * empresa nacería a nombre del administrador y ningún vendedor la vería.
 */
export const NEEDS_ASSIGNEE_MESSAGE = 'Asígnale un responsable primero.';
