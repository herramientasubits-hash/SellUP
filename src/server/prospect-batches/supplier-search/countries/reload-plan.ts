/**
 * AGENT1-SUPPLIER-RELOAD-1 — recarga mensual de las compras públicas cargadas (auditoría de
 * «Proveedores» 21-10, bloque «Próximo»). Puro.
 *
 * Todo se cargó el 15-10 con datos hasta el 30-09 y no había recarga: los datos envejecen
 * sin aviso. Aquí se decide, por país, hasta qué mes recargar y desde cuándo los datos se
 * consideran viejos. Lo ejecuta `scripts/source-catalog/run-public-procurement-monthly.ts`.
 *
 * Cadencias (Fase 0, 15-10):
 *  - Mensual: la fuente publica el mes anterior a comienzos del siguiente. Se pide el mes
 *    pasado y, si aún no está, uno o dos antes.
 *  - Anual: Uruguay publica el año completo (OCDS) meses después: sólo años cerrados.
 *  - A mano: México firma cada descarga en el navegador; la persona deja el CSV del año y el
 *    cargador sólo lo lee. Si el archivo es viejo, se avisa en vez de recargar lo mismo.
 */

export type YearMonth = { year: number; month: number };

export type ReloadCadence =
  | { kind: 'monthly'; lagMonths: number }
  | { kind: 'annual' }
  | { kind: 'manual'; lagMonths: number; downloadPage: string; maxFileAgeDays: number };

/** Página donde la dueña baja los contratos de México (ver `mx.loader.ts`). */
export const MX_MANUAL_DOWNLOAD_PAGE = 'https://comprasmx.buengobierno.gob.mx/datos-abiertos';

export const RELOAD_CADENCE: Readonly<Record<string, ReloadCadence>> = {
  CL: { kind: 'monthly', lagMonths: 1 },
  PE: { kind: 'monthly', lagMonths: 1 },
  HN: { kind: 'monthly', lagMonths: 1 },
  GT: { kind: 'monthly', lagMonths: 1 },
  PY: { kind: 'monthly', lagMonths: 1 },
  PA: { kind: 'monthly', lagMonths: 1 },
  AR: { kind: 'monthly', lagMonths: 1 },
  ES: { kind: 'monthly', lagMonths: 1 },
  EC: { kind: 'monthly', lagMonths: 1 },
  CR: { kind: 'monthly', lagMonths: 1 },
  UY: { kind: 'annual' },
  MX: { kind: 'manual', lagMonths: 1, downloadPage: MX_MANUAL_DOWNLOAD_PAGE, maxFileAgeDays: 35 },
};

/** Meses de la ventana (los mismos 12 de la carga inicial). */
export const RELOAD_WINDOW_MONTHS = 12;
/** Mes final más viejo que se intenta si el más reciente aún no está publicado. */
export const RELOAD_MAX_FALLBACK_MONTHS = 2;

export function shiftMonth(value: YearMonth, delta: number): YearMonth {
  const index = value.year * 12 + (value.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function formatYearMonth(value: YearMonth): string {
  return `${value.year}-${value.month}`;
}

export type CountryReloadPlan = {
  countryCode: string;
  /** Meses finales a probar, del más reciente al más viejo. */
  ends: YearMonth[];
  months: number;
  /** Sólo México: el archivo que la persona tiene que haber dejado y dónde bajarlo. */
  manual?: { fileName: string; downloadPage: string; maxFileAgeDays: number };
};

/** Hasta qué mes recargar cada país, a partir de hoy. */
export function planCountryReload(countryCode: string, today: Date): CountryReloadPlan | null {
  const cadence = RELOAD_CADENCE[countryCode];
  if (!cadence) return null;
  const current: YearMonth = { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 };
  if (cadence.kind === 'annual') {
    return {
      countryCode,
      ends: [{ year: current.year - 1, month: 12 }, { year: current.year - 2, month: 12 }],
      months: RELOAD_WINDOW_MONTHS,
    };
  }
  const latest = shiftMonth(current, -cadence.lagMonths);
  const ends = Array.from({ length: RELOAD_MAX_FALLBACK_MONTHS + 1 }, (_, i) => shiftMonth(latest, -i));
  if (cadence.kind === 'manual') {
    return {
      countryCode,
      ends: [latest],
      months: RELOAD_WINDOW_MONTHS,
      manual: {
        fileName: `contratos_comprasmx_${latest.year}.csv`,
        downloadPage: cadence.downloadPage,
        maxFileAgeDays: cadence.maxFileAgeDays,
      },
    };
  }
  return { countryCode, ends, months: RELOAD_WINDOW_MONTHS };
}

/** ¿El archivo a mano es demasiado viejo para recargar con él? */
export function isManualFileStale(fileMtime: Date, today: Date, maxFileAgeDays: number): boolean {
  return today.getTime() - fileMtime.getTime() > maxFileAgeDays * 86_400_000;
}

/** Días desde el fin de la ventana a partir de los cuales los datos se consideran viejos. */
export const DATA_STALE_AFTER_DAYS: Readonly<Record<ReloadCadence['kind'], number>> = {
  // El mes pasado se publica a comienzos de este: más de ~2 meses sin recargar ya es viejo.
  monthly: 75,
  manual: 75,
  // Un año cerrado se publica meses después: viejo si falta más de un año completo.
  annual: 550,
};

/** ¿Los datos cargados de este país están viejos? (`windowEnd` = AAAA-MM-DD). */
export function isProcurementDataStale(countryCode: string, windowEnd: string | null, today: Date): boolean {
  if (!windowEnd) return false;
  const end = Date.parse(`${windowEnd.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(end)) return false;
  const kind = RELOAD_CADENCE[countryCode]?.kind ?? 'monthly';
  return today.getTime() - end > DATA_STALE_AFTER_DAYS[kind] * 86_400_000;
}

/** ¿El error del cargador dice que ese mes todavía no se publicó (y vale probar uno antes)? */
export function isNotYetPublished(output: string): boolean {
  return /download_failed:[^\n]*:(403|404|410)\b|_not_published|year_not_published/i.test(output);
}
