// Agente 2A — variantes de nombre para buscar la empresa cuando NO hay dominio.
//
// Caso real (24-11): «Merck Sharp  Dohme Colombia SAS» llegó de HubSpot sin dominio y con el «&»
// perdido. Apollo buscó la ficha y las personas por ese texto crudo (doble espacio + «SAS») y dio
// 0 en los tres intentos, aunque la empresa tiene cientos de empleados en LinkedIn. Los
// proveedores indexan el nombre comercial («Merck Sharp & Dohme», «MSD»), no la razón social.
//
// Puro: sin red ni base de datos.

/** Formas legales al final del nombre, comparadas sin puntos, comas ni mayúsculas. */
const TRAILING_LEGAL_FORMS: ReadonlySet<string> = new Set([
  'sas', 'sasbic', 'sa', 'sab', 'sac', 'saa', 'saic', 'sadecv', 'sabdecv', 'sapidecv',
  'sderl', 'sderldecv', 'srl', 'srldecv', 'sl', 'slu', 'ca', 'esp', 'eirl', 'spa', 'sca',
  'ltda', 'limitada', 'inc', 'llc', 'corp', 'corporation', 'ltd', 'limited', 'plc', 'gmbh',
  'cia', 'ycia', '&cia', 'cialtda', 'ycialtda', 'zf', 'bic',
]);

/** Países (sin tildes, minúsculas) que se quitan al final para la variante más corta. */
const TRAILING_COUNTRIES: readonly string[] = [
  'republica dominicana', 'el salvador', 'costa rica', 'estados unidos',
  'colombia', 'mexico', 'peru', 'chile', 'argentina', 'ecuador', 'bolivia', 'paraguay',
  'uruguay', 'venezuela', 'panama', 'guatemala', 'honduras', 'nicaragua', 'espana',
  'brasil', 'brazil', 'usa', 'latam', 'latinoamerica',
];

const MAX_LEGAL_FORM_TOKENS = 4;
const TRAILING_CONNECTORS: ReadonlySet<string> = new Set(['de', 'del', 'y', '&', '-']);

function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function compactToken(token: string): string {
  return stripAccents(token).toLowerCase().replace(/[.,]/g, '');
}

function collapseWhitespace(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

function trimTrailingPunctuation(tokens: readonly string[]): string[] {
  const out = [...tokens];
  while (out.length > 0) {
    const last = out[out.length - 1].replace(/[,;\-–]+$/, '');
    if (last === '') {
      out.pop();
      continue;
    }
    out[out.length - 1] = last;
    break;
  }
  return out;
}

function dropTrailingConnectors(tokens: readonly string[]): string[] {
  const out = trimTrailingPunctuation(tokens);
  while (out.length > 0 && TRAILING_CONNECTORS.has(compactToken(out[out.length - 1]))) {
    out.pop();
  }
  return trimTrailingPunctuation(out);
}

/** Quita formas legales al final («SAS», «S.A.B. de C.V.», «Ltda.»…), repetidamente. */
function stripTrailingLegalForms(name: string): string {
  let tokens = trimTrailingPunctuation(name.split(' '));
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    for (let k = Math.min(MAX_LEGAL_FORM_TOKENS, tokens.length - 1); k >= 1; k -= 1) {
      const tail = tokens.slice(tokens.length - k).map(compactToken).join('');
      if (TRAILING_LEGAL_FORMS.has(tail)) {
        tokens = dropTrailingConnectors(tokens.slice(0, tokens.length - k));
        changed = true;
        break;
      }
    }
  }
  return tokens.join(' ');
}

/** Quita un país al final («… Colombia», «… de México»); nunca deja el nombre vacío. */
function stripTrailingCountry(name: string): string {
  const tokens = name.split(' ');
  const lowered = tokens.map((t) => stripAccents(t).toLowerCase());
  for (const country of TRAILING_COUNTRIES) {
    const countryTokens = country.split(' ');
    if (countryTokens.length >= tokens.length) continue;
    const tail = lowered.slice(tokens.length - countryTokens.length).join(' ');
    if (tail === country) {
      return dropTrailingConnectors(tokens.slice(0, tokens.length - countryTokens.length)).join(' ');
    }
  }
  return name;
}

/**
 * Variantes de búsqueda, de la más fiel a la más corta y sin repetir:
 *  1. el nombre con espacios normalizados;
 *  2. sin forma legal al final;
 *  3. sin forma legal ni país al final.
 */
export function buildCompanySearchNameVariants(rawName: string | null | undefined): string[] {
  const collapsed = collapseWhitespace(rawName ?? '');
  if (!collapsed) return [];
  const withoutLegal = stripTrailingLegalForms(collapsed);
  const withoutCountry = withoutLegal ? stripTrailingCountry(withoutLegal) : '';

  const seen = new Set<string>();
  const variants: string[] = [];
  for (const candidate of [collapsed, withoutLegal, withoutCountry]) {
    const key = candidate.toLowerCase();
    if (!candidate || seen.has(key)) continue;
    seen.add(key);
    variants.push(candidate);
  }
  return variants;
}

/** Nombre para filtros de proveedor: espacios normalizados y sin forma legal (conserva el país). */
export function cleanCompanySearchName(rawName: string | null | undefined): string {
  const collapsed = collapseWhitespace(rawName ?? '');
  if (!collapsed) return '';
  return stripTrailingLegalForms(collapsed) || collapsed;
}
