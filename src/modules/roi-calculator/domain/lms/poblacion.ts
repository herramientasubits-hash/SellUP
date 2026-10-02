/**
 * Reparto de la poblacion entre lideres y resto.
 *
 * El problema que resuelve: con poblacion 350 y lideres 26 / resto 274 — que
 * suman 300 — la app no reajustaba nada y el usuario tenia que restar a mano.
 *
 * `null` sigue significando "derivalo", que es lo que lee el engine. Lo unico
 * que la nulidad no puede expresar es QUIEN manda cuando cambia la poblacion,
 * y para eso esta `modoSegmentos`. Cuando falta se infiere de la forma de los
 * nulos, de modo que un input guardado antes de este cambio se comporta bien
 * sin migracion.
 *
 * Todas las funciones son puras: entra un PoblacionInput, sale otro.
 */

import type { ModoSegmentos, PoblacionInput } from './types';

export type CampoPoblacion = 'poblacionTotal' | 'pctLideres' | 'nLideres' | 'nResto';

export interface SegmentosDerivados {
  lideres: number;
  resto: number;
  suma: number;
  /** lideres + resto === poblacionTotal */
  coherente: boolean;
  lideresEstimados: boolean;
  restoEstimado: boolean;
  /** lideres / poblacionTotal; null si la poblacion es 0. */
  pctReal: number | null;
  /** Personas de la poblacion que no estan en ningun segmento. */
  sinAsignar: number;
}

const entero = (n: number): number => Math.max(0, Math.round(n));

/**
 * Espejo exacto de `resolverSegmentos` (engine.ts), que es una closure privada
 * y no se puede importar. La paridad entre las dos esta cubierta por un test.
 */
export function derivarSegmentos(p: PoblacionInput): SegmentosDerivados {
  const { poblacionTotal, nLideres, nResto, pctLideresDefault } = p;

  const lideres = nLideres ?? Math.round(poblacionTotal * pctLideresDefault);
  const resto = nResto ?? Math.max(0, poblacionTotal - lideres);
  const suma = lideres + resto;

  return {
    lideres,
    resto,
    suma,
    coherente: suma === poblacionTotal,
    lideresEstimados: nLideres === null,
    restoEstimado: nResto === null,
    pctReal: poblacionTotal === 0 ? null : lideres / poblacionTotal,
    sinAsignar: poblacionTotal - suma,
  };
}

/** Deduce quien manda a partir de la forma de los nulos. */
export function inferirModo(p: PoblacionInput): ModoSegmentos {
  const { nLideres, nResto, poblacionTotal } = p;

  if (nLideres === null && nResto === null) return 'porcentaje';
  if (nLideres !== null && nResto === null) return 'lideres';
  if (nLideres === null && nResto !== null) return 'resto';

  // Los dos declarados: si cuadran, mandan los lideres y el resto se reajusta.
  // Si no cuadran, es una incoherencia deliberada y se respeta tal cual.
  return (nLideres ?? 0) + (nResto ?? 0) === poblacionTotal ? 'lideres' : 'ambos';
}

export const modoDe = (p: PoblacionInput): ModoSegmentos => p.modoSegmentos ?? inferirModo(p);

/**
 * Unica transicion del bloque. Escribe solo en los campos que NO se estan
 * editando, para no reformatear lo que el usuario tiene bajo el cursor.
 */
export function aplicarEdicionPoblacion(
  p: PoblacionInput,
  campo: CampoPoblacion,
  valor: number | null,
): PoblacionInput {
  const modo = modoDe(p);

  switch (campo) {
    case 'poblacionTotal': {
      const poblacionTotal = entero(valor ?? 0);

      switch (modo) {
        case 'porcentaje':
          // Los dos derivados reflotan solos.
          return { ...p, poblacionTotal, nLideres: null, nResto: null, modoSegmentos: 'porcentaje' };

        case 'lideres':
          // Se respetan los lideres escritos; el resto se recalcula.
          return { ...p, poblacionTotal, nResto: null, modoSegmentos: 'lideres' };

        case 'resto':
          // Se respeta el resto escrito; los lideres absorben la diferencia.
          return {
            ...p,
            poblacionTotal,
            nLideres: Math.max(0, poblacionTotal - (p.nResto ?? 0)),
            modoSegmentos: 'resto',
          };

        default:
          // 'ambos': incoherencia deliberada, no se toca ningun segmento.
          return { ...p, poblacionTotal, modoSegmentos: 'ambos' };
      }
    }

    case 'pctLideres': {
      // El porcentaje vuelve a repartir: los dos segmentos pasan a derivados.
      const pct = valor === null ? p.pctLideresDefault : Math.min(1, Math.max(0, valor));
      return {
        ...p,
        pctLideresDefault: pct,
        nLideres: null,
        nResto: null,
        modoSegmentos: 'porcentaje',
      };
    }

    case 'nLideres': {
      if (valor === null) {
        // Vaciar el campo devuelve el bloque entero a automatico.
        return { ...p, nLideres: null, nResto: null, modoSegmentos: 'porcentaje' };
      }
      return { ...p, nLideres: entero(valor), nResto: null, modoSegmentos: 'lideres' };
    }

    case 'nResto': {
      if (valor === null) {
        return modo === 'resto'
          ? { ...p, nLideres: null, nResto: null, modoSegmentos: 'porcentaje' }
          : { ...p, nResto: null, modoSegmentos: modo === 'ambos' ? 'lideres' : modo };
      }
      const nResto = entero(valor);
      return {
        ...p,
        nResto,
        nLideres: Math.max(0, p.poblacionTotal - nResto),
        modoSegmentos: 'resto',
      };
    }

    default:
      return p;
  }
}

export function volverAAutomatico(p: PoblacionInput, pct?: number): PoblacionInput {
  return {
    ...p,
    pctLideresDefault: pct ?? p.pctLideresDefault,
    nLideres: null,
    nResto: null,
    modoSegmentos: 'porcentaje',
  };
}

// ---------------------------------------------------------------------------
// Reparaciones cuando la suma no cuadra
// ---------------------------------------------------------------------------

export type Reparacion =
  | { tipo: 'ajustar_resto'; valor: number; etiqueta: string }
  | { tipo: 'ajustar_lideres'; valor: number; etiqueta: string }
  | { tipo: 'ajustar_poblacion'; valor: number; etiqueta: string }
  | { tipo: 'volver_auto'; etiqueta: string };

/** Acciones concretas que ofrece el aviso, en vez de dejar al usuario restando. */
export function reparacionesSugeridas(p: PoblacionInput): Reparacion[] {
  const d = derivarSegmentos(p);
  if (d.coherente) return [];

  const opciones: Reparacion[] = [];

  if (d.lideres <= p.poblacionTotal) {
    const resto = p.poblacionTotal - d.lideres;
    opciones.push({
      tipo: 'ajustar_resto',
      valor: resto,
      etiqueta: `Ajustar el resto a ${resto.toLocaleString('es-CO')}`,
    });
  } else {
    opciones.push({
      tipo: 'ajustar_lideres',
      valor: p.poblacionTotal,
      etiqueta: `Ajustar los líderes a ${p.poblacionTotal.toLocaleString('es-CO')}`,
    });
  }

  opciones.push({
    tipo: 'ajustar_poblacion',
    valor: d.suma,
    etiqueta: `Subir la población a ${d.suma.toLocaleString('es-CO')}`,
  });

  opciones.push({ tipo: 'volver_auto', etiqueta: 'Volver a automático' });

  return opciones;
}

export function aplicarReparacion(p: PoblacionInput, r: Reparacion): PoblacionInput {
  switch (r.tipo) {
    case 'ajustar_resto':
      return { ...p, nResto: r.valor, modoSegmentos: 'lideres' };
    case 'ajustar_lideres':
      return { ...p, nLideres: r.valor, nResto: null, modoSegmentos: 'lideres' };
    case 'ajustar_poblacion':
      return { ...p, poblacionTotal: r.valor, modoSegmentos: 'ambos' };
    case 'volver_auto':
      return volverAAutomatico(p);
    default:
      return p;
  }
}
