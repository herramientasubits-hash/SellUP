/**
 * co-company-name-core.ts — núcleo comparable de una razón social colombiana.
 *
 * SOURCES-CO-CLOSE-1. La lista fija de formas societarias (`COLOMBIA_LEGAL_FORMS`)
 * sólo quitaba la forma cuando venía escrita exactamente como en la lista. En los
 * nombres reales de las corridas aparecen escritas de cualquier manera («S AS»,
 * «SA S», «S. EN C.», «E.S.E.», «LTDA.»), y una forma que no se quita deja el
 * núcleo distinto del de la cámara de comercio: el NIT no aparece.
 *
 * Igual que en México, la forma se reconoce por su ESTRUCTURA: al final del
 * nombre, una racha de fragmentos cortos (de 1 a 4 letras, lo que queda de «S.A.S.»
 * tras quitar puntos) cuyas letras juntas forman una sigla societaria conocida. Se
 * repite mientras quede una, porque se apilan («S.A.S. - BIC», «S.A. E.S.P.»).
 *
 * «EN LIQUIDACION» y «EN REORGANIZACION» NO se quitan: una sociedad en liquidación
 * no es la empresa activa (misma regla que la cámara de comercio en vivo).
 *
 * Puro: sin env, sin I/O, sin DB, sin reloj.
 */

import { COLOMBIA_LEGAL_FORMS, normalizeCompanyNameCore } from '@/server/source-catalog/company-name-core';

/** Formas escritas con palabras completas, además de las de la lista base. */
export const COLOMBIA_LONG_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD EN COMANDITA SIMPLE',
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD ANONIMA',
  'EMPRESA UNIPERSONAL',
  'LIMITADA',
];

/**
 * Siglas societarias con sus letras juntas: la racha final «S A S», «S AS», «SA S»
 * o «SAS» da «SAS» y se quita. «ESE» (empresa social del Estado) y «ESP» (empresa
 * de servicios públicos) se apilan tras la forma o van solas.
 */
export const COLOMBIA_COMPACT_LEGAL_FORMS: ReadonlySet<string> = new Set([
  'SAS',
  'SA',
  'LTDA',
  'LTD',
  'ESP',
  'ESE',
  'BIC',
  'SCA',
  'SCS',
  'SENC',
  'SENCS',
  'SENCA',
  'CTA',
  'EU',
]);

/** Fragmento que puede formar parte de una sigla: sólo letras, de 1 a 4. */
const SIGLA_FRAGMENT = /^[A-Z]{1,4}$/;

/** La racha más larga que se mira al final (S EN C S = 4 fragmentos). */
const MAX_FRAGMENTS = 5;

function stripCompactTail(tokens: string[]): string[] | null {
  for (let take = Math.min(MAX_FRAGMENTS, tokens.length - 1); take >= 1; take--) {
    const tail = tokens.slice(tokens.length - take);
    if (!tail.every((token) => SIGLA_FRAGMENT.test(token))) continue;
    if (COLOMBIA_COMPACT_LEGAL_FORMS.has(tail.join(''))) return tokens.slice(0, tokens.length - take);
  }
  return null;
}

/** Núcleo del nombre: mayúsculas, sin tildes ni signos, sin formas societarias finales. */
export function normalizeColombiaCompanyNameCore(name: string | null | undefined): string {
  let core = normalizeCompanyNameCore(name, [...COLOMBIA_LONG_LEGAL_FORMS, ...COLOMBIA_LEGAL_FORMS]);
  if (core.length === 0) return '';

  let tokens = core.split(' ');
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    const stripped = stripCompactTail(tokens);
    if (stripped !== null) {
      tokens = stripped;
      changed = true;
      continue;
    }
    const again = normalizeCompanyNameCore(tokens.join(' '), COLOMBIA_LONG_LEGAL_FORMS);
    if (again !== tokens.join(' ')) {
      tokens = again.split(' ');
      changed = true;
    }
  }
  core = tokens.join(' ');
  return core;
}
