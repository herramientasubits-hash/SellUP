// Agente 2A — Motor `legacy_lusha_only` del disparo MANUAL de Lusha
// (AGENT2A-PHONE-REVEAL-4O-F-R2)
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// Antes de este hito había DOS implementaciones pagadas independientes de la MISMA
// operación económica «revelar el teléfono de un candidato con Lusha»:
//
//   1. la pata Lusha del waterfall / la continuación legacy, que reserva créditos de
//      forma atómica, crea una corrida real, correlaciona su usage-log con esa corrida
//      y liquida la reserva al cerrar;
//   2. el disparo manual de administración
//      (`revealCandidatePhoneViaLushaFallbackAction`), que llamaba a Lusha
//      DIRECTAMENTE: sin reserva, sin corrida, sin single-flight y —según fijó la
//      auditoría 4O-F-M0— sin gate presupuestal alguno. ACCOUNTING sí, ENFORCEMENT no.
//
// R2 elimina la segunda. El disparo manual pasa a estar DURADERAMENTE REPRESENTADO
// como lo que siempre fue: una corrida de un solo proveedor,
// `run_mode = 'legacy_lusha_only'`, que es una operación REAL que el modelo de datos ya
// soportaba (migración 103) y no una corrida fabricada. No se inventa una pata Apollo,
// no se crea una reserva huérfana, no se añade una RPC y no se toca el ledger global.
//
// LO QUE NO CAMBIA
//
//   * `ENABLE_PHONE_REVEAL_WATERFALL` sigue en `false` en Producción y este archivo NO
//     lo lee. Ese flag gobierna la UX del waterfall Apollo→Lusha; NO gobierna si la
//     base de datos puede contener una corrida `legacy_lusha_only`. La distinción es el
//     eje de R2: flag de PRODUCTO ≠ infraestructura DURABLE de contabilidad.
//   * El permiso de producto del disparo manual sigue siendo
//     `ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`, y sigue evaluándose. No se elimina ni se
//     salta ningún gate existente.
//   * La operación sigue siendo SÍNCRONA, admin-only, de UN candidato, sin polling,
//     sin modal nuevo y sin drawer de waterfall. La UI no cambia.
//
// Este módulo NO decide nada: compone. La decisión vive en el core puro del waterfall y
// en el core puro del fallback, exactamente como antes.

import { isLushaPhoneRevealFallbackEnabled } from '@/lib/feature-flags.server';
import {
  callLushaFallbackLeg,
  startLegacyPhoneRevealWaterfallForCandidate,
  type StartLegacyPhoneRevealWaterfallRuntimeResult,
} from './phone-reveal-waterfall-deps';

/**
 * Pata Lusha del disparo MANUAL. Es la misma función que ejecuta la pata automática
 * —una sola implementación multi-teléfono— con `manualInvocation: true`, que conserva
 * las dos propiedades del contrato manual que la ruta automática no necesita:
 *
 *   1. la puerta de privacidad DESPUÉS de la respuesta de Lusha, que protege contra un
 *      `do_not_contact` registrado EN VUELO (la transacción 111/113 revisa tombstones
 *      por número y supresión por persona bajo el lock, pero NO lee `do_not_contact`);
 *   2. la persistencia en el candidato de los desenlaces que NO revelan
 *      (`no_phone_found`, error), que es la semántica observable que el disparo manual
 *      ya tenía.
 *
 * Está SCOPED a esta invocación: la ruta automática (webhook, cron L2, revisión L3,
 * server action legacy) nunca recibe esta variante y queda funcionalmente idéntica.
 */
const callLushaLegForManualInvocation: NonNullable<
  Parameters<typeof startLegacyPhoneRevealWaterfallForCandidate>[2]
>['callLushaLeg'] = (args) =>
  callLushaFallbackLeg({ ...args, manualInvocation: true });

/**
 * Ejecuta el reveal manual de Lusha sobre la infraestructura `legacy_lusha_only`.
 *
 * Orden de gates, barato→caro y fail-closed, heredado SIN cambios del core del
 * waterfall legacy:
 *
 *   1. permiso de producto (`ENABLE_LUSHA_PHONE_REVEAL_FALLBACK`);
 *   2. rol admin;
 *   3. elegibilidad del candidato sobre evidencia persistida;
 *   4. ninguna corrida activa + historial reautorizable;
 *   5. preflight de presupuesto (lectura del pozo de Lusha, y SOLO de Lusha);
 *   6. RESERVA + CORRIDA en una transacción (`reserve_and_create_phone_reveal_run`);
 *   7. puerta de privacidad previa (supresión + `do_not_contact`);
 *   8. claim atómico de la pata;
 *   9. UNA llamada a Lusha;
 *  10. usage-log correlacionado con la corrida REAL;
 *  11. persistencia multi-teléfono transaccional;
 *  12. liquidación de la reserva al volverse terminal la corrida.
 *
 * Consecuencias que R2 compra, todas propiedades de esa secuencia y no de código nuevo:
 * presupuesto 0 ⇒ 0 llamadas; DNC/supresión previa ⇒ 0 llamadas y 0 créditos; tres
 * invocaciones concurrentes sobre el MISMO candidato con presupuesto abundante ⇒ UNA
 * sola operación pagada (el índice único parcial de reservas activas y el de corrida
 * activa por candidato viven DENTRO de la transacción, así que rechazan ANTES de pagar,
 * no después); y el usage-log comparte identidad de corrida con la reserva confirmada,
 * así que `computeEffectiveConsumption` deduplica y una llamada de 5 créditos consume 5,
 * nunca 10.
 */
export async function executeLegacyLushaOnlyPhoneReveal(args: {
  candidateId: string;
  actor: { internalUserId: string; roleKey: string | null };
}): Promise<StartLegacyPhoneRevealWaterfallRuntimeResult> {
  return startLegacyPhoneRevealWaterfallForCandidate(
    args.candidateId,
    args.actor,
    {
      // El permiso de PRODUCTO del disparo manual. NO se lee
      // `ENABLE_PHONE_REVEAL_WATERFALL`: con ese flag apagado —su estado en
      // Producción— esta operación tiene que seguir siendo posible, porque el flag
      // apagado describe la UX del waterfall, no la existencia de la contabilidad.
      flagEnabled: isLushaPhoneRevealFallbackEnabled(),
      callLushaLeg: callLushaLegForManualInvocation,
    },
  );
}
