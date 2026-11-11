// ============================================================
// Alertas de consumo para administradores (dueña 11-11) — cálculo (puro).
// Compara lo usado en el mes con la cuota mensual de cada proveedor y proyecta
// el día en que se agota al ritmo actual. Sólo LEE: nunca toca el presupuesto.
// ============================================================

export const COST_ALERT_THRESHOLDS = [80, 100] as const;

export interface ProviderMonthUsage {
  proveedor: string;
  asignacionMensualCreditos: number | null;
  asignacionMensualUsd: number | null;
  usadoMesCreditos: number;
  usadoMesUsd: number;
}

export interface CostAlert {
  proveedor: string;
  umbral: (typeof COST_ALERT_THRESHOLDS)[number];
  porcentaje: number;
  unidad: 'créditos' | 'USD';
  usado: number;
  asignado: number;
  /** Día del mes en que se agota al ritmo actual (null si no se agota este mes o ya se agotó). */
  diaAgotamiento: number | null;
}

/** Día del mes y días del mes en hora de Bogotá. */
export function bogotaMonthDay(now: Date): { day: number; daysInMonth: number } {
  const local = new Date(now.getTime() - 5 * 3_600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  return { day: local.getUTCDate(), daysInMonth: new Date(Date.UTC(y, m + 1, 0)).getUTCDate() };
}

export function evaluateCostAlerts(rows: readonly ProviderMonthUsage[], now: Date): CostAlert[] {
  const { day, daysInMonth } = bogotaMonthDay(now);
  const alerts: CostAlert[] = [];
  for (const row of rows) {
    const useCredits = (row.asignacionMensualCreditos ?? 0) > 0;
    const asignado = useCredits ? (row.asignacionMensualCreditos as number) : row.asignacionMensualUsd ?? 0;
    if (!(asignado > 0)) continue;
    const usado = useCredits ? row.usadoMesCreditos : row.usadoMesUsd;
    const porcentaje = Math.round((usado / asignado) * 100);
    const umbral = [...COST_ALERT_THRESHOLDS].reverse().find((t) => porcentaje >= t);
    if (!umbral) continue;
    const ritmo = day > 0 ? usado / day : 0;
    const dia = porcentaje < 100 && ritmo > 0 ? Math.ceil(asignado / ritmo) : null;
    alerts.push({
      proveedor: row.proveedor,
      umbral,
      porcentaje,
      unidad: useCredits ? 'créditos' : 'USD',
      usado: Math.round(usado * 100) / 100,
      asignado,
      diaAgotamiento: dia !== null && dia <= daysInMonth ? dia : null,
    });
  }
  return alerts;
}

/** Título fijo por proveedor y umbral: sirve para no repetir la alerta en el mes. */
export function costAlertTitle(alert: Pick<CostAlert, 'proveedor' | 'umbral'>): string {
  return alert.umbral >= 100
    ? `${alert.proveedor} llegó al 100 % de su cuota del mes`
    : `${alert.proveedor} pasó el ${alert.umbral} % de su cuota del mes`;
}

export function costAlertMessage(alert: CostAlert): string {
  const fmt = (n: number) => n.toLocaleString('es-CO', { maximumFractionDigits: 2 });
  const base = `Lleva ${fmt(alert.usado)} de ${fmt(alert.asignado)} ${alert.unidad} (${alert.porcentaje} %).`;
  if (alert.umbral >= 100) return `${base} Según sus reglas, las búsquedas que lo usan pueden quedar bloqueadas o pedir aprobación.`;
  return alert.diaAgotamiento ? `${base} A este ritmo se agota el día ${alert.diaAgotamiento}.` : base;
}

/** Proveedor que dejó de responder por saldo o llave (alerta inmediata). */
export function providerBlockedTitle(provider: string, code: string): string {
  return code === 'credits_exhausted' ? `${provider} se quedó sin créditos` : `${provider} rechazó la llave de acceso`;
}
