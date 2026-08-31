/**
 * AGENT1-LUSHA-CUT-L3 — la OPERACIÓN LÓGICA DURABLE de una búsqueda pagada.
 *
 * ── El defecto que este módulo cierra ────────────────────────────────────────
 *
 * La primera versión de CUT-L3 vallaba la petición con esta identidad:
 *
 *     lusha_prospecting|v1|<clientRequestId>|b<rama>|p<página>
 *
 * y `clientRequestId` lo acuña el NAVEGADOR (`crypto.randomUUID()`), fresco por
 * clic. Eso cierra la redelivery del mismo payload, el reintento del framework y
 * el `already_reserved` sobre el mismo id — pero NO cierra lo único que hace
 * falta cerrar:
 *
 *     el proceso cae
 *       → la valla previa queda `dispatch_unsafe` / indeterminada
 *         → la usuaria vuelve a hacer clic
 *           → clientRequestId NUEVO
 *             → clave de valla NUEVA
 *               → la MISMA página lógica puede volver a llegar a Lusha
 *
 * La autoridad económica no puede vivir en un uuid que el cliente reacuña. Tiene
 * que vivir en el SERVIDOR y sobrevivir al reinicio.
 *
 * ── La jerarquía ─────────────────────────────────────────────────────────────
 *
 *     ámbito del actor  +  firma canónica de la búsqueda pagada
 *       → operación lógica durable
 *         → operation_id + rama + página
 *           → valla de petición
 *
 * `clientRequestId` SIGUE existiendo y sigue siendo útil: es la correlación con
 * la reserva de presupuesto y con la fila del lote. Lo que deja de ser es
 * AUTORIDAD de replay. Se persiste como traza (`last_client_request_id`) porque
 * quitar observabilidad no era el objetivo.
 *
 * ── Lo que la firma NO es ────────────────────────────────────────────────────
 *
 * 🔴 NO es un dedupe permanente de consultas. La unicidad sólo rige sobre una
 * operación ABIERTA / SIN RECONCILIAR. Cuando la anterior se cierra durablemente,
 * la MISMA búsqueda puede volver a acuñar operación — una usuaria tiene derecho a
 * repetir la semana que viene la búsqueda que hizo hoy, y convertir la valla en
 * un veto perpetuo habría sido cambiar un defecto por otro (§ 8).
 *
 * 🔴 NO se hashea el payload crudo del navegador. Se hashea la semántica
 * NORMALIZADA de lo que hace gastar: proveedor, superficie, versión de contrato y
 * los criterios que cambian materialmente la petición pagada. Nada efímero
 * —clientRequestId, reservationId, relojes, uuids— entra, porque cualquiera de
 * ellos haría la firma inestable y devolvería el defecto original.
 */

import { createHash } from 'node:crypto';

// ─── Ámbito del actor ─────────────────────────────────────────────────────────

/**
 * Frontera de pertenencia. Es la que YA usa el repositorio para esta superficie:
 * `prospect_batches.created_by` / `owner_id` y `wizard_budget_reservations.user_id`
 * apuntan todos a `internal_users(id)`, y no existe columna de organización ni de
 * workspace sobre estas tablas.
 *
 * 🔴 Se prefija a propósito. Una firma sin ámbito sería una llave GLOBAL entre
 * clientes: la búsqueda de una usuaria podría robar —o quedar bloqueada por— la
 * operación abierta de otra (§ 14). El prefijo también deja sitio a un ámbito más
 * ancho el día que exista, sin que las filas viejas se confundan con las nuevas.
 */
export const LUSHA_OPERATION_ACTOR_SCOPE_PREFIX = 'internal_user' as const;

export class LushaProspectingOperationInputError extends Error {}

export function buildLushaOperationActorScope(internalUserId: string): string {
  if (typeof internalUserId !== 'string' || internalUserId.trim().length === 0) {
    throw new LushaProspectingOperationInputError(
      'lusha_operation_actor_scope_missing',
    );
  }
  return `${LUSHA_OPERATION_ACTOR_SCOPE_PREFIX}:${internalUserId.trim()}`;
}

// ─── Firma canónica ───────────────────────────────────────────────────────────

/**
 * Versión del formato de la firma. Subirla NO borra nada: hace que las búsquedas
 * futuras acuñen operaciones nuevas, y las abiertas de la versión anterior siguen
 * bloqueando bajo su propia versión. Se toca cuando cambia QUÉ entra en la firma.
 */
export const LUSHA_OPERATION_SIGNATURE_VERSION = 'v1' as const;

/** Contrato de ejecución pagada que la firma describe. */
const LUSHA_OPERATION_PROVIDER = 'lusha' as const;
const LUSHA_OPERATION_SURFACE = 'company_prospecting' as const;

/**
 * Los criterios que cambian MATERIALMENTE la petición pagada.
 *
 * Salen de `GenerateInputSchema` —la entrada real de la acción— y son exactamente
 * los que viajan al plan de ejecución de Lusha. Lo que NO está aquí no está por
 * una razón: `clientRequestId` y `reservationId` son efímeros (§ 5), y el objetivo
 * pedido es una CONSTANTE de la corrida, así que no distingue dos búsquedas.
 */
export type LushaProspectingSearchCriteria = {
  countryCode: string;
  macroIndustryKey: string;
  subIndustryId?: number | null;
  sizeBandKey?: string | null;
  searchText?: string | null;
};

/** Texto libre → forma estable. Sin esto «Bogotá  SAS» y «bogotá sas» divergirían. */
function normalizeFreeText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const collapsed = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Serializador canónico. Ordena claves recursivamente y colapsa `undefined` a
 * `null`, para que el MISMO significado con las claves en otro orden produzca la
 * MISMA cadena (§ 6).
 *
 * 🔴 Se implementa aquí y no se importa de `benchmark/multistage/artifact-hash`
 * por dos razones concretas: aquél está acoplado a los tipos del pipeline de
 * benchmark, y trunca a 16 hex. Una llave económica no se trunca por comodidad.
 */
function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(normalize);
    const obj = v as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = normalize(obj[k]);
    return sorted;
  };
  return JSON.stringify(normalize(value));
}

/**
 * La carga canónica de la firma. Se expone para que las pruebas puedan afirmar
 * QUÉ entra, en vez de comparar hashes opacos entre sí.
 */
export function buildLushaOperationSignaturePayload(
  criteria: LushaProspectingSearchCriteria,
): Record<string, unknown> {
  const countryCode = normalizeKey(criteria.countryCode)?.toUpperCase() ?? null;
  const macroIndustryKey = normalizeKey(criteria.macroIndustryKey);
  if (countryCode === null || macroIndustryKey === null) {
    throw new LushaProspectingOperationInputError(
      'lusha_operation_signature_criteria_incomplete',
    );
  }
  return {
    provider: LUSHA_OPERATION_PROVIDER,
    surface: LUSHA_OPERATION_SURFACE,
    signatureVersion: LUSHA_OPERATION_SIGNATURE_VERSION,
    countryCode,
    macroIndustryKey,
    subIndustryId:
      typeof criteria.subIndustryId === 'number' && Number.isInteger(criteria.subIndustryId)
        ? criteria.subIndustryId
        : null,
    sizeBandKey: normalizeFreeText(criteria.sizeBandKey),
    searchText: normalizeFreeText(criteria.searchText),
  };
}

/**
 * Huella determinista de la búsqueda pagada. SHA-256 completo, hex.
 *
 * 🔴 Se guarda el HASH, no los criterios. La tabla de operaciones no necesita
 * saber qué buscó nadie para decidir si una operación sigue abierta, y guardar el
 * payload habría metido criterios de negocio en un registro de seguridad de gasto
 * sin ninguna necesidad (§ 6).
 */
export function computeLushaOperationSignatureHash(
  criteria: LushaProspectingSearchCriteria,
): string {
  return createHash('sha256')
    .update(canonicalJson(buildLushaOperationSignaturePayload(criteria)))
    .digest('hex');
}

// ─── Estados durables ─────────────────────────────────────────────────────────

/**
 *   `open`                     — operación viva. Un solo proceso la está corriendo.
 *   `reconciliation_required`  — alguien volvió a entrar mientras seguía abierta,
 *                                o quedó una petición sin liquidar. NO se despacha.
 *   `completed`                — la corrida llegó a su final DURABLE y todas sus
 *                                peticiones tienen verdad de facturación asentada.
 *
 * 🔴 `completed` NO se alcanza porque Lusha devolviera 200. Se alcanza cuando la
 * corrida terminó de persistir río abajo Y ninguna petición quedó en un estado que
 * impida decir si se puede repetir (§ 9).
 */
export type LushaProspectingOperationState =
  | 'open'
  | 'reconciliation_required'
  | 'completed';

export const LUSHA_PROSPECTING_OPERATION_STATES: readonly LushaProspectingOperationState[] =
  ['open', 'reconciliation_required', 'completed'];

/** Estados que NO autorizan a acuñar una operación nueva ni a despachar. */
export const LUSHA_PROSPECTING_OPERATION_UNRESOLVED_STATES: readonly LushaProspectingOperationState[] =
  ['open', 'reconciliation_required'];

export function isLushaProspectingOperationUnresolved(
  state: LushaProspectingOperationState,
): boolean {
  return LUSHA_PROSPECTING_OPERATION_UNRESOLVED_STATES.includes(state);
}

// ─── Persistencia inyectada ───────────────────────────────────────────────────

export type LushaProspectingOperationIdentity = {
  actorScope: string;
  signatureVersion: string;
  signatureHash: string;
  /** TRAZA. Correlaciona con la reserva y con el lote. NUNCA autoridad de replay. */
  clientRequestId: string | null;
};

export type LushaOperationClaimResult =
  /** Esta llamada acuñó la operación. Es la ÚNICA que autoriza a gastar. */
  | { status: 'created'; operationId: string }
  /**
   * Ya había una operación SIN RESOLVER para este actor y esta firma. Se devuelve
   * su id —para que el bloqueo se pueda correlacionar— y NO se acuña otra.
   */
  | { status: 'resumed_unresolved'; operationId: string; state: LushaProspectingOperationState }
  /** La migración 134 no está aplicada. Fallo CERRADO en el llamador. */
  | { status: 'capability_absent' }
  | { status: 'failed'; code: string };

export type LushaOperationCompleteResult =
  | { status: 'completed' }
  | { status: 'already_completed' }
  /** Quedan peticiones sin verdad de facturación asentada. La operación NO cierra. */
  | { status: 'blocked_unsettled_requests'; unsettled: number }
  | { status: 'not_found' }
  | { status: 'capability_absent' }
  | { status: 'failed'; code: string };

export type LushaProspectingOperationStore = {
  claimOrResume: (
    identity: LushaProspectingOperationIdentity,
  ) => Promise<LushaOperationClaimResult>;
  complete: (operationId: string) => Promise<LushaOperationCompleteResult>;
};

// ─── Resolución ───────────────────────────────────────────────────────────────

export type LushaOperationBlockedReason =
  /** Existe una operación abierta / sin reconciliar para esta misma búsqueda. */
  | 'operation_unresolved'
  /** La 134 no está aplicada. */
  | 'capability_absent'
  /** No se pudo resolver la operación (RPC caída, credencial ausente, entrada inválida). */
  | 'operation_unavailable';

export type LushaOperationBlock = {
  reason: LushaOperationBlockedReason;
  state: LushaProspectingOperationState | null;
  operationId: string | null;
  code: string;
};

export const LUSHA_OPERATION_BLOCKED_CODE = 'lusha_prospecting_operation_blocked' as const;
export const LUSHA_OPERATION_CAPABILITY_ABSENT_CODE =
  'lusha_prospecting_operation_capability_absent' as const;
export const LUSHA_OPERATION_UNAVAILABLE_CODE =
  'lusha_prospecting_operation_unavailable' as const;

export type LushaOperationResolution =
  | { status: 'authorized'; operationId: string; signatureHash: string; actorScope: string }
  | { status: 'blocked'; block: LushaOperationBlock };

/**
 * Resuelve la operación lógica ANTES de cualquier gasto.
 *
 * Sólo `created` autoriza. Una operación reanudada SIN RESOLVER bloquea la entrada
 * entera —no sólo la página que ya tenía valla— y esa es la diferencia con la
 * versión anterior del corte: si sólo se bloqueara la página vieja, las páginas
 * 1 y 2 de la corrida caída seguirían pudiendo comprarse tras el clic nuevo, que
 * es justo el gasto que § 11 exige que no ocurra.
 *
 * 🔴 CUALQUIER ambigüedad de la base falla CERRADO: sin operación resuelta no hay
 * reserva y no hay proveedor (§ 21).
 */
export async function resolveLushaProspectingOperation(args: {
  store: LushaProspectingOperationStore;
  internalUserId: string;
  criteria: LushaProspectingSearchCriteria;
  /** TRAZA de correlación. No participa en la identidad. */
  clientRequestId: string | null;
}): Promise<LushaOperationResolution> {
  let actorScope: string;
  let signatureHash: string;
  try {
    actorScope = buildLushaOperationActorScope(args.internalUserId);
    signatureHash = computeLushaOperationSignatureHash(args.criteria);
  } catch (err: unknown) {
    return {
      status: 'blocked',
      block: {
        reason: 'operation_unavailable',
        state: null,
        operationId: null,
        code:
          err instanceof LushaProspectingOperationInputError
            ? err.message
            : LUSHA_OPERATION_UNAVAILABLE_CODE,
      },
    };
  }

  let claim: LushaOperationClaimResult;
  try {
    claim = await args.store.claimOrResume({
      actorScope,
      signatureVersion: LUSHA_OPERATION_SIGNATURE_VERSION,
      signatureHash,
      clientRequestId: args.clientRequestId,
    });
  } catch {
    return {
      status: 'blocked',
      block: {
        reason: 'operation_unavailable',
        state: null,
        operationId: null,
        code: LUSHA_OPERATION_UNAVAILABLE_CODE,
      },
    };
  }

  if (claim.status === 'created') {
    return { status: 'authorized', operationId: claim.operationId, signatureHash, actorScope };
  }
  if (claim.status === 'resumed_unresolved') {
    return {
      status: 'blocked',
      block: {
        reason: 'operation_unresolved',
        state: claim.state,
        operationId: claim.operationId,
        code: `${LUSHA_OPERATION_BLOCKED_CODE}_${claim.state}`,
      },
    };
  }
  if (claim.status === 'capability_absent') {
    return {
      status: 'blocked',
      block: {
        reason: 'capability_absent',
        state: null,
        operationId: null,
        code: LUSHA_OPERATION_CAPABILITY_ABSENT_CODE,
      },
    };
  }
  return {
    status: 'blocked',
    block: {
      reason: 'operation_unavailable',
      state: null,
      operationId: null,
      code: claim.code || LUSHA_OPERATION_UNAVAILABLE_CODE,
    },
  };
}
