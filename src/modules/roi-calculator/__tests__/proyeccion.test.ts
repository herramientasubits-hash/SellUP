/**
 * La proyeccion: el ROI que se ensena DURANTE la venta.
 *
 * Fija el golden del prospecto (US$42.600, verificable a mano) y el
 * comportamiento que hace que el reporte no le diga a alguien que aun no
 * compra que esta "bajo la vara".
 */

import { describe, it } from 'node:test';
import { crearEngineLMS } from '../domain/lms/engine';
import { crearParamsLMS } from '../domain/lms/params';
import { casoEjemploProspecto, validarLMSInput } from '../domain/lms/schema';
import { PALANCA_IDS } from '../domain/lms/types';
import { guionDeVenta } from '../exports/guion-venta';
import { aperturaDeValorProyeccion } from '../exports/narrativa-proyeccion';
import { fmtMultiplo } from '../lib/format';
import { expect } from './expect';

const ahora = () => new Date('2026-09-21T12:00:00.000Z');
const motor = (params = crearParamsLMS(ahora)) => crearEngineLMS({ params, now: ahora });
const engine = motor();

describe('cotización sin declarar', () => {
  const base = casoEjemploProspecto();

  // Si el filtro de cotizacion dejara de ser la identidad, esto lo cazaria.
  it('cotizar las seis palancas da lo mismo que no declarar ninguna', () => {
    const seis = Object.values(PALANCA_IDS);
    const conSeis = engine.calcular({
      ...base,
      capacidad: { ...base.capacidad, palancasCotizadas: seis },
    });
    const sinDeclarar = engine.calcular(base);
    expect(conSeis.totales).toEqual(sinDeclarar.totales);
    expect(conSeis.palancas.map((p) => p.instalado)).toEqual(
      sinDeclarar.palancas.map((p) => p.instalado),
    );
  });
});

describe('golden del prospecto', () => {
  const r = engine.calcular(casoEjemploProspecto());
  const de = (id: string) => r.palancas.find((p) => p.id === id)!;

  it('cada palanca vale lo que se puede verificar a mano', () => {
    expect(de(PALANCA_IDS.lms).instalado).toBe(8000);
    expect(de(PALANCA_IDS.catalogoLideres).instalado).toBe(13000);
    expect(de(PALANCA_IDS.catalogoPorRol).instalado).toBe(13700);
    expect(de(PALANCA_IDS.onboarding).instalado).toBe(1200);
    // 300 x 15% = 45 usuarios x US$5 x 12 meses
    expect(de(PALANCA_IDS.modoEstudio).instalado).toBe(2700);
    expect(de(PALANCA_IDS.assessments).instalado).toBe(4000);
  });

  it('el titular es el techo sobre la inversión cotizada', () => {
    expect(r.totales.instalado).toBe(42600);
    expect(r.totales.techoMultiplo).toBeCloseTo(42600 / 11900, 6);
  });


  it('en venta no hay nada capturado, ni por palanca ni en total', () => {
    expect(r.totales.capturado).toBe(0);
    expect(r.palancas.reduce((a, p) => a + p.capturado, 0)).toBe(0);
    expect(r.totales.sinCapturar).toBe(r.totales.instalado);
  });

  // Si alguien "arregla" los null devolviendo razon(0, inversion), esto salta:
  // ese 0 se renderiza como "0,0x" delante de un prospecto.
  it('el múltiplo y el aprovechamiento son null, no cero', () => {
    expect(r.totales.multiploReal).toBeNull();
    expect(r.totales.aprovechamiento).toBeNull();
    expect(fmtMultiplo(r.totales.multiploReal)).toBe('—');
    for (const p of r.palancas) expect(p.aprovechamiento).toBeNull();
  });

  // Cierra la puerta a que los escenarios vuelvan por la ventana.
  it('el resultado de proyección solo trae lo que el documento usa', () => {
    expect(Object.keys(r.proyeccion!).sort()).toEqual([
      'descargo',
      'palancasCotizadas',
      'palancasExcluidas',
    ]);
  });

});

describe('lo que el modo proyección apaga', () => {
  const r = engine.calcular(casoEjemploProspecto());

  it('las tres varas dicen contra qué se medirá, no cómo va', () => {
    expect(r.benchmarks).toHaveLength(3);
    for (const b of r.benchmarks) {
      expect(b.valor).toBeNull();
      expect(b.nivel).toBe('NO_APLICA');
      expect(b.referenciaTexto.length).toBeGreaterThan(0);
    }
  });

  it('no se queja de que no haya cursos completados', () => {
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('DIVISION_POR_CERO');
  });

  it('avisa de que la base de Modo Estudio es un supuesto', () => {
    const a = r.advertencias.find((x) => x.codigo === 'BASE_ACTIVOS_SUPUESTA');
    expect(a?.valores?.asrEsperado).toBe(0.15);
    expect(a?.mensaje).toContain('15');
  });

  it('el descargo viaja dentro del resultado', () => {
    expect(r.proyeccion!.descargo).toContain('No es una medición de uso');
    // El descargo viejo hablaba de un porcentaje de captura que ya no existe.
    expect(r.proyeccion!.descargo).not.toMatch(/porcentaje|escenario|%/);
  });
});

describe('lo que el CS puede decidir', () => {
  it('un ASR declarado gana al supuesto', () => {
    const base = casoEjemploProspecto();
    const r = engine.calcular({
      ...base,
      capacidad: { ...base.capacidad, asr6Meses: 0.3 },
    });
    // 300 x 30% = 90 x US$5 x 12
    expect(r.palancas.find((p) => p.id === PALANCA_IDS.modoEstudio)!.instalado).toBe(5400);
    expect(r.advertencias.map((a) => a.codigo)).not.toContain('BASE_ACTIVOS_SUPUESTA');
  });

  it('excluir dos palancas baja el instalado justo lo que valían', () => {
    const base = casoEjemploProspecto();
    const cotizadas = Object.values(PALANCA_IDS).filter(
      (id) => id !== PALANCA_IDS.modoEstudio && id !== PALANCA_IDS.assessments,
    );
    const r = engine.calcular({
      ...base,
      capacidad: { ...base.capacidad, palancasCotizadas: cotizadas },
    });
    expect(r.totales.instalado).toBe(42600 - 2700 - 4000);
    const fuera = r.palancas.find((p) => p.id === PALANCA_IDS.assessments)!;
    expect(fuera.enCotizacion).toBe(false);
    expect(fuera.instalado).toBe(0);
    expect(r.proyeccion!.palancasExcluidas).toHaveLength(2);
  });

});

describe('la apertura del documento de venta', () => {
  const r = engine.calcular(casoEjemploProspecto());
  const a = aperturaDeValorProyeccion(r);

  it('dice cuánto puede llegar a capturar y de qué depende', () => {
    expect(a.parrafo).toBe(
      'La capacidad instalada permitirá capturar hasta US$42.600 sobre US$11.900 de inversión. ' +
        'Imagina UBITS como un all you can eat: todo depende de cuánto valor puedas tomar.',
    );
  });

  it('la cifra es un techo, no una previsión', () => {
    for (const t of [a.parrafo, a.parrafoCorto]) {
      expect(t).toMatch(/hasta/);
      expect(t).not.toMatch(/hicieron|completaron|capturó|usaste|lograste/);
    }
  });

  // «Capacidad instalada» se queda: es el término con el que el CEO habla con
  // los clientes. El resto del vocabulario del modelo sigue fuera, porque a un
  // prospecto no le dice nada.
  it('no usa el vocabulario del modelo', () => {
    for (const t of [a.parrafo, a.parrafoCorto]) {
      expect(t).not.toMatch(/palanca|vara|aprovechamiento|techo|escenario/i);
    }
  });

});

describe('el techo acotado', () => {
  // Con una inversion minima el multiplo se dispara; el motor lo acota a 6x
  // recalculando con precios escalados, y lo deja dicho en `acotacion`.
  it('un contrato muy descontado no pasa de 6x la inversión', () => {
    const base = casoEjemploProspecto();
    const r = engine.calcular({ ...base, capacidad: { ...base.capacidad, inversionAnualUSD: 2000 } });
    expect(r.acotacion).toMatchObject({ techoMaximo: 6, instaladoSinAcotar: 42600 });
    expect(r.totales.instalado).toBeLessThanOrEqual(12000 + 6);
    expect(r.totales.techoMultiplo! <= 6.01).toBe(true);
  });

  it('el golden no se acota: 42.600 está por debajo de 6 × 11.900', () => {
    expect(engine.calcular(casoEjemploProspecto()).acotacion).toBeNull();
  });
});

describe('validación y guion', () => {
  it('el ejemplo del prospecto valida', () => {
    expect(validarLMSInput(casoEjemploProspecto()).ok).toBe(true);
  });

  it('sin cliente ni población no valida, con mensajes en español', () => {
    const v = validarLMSInput({
      cliente: '',
      capacidad: { ...casoEjemploProspecto().capacidad, poblacion: { ...casoEjemploProspecto().capacidad.poblacion, poblacionTotal: '' } },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      const campos = v.errores.map((e) => e.campo);
      expect(campos).toContain('cliente');
      expect(campos).toContain('capacidad.poblacion.poblacionTotal');
      expect(v.errores.find((e) => e.campo === 'capacidad.poblacion.poblacionTotal')?.mensaje).toBe(
        'Indica la población con acceso.',
      );
    }
  });

  it('el guion de venta abre con la cifra y nunca habla de uso', () => {
    const bloques = guionDeVenta(engine.calcular(casoEjemploProspecto()));
    expect(bloques[0].texto).toContain('US$42.600');
    for (const b of bloques) expect(b.texto).not.toMatch(/capturó|usaste|aprovechó/);
  });
});
