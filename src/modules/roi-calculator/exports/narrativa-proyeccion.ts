/**
 * Los textos del documento de venta.
 *
 * Existe aparte de `narrativa.ts` por una razon de fondo: el resultado reusa la
 * misma forma en los dos modos, asi que lo unico que impide que un entregable
 * de venta afirme una medicion son las palabras.
 *
 * Dos reglas de este archivo:
 *
 * 1. **Nada afirma un resultado.** Se dice lo que va a tener disponible y como
 *    se comprobara al cierre. Nunca "capturado", "aprovechamiento" ni "retorno".
 * 2. **Fuera el vocabulario del modelo.** El prospecto no sabe que es una
 *    palanca, una vara, la capacidad instalada ni un techo. En pantalla esas
 *    palabras se quedan —es la mesa de trabajo del CS—; aqui no.
 */

import { fmtEntero, fmtMultiplo, fmtUSD } from '../lib/format';
import type { PalancaResultado, ROIResultado } from '../domain/types';
import { nombreCorto } from './narrativa-comun';
import type { AperturaDeValor } from './narrativa-comun';

/** true cuando el resultado es una proyeccion de venta y no una medicion. */
export const esProyeccion = (r: ROIResultado<unknown>) => r.modo === 'proyeccion';

/**
 * El titular. El `kicker` va pegado a la cifra a proposito: es la unica frase
 * que dice lo que el numero NO es, y tiene que estar donde el ojo ya mira.
 */
export function titularProyeccion(resultado: ROIResultado<unknown>): {
  eyebrow: string;
  cifra: string;
  detalle: string;
  kicker: string;
} {
  const { totales } = resultado;
  return {
    // "Valor disponible sobre tu inversion" invitaba a leer rentabilidad.
    // "Por cada dolar que inviertes" invita a leer precio, que es lo que es.
    eyebrow: 'POR CADA DÓLAR QUE INVIERTES',
    cifra: fmtMultiplo(totales.techoMultiplo),
    // Las dos cifras ya las da la apertura, arriba, y las tarjetas de KPI, al
    // lado: repetirlas aqui era decir tres veces lo mismo en media pagina.
    // Este renglon explica CONTRA QUE se compara el multiplo.
    detalle: 'Es lo que costaría comprar esa misma formación en el mercado abierto.',
    kicker: `Es capacidad disponible para tus ${fmtEntero(totales.poblacionCubierta)} personas, no un retorno prometido.`,
  };
}

/**
 * Lo primero que lee el prospecto: cuanto valor puede llegar a tomar y de que
 * depende. Sin un solo dato de uso, porque todavia no existe.
 *
 * El registro —"hasta", "todo depende de cuanto tomes"— es deliberado: la
 * cifra es un techo, no una prevision. Las reglas de lo que NO se puede
 * afirmar estan en `afirmaciones-prohibidas.ts`, que ademas leen las pruebas.
 */
export function aperturaDeValorProyeccion(resultado: ROIResultado<unknown>): AperturaDeValor {
  const { totales } = resultado;

  const cabeza =
    totales.inversion > 0
      ? `La capacidad instalada permitirá capturar hasta ${fmtUSD(totales.instalado)} sobre ${fmtUSD(totales.inversion)} de inversión.`
      : `La capacidad instalada permitirá capturar hasta ${fmtUSD(totales.instalado)} en formación.`;

  // La analogia del buffet sustituye a la de la poliza: dice lo mismo —se
  // paga el acceso, no el consumo— y no necesita explicacion.
  const metafora =
    'Imagina UBITS como un all you can eat: todo depende de cuánto valor puedas tomar.';

  return {
    rotulo: 'LO QUE PUEDES LLEGAR A TOMAR',
    parrafo: `${cabeza} ${metafora}`,
    parrafoCorto: cabeza,
    tono: 'logro',
  };
}

/** La segunda linea de la portada, mas pequena que la cifra que la acompana. */
export const metaforaDeValor = (): string =>
  'Imagina UBITS como un all you can eat: todo depende de cuánto valor puedas tomar.';

/** Lo que entra en la cotizacion, de mayor a menor. */
export function queIncluyeLaCotizacion(resultado: ROIResultado<unknown>): PalancaResultado[] {
  return resultado.palancas
    .filter((p) => p.enCotizacion)
    .slice()
    .sort((a, b) => b.instalado - a.instalado);
}

/** Lo que existe y quedo fuera: la conversacion del ano que viene. */
export function loQueQuedaFuera(resultado: ROIResultado<unknown>): string | null {
  const fuera = resultado.palancas.filter((p) => !p.enCotizacion);
  if (fuera.length === 0) return null;

  const nombres = fuera.map((p) => nombreCorto(p.id, p.nombre));
  const listado =
    nombres.length > 1
      ? `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
      : nombres[0];
  return `Hoy no incluye ${listado}. Se pueden sumar cuando quieras.`;
}

/**
 * La linea que convierte la cifra en una hipotesis verificable en vez de una
 * promesa. Decia "Al cierre del ano repetimos este calculo con tus datos
 * reales de uso" y hubo que explicarla: no se entendia que se comprobaba ni
 * quien. Ahora dice quien, cuando y con que.
 */
export const promesaDeMedicion = (): string =>
  'Dentro de un año hacemos esta misma cuenta con tus datos reales: cuánta gente entró, cuántos cursos completó y cuánto de este valor terminaste tomando.';

/** Rotulo de la seccion que la acompana. */
export const rotuloMedicion = (): string => 'CÓMO SABRÁS SI PASÓ';
