/**
 * Source Catalog — Contrato genérico de conectores estructurados — Hito 16AD.2
 *
 * Define la interfaz IStructuredSourceConnector que cualquier fuente
 * estructurada debe implementar. Socrata Colombia es la primera implementación.
 *
 * No contiene lógica. No importa nada externo.
 */

import type { StructuredSourceMode, StructuredSourceType } from '../agents/prospecting-toolkit/structured-candidate-types';

/**
 * Contrato base para cualquier conector de fuente estructurada.
 *
 * Identifica la fuente, su tipo, modo operativo y país de origen.
 * Los métodos fetch/normalize/toDraft son responsabilidad de cada
 * implementación concreta — no se tipan aquí para no acoplar al
 * tipo de registro fuente ni al tipo de draft generado.
 */
export interface IStructuredSourceConnector {
  /** Clave única del conector en el catálogo (e.g. 'co_rues') */
  readonly sourceKey: string;

  /** Proveedor de la fuente (e.g. 'socrata_colombia') */
  readonly sourceProvider: string;

  /** Clasificación funcional de la fuente */
  readonly sourceType: StructuredSourceType;

  /** Modo operativo actual del conector */
  readonly sourceMode: StructuredSourceMode;

  /** Código ISO-2 del país objetivo */
  readonly countryCode: string;

  /** Versión semántica del conector */
  readonly connectorVersion: string;
}
