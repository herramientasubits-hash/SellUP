/**
 * El PDF que se le manda a un prospecto durante la venta. Una sola pagina.
 *
 * Un prospecto lee una hoja. Antes eran dos, con una banda de tres escenarios
 * de captura que confundia mas de lo que explicaba: el documento se juega todo
 * a una cifra —lo que va a tener disponible sobre lo que paga— y a decir como
 * se comprobara al cierre.
 *
 * Cuatro senales redundantes a proposito para que nadie confunda este documento
 * con el reporte real: el chip de la portada, el prefijo del nombre de archivo,
 * el descargo del pie y un titular que nunca se rotula como retorno.
 */

import type { jsPDF } from 'jspdf';
import { hexDeRGB, rasterizarLogo } from './logo-imagen';
import { formatAppDate } from '@/lib/format-date';
import { fmtEntero, fmtUSD, slugArchivo } from '../lib/format';
import type { ROIResultado } from '../domain/types';
import { comoSeCalcula, comoSeCalculaLinea, notaDeAcotacion } from './narrativa-comun';
import {
  loQueQuedaFuera,
  promesaDeMedicion,
  queIncluyeLaCotizacion,
  rotuloMedicion,
  titularProyeccion,
  aperturaDeValorProyeccion,
  metaforaDeValor,
} from './narrativa-proyeccion';
import {
  abrirDocumento,
  CUERPO_APERTURA,
  medirApertura,
  Y_APERTURA,
  Y_ROTULO_APERTURA,
  ACENTO,
  ANCHO,
  AZUL,
  BLANCO,
  CREMA,
  DERECHA,
  GRIS,
  MARGEN,
  NAVY,
  PAPEL,
  RIEL,
  TEXTO_SOBRE_NAVY,
  TEXTO_SUAVE,
  TEXTO_TENUE,
  UTIL,
  type Cromo,
} from './cromo-pdf';

/** La banda navy crece para alojar la apertura de valor. */

/**
 * Tope del cierre: mas abajo chocaria con el pie. El bloque sigue al contenido
 * y solo se ancla aqui cuando la cotizacion es larga — asi el blanco sobrante
 * cae al final de la hoja y no en mitad de ella, que se lee como que falta algo.
 */
/** La caja del cierre: rotulo, promesa de medicion (hasta 2 lineas) y descargo. */
const ALTO_CIERRE = 34;

/** El renglon de la metafora bajo la cifra de la portada. */
const ALTO_METAFORA = 5.2;

const Y_CIERRE_MAX = 244;

export async function generarPDFProyeccion(resultado: ROIResultado<unknown>): Promise<jsPDF> {
  const C = abrirDocumento();
  const { doc } = C;
  const marca = await rasterizarLogo(hexDeRGB(BLANCO), hexDeRGB(NAVY));
  const cliente = resultado.cliente.trim() || 'Cliente';

  // La banda crece con la apertura, asi que lo de debajo se cuelga de su borde.
  const banda = portada(C, resultado, cliente, marca?.dataUrl ?? null);
  titular(C, resultado, banda);

  let y = titulo(C, banda + 63, 'Qué incluye tu cotización');
  y = tablaCotizacion(C, y, resultado);
  y = fueraDeCotizacion(C, y + 6, resultado);

  cierre(C, resultado, Math.min(y + 10, Y_CIERRE_MAX));
  pie(C, resultado);
  return doc;
}

function portada(
  C: Cromo,
  resultado: ROIResultado<unknown>,
  cliente: string,
  marca: string | null,
): number {
  const { doc } = C;
  const { periodo } = resultado;

  // La apertura se mide antes de pintar: la banda tiene que caber su parrafo.
  // Se mide solo la cabeza —la cifra— porque la metafora va debajo y mas
  // pequena, en su propio renglon.
  const a = aperturaDeValorProyeccion(resultado);
  const { lineas, alto: altoCabeza } = medirApertura(C, a.parrafoCorto);
  const alto = altoCabeza + ALTO_METAFORA;

  C.relleno(NAVY);
  doc.rect(0, 0, ANCHO, alto, 'F');
  C.franjaMarca(0, alto, ANCHO);
  C.logo(marca, MARGEN, 12, 22);

  C.fuente('bold');
  doc.setFontSize(7);
  doc.setCharSpace(0.5);
  const rotulo = 'PROYECCIÓN';
  const ancho = doc.getTextWidth(rotulo) + 6;
  C.relleno(ACENTO);
  doc.roundedRect(DERECHA - ancho, 14, ancho, 5.5, 2.75, 2.75, 'F');
  C.tinta(BLANCO);
  doc.text(rotulo, DERECHA - ancho + 3, 17.8);
  doc.setCharSpace(0);

  C.fuente('bold');
  C.tinta(BLANCO);
  doc.setFontSize(C.ajustarTamano(cliente, UTIL, 21, 13));
  doc.text(cliente, MARGEN, 33);

  C.estilo({ tam: 9.5, color: [150, 180, 230] });
  doc.text(
    `Retorno de inversión con UBITS · ${resultado.productName} · ${periodo.anio}`,
    MARGEN,
    40,
  );

  // La apertura de valor, dentro de la banda: el documento abre diciendo qué
  // va a poner en manos de su gente, antes de la primera cifra.
  C.estilo({ tam: 7, peso: 'bold', color: [120, 155, 215], charSpace: 0.4 });
  doc.text(a.rotulo, MARGEN, Y_ROTULO_APERTURA);
  doc.setCharSpace(0);

  C.estilo({ tam: CUERPO_APERTURA, color: TEXTO_SOBRE_NAVY });
  doc.text(lineas, MARGEN, Y_APERTURA);

  // La metafora, mas pequena y mas tenue: acompana a la cifra, no compite.
  C.estilo({ tam: 7.5, color: [150, 180, 230] });
  doc.text(metaforaDeValor(), MARGEN, Y_APERTURA + (lineas.length - 1) * 3.45 + 5.2);

  return alto;
}

/** La cifra, y pegado a ella lo que NO es. */
function titular(C: Cromo, resultado: ROIResultado<unknown>, banda: number) {
  const { doc } = C;
  const { totales } = resultado;
  const t = titularProyeccion(resultado);

  // La columna de la izquierda acaba en la divisoria: el texto se envuelve
  // dentro de ella o se monta sobre los KPI de la derecha.
  const ANCHO_IZQ = 92;

  C.trazo(GRIS);
  doc.setLineWidth(0.2);
  doc.line(110, banda + 8, 110, banda + 55);

  C.estilo({ tam: 7, peso: 'bold', color: TEXTO_SUAVE, charSpace: 0.4 });
  doc.text(t.eyebrow, MARGEN, banda + 14);

  C.estilo({ tam: 42, peso: 'bold', color: AZUL });
  doc.text(t.cifra, MARGEN, banda + 33);

  C.fuente('normal');
  doc.setFontSize(9);
  const detalle = doc.splitTextToSize(t.detalle, ANCHO_IZQ) as string[];
  C.estilo({ tam: 9 });
  const yDetalle = banda + 40;
  doc.text(detalle, MARGEN, yDetalle);

  C.fuente('normal');
  doc.setFontSize(8.5);
  const kicker = doc.splitTextToSize(t.kicker, ANCHO_IZQ) as string[];
  C.estilo({ tam: 8.5, color: TEXTO_SUAVE });
  doc.text(kicker, MARGEN, yDetalle + detalle.length * 4.2 + 1.5);

  const celdas: Array<[string, string]> = [
    ['Inversión anual', fmtUSD(totales.inversion)],
    ['Valor de mercado', fmtUSD(totales.instalado)],
    ['Personas cubiertas', fmtEntero(totales.poblacionCubierta)],
    [
      'Servicios incluidos',
      `${resultado.proyeccion?.palancasCotizadas.length ?? 0} de ${resultado.palancas.length}`,
    ],
  ];
  celdas.forEach(([etiqueta, valor], i) => {
    const x = i % 2 === 0 ? 116 : 158;
    const yEtiqueta = banda + (i < 2 ? 15 : 33);
    C.estilo({ tam: 7, color: TEXTO_SUAVE });
    doc.text(etiqueta, x, yEtiqueta);
    C.fuente('bold');
    C.tinta(NAVY);
    doc.setFontSize(C.ajustarTamano(valor, 38, 13, 9));
    doc.text(valor, x, yEtiqueta + 8);
  });
}

const ALTO_FILA = 14;

/**
 * Una fila por servicio cotizado. La prosa va a ancho completo y a 7 pt, que es
 * donde la linea mas larga del catalogo (107 caracteres) ocupa 117 mm de los
 * 182 disponibles: cabe en un renglon, sin envolver y sin truncarse.
 */
function tablaCotizacion(C: Cromo, y: number, resultado: ROIResultado<unknown>): number {
  const { doc } = C;
  const palancas = queIncluyeLaCotizacion(resultado);
  const cuentas = new Map(comoSeCalcula(resultado).map((c) => [c.palancaId, c]));
  const escala = Math.max(...palancas.map((p) => p.instalado), 1);

  C.estilo({ tam: 7, peso: 'bold', color: TEXTO_SUAVE, charSpace: 0.3 });
  doc.text('QUÉ INCLUYE', MARGEN, y);
  doc.text('VALOR DE MERCADO', DERECHA, y, { align: 'right' });
  doc.setCharSpace(0);
  C.trazo(NAVY);
  doc.setLineWidth(0.4);
  doc.line(MARGEN, y + 2, DERECHA, y + 2);
  y += 4;

  for (const p of palancas) {
    // Sin el codigo P1..P6: es una etiqueta interna que al prospecto no le dice
    // nada y le roba sitio al nombre del servicio.
    C.fuente('bold');
    C.tinta(NAVY);
    doc.setFontSize(C.ajustarTamano(p.nombre, 120, 10, 8));
    doc.text(p.nombre, MARGEN, y + 4.2);

    C.estilo({ tam: 11, peso: 'bold' });
    doc.text(fmtUSD(p.instalado), DERECHA, y + 4.2, { align: 'right' });

    // Barra llena: es lo que vale el servicio, no un reparto de uso.
    C.relleno(RIEL);
    doc.roundedRect(MARGEN, y + 6.4, UTIL, 2.6, 1.3, 1.3, 'F');
    C.relleno(AZUL);
    doc.roundedRect(MARGEN, y + 6.4, Math.max(2.6, (p.instalado / escala) * UTIL), 2.6, 1.3, 1.3, 'F');

    const cuenta = cuentas.get(p.id);
    if (cuenta) {
      C.fuente('normal');
      doc.setFontSize(7);
      const linea = (doc.splitTextToSize(comoSeCalculaLinea(cuenta), UTIL) as string[])[0] ?? '';
      C.estilo({ tam: 7, color: TEXTO_SUAVE });
      doc.text(linea, MARGEN, y + 12.2);
    }

    y += ALTO_FILA;
    C.trazo(GRIS);
    doc.setLineWidth(0.2);
    doc.line(MARGEN, y, DERECHA, y);
  }

  C.trazo(NAVY);
  doc.setLineWidth(0.4);
  doc.line(MARGEN, y, DERECHA, y);
  C.estilo({ tam: 9.5, peso: 'bold' });
  doc.text(
    `Total · ${palancas.length} ${palancas.length === 1 ? 'servicio incluido' : 'servicios incluidos'}`,
    MARGEN,
    y + 6,
  );
  C.estilo({ tam: 12, peso: 'bold' });
  doc.text(fmtUSD(resultado.totales.instalado), DERECHA, y + 6, { align: 'right' });
  return y + 9;
}

function fueraDeCotizacion(C: Cromo, y: number, resultado: ROIResultado<unknown>): number {
  // La acotacion manda sobre la cifra del total, asi que se cuenta antes que
  // lo que queda fuera de la cotizacion.
  const texto = [notaDeAcotacion(resultado), loQueQuedaFuera(resultado)].filter(Boolean).join(' ');
  if (!texto || y + 12 > Y_CIERRE_MAX) return y - 6;
  const { doc } = C;

  C.relleno(PAPEL);
  doc.roundedRect(MARGEN, y, UTIL, 12, 2, 2, 'F');
  C.estilo({ tam: 7.5, color: TEXTO_SUAVE });
  doc.text((doc.splitTextToSize(texto, UTIL - 8) as string[]).slice(0, 2), MARGEN + 4, y + 5);
  return y + 12;
}

function cierre(C: Cromo, resultado: ROIResultado<unknown>, y: number) {
  const { doc } = C;

  C.relleno(CREMA);
  doc.roundedRect(MARGEN, y, UTIL, ALTO_CIERRE, 2, 2, 'F');

  C.estilo({ tam: 7, peso: 'bold', color: TEXTO_SUAVE, charSpace: 0.4 });
  doc.text(rotuloMedicion(), MARGEN + 6, y + 8);
  doc.setCharSpace(0);

  // Envuelta y no de una tirada: la frase paso de 70 a 150 caracteres y se
  // salia de la caja por el lado derecho sin que nada fallara.
  C.estilo({ tam: 9 });
  const promesa = (doc.splitTextToSize(promesaDeMedicion(), UTIL - 12) as string[]).slice(0, 2);
  doc.text(promesa, MARGEN + 6, y + 15);

  C.fuente('normal');
  doc.setFontSize(7);
  const descargo = doc.splitTextToSize(resultado.proyeccion?.descargo ?? '', UTIL - 12) as string[];
  C.estilo({ tam: 7, color: TEXTO_SUAVE });
  doc.text(descargo.slice(0, 2), MARGEN + 6, y + 15 + promesa.length * 3.7 + 3);
}

function titulo(C: Cromo, y: number, texto: string, tam = 12): number {
  const { doc } = C;
  C.estilo({ tam, peso: 'bold' });
  doc.setFontSize(C.ajustarTamano(texto, UTIL, tam, 9));
  doc.text(texto, MARGEN, y);
  C.trazo(AZUL);
  doc.setLineWidth(0.6);
  doc.line(MARGEN, y + 1.8, MARGEN + 26, y + 1.8);
  return y + 9;
}

function pie(C: Cromo, resultado: ROIResultado<unknown>) {
  const { doc } = C;
  const fecha = formatAppDate(resultado.calculadoEn);

  C.franjaMarca(MARGEN, 283, 18, 1.2);
  C.estilo({ tam: 7, color: TEXTO_TENUE });
  doc.text(`UBITS · Proyección de valor · Generado el ${fecha}`, MARGEN + 21, 286.5);
}

export async function descargarPDFProyeccion(resultado: ROIResultado<unknown>) {
  const doc = await generarPDFProyeccion(resultado);
  doc.save(`ROI_PROYECCION_UBITS_${slugArchivo(resultado.cliente)}_${resultado.periodo.anio}.pdf`);
}
