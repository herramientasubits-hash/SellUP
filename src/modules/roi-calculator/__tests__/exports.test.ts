/**
 * La red que protege el formato de los entregables de venta.
 *
 * Mover un milimetro puede partir el PDF en dos o meter un texto en la franja
 * de marca del deck sin que nadie se entere hasta abrirlo. jsPDF y PptxGenJS
 * corren headless: `rasterizarLogo` devuelve null fuera del navegador y el
 * resto del dibujo funciona igual.
 */

import { describe, it } from 'node:test';
import { crearEngineLMS } from '../domain/lms/engine';
import { crearParamsLMS } from '../domain/lms/params';
import { casoEjemploProspecto } from '../domain/lms/schema';
import { aperturaDeValorProyeccion } from '../exports/narrativa-proyeccion';
import { generarPDFProyeccion } from '../exports/proyeccion-pdf';
import { generarPPTXProyeccion } from '../exports/proyeccion-pptx';
import { expect } from './expect';

const ahora = () => new Date('2026-09-22T12:00:00.000Z');
const engine = crearEngineLMS({ params: crearParamsLMS(ahora), now: ahora });

/** La franja de marca vive a 5,55 in y nada puede bajar hasta ella. */
const BANDA_DE_MARCA = 5.55;
/** La propia franja mide 0,08 in y es un objeto mas de la lamina. */
const GROSOR_DE_LA_FRANJA = 0.08;

type ObjetoLamina = { text?: unknown; options?: { y?: number; h?: number } };
type Lamina = { _slideObjects: ObjetoLamina[] };

/** Todos los textos de una lamina, en orden de dibujo. */
function textosDe(slide: Lamina): string[] {
  return slide._slideObjects.flatMap((o) =>
    typeof o.text === 'string'
      ? [o.text]
      : Array.isArray(o.text)
        ? o.text.map((t: { text?: string }) => t.text ?? '').filter(Boolean)
        : [],
  );
}

/** El borde inferior mas bajo de la lamina. Las tablas se guardan en EMU. */
function fondoDe(slide: Lamina): number {
  return Math.max(
    0,
    ...slide._slideObjects.map((o) => {
      const y = o.options?.y ?? 0;
      const h = o.options?.h ?? 0;
      return y > 100 ? (y + h) / 914400 : y + h;
    }),
  );
}

describe('el documento de venta', () => {
  it('el PDF cabe en una página', async () => {
    const doc = await generarPDFProyeccion(engine.calcular(casoEjemploProspecto()));
    expect(doc.getNumberOfPages()).toBe(1);
  });

  it('el deck abre con la apertura de valor y no invade la franja', async () => {
    const resultado = engine.calcular(casoEjemploProspecto());
    const deck = (await generarPPTXProyeccion(resultado)) as unknown as { _slides: Lamina[] };
    const slides = deck._slides;

    expect(slides).toHaveLength(2);
    expect(textosDe(slides[0])).toContain(aperturaDeValorProyeccion(resultado).parrafoCorto);
    for (const s of slides) {
      expect(fondoDe(s)).toBeLessThanOrEqual(BANDA_DE_MARCA + GROSOR_DE_LA_FRANJA);
    }
  });
});
