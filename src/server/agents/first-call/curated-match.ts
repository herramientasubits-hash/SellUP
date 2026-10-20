/**
 * Agente 3 · encontrar la empresa en las listas cargadas (Merco, Great Place to Work…)
 * aunque el nombre no sea idéntico (puro).
 *
 * Davivienda (19-10): la cuenta se llama «Davivienda Colombia» y Merco Talento dice
 * «DAVIVIENDA»; con el nombre exacto no se encontraba. Se compara el NÚCLEO del nombre
 * por los dos lados: sin el país al final, sin la forma jurídica y sin prefijos
 * genéricos («Banco», «Grupo»…). Es conservador a propósito: sólo coincide si el núcleo
 * queda igual (nunca por compartir una palabra), y el país se exige aparte.
 */

import { normalizeLatamCuratedName } from '@/server/source-catalog/connectors/latam-curated/latam-curated-rows';

/** Países (y su forma «de X») que suelen ir al final del nombre de una filial. */
const COUNTRY_WORDS = [
  'COLOMBIA',
  'MEXICO',
  'CHILE',
  'ARGENTINA',
  'BRASIL',
  'BRAZIL',
  'PERU',
  'URUGUAY',
  'ECUADOR',
  'PARAGUAY',
  'BOLIVIA',
  'VENEZUELA',
  'GUATEMALA',
  'HONDURAS',
  'EL SALVADOR',
  'NICARAGUA',
  'COSTA RICA',
  'PANAMA',
  'REPUBLICA DOMINICANA',
  'DOMINICANA',
  'ESTADOS UNIDOS',
  'USA',
  'ESPANA',
  'LATAM',
  'LATINOAMERICA',
  'AMERICA LATINA',
  'CENTROAMERICA',
];

/** Palabras genéricas al comienzo que no distinguen a la empresa. */
const GENERIC_PREFIXES = ['BANCO', 'GRUPO', 'CORPORACION', 'COMPANIA', 'EMPRESA', 'EMPRESAS', 'ORGANIZACION', 'HOLDING', 'THE'];

const COUNTRY_TAIL = new RegExp(`\\s+(?:DE\\s+|DEL\\s+)?(?:${COUNTRY_WORDS.join('|')})$`);
const GENERIC_HEAD = new RegExp(`^(?:${GENERIC_PREFIXES.join('|')})\\s+`);

/** Un núcleo con menos letras que esto es demasiado genérico para coincidir solo. */
export const CURATED_CORE_MIN_CHARS = 4;

/**
 * Núcleos que son palabras comunes: «Banco de Chile» queda en «BANCO», «Grupo Éxito» en
 * «EXITO». Solos no identifican a la empresa (revisión 19-10): ahí se exige el nombre entero.
 */
const COMMON_WORD_CORES = new Set([
  'BANCO', 'GRUPO', 'EMPRESA', 'COMPANIA', 'CORPORACION', 'ESTADO', 'EXITO', 'FAMILIA', 'CORONA',
  'NACIONAL', 'INTERNACIONAL', 'CENTRAL', 'GENERAL', 'UNION', 'ALIANZA', 'PROGRESO', 'FUTURO',
  'SEGUROS', 'SERVICIOS', 'INDUSTRIAS', 'COMERCIAL', 'TECNOLOGIA', 'SALUD', 'ENERGIA', 'CAPITAL',
]);

/** ¿El núcleo identifica a la empresa por sí solo? */
export function isDistinctiveCore(core: string): boolean {
  return core.length >= CURATED_CORE_MIN_CHARS && !COMMON_WORD_CORES.has(core);
}

/** El núcleo comparable del nombre de una empresa. */
export function curatedCoreName(name: string | null | undefined): string {
  let text = normalizeLatamCuratedName(name);
  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(COUNTRY_TAIL, '').replace(GENERIC_HEAD, '').trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/** ¿Es la misma empresa en la lista? Mismo núcleo y núcleo suficientemente distintivo. */
export function curatedNamesMatch(accountName: string | null | undefined, listName: string | null | undefined): boolean {
  const core = curatedCoreName(accountName);
  if (!isDistinctiveCore(core)) return false;
  return core === curatedCoreName(listName);
}

/** ¿El texto nombra a la empresa? (por el núcleo de su nombre, sin «Grupo», «Banco» ni el país). */
export function mentionsCompany(text: string, companyName: string): boolean {
  // Con un núcleo que es palabra común («BANCO», «EXITO») se exige el nombre entero.
  const core = curatedCoreName(companyName);
  const target = isDistinctiveCore(core) ? core : normalizeLatamCuratedName(companyName);
  return target.length > 0 && phraseIn(text, target);
}

function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`´]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * ¿El texto dice la frase, palabra por palabra y sin puntuación en medio? «Domino’s Pizza:
 * pizza mediana» no dice «Pizza Pizza» (Pizza Pizza, Prod 19-10).
 */
function phraseIn(text: string, phrase: string): boolean {
  const words = plain(phrase).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return false;
  return new RegExp(`(^|[^a-z0-9])${words.join(' ')}(?![a-z0-9])`).test(plain(text));
}

/**
 * ¿El resultado es de ESTA empresa? Nombra su núcleo o su dominio («oreillyauto» en
 * «O'Reilly Auto Parts»). Pizza Pizza (Prod 19-10): la prensa traía notas de «pizza» en
 * general («Día de la Pizza», Pizza Hut en Nueva York) que ocupaban los documentos.
 */
export function resultMentionsCompany(text: string, companyName: string, domain: string | null): boolean {
  if (mentionsCompany(text, companyName)) return true;
  const label = (domain ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0];
  if (label.length < 5) return false;
  // Dentro de un mismo tramo sin puntuación («O’Reilly Auto Parts» → «oreillyautoparts»).
  return plain(text)
    .split(/[^a-z0-9 ]+/)
    .some((segment) => segment.replace(/ /g, '').includes(label));
}
