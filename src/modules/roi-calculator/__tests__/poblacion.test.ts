import { describe, it } from 'node:test';
import { expect } from './expect';
import { crearEngineLMS } from '../domain/lms/engine';
import { crearParamsLMS } from '../domain/lms/params';
import {
  aplicarEdicionPoblacion,
  aplicarReparacion,
  derivarSegmentos,
  inferirModo,
  modoDe,
  reparacionesSugeridas,
  volverAAutomatico,
} from '../domain/lms/poblacion';
import { casoEjemploProspecto } from '../domain/lms/schema';
import { PALANCA_IDS } from '../domain/lms/types';
import type { PoblacionInput } from '../domain/lms/types';

const ahora = () => new Date('2026-09-21T12:00:00.000Z');
const engine = crearEngineLMS({ params: crearParamsLMS(ahora), now: ahora });

const pob = (p: Partial<PoblacionInput>): PoblacionInput => ({
  poblacionTotal: 300,
  nLideres: null,
  nResto: null,
  pctLideresDefault: 0.05,
  ...p,
});

describe('paridad con el engine', () => {
  // derivarSegmentos duplica la formula de resolverSegmentos, que es una
  // closure privada del engine. Este test impide que las dos copias se separen.
  const casos: PoblacionInput[] = [
    pob({}),
    pob({ poblacionTotal: 350 }),
    pob({ poblacionTotal: 350, pctLideresDefault: 0.1 }),
    pob({ poblacionTotal: 300, nLideres: 26, nResto: 274 }),
    pob({ poblacionTotal: 350, nLideres: 26, nResto: 274 }),
    pob({ poblacionTotal: 1000, nLideres: 80, nResto: null }),
    pob({ poblacionTotal: 1000, nLideres: null, nResto: 900 }),
    pob({ poblacionTotal: 0 }),
    pob({ poblacionTotal: 20, nLideres: 26 }),
    pob({ poblacionTotal: 350, pctLideresDefault: 0.074 }),
  ];

  casos.forEach((poblacion, n) => {
    it(`los segmentos coinciden con los que usa el engine (${n})`, () => {
      const base = casoEjemploProspecto();
      const resultado = engine.calcular({
        ...base,
        capacidad: { ...base.capacidad, poblacion },
      });

      const mio = derivarSegmentos(poblacion);
      const derivadosDelEngine = Object.fromEntries(
        resultado.derivados.map((d) => [d.etiqueta, d.valor]),
      );

      expect(mio.lideres).toBe(derivadosDelEngine['Líderes']);
      expect(mio.resto).toBe(derivadosDelEngine['Resto de población']);
    });
  });

  it('población 350 al 5% reparte 18 y 332, sin dobles redondeos', () => {
    const d = derivarSegmentos(pob({ poblacionTotal: 350 }));
    expect(d.lideres).toBe(18);
    expect(d.resto).toBe(332);
    expect(d.suma).toBe(350);
    expect(d.coherente).toBe(true);
  });
});

describe('inferencia del modo', () => {
  it('sin segmentos declarados manda el porcentaje', () => {
    expect(inferirModo(pob({}))).toBe('porcentaje');
  });

  it('con solo líderes declarados mandan los líderes', () => {
    expect(inferirModo(pob({ nLideres: 26 }))).toBe('lideres');
  });

  it('con solo el resto declarado manda el resto', () => {
    expect(inferirModo(pob({ nResto: 274 }))).toBe('resto');
  });

  it('con los dos declarados y suma correcta mandan los líderes', () => {
    // El caso SIES: 26 + 274 = 300. Es lo que arregla el bug reportado.
    expect(inferirModo(pob({ nLideres: 26, nResto: 274 }))).toBe('lideres');
  });

  it('con los dos declarados y suma incorrecta se respeta la incoherencia', () => {
    expect(inferirModo(pob({ poblacionTotal: 350, nLideres: 26, nResto: 274 }))).toBe('ambos');
  });

  it('el modo guardado gana sobre la inferencia', () => {
    expect(modoDe(pob({ nLideres: 26, modoSegmentos: 'ambos' }))).toBe('ambos');
  });
});

describe('propagación al cambiar la población', () => {
  it('en modo porcentaje reparte de nuevo los dos segmentos', () => {
    const r = aplicarEdicionPoblacion(pob({}), 'poblacionTotal', 350);
    const d = derivarSegmentos(r);
    expect([d.lideres, d.resto]).toEqual([18, 332]);
  });

  it('el caso reportado: 300 con 26/274 pasa a 350 y el resto se reajusta', () => {
    const inicial = pob({ nLideres: 26, nResto: 274 });
    const r = aplicarEdicionPoblacion(inicial, 'poblacionTotal', 350);
    const d = derivarSegmentos(r);

    expect(d.lideres).toBe(26);
    expect(d.resto).toBe(324);
    expect(d.suma).toBe(350);
    expect(d.coherente).toBe(true);
  });

  it('en modo resto son los líderes los que absorben la diferencia', () => {
    const inicial = aplicarEdicionPoblacion(pob({}), 'nResto', 274);
    const r = aplicarEdicionPoblacion(inicial, 'poblacionTotal', 350);
    const d = derivarSegmentos(r);

    expect(d.resto).toBe(274);
    expect(d.lideres).toBe(76);
    expect(d.coherente).toBe(true);
  });

  it('en modo ambos no se toca ningún segmento', () => {
    const inicial = pob({ poblacionTotal: 350, nLideres: 26, nResto: 274 });
    const r = aplicarEdicionPoblacion(inicial, 'poblacionTotal', 400);
    expect([r.nLideres, r.nResto]).toEqual([26, 274]);
    expect(derivarSegmentos(r).coherente).toBe(false);
  });
});

describe('propagación al editar cada campo', () => {
  it('el porcentaje rellena líderes y resto', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350, nLideres: 26 }), 'pctLideres', 0.1);
    expect([r.nLideres, r.nResto]).toEqual([null, null]);
    const d = derivarSegmentos(r);
    expect([d.lideres, d.resto]).toEqual([35, 315]);
  });

  it('escribir líderes recalcula el resto', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nLideres', 40);
    const d = derivarSegmentos(r);
    expect([d.lideres, d.resto]).toEqual([40, 310]);
    expect(d.coherente).toBe(true);
  });

  it('escribir el resto recalcula los líderes', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nResto', 300);
    const d = derivarSegmentos(r);
    expect([d.lideres, d.resto]).toEqual([50, 300]);
    expect(d.coherente).toBe(true);
  });

  it('vaciar los líderes devuelve el bloque a automático', () => {
    const conLideres = aplicarEdicionPoblacion(pob({}), 'nLideres', 40);
    const r = aplicarEdicionPoblacion(conLideres, 'nLideres', null);
    expect([r.nLideres, r.nResto]).toEqual([null, null]);
    expect(modoDe(r)).toBe('porcentaje');
  });

  it('el porcentaje real se refleja aunque los líderes sean manuales', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nLideres', 26);
    expect(derivarSegmentos(r).pctReal).toBeCloseTo(0.0743, 4);
  });

  it('editar un campo no reformatea el que se está escribiendo', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nLideres', 400);
    expect(r.nLideres).toBe(400); // no se acota aunque supere la población
  });
});

describe('bordes', () => {
  it('población 0 no rompe nada', () => {
    const d = derivarSegmentos(pob({ poblacionTotal: 0 }));
    expect([d.lideres, d.resto, d.pctReal]).toEqual([0, 0, null]);
  });

  it('líderes por encima de la población dejan el resto en cero y avisan', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nLideres', 400);
    const d = derivarSegmentos(r);
    expect(d.resto).toBe(0);
    expect(d.coherente).toBe(false);
  });

  it('bajar la población por debajo de los líderes manuales no los corrige solo', () => {
    const conLideres = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'nLideres', 26);
    const r = aplicarEdicionPoblacion(conLideres, 'poblacionTotal', 20);
    expect(r.nLideres).toBe(26);
    expect(derivarSegmentos(r).coherente).toBe(false);
  });

  it('los decimales y los negativos se normalizan a enteros no negativos', () => {
    expect(aplicarEdicionPoblacion(pob({}), 'nLideres', 26.7).nLideres).toBe(27);
    expect(aplicarEdicionPoblacion(pob({}), 'nResto', -5).nResto).toBe(0);
  });

  it('el porcentaje se acota entre 0 y 1', () => {
    expect(aplicarEdicionPoblacion(pob({}), 'pctLideres', 1.5).pctLideresDefault).toBe(1);
    expect(aplicarEdicionPoblacion(pob({}), 'pctLideres', -0.2).pctLideresDefault).toBe(0);
  });

  it('el 100% deja el resto en cero y sigue siendo coherente', () => {
    const r = aplicarEdicionPoblacion(pob({ poblacionTotal: 350 }), 'pctLideres', 1);
    const d = derivarSegmentos(r);
    expect([d.lideres, d.resto, d.coherente]).toEqual([350, 0, true]);
  });
});

describe('reparaciones', () => {
  const incoherente = pob({ poblacionTotal: 350, nLideres: 26, nResto: 274 });

  it('un reparto coherente no sugiere nada', () => {
    expect(reparacionesSugeridas(pob({ nLideres: 26, nResto: 274 }))).toHaveLength(0);
  });

  it('ofrece ajustar el resto, subir la población o volver a automático', () => {
    const r = reparacionesSugeridas(incoherente);
    expect(r.map((x) => x.tipo)).toEqual([
      'ajustar_resto',
      'ajustar_poblacion',
      'volver_auto',
    ]);
    expect(r[0]?.etiqueta).toContain('324');
    expect(r[1]?.etiqueta).toContain('300');
  });

  it('cada reparación deja el reparto coherente', () => {
    for (const reparacion of reparacionesSugeridas(incoherente)) {
      expect(derivarSegmentos(aplicarReparacion(incoherente, reparacion)).coherente).toBe(true);
    }
  });

  it('con líderes por encima de la población ofrece acotarlos', () => {
    const r = reparacionesSugeridas(pob({ poblacionTotal: 20, nLideres: 26, nResto: 0 }));
    expect(r[0]).toMatchObject({ tipo: 'ajustar_lideres', valor: 20 });
  });

  it('volver a automático limpia los dos segmentos', () => {
    const r = volverAAutomatico(incoherente);
    expect([r.nLideres, r.nResto]).toEqual([null, null]);
    expect(derivarSegmentos(r).coherente).toBe(true);
  });
});

describe('el prospecto de ejemplo sigue intacto', () => {
  it('el ejemplo no cambia de resultado', () => {
    const r = engine.calcular(casoEjemploProspecto());
    expect(r.totales.instalado).toBe(42600);
    expect(r.palancas.find((p) => p.id === PALANCA_IDS.catalogoPorRol)?.instalado).toBe(13700);
  });

  it('una incoherencia deliberada sigue disparando la advertencia del engine', () => {
    const base = casoEjemploProspecto();
    const r = engine.calcular({
      ...base,
      capacidad: {
        ...base.capacidad,
        poblacion: { ...base.capacidad.poblacion, poblacionTotal: 350, modoSegmentos: 'ambos' },
      },
    });
    expect(r.advertencias.some((a) => a.codigo === 'SUMA_SEGMENTOS_DISTINTA_POBLACION')).toBe(true);
  });
});
