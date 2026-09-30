/**
 * tavily-foreign-cctld-guard.ts — descarta, en la búsqueda de Tavily, los
 * resultados cuyo dominio es claramente de OTRO país.
 *
 * AGENT1-TAVILY-V2-2.
 *
 * En la prueba controlada del 30-09, `cheekyfoods.com.au` (Australia) llegó como
 * candidato de Colombia × Retail y `inmedical.com.ec` (Ecuador) como candidato de
 * Perú × Salud: el control de país del escritor sólo conoce una lista corta de
 * dominios latinoamericanos y trata el resto como genérico.
 *
 * Deliberadamente NO toca `country-compatibility.ts` (compartido con Apollo y
 * Lusha): esto corre sólo para Tavily, antes de pagar la verificación del sitio.
 *
 * Regla, conservadora a propósito:
 *   · sólo mira el código de país de 2 letras al final del dominio (`.au`, `.ec`);
 *   · dominios genéricos (`.com`, `.org`, `.io`…) nunca se descartan;
 *   · los códigos que el mundo usa como genéricos (`.co`, `.io`, `.ai`, `.tv`,
 *     `.me`…) sólo cuentan como país cuando llevan un segundo nivel institucional
 *     (`.com.co`, `.gov.co`), que ahí sí es inequívoco;
 *   · ante cualquier duda (URL ilegible, país ausente) no descarta.
 *
 * Puro: sin red, sin base de datos.
 */

/** Códigos de país que se usan como dominio genérico en todo el mundo. */
const GENERIC_USE_CCTLDS: ReadonlySet<string> = new Set([
  'co', 'io', 'ai', 'tv', 'me', 'ly', 'to', 'fm', 'cc', 'ws', 'gg', 'sh', 'la', 'vc', 'is', 'so',
]);

/** Segundos niveles que convierten un código genérico en uno de país real. */
const INSTITUTIONAL_SECOND_LEVELS: ReadonlySet<string> = new Set([
  'com', 'net', 'org', 'gov', 'gob', 'edu', 'mil', 'ac', 'gub', 'nom',
]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * El código de país del dominio si NO coincide con el país pedido; `null` si
 * coincide, si el dominio es genérico o si no se puede saber.
 */
export function findForeignCctld(
  url: string | null | undefined,
  targetCountryCode: string | null | undefined,
): string | null {
  const target = targetCountryCode?.trim().toLowerCase();
  if (!url || !target || target.length !== 2) return null;

  const hostname = hostnameOf(url);
  if (!hostname) return null;
  const labels = hostname.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  const tld = labels[labels.length - 1];
  if (tld.length !== 2 || tld === target) return null;

  if (GENERIC_USE_CCTLDS.has(tld)) {
    const secondLevel = labels.length >= 3 ? labels[labels.length - 2] : null;
    if (!secondLevel || !INSTITUTIONAL_SECOND_LEVELS.has(secondLevel)) return null;
  }

  return tld;
}
