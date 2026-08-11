/**
 * Procedencia de `contacts.phone` ante una edición MANUAL
 * (AGENT2A-PHONE-REVEAL-4O-E4.1-R1).
 *
 * ═══════════════════════════════════════════════════════════════════
 * POR QUÉ EXISTE ESTE MÓDULO
 * ═══════════════════════════════════════════════════════════════════
 *
 * `contacts.phone_source` es la ÚNICA evidencia que la supresión de privacidad
 * acepta para borrar el teléfono de un contacto oficial: sólo borra cuando el valor
 * observado está en `SUPPRESSIBLE_CONTACT_PHONE_SOURCES`
 * (`apollo_reveal` / `apollo_cache` / `lusha_reveal`).
 *
 * Hasta R1, `updateContact` escribía `contacts.phone` y NO tocaba `phone_source` ni
 * ninguna de las columnas de metadata del proveedor. El resultado era un flujo real
 * y trivial de alcanzar, sin ninguna carrera de por medio:
 *
 *     aprobación de candidato  → phone = número del proveedor
 *                                phone_source = apollo_reveal
 *
 *     edición humana           → phone = número TECLEADO A MANO
 *                                phone_source SIGUE SIENDO apollo_reveal
 *
 *     supresión posterior      → la procedencia parece demostrada
 *                                ⇒ se borra un número que el proveedor nunca escribió
 *
 * La procedencia describe UN VALOR, no una fila. En cuanto el valor deja de ser el
 * que escribió el proveedor, la procedencia anterior ya no es demostrable y no puede
 * seguir autorizando un borrado destructivo. Ese es el invariante que este módulo
 * mantiene, y el motivo por el que el número y su procedencia tienen que viajar
 * SIEMPRE en el mismo patch (ver `updateContact`): un estado intermedio en el que el
 * número ya cambió pero la procedencia todavía no es exactamente la ventana en la
 * que la supresión borraría el dato equivocado.
 *
 * ═══════════════════════════════════════════════════════════════════
 * LOS CUATRO CASOS, Y POR QUÉ NO SON DOS
 * ═══════════════════════════════════════════════════════════════════
 *
 * La regla ingenua «si el formulario envía `phone`, la procedencia pasa a manual»
 * es incorrecta y destructiva en la dirección contraria: el formulario de edición
 * (`edit-contact-drawer`) reenvía SIEMPRE todos sus campos, así que guardar un
 * cambio de cargo convertiría en `manual` la procedencia de todos los teléfonos
 * Apollo/Lusha del sistema — y entonces ninguna DSAR volvería a borrarlos.
 *
 * Por eso la decisión se toma comparando con el valor ACTUAL, no con la presencia
 * del campo:
 *
 *   A. `field_absent`  — `phone` no viaja en el input ⇒ nada cambia.
 *   B. `unchanged`     — `phone` viaja con el MISMO valor que ya está guardado
 *                        ⇒ la procedencia del proveedor SOBREVIVE.
 *   C. `replaced`      — valor nuevo no vacío ⇒ `phone_source = 'manual'` y la
 *                        metadata del proveedor se limpia.
 *   D. `cleared`       — el valor nuevo representa ausencia ⇒ toda la tupla a NULL,
 *                        incluida `phone_source` (no hay número del que declarar
 *                        origen; dejar `apollo_reveal` sobre `phone = NULL` sería
 *                        metadata huérfana).
 *
 * La comparación de B es contra el valor EFECTIVAMENTE ESCRIBIBLE (`trim()`, y vacío
 * ⇒ ausencia), que es la misma normalización que aplicaba `updateContact` antes de
 * R1, y la misma con la que la aprobación escribe el número (`cleanString`). Si los
 * bytes guardados no cambian, la procedencia no cambia; si cambian, deja de ser
 * demostrable. No se comparan «números equivalentes» (dígitos sueltos, prefijos):
 * este módulo no interpreta teléfonos, sólo observa si el dato guardado cambió.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALCANCE — LO QUE ESTE MÓDULO NO HACE
 * ═══════════════════════════════════════════════════════════════════
 *
 *   * NO toca `contacts.mobile_phone`. Esa columna sigue exactamente como la dejó
 *     4O-E4.1: sin escritor de proveedor, sin procedencia y fuera del alcance de
 *     cualquier borrado por procedencia (`MOBILE_PHONE_PROVENANCE_PENDING` sigue
 *     abierto). Inferir su origen desde `phone_source` fue precisamente el error que
 *     E4.1 retiró.
 *   * NO introduce vocabulario nuevo: `'manual'` ya es un valor válido del CHECK
 *     `contacts_phone_source_check` (migración 094) y del tipo `ContactPhoneSource`.
 *   * NO decide `phone_type` a partir de nada: el formulario de edición no tiene
 *     selector de tipo, así que un teléfono manual no tiene tipo declarado y la
 *     columna va a NULL. Conservar el tipo del proveedor anterior describiría un
 *     número que ya no existe. Esa premisa está CONGELADA por la suite estática de
 *     R1: si `phone_type` aparece en `UpdateContactInput` o en el formulario, la
 *     suite falla y este módulo debe aprender a recibir el tipo introducido.
 */

import type { ContactPhoneSource, ContactPhoneType, ConfidenceLevel } from './types';

/**
 * Tupla completa de `contacts` que describe el teléfono principal y su origen.
 *
 * Son las MISMAS 7 columnas que borra `buildContactPhoneSuppressionPatch()`
 * (4O-E4.1). No es coincidencia: una edición manual y una supresión son las dos
 * operaciones que invalidan la procedencia anterior, y ninguna de las dos puede
 * dejar viva una sola columna de la tupla — una `phone_revealed_at` huérfana sobre
 * un número tecleado a mano es una afirmación falsa sobre cuándo un proveedor
 * reveló ese dato.
 */
export interface ManualContactPhoneEditPatch {
  phone: string | null;
  phone_source: ContactPhoneSource | null;
  phone_type: ContactPhoneType | null;
  phone_raw_type: null;
  phone_revealed_at: null;
  phone_processing_basis: null;
  phone_confidence: ConfidenceLevel | null;
}

/**
 * Resultado de evaluar la edición. Los dos primeros casos NO producen patch a
 * propósito: que no exista objeto que aplicar es lo que hace imposible que una
 * edición de otro campo arrastre la procedencia sin querer.
 */
export type ManualContactPhoneEdit =
  | { kind: 'field_absent' }
  | { kind: 'unchanged' }
  | { kind: 'replaced'; patch: ManualContactPhoneEditPatch }
  | { kind: 'cleared'; patch: ManualContactPhoneEditPatch };

/**
 * Normalización de escritura: misma que aplicaba `updateContact` antes de R1
 * (`input.phone?.trim() || null`). Vacío o sólo espacios ⇒ ausencia de teléfono.
 */
function normalizeWritablePhone(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Construye el patch de una escritura manual de `contacts.phone`.
 *
 * Con número (`nextPhone` no nulo) la procedencia es `'manual'`: el sistema SÍ sabe
 * de dónde salió esa escritura —de un humano en el formulario— y declararlo es mejor
 * que dejar la columna en NULL, que significa «se desconoce». Sin número, toda la
 * tupla va a NULL: no hay dato del que declarar origen.
 */
export function buildManualContactPhoneEditPatch(
  nextPhone: string | null,
): ManualContactPhoneEditPatch {
  return {
    phone: nextPhone,
    phone_source: nextPhone === null ? null : 'manual',
    // El formulario manual no declara tipo (ver cabecera). Nunca se hereda el del
    // proveedor anterior: describiría un número que ya no está guardado.
    phone_type: null,
    phone_raw_type: null,
    phone_revealed_at: null,
    phone_processing_basis: null,
    phone_confidence: null,
  };
}

/**
 * Decide qué le ocurre a la procedencia de `contacts.phone` en una edición manual.
 *
 * `currentPhone` es el valor GUARDADO tal cual se leyó, y `inputPhone` el campo del
 * input: `undefined` ⇒ el campo no viaja (caso A); `null` o vacío ⇒ el humano deja
 * el contacto sin teléfono (caso D).
 */
export function resolveManualContactPhoneEdit(args: {
  currentPhone: string | null;
  inputPhone: string | null | undefined;
}): ManualContactPhoneEdit {
  if (args.inputPhone === undefined) return { kind: 'field_absent' };

  const nextPhone = normalizeWritablePhone(args.inputPhone);
  if (nextPhone === args.currentPhone) return { kind: 'unchanged' };

  return nextPhone === null
    ? { kind: 'cleared', patch: buildManualContactPhoneEditPatch(null) }
    : { kind: 'replaced', patch: buildManualContactPhoneEditPatch(nextPhone) };
}
