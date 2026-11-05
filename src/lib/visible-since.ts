/**
 * PLATFORM-CLEANUP-2026-11-05 — fecha de corte de VISIBILIDAD.
 *
 * SellUp se entregó a los líderes «como si empezara de cero». Lo de antes (consumo de créditos,
 * corridas, contactos de las pruebas) sigue guardado por debajo — el presupuesto lo necesita y el
 * banco de contactos lo reutiliza — pero ninguna pantalla lo muestra: las lecturas que se ven
 * acotan su «desde» con esta fecha.
 *
 * 🔴 Sólo para lecturas que se MUESTRAN. El presupuesto, los topes y el banco de contactos
 * leen todo, siempre: nunca pasar sus consultas por aquí.
 *
 * `SELLUP_VISIBLE_SINCE` en el entorno la cambia (fecha ISO) o la apaga (`off`).
 */

export const VISIBLE_SINCE_ENV = 'SELLUP_VISIBLE_SINCE';

/** Momento de la limpieza de entrega en Producción. */
export const DEFAULT_VISIBLE_SINCE = '2026-11-05T21:00:00.000Z';

/** `null` = sin corte. Un valor inválido cae al corte por defecto (nunca muestra de más). */
export function parseVisibleSince(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return DEFAULT_VISIBLE_SINCE;
  if (value.toLowerCase() === 'off') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? DEFAULT_VISIBLE_SINCE : new Date(ms).toISOString();
}

export function getVisibleSince(): string | null {
  return parseVisibleSince(process.env[VISIBLE_SINCE_ENV]);
}

/** El «desde» más reciente entre el pedido por la pantalla y el corte de visibilidad. */
export function clampToVisibleSince(
  since: string | null | undefined,
  visibleSince: string | null = getVisibleSince(),
): string | null {
  const requested = since ? Date.parse(since) : Number.NaN;
  if (!visibleSince) return Number.isNaN(requested) ? (since ?? null) : since!;
  if (Number.isNaN(requested)) return visibleSince;
  return requested >= Date.parse(visibleSince) ? since! : visibleSince;
}
