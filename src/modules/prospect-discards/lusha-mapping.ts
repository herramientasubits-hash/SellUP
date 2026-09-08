// AGENT1-LUSHA-DISCARD-TRACEABILITY-1 — taxonomía PURA de la pierna Lusha.
//
// Traduce cada desenlace que la corrida de Lusha YA decidió al vocabulario
// durable de `prospect_discarded_dispositions`. Sin IO, sin reloj, sin
// importar nada de la pierna Lusha: sólo `./types`, para que este módulo
// siga cumpliendo la guarda estática de «cero imports de proveedor».
//
// 🔴 NO inventa códigos. Todo lo que devuelve ya existe en
// `DiscardDispositionCode` y en el CHECK de la migración 138.
//
// 🔴 `null` NO es «no pasó nada»: es «esto NO es una disposición durable».
// Hay cinco familias de estado transitorio, y confundirlas con un descarte
// sería exactamente el dato inventado que este hito evita:
//
//   · provider_seen                — memoria de proveedor, no veredicto.
//   · duplicado intra-corrida      — el proveedor repitió una fila suya.
//   · possible_duplicate           — YA existe como candidato needs_review.
//   · rechazo de identidad de LOTE — la empresa ya ocupa el lote por otra vía.
//   · aceptada                     — existe en `prospect_candidates`.
//   · fila impersistible           — sin nombre: nada que mostrar ni auditar.

import type { DiscardDispositionCode } from './types';

/**
 * `reason_code` canónicos que este hito escribe. Son los tres que el alcance
 * aprobado nombra explícitamente; el resto de las filas dejan `reason_code`
 * con el motivo VERBATIM del gate/precisión que las rechazó, o `null`.
 */
export const LUSHA_DISCARD_REASON_CODE = {
  icpSizeBelowMin: 'known_employee_count_below_min',
  targetOverflow: 'target_overflow_discarded',
  knownDomainSeed: 'known_domain_seed',
} as const;

/**
 * Motivos DUROS del gate compartido de intake que tienen código propio en el
 * vocabulario durable. El resto cae en `other` conservando su motivo en
 * `reason_code` — el mismo patrón de red de seguridad que ya usa la ruta
 * Apollo con `unclassified_final`, y nunca un código nuevo.
 */
const GATE_REASON_TO_CODE: Readonly<Record<string, DiscardDispositionCode>> = {
  country_mismatch: 'country_rejected',
  unsupported_country: 'country_rejected',
  obviously_wrong_sector: 'sector_rejected',
  ambiguous_sector: 'sector_rejected',
};

/** El desenlace, tal como la corrida lo decidió. Un `kind` por punto de decisión. */
export type LushaDiscardEvent =
  /** Gate obligatorio compartido: `decision === 'hard_excluded'`. */
  | { kind: 'gate_hard_excluded'; gateReason: string | null }
  /** Guard de candidato activo con coincidencia FUERTE. */
  | { kind: 'active_candidate_guard' }
  /** Duplicado exacto confirmado, con la fuente que lo confirmó. */
  | { kind: 'exact_duplicate'; duplicateSource: 'sellup' | 'hubspot' }
  /** El catálogo NO confirmó la macro pedida. No es duplicado. */
  | { kind: 'macro_precision_rejected'; precisionReason?: string | null }
  /** Tamaño por debajo del mínimo del ICP, conocido. */
  | { kind: 'icp_size_rejected' }
  /** Nueva y precisa, pero el objetivo ya estaba cerrado. */
  | { kind: 'target_overflow' }
  /** Dominio que SellUp ya conocía antes de empezar (siembra CLIENTE). */
  | { kind: 'known_domain_seed' }
  // ── Estados TRANSITORIOS: nunca son disposición ──
  | { kind: 'provider_seen' }
  | { kind: 'intra_run_provider_duplicate' }
  | { kind: 'possible_duplicate' }
  | { kind: 'batch_identity_rejected' }
  | { kind: 'accepted' }
  | { kind: 'unusable_record' };

/** El veredicto durable de un desenlace: código + su `reason_code` canónico. */
export interface LushaDiscardDispositionResolution {
  disposition: DiscardDispositionCode;
  reasonCode: string | null;
}

/**
 * El desenlace completo de UN evento. `null` ⇒ estado transitorio: el llamador
 * NO debe persistir fila.
 */
export function resolveLushaDiscardDisposition(
  event: LushaDiscardEvent,
): LushaDiscardDispositionResolution | null {
  switch (event.kind) {
    case 'gate_hard_excluded': {
      const reason = event.gateReason?.trim() || null;
      if (reason !== null) {
        const mapped = GATE_REASON_TO_CODE[reason];
        if (mapped !== undefined) return { disposition: mapped, reasonCode: reason };
      }
      // Incluye `known_employee_count_below_min` (rechazo por tamaño del ICP),
      // `missing_domain` y cualquier motivo duro sin código propio: `other`
      // con el motivo REAL en `reason_code`, jamás un código nuevo.
      return { disposition: 'other', reasonCode: reason };
    }
    case 'active_candidate_guard':
      // Coincidencia fuerte contra un candidato ACTIVO de SellUp.
      return { disposition: 'sellup_duplicate', reasonCode: null };
    case 'exact_duplicate':
      return event.duplicateSource === 'hubspot'
        ? { disposition: 'hubspot_duplicate', reasonCode: null }
        : { disposition: 'sellup_duplicate', reasonCode: null };
    case 'macro_precision_rejected':
      // NO es duplicado y NO es país: el catálogo no acreditó el sector.
      return {
        disposition: 'sector_rejected',
        reasonCode: event.precisionReason?.trim() || null,
      };
    case 'icp_size_rejected':
      return {
        disposition: 'other',
        reasonCode: LUSHA_DISCARD_REASON_CODE.icpSizeBelowMin,
      };
    case 'target_overflow':
      return {
        disposition: 'target_cap_reached',
        reasonCode: LUSHA_DISCARD_REASON_CODE.targetOverflow,
      };
    case 'known_domain_seed':
      return {
        disposition: 'sellup_duplicate',
        reasonCode: LUSHA_DISCARD_REASON_CODE.knownDomainSeed,
      };
    case 'provider_seen':
    case 'intra_run_provider_duplicate':
    case 'possible_duplicate':
    case 'batch_identity_rejected':
    case 'accepted':
    case 'unusable_record':
      return null;
    default: {
      // Exhaustividad comprobada por el compilador: un `kind` nuevo sin
      // decisión explícita no compila, en vez de colarse como `other`.
      const exhaustive: never = event;
      void exhaustive;
      return null;
    }
  }
}

/**
 * El código durable de un desenlace, o `null` si es transitorio.
 * Envoltura estrecha de `resolveLushaDiscardDisposition` para los llamadores
 * que sólo necesitan el código.
 */
export function mapLushaDiscardToCode(
  event: LushaDiscardEvent,
): DiscardDispositionCode | null {
  return resolveLushaDiscardDisposition(event)?.disposition ?? null;
}

/**
 * De qué lado vino un duplicado EXACTO, leyendo únicamente la evidencia que la
 * resolución de duplicados ya produjo.
 *
 * 🔴 Orden deliberado: SellUp primero. Una cuenta propia es el hecho interno
 * más fuerte, y una empresa puede coincidir a la vez con una cuenta de SellUp y
 * con una compañía de HubSpot. Sin evidencia de NINGUNO de los dos lados cae en
 * `'sellup'`: el `dbDuplicateStatus` que trajo aquí es el veredicto del
 * comprobador PROPIO, así que atribuirlo a HubSpot sería afirmar una
 * coincidencia externa que nadie reportó.
 */
export function classifyLushaExactDuplicateSource(input: {
  sources?: readonly { source: string; strength: string }[] | null;
  matchedAccountId?: string | null;
  matchedHubspotCompanyId?: string | null;
}): 'sellup' | 'hubspot' {
  const exact = (input.sources ?? []).filter((s) => s.strength === 'exact');
  const hasSellup =
    exact.some((s) => s.source === 'sellup' || s.source === 'active_candidate') ||
    Boolean(input.matchedAccountId);
  if (hasSellup) return 'sellup';
  const hasHubspot =
    exact.some((s) => s.source === 'hubspot') || Boolean(input.matchedHubspotCompanyId);
  return hasHubspot ? 'hubspot' : 'sellup';
}
