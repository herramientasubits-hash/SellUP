/**
 * Deck de venta: dos laminas, en el ritmo de la reunion.
 *
 *  1. Lo que va a tener disponible — la cifra y lo que significa
 *  2. Qué incluye — de dónde sale esa cifra, servicio por servicio
 *
 * Dos y no tres: la banda de escenarios desaparecio por decision, y la lamina
 * de las varas del mercado se comprime a la linea de medicion. Dos y no una:
 * esto se proyecta en una sala, y meterlo todo en una lamina obliga a cuerpos
 * de 7 pt que no se leen a tres metros.
 */

import type PptxGenJS from 'pptxgenjs';
import { fmtEntero, fmtUSD, slugArchivo } from '../lib/format';
import type { ROIResultado } from '../domain/types';
import { rasterizarLogo } from './logo-imagen';
import { abreviarUSD, comoSeCalcula, nombreCorto, notaDeAcotacion } from './narrativa-comun';
import {
  aperturaDeValorProyeccion,
  loQueQuedaFuera,
  metaforaDeValor,
  promesaDeMedicion,
  queIncluyeLaCotizacion,
  titularProyeccion,
} from './narrativa-proyeccion';
import { abrirDeck, ACENTO, AZUL, BLANCO, GRIS, GRIS_TENUE, LINEA, NAVY, TIPO } from './cromo-pptx';

export async function generarPPTXProyeccion(resultado: ROIResultado<unknown>): Promise<PptxGenJS> {
  const marca = await rasterizarLogo(`#${NAVY}`, `#${BLANCO}`);
  const deck = abrirDeck(`Proyección de valor ${resultado.cliente}`, marca);
  const { pptx } = deck;

  const cliente = resultado.cliente.trim() || 'Cliente';
  const { totales } = resultado;
  const t = titularProyeccion(resultado);
  const descargo = resultado.proyeccion?.descargo ?? '';

  // ------------------------------------- 1 · Lo que va a tener disponible
  const s1 = deck.slide(`${cliente} · Retorno de inversión con UBITS`);

  s1.addShape(pptx.ShapeType.roundRect, {
    x: 8.3, y: 0.42, w: 1.15, h: 0.28,
    fill: { color: ACENTO }, line: { color: ACENTO }, rectRadius: 0.14,
  });
  s1.addText('PROYECCIÓN', {
    x: 8.3, y: 0.42, w: 1.15, h: 0.28,
    fontSize: 7.5, bold: true, color: BLANCO, fontFace: TIPO, align: 'center', valign: 'middle',
  });

  // La apertura de valor abre la lamina: que va a poner en manos de su gente.
  const apertura = aperturaDeValorProyeccion(resultado);
  s1.addText(apertura.parrafoCorto, {
    x: 0.5, y: 1.0, w: 9, h: 0.34, fontSize: 10.5, color: NAVY, fontFace: TIPO, valign: 'top',
  });
  s1.addText(metaforaDeValor(), {
    x: 0.5, y: 1.3, w: 9, h: 0.3, fontSize: 9, color: GRIS, fontFace: TIPO, valign: 'top',
  });

  s1.addText(t.eyebrow, {
    x: 0.5, y: 1.66, w: 9, h: 0.26, fontSize: 9, bold: true, color: GRIS, fontFace: TIPO,
  });
  s1.addText(t.cifra, {
    x: 0.5, y: 1.94, w: 9, h: 0.85, fontSize: 46, bold: true, color: AZUL, fontFace: TIPO,
  });
  s1.addText(t.detalle, {
    x: 0.5, y: 2.82, w: 9, h: 0.32, fontSize: 12, color: NAVY, fontFace: TIPO,
  });
  // El desmentido va pegado a la cifra, no en el pie: es la unica frase que
  // dice lo que el numero NO es.
  s1.addText(t.kicker, {
    x: 0.5, y: 3.18, w: 9, h: 0.3, fontSize: 9.5, color: GRIS_TENUE, fontFace: TIPO,
  });

  deck.kpis(s1, 3.52, [
    ['Inversión anual', fmtUSD(totales.inversion)],
    ['Valor de mercado', fmtUSD(totales.instalado)],
    ['Personas cubiertas', fmtEntero(totales.poblacionCubierta)],
    [
      'Servicios incluidos',
      `${resultado.proyeccion?.palancasCotizadas.length ?? 0} de ${resultado.palancas.length}`,
    ],
  ]);

  // La promesa paso de 70 a 150 caracteres al reescribirla: ocupa dos
  // renglones y necesita su alto, o se monta sobre el descargo. PowerPoint no
  // recorta el texto que sobra de su caja, lo pinta encima de lo que haya.
  s1.addText(promesaDeMedicion(), {
    x: 0.5, y: 4.56, w: 9, h: 0.52, fontSize: 9, color: NAVY, fontFace: TIPO, valign: 'top',
  });
  s1.addText(descargo, {
    x: 0.5, y: 5.12, w: 9, h: 0.36, fontSize: 7.5, color: GRIS_TENUE, fontFace: TIPO, valign: 'top',
  });

  // ------------------------------------- 2 · Qué incluye
  const s2 = deck.slide('Qué incluye');
  const cotizadas = queIncluyeLaCotizacion(resultado);
  const cuentas = new Map(comoSeCalcula(resultado).map((c) => [c.palancaId, c]));
  const escala = Math.max(...cotizadas.map((p) => p.instalado), 1);

  cotizadas.forEach((p, i) => {
    const y = 1.2 + i * 0.52;
    s2.addText(abreviarUSD(p.instalado), {
      x: 0.5, y, w: 0.85, h: 0.32, fontSize: 12, bold: true, color: NAVY, fontFace: TIPO, align: 'right',
    });
    s2.addText(nombreCorto(p.id, p.nombre), {
      x: 1.45, y, w: 2.2, h: 0.32, fontSize: 10, color: GRIS, fontFace: TIPO, valign: 'middle',
    });
    s2.addShape(pptx.ShapeType.roundRect, {
      x: 3.8, y: y + 0.1, w: 2.6, h: 0.13,
      fill: { color: LINEA }, line: { color: LINEA }, rectRadius: 0.065,
    });
    s2.addShape(pptx.ShapeType.roundRect, {
      x: 3.8, y: y + 0.1, w: Math.max(0.08, (p.instalado / escala) * 2.6), h: 0.13,
      fill: { color: AZUL }, line: { color: AZUL }, rectRadius: 0.065,
    });
    const cuenta = cuentas.get(p.id);
    if (cuenta) {
      s2.addText(cuenta.cuenta, {
        x: 6.6, y, w: 2.9, h: 0.32, fontSize: 8.5, color: GRIS_TENUE, fontFace: TIPO, valign: 'middle',
      });
    }
  });

  s2.addText(`Total · ${fmtUSD(totales.instalado)} de valor de mercado`, {
    x: 0.5, y: 4.45, w: 9, h: 0.3, fontSize: 11, bold: true, color: NAVY, fontFace: TIPO,
  });

  const pie = [notaDeAcotacion(resultado), loQueQuedaFuera(resultado)].filter(Boolean).join(' ');
  if (pie) {
    s2.addText(pie, {
      x: 0.5, y: 4.8, w: 9, h: 0.28, fontSize: 8.5, color: GRIS_TENUE, fontFace: TIPO,
    });
  }
  s2.addText(descargo, {
    x: 0.5, y: 5.1, w: 9, h: 0.4, fontSize: 7.5, color: GRIS_TENUE, fontFace: TIPO, valign: 'top',
  });

  return pptx;
}

export async function descargarPPTXProyeccion(resultado: ROIResultado<unknown>) {
  const pptx = await generarPPTXProyeccion(resultado);
  await pptx.writeFile({
    fileName: `ROI_PROYECCION_UBITS_${slugArchivo(resultado.cliente)}_${resultado.periodo.anio}.pptx`,
  });
}
