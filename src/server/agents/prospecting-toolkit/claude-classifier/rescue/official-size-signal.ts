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

/**
 * ¿El tamaño de esta fila lo midió una fuente oficial? Sólo filas del buscador
 * gratuito (`fromFreeLayer`) de los países de la tabla.
 */
export function officialSizeSignal(params: { countryCode: string | null; fromFreeLayer: boolean }): OfficialSizeSignal {
  if (!params.fromFreeLayer) return NOT_MEASURED;
  const country = (params.countryCode ?? '').trim().toUpperCase();
  const min = OFFICIAL_SIZE_MIN_EMPLOYEES[country];
  return min === undefined ? NOT_MEASURED : { measured: true, minEmployees: min };
}
