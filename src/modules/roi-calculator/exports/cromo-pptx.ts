/**
 * El cromo de marca de las presentaciones: paleta, cabecera de slide, franja
 * tricolor al pie y la tarjeta de KPI.
 *
 * Los dos decks que habia definian las mismas nueve constantes de color, la
 * misma franja con la misma geometria y la misma tarjeta de KPI con los mismos
 * numeros magicos. Con un tercer deck eso pasaba a tres copias.
 *
 * Lo que NO vive aqui es el contenido de los slides: cada deck cuenta su
 * historia.
 */

import PptxGenJS from 'pptxgenjs';
import type { NivelBenchmark } from '../domain/types';
import { tonoDeNivel } from '../lib/tono-nivel';

/* Paleta de marca (ai-academy-ubits.com). */
export const NAVY = '0B1220';
export const AZUL = '1A6BFF';
export const MAGENTA = 'EB056F';
export const ACENTO = 'FF5416'; /* naranja oficial: marca los gaps */
export const GRIS = '48536A';
export const GRIS_TENUE = '7B869C';
export const LINEA = 'E4EAF5';
export const SUAVE = 'F5F8FE';
export const BLANCO = 'FFFFFF';

/* Los pares fondo-tenue / tinta-legible de las pildoras. Estaban escritos en
   crudo dentro del deck; el verde es nuevo y es el `--success` de la app. */
export const AZUL_TENUE = 'E9F0FC';
export const AZUL_OSCURO = '0D4FC4';
export const CREMA = 'FFF1E9';
export const ACENTO_OSCURO = '97300A';
export const VERDE = '0E9F6E';
export const VERDE_TENUE = 'E7F5F0';
export const VERDE_OSCURO = '04553A';

export const TIPO = 'Inter Tight';

/** Los tres colores de una pildora de veredicto, segun el nivel. */
export function tonoNivel(nivel: NivelBenchmark): { fondo: string; borde: string; tinta: string } {
  switch (tonoDeNivel(nivel)) {
    case 'exito':
      return { fondo: VERDE_TENUE, borde: VERDE, tinta: VERDE_OSCURO };
    case 'aviso':
      return { fondo: CREMA, borde: ACENTO, tinta: ACENTO_OSCURO };
    case 'neutro':
      return { fondo: SUAVE, borde: LINEA, tinta: GRIS_TENUE };
    default:
      return { fondo: AZUL_TENUE, borde: AZUL, tinta: AZUL_OSCURO };
  }
}

/** Los tres colores IA al pie: la firma de marca del deck. */
export function franjaMarca(pptx: PptxGenJS, slide: PptxGenJS.Slide) {
  const tercio = 10 / 3;
  [AZUL, MAGENTA, ACENTO].forEach((color, i) => {
    slide.addShape(pptx.ShapeType.rect, {
      x: i * tercio, y: 5.55, w: tercio + 0.02, h: 0.08,
      fill: { color }, line: { color },
    });
  });
}

export function kpis(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  y: number,
  datos: Array<[string, string] | [string, string, string]>,
) {
  datos.forEach(([etiqueta, valor, pie], i) => {
    const x = 0.5 + i * 2.3;
    slide.addShape(pptx.ShapeType.roundRect, {
      x, y, w: 2.15, h: pie ? 1.24 : 1.06,
      fill: { color: BLANCO }, line: { color: LINEA }, rectRadius: 0.08,
    });
    slide.addText(etiqueta, {
      x: x + 0.16, y: y + 0.12, w: 1.85, h: 0.24, fontSize: 8.5, color: GRIS, fontFace: TIPO,
    });
    slide.addText(valor, {
      x: x + 0.16, y: y + 0.36, w: 1.85, h: 0.46, fontSize: 21, bold: true, color: NAVY, fontFace: TIPO,
    });
    if (pie) {
      slide.addText(pie, {
        x: x + 0.16, y: y + 0.84, w: 1.85, h: 0.3, fontSize: 7.5, color: GRIS_TENUE, fontFace: TIPO, valign: 'top',
      });
    }
  });
}

export interface Deck {
  pptx: PptxGenJS;
  /** Abre un slide con titulo, subrayado azul, logo y franja. */
  slide(titulo: string): PptxGenJS.Slide;
  kpis(slide: PptxGenJS.Slide, y: number, datos: Parameters<typeof kpis>[3]): void;
}

/** Crea la presentacion con la marca puesta. */
export function abrirDeck(titulo: string, marca: { dataUrl: string; relacion: number } | null): Deck {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'UBITS';
  pptx.title = titulo;

  return {
    pptx,
    slide(rotulo: string) {
      const s = pptx.addSlide();
      s.background = { color: BLANCO };
      s.addText(rotulo, {
        x: 0.5, y: 0.34, w: 8.2, h: 0.5, fontSize: 21, bold: true, color: NAVY, fontFace: TIPO,
      });
      s.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: 0.88, w: 1.1, h: 0.05, fill: { color: AZUL }, line: { color: AZUL },
      });
      if (marca) {
        s.addImage({ data: marca.dataUrl, x: 8.86, y: 0.34, w: 0.72, h: 0.72 * marca.relacion });
      }
      franjaMarca(pptx, s);
      return s;
    },
    kpis(slide: PptxGenJS.Slide, y: number, datos: Parameters<typeof kpis>[3]) {
      kpis(pptx, slide, y, datos);
    },
  };
}
