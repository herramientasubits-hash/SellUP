/**
 * ar-company-name-core.ts — núcleo comparable del nombre de una sociedad
 * argentina: el mismo cálculo al CARGAR el Registro Nacional de Sociedades
 * (`ar_rns_registry.normalized_legal_name`) y al BUSCAR una empresa por nombre
 * dentro de la corrida del Agente 1. Si los dos lados no normalizan igual, la
 * búsqueda exacta nunca coincide: por eso vive en un solo sitio.
 *
 * SOURCES-AR-CUIT-BY-NAME-1. Puro: sin env, sin I/O, sin DB, sin reloj.
 *
 * Núcleo = mayúsculas, sin tildes, sólo letras/dígitos/&, espacios simples y sin
 * la forma societaria final («SOCIEDAD ANONIMA», «S.A.», «S.R.L.», «S.A.S.»…).
 * «TELECOM ARGENTINA SOCIEDAD ANONIMA» y «Telecom Argentina S.A.» → «TELECOM
 * ARGENTINA». Medido sobre las 1.195.004 sociedades activas (junio 2026): el
 * 84,6 % tiene un núcleo que no comparte con ninguna otra.
 */

/** Formas societarias, más largas primero para que «S A U» gane a «S A». */
const AR_LEGAL_FORMS: readonly string[] = [
  'SOCIEDAD DE RESPONSABILIDAD LIMITADA',
  'SOCIEDAD POR ACCIONES SIMPLIFICADA',
  'SOCIEDAD EN COMANDITA POR ACCIONES',
  'SOCIEDAD ANONIMA UNIPERSONAL',
  'SOCIEDAD COLECTIVA',
  'SOCIEDAD ANONIMA',
  'S DE H',
  'S A U',
  'S A S',
  'S R L',
  'S C A',
  'S A',
  'LIMITADA',
  'LTDA',
  'SAU',
  'SAS',
  'SRL',
  'SCA',
  'SA',
];

/** Núcleo comparable del nombre, o cadena vacía si no queda nada. */
export function normalizeArCompanyCore(name: string | null | undefined): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '';

  let core = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let stripped = true;
  while (stripped && core.length > 0) {
    stripped = false;
    for (const form of AR_LEGAL_FORMS) {
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
 * Formas societarias COMPUESTAS que el núcleo de carga NO quita y que, por eso,
 * quedaron pegadas al nombre guardado en `ar_rns_registry` («ARCOR S A I C»,
 * «ROEMMERS S A I C F», «HOSPITAL ALEMAN ASOCIACION CIVIL»). Cambiar el núcleo
 * obligaría a recalcular 1,19 M filas en Producción; en su lugar, la búsqueda
 * pregunta también por «núcleo + forma». Lista cerrada: las terminaciones con
 * ≥ 20 sociedades en el registro (medido en Prod el 05-10-2026).
 */
export const AR_REGISTRY_COMPOSITE_FORMS: readonly string[] = [
  'ASOCIACION CIVIL', 'S C', 'S EN C', 'S A S U', 'S A P E M', 'S A E F', 'S A EF', 'SAFE',
  'S A I', 'S A A', 'S A A G', 'S A C', 'SAC',
  'S A I C', 'SAIC', 'S A C I', 'SACI', 'S A C I F', 'SACIF', 'S A C I F I', 'SACIFI',
  'S A C I F I A', 'SACIFIA', 'S A C I F E I', 'S A C E I', 'SACEI', 'S A I Y C',
  'S A C I F I Y A', 'S A C I Y F', 'S A I C Y F', 'S A C I A', 'SACIA', 'S A C I F A', 'SACIFA',
  'S A C I E I', 'S A I C F', 'SAICF', 'S A I C I F', 'SAICIF', 'S A I C F E I', 'S A I C F I',
  'SAICFI', 'S A I C I', 'SAICI', 'S A C I Y A', 'S A C I F Y A', 'S A I C I Y F', 'S A C I I F',
  'S A I C A', 'SAICA', 'S A C I I Y F', 'S A I C E I', 'S A C Y F', 'S A I C Y A',
  'S A C I I F Y A', 'S A C I I', 'S A C I I Y A', 'S A I C I A', 'S A C I A E I', 'S A C I I A',
  'S A I C F I A', 'S A C I F I C A', 'S A I C I Y A', 'S A C F', 'S A C F E I', 'S A I C I F Y A',
  'S A C Y A', 'S A C I A F',
];

/** Por qué camino se buscó el nombre (de más a menos literal). */
export type ArRegistryLookupTierKind = 'exact' | 'legal_form' | 'country_variant' | 'compact';

export interface ArRegistryLookupTier {
  kind: ArRegistryLookupTierKind;
  /** Núcleo base del escalón (el del candidato o su variante). */
  core: string;
  /** Nombres guardados exactos que se piden al índice. */
  names: string[];
}

const COUNTRY_SUFFIXES = [' DE ARGENTINA', ' ARGENTINA'] as const;

function withForms(core: string): string[] {
  return [core, ...AR_REGISTRY_COMPOSITE_FORMS.map((form) => `${core} ${form}`)];
}

/**
 * Escalones de búsqueda para un núcleo, en orden: el primero que encuentre algún
 * CUIT decide (los siguientes ni se consultan).
 *   1. `exact`        — el núcleo tal cual (lo de siempre).
 *   2. `legal_form`   — núcleo + forma compuesta («ARCOR» → «ARCOR S A I C»).
 *   3. `country_variant` — con/sin «ARGENTINA» al final («CENCOSUD ARGENTINA» →
 *      «CENCOSUD»; «TERNIUM» → «TERNIUM ARGENTINA»), también con forma compuesta.
 *   4. `compact`      — dos o tres palabras juntas («MERCADO LIBRE» → «MERCADOLIBRE»).
 */
export function buildArRegistryLookupTiers(core: string): ArRegistryLookupTier[] {
  if (!core) return [];
  const tiers: ArRegistryLookupTier[] = [
    { kind: 'exact', core, names: [core] },
    { kind: 'legal_form', core, names: withForms(core).slice(1) },
  ];

  const countrySuffix = COUNTRY_SUFFIXES.find((suffix) => core.endsWith(suffix));
  const countryVariants = countrySuffix
    ? [core.slice(0, core.length - countrySuffix.length).trim()]
    : COUNTRY_SUFFIXES.map((suffix) => `${core}${suffix}`);
  for (const variant of countryVariants) {
    if (variant.length >= 2 && variant !== core) {
      tiers.push({ kind: 'country_variant', core: variant, names: withForms(variant) });
    }
  }

  const tokens = core.split(' ');
  if (tokens.length >= 2 && tokens.length <= 3 && tokens.every((t) => /^[A-Z]{2,}$/.test(t))) {
    const compact = tokens.join('');
    tiers.push({ kind: 'compact', core: compact, names: withForms(compact) });
  }
  return tiers;
}
