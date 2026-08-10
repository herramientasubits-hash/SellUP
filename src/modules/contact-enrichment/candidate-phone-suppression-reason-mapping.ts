// Agente 2A — Traducción del MOTIVO de supresión entre los dos vocabularios
// (AGENT2A-PHONE-REVEAL-4O-E2)
//
// ── EL PROBLEMA, DICHO SIN RODEOS ──────────────────────────────
//
// El subsistema tiene DOS columnas llamadas casi igual que NO contienen los mismos
// valores:
//
//   phone_reveal_cache.suppression_reason           (migración 099)
//   phone_reveal_suppression_audit.reason_code      (migración 099)
//     → dsar_erasure_request · do_not_contact_request · legal_privacy_request
//       admin_privacy_correction · test_synthetic
//     Responden a POR QUÉ se pidió la supresión.
//
//   contact_enrichment_candidate_phones.suppression_reason  (migración 109)
//     → data_subject_request · operator_request · provider_retraction
//     Responde a QUIÉN ejerció la supresión.
//
// La intersección de los dos conjuntos es VACÍA. Un `suppression_reason =
// cache.suppression_reason` no falla en una fila rara: falla en el 100% de ellas,
// con un 23514 de la CHECK de la 109, y solo en runtime — el tipo `string` de
// PostgREST no lo detecta y el compilador tampoco. Es exactamente la forma del
// defecto que en el hilo de Agente 1 perdió «Almacenes La 14» (#238): dos columnas
// con nombre parecido, vocabularios distintos, cero valores en común.
//
// Este módulo es el único traductor, y está construido para que un pass-through no
// sea representable: la firma solo ACEPTA el vocabulario de origen y solo DEVUELVE
// el de la colección, así que devolver la entrada tal cual no compila.
//
// ── LOS CRITERIOS DEL MAPEO ────────────────────────────────────
//
// El vocabulario de destino clasifica por QUIÉN ejerce, no por qué formulario se
// usó. De ahí las tres reglas, y ninguna se decide por parecido de nombre:
//
//   * el titular ejerce un derecho          → data_subject_request
//   * la operación es administrativa/interna → operator_request
//   * el proveedor se retracta               → provider_retraction
//
// Caso por caso:
//
//   dsar_erasure_request    → data_subject_request
//     Un DSAR es, por definición, el titular ejerciendo su derecho de supresión.
//
//   do_not_contact_request  → data_subject_request
//     Lo pide la persona. Que el derecho ejercido sea oposición al tratamiento y
//     no supresión no cambia QUIÉN lo ejerce, que es lo que la columna registra.
//
//   legal_privacy_request   → data_subject_request
//     Una petición jurídica de privacidad llega por el abogado del titular o por
//     una autoridad que actúa sobre su derecho. El vehículo es distinto; el
//     interesado es el mismo. Clasificarla como `operator_request` diría que SellUp
//     decidió borrar por su cuenta, que es falso y además rebaja la fuerza del
//     registro.
//
//   admin_privacy_correction → operator_request
//     Nadie de fuera lo pidió: es SellUp corrigiendo su propio dato.
//
//   test_synthetic          → operator_request
//     Una supresión de prueba la origina un operador. No es un titular ejerciendo
//     nada, y NO se inventa un cuarto valor en la colección para señalarla: añadir
//     `test_synthetic` a la CHECK de la 109 metería vocabulario de pruebas en una
//     tabla de Producción. La naturaleza sintética ya queda registrada donde
//     corresponde — en `reason_code` de la auditoría, que sí lo admite.
//
// `provider_retraction` no es la imagen de NINGÚN motivo de origen, y eso es
// correcto: el vocabulario de la caché no tiene un valor que signifique «el
// proveedor retiró el número». Ese estado llegará, si llega, de un camino de
// retractación que hoy no existe. No se fuerza ningún origen hacia él para que la
// función «use los tres».
//
// PURO: sin red, sin Supabase, sin reloj, sin logging. No recibe ni devuelve
// ningún número de teléfono.

import {
  PHONE_CACHE_SUPPRESSION_REASON_CODES,
  type PhoneCacheSuppressionReasonCode,
} from './phone-cache-suppression-core';
import type { CandidatePhoneSuppressionReason } from './phone-collection-core';

/**
 * Vocabulario CERRADO de la colección canónica. Espejo EXACTO de la CHECK
 * `contact_enrichment_candidate_phones_suppression_reason_check` (migración 109) y
 * del tipo `CandidatePhoneSuppressionReason` (phone-collection-core.ts). Se declara
 * aquí como valor —y no solo como tipo— porque el mapeo tiene que poder
 * comprobarse contra el SQL en una prueba, y un tipo no sobrevive a la
 * compilación.
 */
export const CANDIDATE_PHONE_SUPPRESSION_REASONS: readonly CandidatePhoneSuppressionReason[] =
  ['data_subject_request', 'operator_request', 'provider_retraction'];

/**
 * Vocabulario de ORIGEN, reexportado para que la prueba de exhaustividad recorra
 * la misma lista que valida la caché en vez de una copia que pueda quedarse atrás.
 */
export const SUPPRESSION_REASON_SOURCE_CODES = PHONE_CACHE_SUPPRESSION_REASON_CODES;

/**
 * Traduce el motivo de la supresión al vocabulario de la colección canónica.
 *
 * EXHAUSTIVO por construcción: el `default` asigna la entrada a `never`, así que
 * añadir un valor a `PHONE_CACHE_SUPPRESSION_REASON_CODES` sin mapearlo aquí ROMPE
 * LA COMPILACIÓN en vez de producir una fila que la CHECK de la 109 rechazará en
 * Producción.
 *
 * Nunca hace pass-through: los dos vocabularios no comparten ni un valor, así que
 * devolver la entrada sería devolver algo que la base de datos rechaza. La firma lo
 * impide antes de que llegue a ser una decisión.
 *
 * LANZA si en tiempo de ejecución llega un valor fuera del vocabulario de origen
 * (por ejemplo desde `unknown` mal casteado). Fail-closed a propósito: preferimos
 * una supresión que se reporta incompleta a una que escribe un motivo inventado.
 */
export function mapSuppressionReasonToCandidatePhoneReason(
  reason: PhoneCacheSuppressionReasonCode,
): CandidatePhoneSuppressionReason {
  switch (reason) {
    // ── El titular ejerce un derecho ──
    case 'dsar_erasure_request':
    case 'do_not_contact_request':
    case 'legal_privacy_request':
      return 'data_subject_request';

    // ── SellUp actúa sobre su propio dato ──
    case 'admin_privacy_correction':
    case 'test_synthetic':
      return 'operator_request';

    default: {
      const exhaustive: never = reason;
      // El mensaje nombra el CAMPO, nunca un teléfono: el motivo es un valor de
      // vocabulario cerrado, así que imprimirlo no expone dato personal.
      throw new Error(
        `unmapped phone suppression reason code: ${String(exhaustive)}`,
      );
    }
  }
}
