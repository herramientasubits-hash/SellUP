/**
 * pe-sunat-open-padron.ts — una fila del Padrón RUC de SUNAT en datos abiertos.
 *
 * SOURCES-PE-CLOSE-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Archivo: `https://www.datosabiertos.gob.pe/sites/default/files/PadronRUC_AAAAMM.zip`
 * (licencia ODC-BY, mensual; el de 2026-09 pesa 261 MB y su CSV 3,55 GB, UTF-8,
 * separado por comas). Columnas:
 *
 *   RUC, Estado, Condicion, Tipo, Actividad_Economica_CIIU_revision3_Principal,
 *   Actividad_Economica_CIIU_revision3_Secundaria,
 *   Actividad_Economica_CIIU_revision4_Principal, NroTrab, TipoFacturacion,
 *   TipoContabilidad, ComercioExterior, UBIGEO, Departamento, Provincia, Distrito,
 *   PERIODO_PUBLICACION
 *
 * NO trae la razón social: se cruza por RUC con el padrón reducido
 * (`pe_sunat_registry`). Lo que aporta es el TIPO de contribuyente, la ACTIVIDAD
 * (CIIU Rev. 4, como texto) y el NÚMERO DE TRABAJADORES (`NroTrab`, de la planilla;
 * «NO DISPONIBLE» en el 59 % de las sociedades activas). Medido en el corte
 * 2026-09: 916.556 RUC 20, de ellos 867.475 activos y habidos; 358.204 con
 * trabajadores informados.
 *
 * 🔴 Un «0» informado NO es una empresa vacía: grupos grandes declaran la planilla
 * en otra razón social (Supermercados Peruanos aparece con 0). El filtro de tamaño
 * ya lo trata así; aquí sólo se conserva el número.
 */

import { resolvePeSunatCiiu4Code } from './pe-sunat-ciiu4-activity-catalog';

/** Cabecera esperada (orden fijo del archivo). */
export const PE_SUNAT_OPEN_PADRON_HEADER = [
  'RUC',
  'Estado',
  'Condicion',
  'Tipo',
  'Actividad_Economica_CIIU_revision3_Principal',
  'Actividad_Economica_CIIU_revision3_Secundaria',
  'Actividad_Economica_CIIU_revision4_Principal',
  'NroTrab',
  'TipoFacturacion',
  'TipoContabilidad',
  'ComercioExterior',
  'UBIGEO',
  'Departamento',
  'Provincia',
  'Distrito',
  'PERIODO_PUBLICACION',
] as const;

const COMPANY_RUC = /^20\d{9}$/;

/** Lo que una sociedad del padrón abierto aporta a SellUp. */
export type PeSunatOpenPadronRecord = {
  ruc: string;
  taxpayerType: string | null;
  /** Texto CIIU Rev. 4 tal como lo publica SUNAT. */
  activityText: string | null;
  /** Clase CIIU Rev. 4 (4 dígitos) del texto, o `null` si no se conoce. */
  ciiu4Code: string | null;
  /** Trabajadores informados; `null` si «NO DISPONIBLE». */
  workers: number | null;
  /** Año del corte (`PERIODO_PUBLICACION` 202609 → 2026). */
  metricsYear: number | null;
  department: string | null;
  province: string | null;
};

function text(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 && trimmed.toUpperCase() !== 'NO DISPONIBLE' ? trimmed : null;
}

/** ¿Es la cabecera esperada? (las celdas, en orden). */
export function isPeSunatOpenPadronHeader(cells: readonly string[]): boolean {
  return (
    cells.length === PE_SUNAT_OPEN_PADRON_HEADER.length &&
    PE_SUNAT_OPEN_PADRON_HEADER.every((name, i) => cells[i]?.trim() === name)
  );
}

/**
 * Una fila del CSV → registro, o `null` si no es una sociedad (RUC 20) ACTIVA y
 * HABIDA con el número de columnas esperado.
 */
export function parsePeSunatOpenPadronRow(cells: readonly string[]): PeSunatOpenPadronRecord | null {
  if (cells.length !== PE_SUNAT_OPEN_PADRON_HEADER.length) return null;
  const ruc = cells[0].trim();
  if (!COMPANY_RUC.test(ruc)) return null;
  if (cells[1].trim().toUpperCase() !== 'ACTIVO' || cells[2].trim().toUpperCase() !== 'HABIDO') return null;

  const workersText = cells[7].trim();
  const workers = /^\d{1,7}$/.test(workersText) ? Number(workersText) : null;
  const period = cells[15].trim();
  const metricsYear = /^\d{6}$/.test(period) ? Number(period.slice(0, 4)) : null;
  const activityText = text(cells[6]);

  return {
    ruc,
    taxpayerType: text(cells[3]),
    activityText,
    ciiu4Code: resolvePeSunatCiiu4Code(activityText),
    workers,
    metricsYear,
    department: text(cells[12]),
    province: text(cells[13]),
  };
}
