/**
 * El logotipo como imagen, para los exports.
 *
 * jsPDF no dibuja SVG y pptxgenjs necesita un data URL, asi que el path del
 * logo se rasteriza en un canvas en el momento de exportar. Asi no hay ningun
 * binario generado en el repo y la imagen siempre sale del mismo path que usa
 * la aplicacion.
 *
 * Va con el fondo horneado y sin canal alfa: con transparencia jsPDF corrompe
 * el alfa y el logo sale partido por la mitad.
 */

import { LOGO_UBITS_PATH } from './logo-path';

const RELACION = 32 / 99.201;

export interface LogoRasterizado {
  dataUrl: string;
  relacion: number;
}

/** [11, 18, 32] -> "#0b1220". Los colores del entregable viven como tuplas RGB. */
export const hexDeRGB = (rgb: readonly number[]): string =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/**
 * Rasteriza el logo sobre un fondo solido. Devuelve null fuera del navegador
 * (por ejemplo al generar el PDF desde Node en las verificaciones), donde el
 * logo es prescindible.
 */
export async function rasterizarLogo(
  colorLogo: string,
  colorFondo: string,
  escala = 12,
): Promise<LogoRasterizado | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  const ancho = Math.round(99.201 * escala);
  const alto = Math.round(32 * escala);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 99.201 32" width="${ancho}" height="${alto}">` +
    `<rect width="100%" height="100%" fill="${colorFondo}"/>` +
    `<path d="${LOGO_UBITS_PATH}" fill="${colorLogo}"/></svg>`;

  try {
    const imagen = new Image();
    await new Promise<void>((resolver, rechazar) => {
      imagen.onload = () => resolver();
      imagen.onerror = () => rechazar(new Error('no se pudo rasterizar el logo'));
      imagen.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    });

    const lienzo = document.createElement('canvas');
    lienzo.width = ancho;
    lienzo.height = alto;

    const ctx = lienzo.getContext('2d', { alpha: false });
    if (!ctx) return null;
    ctx.fillStyle = colorFondo;
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(imagen, 0, 0, ancho, alto);

    // PNG y no JPEG: el JPEG al 0,92 emborronaba los arcos de la marca —trazos
    // finos de blanco sobre navy— y el logo se veia sucio al acercarse. Aqui no
    // hay canal alfa que corromper, porque el fondo se pinta antes, y el PNG de
    // dos colores pesa la mitad que el JPEG equivalente.
    return { dataUrl: lienzo.toDataURL('image/png'), relacion: RELACION };
  } catch {
    return null;
  }
}
