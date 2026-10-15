/**
 * Agente 1 · Rescate con Claude — tamaño medido por la fuente OFICIAL (puro).
 *
 * SOURCES-FREE-LAYER-OFFICIAL-SIZE-1 — decisión de la dueña (06-10-2026, «si»):
 * cuando la empresa viene del buscador gratuito de un país cuya fuente oficial
 * YA midió su tamaño, Claude NO la descarta por una cifra de internet (rangos de
 * LinkedIn, notas viejas, directorios); sigue comprobando industria y sitio, y la
 * cifra que encuentre queda en su clasificación como aviso para quien revise.
 *
 * Prod 06-10: 32 empresas del buscador gratuito descartadas por tamaño en AR, CO
 * y RD (p. ej. Equifax RD por «170 empleados» de un comunicado antiguo; Logicone
 * por «49 empleados» de un directorio).
 *
 * Países con tamaño oficial en su capa gratuita:
 *   - CL: trabajadores dependientes informados al SII (cl_sii_directory, 100+).
 *     Umbral 100, el mismo que aprobó la dueña para el buscador de Chile.
 *   - EC: empleados del ranking de la Superintendencia (ec_scvs_directory, 100+).
 *     Umbral 100 desde SOURCES-EC-CLOSE-1 (dueña 06-10: «100+ como Chile»).
 *   - DO: sólo empresas con señal de tamaño de la DGII (#593).
 *   - PE: trabajadores informados a SUNAT en el Padrón RUC abierto (pe_sunat_directory, 200+).
 *     SOURCES-EC-CLOSE-2, dueña 06-10-2026.
 * Argentina (proveedores del Estado), Colombia (ranking por ventas) y México
 * (estrato DENUE 51+) NO miden tamaño ICP: Claude sigue decidiendo como siempre.
 */

import { DEFAULT_ICP_MIN_EMPLOYEES } from './rescue-decision';

const OFFICIAL_SIZE_MIN_EMPLOYEES: Readonly<Record<string, number>> = Object.freeze({
  CL: 100,
  EC: 100,
  DO: 200,
  PE: 200,
});

export type OfficialSizeSignal = {
  /** La fuente oficial ya midió el tamaño: Claude no descarta por tamaño. */
  measured: boolean;
  /** Umbral de tamaño para esta fila. */
  minEmployees: number;
};

const NOT_MEASURED: OfficialSizeSignal = { measured: false, minEmployees: DEFAULT_ICP_MIN_EMPLOYEES };

/** Clave (evidencia de la descartada o metadata del candidato) de una fuente sin filtro de tamaño. */
export const OFFICIAL_SIZE_UNFILTERED_KEY = 'official_size_unfiltered';

/**
 * AGENT1-RESCUE-SIZE-UNFILTERED-1 — ¿la fila viene de una fuente oficial que NO filtró
 * por tamaño (proveedores de compras públicas)? Prod 15-10 (Subsecretaría de Salud × CL,
 * 28a13bfd): AZAR PRODUCCIONES (2 empleados) volvió a revisión y VICONF entró sin web
 * como «filial grande», porque en Chile toda fila oficial se daba por «100+ medido».
 */
export function isSizeUnfiltered(record: Record<string, unknown> | null | undefined): boolean {
  return record?.[OFFICIAL_SIZE_UNFILTERED_KEY] === true;
}

/**
 * ¿El tamaño de esta fila lo midió una fuente oficial? Sólo filas del buscador
 * gratuito (`fromFreeLayer`) de los países de la tabla, y nunca las de una fuente que
 * no filtró por tamaño (`sizeUnfiltered`).
 */
export function officialSizeSignal(params: {
  countryCode: string | null;
  fromFreeLayer: boolean;
  sizeUnfiltered?: boolean;
}): OfficialSizeSignal {
  if (!params.fromFreeLayer) return NOT_MEASURED;
  const country = (params.countryCode ?? '').trim().toUpperCase();
  const min = OFFICIAL_SIZE_MIN_EMPLOYEES[country];
  // Sin filtro de la fuente: no está medido, pero rige el umbral aprobado del país.
  if (params.sizeUnfiltered === true) return min === undefined ? NOT_MEASURED : { measured: false, minEmployees: min };
  return min === undefined ? NOT_MEASURED : { measured: true, minEmployees: min };
}
