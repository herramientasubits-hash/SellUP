/**
 * AGENT1-RESCUE-INSTITUTION-WEB-NAME-1 — una web de gobierno, educación o militar
 * (.gob / .gov / .edu / .mil) sólo vale para la entidad si su dirección lleva el
 * nombre o la sigla de esa entidad.
 *
 * Prod 07-10 (Ecuador × Gobierno, 9aa89dc3): a «MINISTERIO DE GOBIERNO» (RUC
 * 1760000660001) el buscador de sitio le dio registrocivil.gob.ec porque la página
 * del Registro Civil nombra al Ministerio. El Registro Civil es otra entidad, con su
 * propio RUC, y el Ministerio ya estaba en revisión con ministeriodegobierno.gob.ec:
 * con la web equivocada el control de duplicados por web no la vio y entró dos veces.
 *
 * Puro. Las webs que no son de gobierno/educación no se tocan.
 */

const INSTITUTION_SUFFIX = /\.(gob|gov|edu|mil)(\.[a-z]{2})?$/;

/** Palabras que no distinguen a una entidad de otra. */
const GENERIC_WORDS = new Set([
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'por', 'a',
  'ministerio', 'secretaria', 'subsecretaria', 'nacional', 'direccion', 'general',
  'autonomo', 'descentralizado', 'municipal', 'provincial', 'parroquial', 'rural',
  'empresa', 'publica', 'publico', 'sa', 'ep', 'cem', 'coordinacion', 'zonal',
]);

/** Conectores que no cuentan para la sigla (IESS, SRI, UCE). */
const ACRONYM_SKIP = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para', 'por', 'a']);

const PREFIX_LENGTH = 5;

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function words(name: string): string[] {
  return fold(name).split(/[^a-z0-9]+/).filter(Boolean);
}

/** «www.admision.educacion.gob.ec» → «admisioneducacion». `null` si no es institucional. */
export function institutionHostLabel(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const host = domain.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  if (!INSTITUTION_SUFFIX.test(host)) return null;
  return host.replace(INSTITUTION_SUFFIX, '').replace(/[^a-z0-9]/g, '') || null;
}

function nameMatchesLabel(name: string, label: string): boolean | null {
  const all = words(name);
  const distinctive = all.filter((w) => !GENERIC_WORDS.has(w) && w.length >= 3);
  if (distinctive.length === 0) return null;
  if (distinctive.some((w) => label.includes(w.length >= 4 ? w.slice(0, PREFIX_LENGTH) : w))) return true;
  const acronym = all.filter((w) => !ACRONYM_SKIP.has(w)).map((w) => w[0]).join('');
  return acronym.length >= 3 ? label.includes(acronym) : label === acronym;
}

/**
 * ¿La web institucional corresponde a la entidad? `true` si no es una web de
 * gobierno/educación, o si ningún nombre trae palabras distintivas (no se puede juzgar).
 */
export function institutionWebMatchesName(domain: string | null | undefined, names: readonly string[]): boolean {
  const label = institutionHostLabel(domain);
  if (!label) return true;
  const verdicts = names.filter((n) => n && n.trim()).map((n) => nameMatchesLabel(n, label));
  if (verdicts.every((v) => v === null)) return true;
  return verdicts.some((v) => v === true);
}
