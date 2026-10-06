/**
 * do-large-taxpayer-list.ts — lectura de las listas públicas de Grandes
 * Contribuyentes de la DGII (República Dominicana).
 *
 * SOURCES-DO-SIZE-SIGNAL-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * La DGII publica, como páginas HTML con una tabla (sin archivo descargable):
 *   1. «Grandes Contribuyentes Nacionales» (≈632 RNC): RNC, razón social, plazo
 *      de facturación electrónica y si está autorizado. Sin columna de tamaño:
 *      todas son grandes nacionales.
 *      https://dgii.gov.do/cicloContribuyente/facturacion/comprobantesFiscalesElectronicosE-CF/Paginas/Implemantacion-FE-listado-grandes-contribuyentes-nacionales.aspx
 *   2. «Grandes Locales y Medianos» (≈12.500 filas): RNC, razón social,
 *      Clasificación («Grande Local» / «Mediana»), plazo y autorizados.
 *      https://dgii.gov.do/app/WebApps/Misc/VerLista?doc=GCL-240110
 *
 * Es la clasificación de tamaño de la propia DGII. Estar en la lista prueba
 * «mediana o grande»; NO estar no prueba que sea pequeña (las listas de
 * pequeños y micro no se publican).
 *
 * Sólo se aceptan RNC de empresa (9 dígitos): las cédulas de 11 dígitos de la
 * lista de locales son personas físicas y nunca se leen.
 */

/** Tamaño según la DGII. El orden es de mayor a menor. */
export type DgiiLargeTaxpayerClass = 'gran_nacional' | 'gran_local' | 'mediana';

export type DgiiLargeTaxpayer = {
  rnc: string;
  legalName: string;
  dgiiClass: DgiiLargeTaxpayerClass;
};

const BUSINESS_RNC = /^\d{9}$/;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Celdas `<td>` de cada fila `<tr>` de la página, ya en texto plano. */
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cellText(cell[1]));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function classFromLocalList(raw: string | undefined): DgiiLargeTaxpayerClass | null {
  const label = (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
  if (label === 'GRANDE LOCAL') return 'gran_local';
  if (label === 'MEDIANA') return 'mediana';
  return null;
}

/**
 * Lee una de las dos páginas. `kind` dice cuál: en la de nacionales no hay
 * columna de clasificación; en la de locales, una clasificación desconocida
 * descarta la fila (nunca se inventa un tamaño).
 */
export function parseDgiiLargeTaxpayerListHtml(
  html: string,
  kind: 'nacionales' | 'locales_medianos',
): DgiiLargeTaxpayer[] {
  const out: DgiiLargeTaxpayer[] = [];
  const seen = new Set<string>();
  for (const cells of tableRows(html)) {
    const rnc = (cells[0] ?? '').replace(/[\s-]/g, '');
    const legalName = cells[1] ?? '';
    if (!BUSINESS_RNC.test(rnc) || legalName.length === 0 || seen.has(rnc)) continue;
    const dgiiClass = kind === 'nacionales' ? 'gran_nacional' : classFromLocalList(cells[2]);
    if (dgiiClass === null) continue;
    seen.add(rnc);
    out.push({ rnc, legalName, dgiiClass });
  }
  return out;
}

const CLASS_ORDER: Readonly<Record<DgiiLargeTaxpayerClass, number>> = {
  gran_nacional: 1,
  gran_local: 2,
  mediana: 3,
};

/** Une las dos listas: si un RNC aparece en ambas, gana la clase mayor. */
export function mergeDgiiLargeTaxpayerLists(
  ...lists: readonly (readonly DgiiLargeTaxpayer[])[]
): Map<string, DgiiLargeTaxpayer> {
  const byRnc = new Map<string, DgiiLargeTaxpayer>();
  for (const list of lists) {
    for (const entry of list) {
      const previous = byRnc.get(entry.rnc);
      if (!previous || CLASS_ORDER[entry.dgiiClass] < CLASS_ORDER[previous.dgiiClass]) {
        byRnc.set(entry.rnc, entry);
      }
    }
  }
  return byRnc;
}
