/**
 * Qué significa cada nivel de benchmark, en una sola decisión.
 *
 * ALTO es bueno, BAJO pide acción, MEDIO no dice nada por sí solo. Eso se
 * decide aquí y lo traducen a su vocabulario los tres sitios que lo pintan: la
 * pantalla con variantes de Badge, el PDF con tuplas RGB y el deck con hex.
 *
 * Vive en `lib/` y no en `features/exports/` porque lo leen los dos lados. Y
 * vive en un archivo propio porque antes cada uno tenía su criterio: en
 * pantalla ya había semáforo y en los entregables la píldora era binaria
 * —naranja si BAJO, azul todo lo demás—, así que las tres varas del reporte
 * salían del mismo color y el cliente no veía dónde iba bien.
 */

import type { NivelBenchmark } from '../domain/types';

export type TonoNivel = 'exito' | 'info' | 'aviso' | 'neutro';

export const TONO_DE_NIVEL: Record<NivelBenchmark, TonoNivel> = {
  ALTO: 'exito',
  MEDIO: 'info',
  BAJO: 'aviso',
  SIN_DATO: 'neutro',
  NO_APLICA: 'neutro',
};

export const tonoDeNivel = (nivel: NivelBenchmark): TonoNivel => TONO_DE_NIVEL[nivel];
