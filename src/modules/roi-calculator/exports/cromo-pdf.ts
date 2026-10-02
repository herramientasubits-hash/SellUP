/**
 * El cromo de marca de los PDF: paleta, fuente incrustada, franja tricolor,
 * logo y los helpers de estilo. Lo comparten los tres reportes.
 *
 * Antes cada generador tenia su copia de los siete colores, de `instalarFuente`
 * y de `franjaMarca`, y su propia global mutable con la familia tipografica
 * activa. Con un tercer reporte eso pasaba a tres copias, y la global
 * compartida habria dejado a un generador escribiendo con la familia que dejo
 * otro. Aqui la familia vive en la clausura de cada documento.
 *
 * Lo que NO vive aqui es el layout: cada reporte cuenta su historia y dibuja
 * sus propias secciones.
 */

import { jsPDF } from 'jspdf';
import type { NivelBenchmark } from '../domain/types';
import { tonoDeNivel } from '../lib/tono-nivel';
import { INTER_TIGHT_REGULAR, INTER_TIGHT_SEMIBOLD } from './fuente-inter-tight';

export type Color = readonly [number, number, number];

/* Paleta de marca (ai-academy-ubits.com): tres colores IA y los neutros. */
export const NAVY = [11, 18, 32] as const;
export const AZUL = [26, 107, 255] as const;
export const MAGENTA = [235, 5, 111] as const;
export const ACENTO = [255, 84, 22] as const; /* naranja oficial: marca los gaps */
export const GRIS = [228, 234, 245] as const;
export const TEXTO_SUAVE = [72, 83, 106] as const;
export const TEXTO_TENUE = [123, 134, 156] as const;
export const BLANCO = [255, 255, 255] as const;
export const PAPEL = [248, 250, 255] as const;
export const RIEL = [241, 244, 250] as const;
export const GAP_SUAVE = [255, 217, 196] as const; /* el naranja al 25%: el hueco */
export const CREMA = [255, 241, 233] as const;
export const ACENTO_OSCURO = [151, 48, 10] as const; /* naranja legible sobre crema */
export const AZUL_TENUE = [233, 240, 252] as const;
export const AZUL_OSCURO = [13, 79, 196] as const; /* azul legible sobre el tenue */
/* El verde del semaforo: el mismo `--success` de la app, con su par tenue y su
   tinta legible. Es el unico color de los entregables que no sale de la paleta
   de marca, y existe porque un veredicto ALTO tiene que verse bueno. */
export const VERDE = [14, 159, 110] as const;
export const VERDE_TENUE = [231, 245, 240] as const;
export const VERDE_OSCURO = [4, 85, 58] as const;
/** Parrafo sobre la banda navy: contraste holgado a 8,5 pt. */
export const TEXTO_SOBRE_NAVY = [214, 228, 250] as const;

/** Los tres colores de una pildora de veredicto, segun el nivel. */
export function tonoNivel(nivel: NivelBenchmark): { fondo: Color; borde: Color; tinta: Color } {
  switch (tonoDeNivel(nivel)) {
    case 'exito':
      return { fondo: VERDE_TENUE, borde: VERDE, tinta: VERDE_OSCURO };
    case 'aviso':
      return { fondo: CREMA, borde: ACENTO, tinta: ACENTO_OSCURO };
    case 'neutro':
      return { fondo: RIEL, borde: GRIS, tinta: TEXTO_TENUE };
    default:
      return { fondo: AZUL_TENUE, borde: AZUL, tinta: AZUL_OSCURO };
  }
}

export const MARGEN = 14;
export const ANCHO = 210;
export const UTIL = ANCHO - MARGEN * 2;
export const DERECHA = ANCHO - MARGEN;
/** Ultima y utilizable: por debajo empieza la zona del pie. */
export const LIMITE = 278;

/* La apertura de valor dentro de la banda navy de la portada. La banda NO mide
   lo mismo siempre: el parrafo va de una a tres lineas segun el cliente, y con
   un alto fijo de 60 mm la tercera linea quedaba pegada a la franja tricolor.
   Se mide antes de pintar y la banda crece con el texto. */
export const Y_ROTULO_APERTURA = 47.5;
export const Y_APERTURA = 53;
const INTERLINEA_APERTURA = 3.45; /* 8,5 pt por el factor 1,15 de jsPDF */
const AIRE_BAJO_APERTURA = 7; /* el descendente se come 1,1 de estos */
export const CUERPO_APERTURA = 8.5;
/** Mas de tres lineas se comerian la portada entera. */
const MAX_LINEAS_APERTURA = 3;

/**
 * Parte el parrafo y dice cuanto tiene que medir la banda para alojarlo con
 * aire. Hay que llamarla ANTES de pintar el rectangulo navy.
 */
export function medirApertura(C: Cromo, parrafo: string): { lineas: string[]; alto: number } {
  C.fuente('normal');
  C.doc.setFontSize(CUERPO_APERTURA);
  const lineas = (C.doc.splitTextToSize(parrafo, UTIL) as string[]).slice(0, MAX_LINEAS_APERTURA);
  const alto = Y_APERTURA + (lineas.length - 1) * INTERLINEA_APERTURA + AIRE_BAJO_APERTURA;
  return { lineas, alto };
}

const FUENTE = 'InterTight';

/**
 * jsPDF escribe con las fuentes estandar del PDF, que usan WinAnsi: los
 * caracteres fuera de latin-1 (guion largo, mayor o igual, el check) salen
 * vacios. Se sustituyen por equivalentes que si existen; el check se dibuja.
 */
const FUERA_DE_WINANSI: Array<[RegExp, string]> = [
  [/[–—]/g, '-'],
  [/→/g, '->'],
  [/≥/g, '>='],
  [/≤/g, '<='],
  [/…/g, '...'],
  [/[«»“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/✓/g, ''],
];

const sanear = (texto: string): string =>
  FUERA_DE_WINANSI.reduce((acc, [patron, reemplazo]) => acc.replace(patron, reemplazo), texto);

export interface OpcionesEstilo {
  tam: number;
  peso?: 'normal' | 'bold';
  color?: Color;
  charSpace?: number;
}

export interface Cromo {
  doc: jsPDF;
  /** false cuando Inter Tight no se pudo incrustar y se cae a Helvetica. */
  conFuenteDeMarca: boolean;
  fuente(estilo: 'normal' | 'bold'): void;
  /**
   * El estado grafico de jsPDF es global y pegajoso: un color o un charSpace
   * que no se restablece se propaga a todo lo que venga detras. Con filas
   * repetidas eso se nota tarde y en silencio, asi que cada dibujo declara su
   * estilo entero.
   */
  estilo(opciones: OpcionesEstilo): void;
  relleno(c: Color): void;
  trazo(c: Color): void;
  tinta(c: Color): void;
  /** Los tres colores IA en una franja: la firma de marca del documento. */
  franjaMarca(x: number, y: number, ancho: number, alto?: number): void;
  logo(imagen: string | null, x: number, y: number, ancho: number): void;
  /** Baja el cuerpo hasta que el texto quepa en `anchoMax`. */
  ajustarTamano(texto: string, anchoMax: number, tamMax: number, tamMin: number): number;
  /** Marca de verificacion vectorial: WinAnsi no tiene el caracter. */
  check(x: number, y: number): void;
}

/** Registra Inter Tight. Si algo falla, el PDF sigue saliendo en Helvetica. */
function instalarFuente(doc: jsPDF): boolean {
  try {
    doc.addFileToVFS('InterTight-Regular.ttf', INTER_TIGHT_REGULAR);
    doc.addFont('InterTight-Regular.ttf', FUENTE, 'normal');
    doc.addFileToVFS('InterTight-SemiBold.ttf', INTER_TIGHT_SEMIBOLD);
    doc.addFont('InterTight-SemiBold.ttf', FUENTE, 'bold');
    doc.setFont(FUENTE, 'normal');
    return doc.getFontList()[FUENTE] !== undefined;
  } catch {
    return false;
  }
}

/**
 * Abre un A4 con la marca puesta. La familia tipografica queda capturada en la
 * clausura, no en una variable de modulo: dos reportes generados a la vez no
 * pueden pisarse la fuente.
 */
export function abrirDocumento(): Cromo {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const conFuenteDeMarca = instalarFuente(doc);
  const familia = conFuenteDeMarca ? FUENTE : 'helvetica';

  // Con la fuente de marca incrustada el texto pasa tal cual; sin ella hay que
  // sanearlo o los glifos fuera de latin-1 salen vacios.
  const escribir = doc.text.bind(doc);
  const preparar = (t: string) => (conFuenteDeMarca ? t : sanear(t));
  doc.text = ((contenido: string | string[], ...resto: unknown[]) =>
    escribir(
      typeof contenido === 'string'
        ? preparar(contenido)
        : Array.isArray(contenido)
          ? contenido.map(preparar)
          : contenido,
      ...(resto as [number, number]),
    )) as typeof doc.text;

  const fuente = (estilo: 'normal' | 'bold') => doc.setFont(familia, estilo);
  const relleno = (c: Color) => doc.setFillColor(c[0], c[1], c[2]);
  const trazo = (c: Color) => doc.setDrawColor(c[0], c[1], c[2]);
  const tinta = (c: Color) => doc.setTextColor(c[0], c[1], c[2]);

  return {
    doc,
    conFuenteDeMarca,
    fuente,
    relleno,
    trazo,
    tinta,

    estilo(opciones: OpcionesEstilo) {
      fuente(opciones.peso ?? 'normal');
      doc.setFontSize(opciones.tam);
      tinta(opciones.color ?? NAVY);
      doc.setCharSpace(opciones.charSpace ?? 0);
    },

    franjaMarca(x: number, y: number, ancho: number, alto = 1.6) {
      const tercio = ancho / 3;
      for (const [i, c] of [AZUL, MAGENTA, ACENTO].entries()) {
        relleno(c);
        doc.rect(x + i * tercio, y, tercio + 0.2, alto, 'F');
      }
    },

    logo(imagen: string | null, x: number, y: number, ancho: number) {
      if (!imagen) return;
      try {
        doc.addImage(imagen, 'PNG', x, y, ancho, (ancho * 32) / 99.201);
      } catch {
        /* decorativo: si no se pudo rasterizar, la portada sigue siendo legible */
      }
    },

    ajustarTamano(texto: string, anchoMax: number, tamMax: number, tamMin: number): number {
      let tam = tamMax;
      doc.setFontSize(tam);
      while (tam > tamMin && doc.getTextWidth(texto) > anchoMax) {
        tam -= 0.5;
        doc.setFontSize(tam);
      }
      return tam;
    },

    check(x: number, y: number) {
      trazo(AZUL);
      doc.setLineWidth(0.7);
      doc.line(x, y + 0.4, x + 1.2, y + 1.7);
      doc.line(x + 1.2, y + 1.7, x + 3.4, y - 1.2);
    },
  };
}
