/**
 * Inputs del Modulo de Aprendizaje (LMS), solo para la proyeccion de venta.
 *
 * `capacidad` es lo que el prospecto TENDRIA disponible: lo cotizado y su
 * headcount. La calculadora original tambien medía el uso real al cierre del
 * ano; en SellUP solo vive el ejercicio de proyeccion, asi que no hay `uso`.
 *
 * Los campos opcionales son `null`, no `undefined`: null significa "no lo se,
 * derivalo del supuesto", y el engine deja constancia de que lo derivo.
 */

import type { PalancaId } from '../types';

/** Proporcion 0-1. Antes solo admitia 5% o 10%; ahora es libre. */
export type PctLideresDefault = number;

/**
 * Quien manda cuando cambia la poblacion total.
 *
 * Es solo intencion de edicion: el engine NUNCA lo lee, deriva igual que
 * siempre a partir de los nulos. Es opcional para que un localStorage viejo y
 * el caso de ejemplo sigan validando sin migracion; si falta, se infiere de la
 * forma de los nulos.
 */
export type ModoSegmentos = 'porcentaje' | 'lideres' | 'resto' | 'ambos';

export interface PoblacionInput {
  /** P: usuarios con acceso. Alimenta los tramos y las interpolaciones. */
  poblacionTotal: number;
  /** null -> poblacionTotal x pctLideresDefault. */
  nLideres: number | null;
  /** null -> poblacionTotal - lideres. */
  nResto: number | null;
  pctLideresDefault: PctLideresDefault;
  modoSegmentos?: ModoSegmentos;
}

export interface CapacidadInput {
  /**
   * Ids de las palancas incluidas en la cotizacion.
   * null o ausente = no se declaro -> se calculan las 6, que es lo de siempre.
   */
  palancasCotizadas?: PalancaId[] | null;
  /** En proyeccion el periodo es siempre el ano completo. */
  anio: number;
  inversionAnualUSD: number;
  poblacion: PoblacionInput;
  /** null -> param p4.rotacionAnual (0,20). */
  rotacionAnual: number | null;
  /**
   * ASR esperado, 0-1. Base de Modo Estudio (poblacion x ASR).
   * null -> param proy.asrEsperado (15%).
   */
  asr6Meses: number | null;
}

export interface LMSInput {
  cliente: string;
  capacidad: CapacidadInput;
}

/** Ids de las 6 palancas. Son claves de logica; el "P1..P6" es solo etiqueta. */
export const PALANCA_IDS = {
  lms: 'lms',
  catalogoLideres: 'catalogo_lideres',
  catalogoPorRol: 'catalogo_por_rol',
  onboarding: 'onboarding',
  modoEstudio: 'modo_estudio',
  assessments: 'assessments',
} as const;

export type LMSPalancaId = (typeof PALANCA_IDS)[keyof typeof PALANCA_IDS];

/**
 * Etiquetas de las lineas del desglose.
 *
 * Son un contrato, no rotulos sueltos: los exports buscan valores dentro de
 * `explicacionInstalado.lineas` comparando por etiqueta. Mientras fueron
 * strings escritos a mano en dos sitios, renombrar una aqui devolvia undefined
 * alli y el PDF imprimia "0 x US$50" sin que fallara nada.
 */
export const ETIQUETA = {
  poblacionTotal: 'Población total',
  valorTramo: 'Valor del tramo',
  tramoDesde: 'Tramo desde',
  tramoHasta: 'Tramo hasta',
  lideres: 'Líderes',
  precioLider: 'Precio por líder',
  usuariosResto: 'Usuarios del resto',
  precioUsuario: 'Precio por usuario',
  contrataciones: 'Contrataciones',
  horasAhorradas: 'Horas ahorradas',
  costoHoraRH: 'Costo hora de RH',
  baseActivos: 'Base de usuarios activos',
  costoMensual: 'Costo mensual por usuario',
  mesesAplicables: 'Meses aplicables',
  pisoAssessments: 'Piso de Assessments',
} as const;
