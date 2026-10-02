/**
 * Guion de conversacion para la venta. Se construye con los numeros del
 * resultado para que el comercial no tenga que traducir el reporte a frases a
 * mano. Habla de lo que el prospecto va a tener y de como se comprobara,
 * nunca de lo que uso.
 *
 * Es una funcion pura sobre ROIResultado: no toca el DOM y se prueba sola.
 */

import { fmtEntero, fmtMultiplo, fmtUSD } from '../lib/format';
import type { ROIResultado } from '../domain/types';

export interface BloqueGuion {
  id: string;
  titulo: string;
  texto: string;
}

const nombre = (r: ROIResultado<unknown>) => r.cliente.trim() || 'El cliente';

export const guionCompleto = (bloques: BloqueGuion[]): string =>
  bloques.map((b) => `${b.titulo.toUpperCase()}\n${b.texto}`).join('\n\n');

/**
 * El guion cuando todavia no hay nada que medir. Habla de lo que va a tener y
 * de como se comprobara, nunca de lo que uso.
 */
export function guionDeVenta(resultado: ROIResultado<unknown>): BloqueGuion[] {
  const { totales } = resultado;
  const bloques: BloqueGuion[] = [
    {
      id: 'apertura',
      titulo: 'Frase de apertura',
      texto:
        `${nombre(resultado)} va a tener ${fmtUSD(totales.instalado)} en formación a precio de mercado ` +
        `por ${fmtUSD(totales.inversion)} de inversión` +
        (totales.techoMultiplo === null
          ? '.'
          : `: ${fmtMultiplo(totales.techoMultiplo)} lo que paga.`) +
        ` Disponible para ${fmtEntero(totales.poblacionCubierta)} personas desde el primer día.`,
    },
    {
      id: 'instalada',
      titulo: 'Qué está comprando',
      texto:
        'Capacidad disponible sobre toda la población, que se juzga por cobertura: ' +
        'UBITS es un all you can eat, y todo depende de cuánto valor puedan tomar.',
    },
    {
      id: 'medicion',
      titulo: 'Cómo se comprueba',
      texto:
        'Al cierre del año repetimos este mismo cálculo con sus datos reales de uso, ' +
        'contra las tres varas del mercado. No es una promesa: es un punto de partida verificable.',
    },
  ];

  const fuera = resultado.palancas.filter((p) => !p.enCotizacion);
  if (fuera.length > 0) {
    bloques.push({
      id: 'expansion',
      titulo: 'Si pregunta qué más hay',
      texto:
        `Quedan ${fuera.length} ${fuera.length === 1 ? 'servicio' : 'servicios'} fuera de esta cotización. ` +
        'Se pueden sumar cuando quiera, sin rehacer nada de lo que ya tiene.',
    });
  }

  return bloques;
}
