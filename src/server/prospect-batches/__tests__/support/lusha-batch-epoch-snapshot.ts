/**
 * CUT9A-FIX-ADOPTED-EPOCH-REFRESH — cómo se modela la LECTURA ACTUAL de la época.
 *
 * `PersistLushaPendingReviewDeps.readBatchIdentityEpoch` es OBLIGATORIA, por la
 * misma razón que `insertCandidatesFenced`: la ausencia de una dependencia
 * inyectada no puede autorizar nada. Mientras la época salió de la reserva
 * memoizada, la mitad de pago declaraba el estado que el lote tenía cuando NACIÓ
 * —no el que tiene al escribir—, y en la ruta gratuita→pago eso era un `stale`
 * FALSO que lanzaba la corrida entera después de haber pagado al proveedor.
 *
 * En producción la dependencia es la foto canónica de CUT-3B4
 * (`loadBatchIdentityRegistry`). Aquí se ofrecen los dobles que corresponden a las
 * respuestas que esa foto puede dar de verdad.
 */

import type { FenceCapabilityEvidence } from '@/server/prospect-batches/batch-identity-fenced-persistence';

/**
 * «La migración 126 NO está aplicada», tal como lo PRUEBA la base.
 *
 * La conjunción exacta que `isProvenFenceCapabilityAbsent` exige: sin época,
 * ausencia PROBADA (42883 / PGRST202) y lectura que NO falló. Es el compañero
 * natural de `preM126FencedInsert`: con los dos, una prueba ejercita la ruta
 * anterior a B4 por su única puerta legítima.
 *
 * 🔴 No usar para modelar averías. Una lectura caída es `degradedEpochSnapshot`,
 * que falla CERRADO.
 */
export async function preM126BatchEpochSnapshot(): Promise<FenceCapabilityEvidence> {
  return { epoch: null, fenceCapabilityAbsent: true, degraded: false };
}

/** Una época REAL leída de la base. La 126 está aplicada y la valla está activa. */
export function batchEpochSnapshot(epoch: number) {
  return async (): Promise<FenceCapabilityEvidence> => ({
    epoch,
    fenceCapabilityAbsent: false,
    degraded: false,
  });
}

/**
 * Lectura AVERIADA: no hay época y la ausencia NO está probada.
 *
 * 🔴 Esto NO autoriza la ruta anterior a B4 y no puede degradarse a la época 0:
 * confundir «no lo sé» con «cero» haría pasar por vallada una escritura que no lo
 * está. El escritor tiene que fallar CERRADO.
 */
export async function degradedEpochSnapshot(): Promise<FenceCapabilityEvidence> {
  return { epoch: null, fenceCapabilityAbsent: false, degraded: true };
}
