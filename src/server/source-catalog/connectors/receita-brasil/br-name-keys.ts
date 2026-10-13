/**
 * br-name-keys.ts — núcleo, alias y variantes del nombre de Brasil para el CNPJ por
 * nombre.
 *
 * SOURCES-BR-LIGHT-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * ── Por qué un archivo propio (y no `company-name-core.ts`) ─────────────────
 *
 * Igual que Paraguay (#623): la forma societaria se reconoce por su ESTRUCTURA y
 * sólo al FINAL del nombre, con todas sus escrituras («S.A.», «S/A», «SA»,
 * «SOCIEDADE ANÔNIMA», «LTDA.», «LIMITADA», «EIRELI», «- ME», «- EPP», «& CIA»,
 * «- EM RECUPERAÇÃO JUDICIAL»…), apiladas o no. Así la lista de otros países no
 * cambia.
 *
 * ── Medido el 13-10-2026 (Receita 2026-09, 100 grandes brasileñas) ──────────
 *
 * El nombre comercial que traen Apollo, Tavily o Claude rara vez es la razón
 * social: «Petrobras» es PETROLEO BRASILEIRO S A PETROBRAS, «Vivo» es TELEFÔNICA
 * BRASIL. Por eso el nome fantasia y el nombre comercial de la CVM son ALIAS, y
 * el candidato prueba también sin «Brasil»/«do Brasil» («Engie Brasil», «Santander
 * Brasil») y sin «Grupo» («Grupo Boticário»).
 *
 * Ninguna regla es difusa: cada clave es una igualdad exacta.
 */

/** Formas societarias brasileñas ya normalizadas, más largas primero. Sólo al final. */
const BR_LEGAL_FORM_TAILS: readonly string[] = [
  'EMPRESA INDIVIDUAL DE RESPONSABILIDADE LIMITADA',
  'SOCIEDADE LIMITADA UNIPESSOAL',
  'SOCIEDADE EMPRESARIA LIMITADA',
  'SOCIEDADE ANONIMA FECHADA',
  'SOCIEDADE ANONIMA ABERTA',
  'SOCIEDADE ANONIMA',
  'SOCIEDADE LIMITADA',
  'SOCIEDADE SIMPLES',
  'EM RECUPERACAO JUDICIAL',
  'EM RECUPERACAO EXTRAJUDICIAL',
  'EM LIQUIDACAO EXTRAJUDICIAL',
  'EM LIQUIDACAO JUDICIAL',
  'EM LIQUIDACAO',
  'MASSA FALIDA',
  'UNIPESSOAL',
  'LIMITADA',
  'EIRELI',
  'LTDA',
  'E COMPANHIA',
  'E CIA',
  'COMPANHIA',
  'CIA',
  'S A',
  'SA',
  'S S',
  'SS',
  'SLU',
  'EPP',
  'MEI',
  'ME',
];

/** Mayúsculas, sin tildes, «&» como «E», sólo letras/dígitos y espacios simples. */
export function plainUpperBrazil(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' E ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quita formas societarias del final, apiladas («LTDA - ME», «S/A EM RECUPERAÇÃO JUDICIAL»). */
function stripLegalFormTails(upper: string): string {
  let core = upper;
  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of BR_LEGAL_FORM_TAILS) {
      if (core !== form && core.endsWith(` ${form}`)) {
        core = core.slice(0, core.length - form.length - 1).trim();
        stripped = true;
        break;
      }
    }
  }
  return core;
}

/**
 * Núcleo del nombre brasileño: el MISMO al cargar la Receita y al buscar en la
 * corrida. Sin la forma societaria del final.
 */
export function brazilNameCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';
  return stripLegalFormTails(plainUpperBrazil(name));
}

/** ¿Termina el texto en una forma societaria brasileña? */
export function endsWithBrazilLegalForm(name: string): boolean {
  const upper = plainUpperBrazil(name);
  return stripLegalFormTails(upper) !== upper;
}

/** Partes de un nombre separadas por « - », «|», «/» o «(»: razón social y sigla. */
export function splitBrazilNameParts(name: string): string[] {
  return name
    .split(/\s+-\s+|\s*\|\s*|\s+\/\s+|\s*\(\s*/)
    .map((part) => part.replace(/\)\s*\.?\s*$/, '').trim())
    .filter((part) => part.length > 0);
}

const PUBLIC_LINK = '(?: (?:DE|DO|DA|DOS|DAS))?';
const MUNICIPALITY_START = new RegExp(`^(?:PREFEITURA MUNICIPAL|PREFEITURA DO MUNICIPIO|PREFEITURA DA CIDADE|PREFEITURA|MUNICIPIO)${PUBLIC_LINK} (.+)$`);
const STATE_START = new RegExp(`^(?:GOVERNO DO ESTADO|GOVERNO${PUBLIC_LINK}|ESTADO)${PUBLIC_LINK} (.+)$`);

/**
 * Clave pública: una forma común en los DOS lados para alcaldías y estados.
 *
 *   MUNICIPIO DE SAO PAULO / Prefeitura de São Paulo / Prefeitura Municipal de
 *   São Paulo                               → MUNICIPIO SAO PAULO
 *   ESTADO DE MINAS GERAIS / Governo do Estado de Minas Gerais → ESTADO MINAS GERAIS
 *
 * Un municipio repetido en varios estados («Santa Luzia») da varios CNPJ: queda
 * como pista salvo que la web (`.gov.br`) desempate. `null` si no es una de esas.
 */
export function brazilPublicEntityKey(core: string): string | null {
  const municipality = MUNICIPALITY_START.exec(core);
  if (municipality !== null && municipality[1].length >= 2) return `MUNICIPIO ${municipality[1]}`;
  const state = STATE_START.exec(core);
  if (state !== null && state[1].length >= 2 && !state[1].startsWith('ESTADO ')) return `ESTADO ${state[1]}`;
  return null;
}

/**
 * Razones sociales cuyos alias nunca se guardan: no son la empresa que nombran
 * («FUNDO DE INVESTIMENTO … BRADESCO» haría que «Bradesco» apuntara al fondo).
 */
const NO_ALIAS_NAME = /\b(FUNDO|FIDC|FII|CONDOMINIO|CONSORCIO|SINDICATO|ASSOCIACAO DOS (FUNCIONARIOS|EMPREGADOS)|CLUBE DE INVESTIMENTO|SPE)\b/;

/** ¿Puede esta razón social aportar alias (nome fantasia, sigla, partes)? */
export function brazilNameMayHaveAliases(legalName: string): boolean {
  return !NO_ALIAS_NAME.test(plainUpperBrazil(legalName));
}

/**
 * Claves EXTRA de una empresa de la Receita (sin su núcleo): el nome fantasia, el
 * nombre comercial de la CVM y cada parte de la razón social separada por « - »
 * («COMPANHIA DE SANEAMENTO BASICO DO ESTADO DE SAO PAULO - SABESP» → SABESP).
 */
export function brazilRegistryAliasKeys(input: {
  legalName: string;
  tradeName?: string | null;
  cvmTradeName?: string | null;
}): string[] {
  const mainCore = brazilNameCore(input.legalName);
  const keys: string[] = [];
  if (!brazilNameMayHaveAliases(input.legalName)) return keys;
  const push = (core: string): void => {
    if (core.length >= 2 && core !== mainCore && !keys.includes(core) && !/^\d+$/.test(core)) keys.push(core);
  };
  const publicKey = brazilPublicEntityKey(mainCore);
  if (publicKey !== null) push(publicKey);
  for (const name of [input.tradeName, input.cvmTradeName]) {
    if (typeof name === 'string' && name.trim().length > 0) push(brazilNameCore(name));
  }
  const parts = splitBrazilNameParts(input.legalName);
  if (parts.length > 1) for (const part of parts) push(brazilNameCore(part));
  return keys;
}

/** Una variante del nombre del candidato y de dónde sale. */
export type BrazilNameVariant = {
  core: string;
  origin: 'name' | 'part' | 'without_brasil' | 'without_grupo' | 'public';
};

const BRASIL_SUFFIXES: readonly string[] = [' DO BRASIL', ' BRASIL', ' BRAZIL'];

/**
 * Variantes del nombre del candidato, en orden: la primera que encuentra algo
 * decide. El núcleo de siempre va primero.
 */
export function brazilCandidateNameVariants(name: string | null | undefined): BrazilNameVariant[] {
  const variants: BrazilNameVariant[] = [];
  if (typeof name !== 'string' || name.trim().length === 0) return variants;
  const add = (core: string, origin: BrazilNameVariant['origin']): void => {
    if (core.length >= 2 && !variants.some((v) => v.core === core)) variants.push({ core, origin });
  };

  add(brazilNameCore(name), 'name');
  const parts = splitBrazilNameParts(name);
  if (parts.length > 1) add(brazilNameCore(parts[0]), 'part');

  for (const variant of [...variants]) {
    if (variant.core.startsWith('GRUPO ') && variant.core.split(' ').length >= 2) {
      add(variant.core.slice('GRUPO '.length), 'without_grupo');
    }
  }
  for (const variant of [...variants]) {
    const suffix = BRASIL_SUFFIXES.find((s) => variant.core.endsWith(s));
    if (suffix !== undefined && variant.core.length > suffix.length + 1) {
      add(variant.core.slice(0, -suffix.length), 'without_brasil');
    }
  }
  for (const variant of [...variants]) {
    const publicKey = brazilPublicEntityKey(variant.core);
    if (publicKey !== null) add(publicKey, 'public');
  }
  return variants;
}

/** ¿Aparece `core` como palabras completas dentro de `text`? */
export function brazilCoreContainsWords(text: string, core: string): boolean {
  if (core.length < 2) return false;
  return ` ${text} `.includes(` ${core} `);
}
