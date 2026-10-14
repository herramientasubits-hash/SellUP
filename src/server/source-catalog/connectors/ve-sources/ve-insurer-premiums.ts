/**
 * ve-insurer-premiums.ts — las aseguradoras más grandes de Venezuela por primas, como
 * señal de «grande» para el tamaño.
 *
 * SOURCES-VE-SIZE-2 (14-10-2026, aprobado por la dueña: las 15 primeras por primas,
 * el 91 % del mercado). Puro.
 *
 * Fuente: SUDEASEG, «Seguro en Cifras 2024», cuadro 31-A (primas netas cobradas por
 * empresa, miles de bolívares nominales; copia del Internet Archive). No es número de
 * trabajadores: es un tramo «grande» que queda en la ficha y NO decide solo el corte
 * de 200 (igual que los grandes contribuyentes de Bolivia, Panamá o Nicaragua).
 */

export type VeLargeInsurer = { rif: string; name: string; rank: number; marketSharePct: number };

/** Año de las primas. */
export const VE_INSURER_PREMIUMS_YEAR = 2024;

/** Categoría que lee el filtro de tamaño (`BO_TAXPAYER_CATEGORY_BANDS`). */
export const VE_LARGE_INSURER_CATEGORY = 'VE_ASEGURADORA_GRANDE' as const;

export const VE_LARGE_INSURERS: readonly VeLargeInsurer[] = Object.freeze([
  { rif: 'J-00090180-5', name: 'MERCANTIL SEGUROS, C.A', rank: 1, marketSharePct: 26.07 },
  { rif: 'J-00038923-3', name: 'SEGUROS CARACAS, C.A', rank: 2, marketSharePct: 19.98 },
  { rif: 'J-09028623-3', name: 'SEGUROS CONSTITUCIÓN, C.A', rank: 3, marketSharePct: 5.93 },
  { rif: 'J-00338202-7', name: 'C.A DE SEGUROS LA INTERNACIONAL', rank: 4, marketSharePct: 5.15 },
  { rif: 'J-00021410-7', name: 'MAPFRE LA SEGURIDAD C.A. DE SEGUROS', rank: 5, marketSharePct: 4.49 },
  { rif: 'J-30620632-9', name: 'Oceánica de Seguros, C.A.', rank: 6, marketSharePct: 4.46 },
  { rif: 'J-00106474-5', name: 'SEGUROS PIRÁMIDE, C.A', rank: 7, marketSharePct: 4.31 },
  { rif: 'J-30467796-0', name: 'HISPANA DE SEGUROS, S.A', rank: 8, marketSharePct: 3.58 },
  { rif: 'J-00007587-5', name: 'ESTAR SEGUROS, S.A', rank: 9, marketSharePct: 2.97 },
  { rif: 'J-41173015-7', name: 'SEGUROS CAPITAL C.A.', rank: 10, marketSharePct: 2.8 },
  { rif: 'J-30083118-3', name: 'BANESCO SEGUROS C.A', rank: 11, marketSharePct: 2.69 },
  { rif: 'J-00148811-1', name: 'SEGUROS UNIVERSITAS, C.A.', rank: 12, marketSharePct: 2.49 },
  { rif: 'J-00057479-0', name: 'SEGUROS MIRANDA, C.A', rank: 13, marketSharePct: 2.02 },
  { rif: 'J-00034036-6', name: 'SEGUROS VENEZUELA C.A', rank: 14, marketSharePct: 1.96 },
  { rif: 'J-30052236-9', name: 'SEGUROS ALTAMIRA, C.A', rank: 15, marketSharePct: 1.78 },
]);

const BY_RIF: ReadonlyMap<string, VeLargeInsurer> = new Map(VE_LARGE_INSURERS.map((i) => [i.rif, i]));

/** La aseguradora grande de un RIF, o `null`. */
export function veLargeInsurerFor(rif: string | null | undefined): VeLargeInsurer | null {
  return typeof rif === 'string' ? (BY_RIF.get(rif) ?? null) : null;
}

/** Campos de `raw_data` del tramo «grande» (ficha y capa gratuita). Vacío sin dato. */
export function veLargeInsurerRaw(insurer: VeLargeInsurer | null): Record<string, unknown> {
  return insurer === null
    ? {}
    : {
        taxpayer_category: VE_LARGE_INSURER_CATEGORY,
        metrics_year: VE_INSURER_PREMIUMS_YEAR,
        official_size_band: 'large',
        insurer_premium_rank: insurer.rank,
        insurer_market_share_pct: insurer.marketSharePct,
      };
}
