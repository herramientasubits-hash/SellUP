/**
 * Institutional Name↔Domain Correspondence — AGENT1-OWNERSHIP-GATE-GOVERNMENT-P0
 *
 * ── El defecto que cierra ─────────────────────────────────────────────────────
 *
 * `evaluateCompanyOwnership` comparaba nombre y dominio como CADENAS
 * CONCATENADAS: `normalizeForDomain` borra espacios y guiones antes de buscar
 * subcadenas. Para una entidad pública eso no puede coincidir nunca, porque el
 * nombre lleva el sustantivo institucional que el dominio abrevia u omite, y el
 * dominio lleva el calificativo que el nombre no dice:
 *
 *   "Alcaldía de Segovia"    → alcaldiadesegovia   vs  segoviaantioquia
 *   "Ministerio de Ambiente" → ministeriodeambiente vs  minambiente
 *
 * Este módulo razona por TOKENS, que es el nivel en el que la correspondencia
 * existe de verdad.
 *
 * ── Lo que este módulo NO hace ────────────────────────────────────────────────
 *
 * NO acepta un dominio por su TLD. `.gov.co` no aparece en ninguna regla: las
 * tres exigen una correspondencia demostrable entre los tokens del nombre y los
 * del dominio, y son igual de válidas bajo `.com`. Sector ≠ ownership: que el
 * enrichment diga "government administration" no entra aquí.
 *
 * ── Las tres reglas ──────────────────────────────────────────────────────────
 *
 *   A. territorial      — el topónimo del nombre ES un token del dominio, y
 *                         todo token sobrante del dominio es un calificativo
 *                         territorial reconocido (departamento / administrativo).
 *                         «Alcaldía de Segovia» ↔ `segovia-antioquia`
 *   B. abreviatura      — el dominio es «prefijo del sustantivo institucional»
 *                         + «el resto del nombre».
 *                         «Ministerio de Ambiente» ↔ `min` + `ambiente`
 *   C. sigla            — el dominio son las iniciales del nombre.
 *                         «Instituto Colombiano de Bienestar Familiar» ↔ `icbf`
 *
 * Puerta de entrada común: el nombre debe contener al menos un término
 * institucional. Sin eso, ninguna regla se evalúa, y una razón social privada
 * jamás alcanza un dominio público ajeno.
 *
 * Sin IA. Sin llamadas externas. Determinístico.
 */

import {
  ADMINISTRATIVE_QUALIFIER_WORDS,
  COLOMBIAN_DEPARTMENT_WORDS,
  INSTITUTIONAL_ADJECTIVES,
  INSTITUTIONAL_HEAD_NOUNS,
  SPANISH_CONNECTOR_TOKENS,
  TERRITORIAL_HEAD_NOUNS,
} from './public-entity-lexicon';

export type InstitutionalCorrespondenceSignal =
  | 'institutional_territorial_domain_match'
  | 'institutional_abbreviation_domain_match'
  | 'institutional_acronym_domain_match';

export type InstitutionalCorrespondenceResult = {
  matched: boolean;
  signal: InstitutionalCorrespondenceSignal | null;
  /** Explicación legible de la correspondencia encontrada. Vacía si no hubo. */
  detail: string;
};

const NO_MATCH: InstitutionalCorrespondenceResult = {
  matched: false,
  signal: null,
  detail: '',
};

/** Longitud mínima de un token para que valga como evidencia de identidad. */
const MIN_EVIDENCE_TOKEN_LENGTH = 3;
/** Una sigla de dos letras es ruido, no identidad. */
const MIN_ACRONYM_LENGTH = 3;
/** Prefijo mínimo del sustantivo institucional ("min", "gob", "super"…). */
const MIN_HEAD_NOUN_PREFIX_LENGTH = 3;

// ─── Normalización ────────────────────────────────────────────────────────────

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Tokens alfanuméricos en minúscula, sin tildes y sin conectores. */
function tokenize(text: string): string[] {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0 && !SPANISH_CONNECTOR_TOKENS.has(token));
}

/**
 * Etiqueta registrable del dominio ya sin TLD, y sus tokens.
 *
 * Recibe la clave de identidad del dominio que el gate ya calculó (dominio sin
 * TLD conocido). De `a.b` se queda con `b`: el subdominio no identifica al
 * titular.
 */
function readDomainTokens(domainIdentityKey: string): { label: string; tokens: string[] } {
  const segments = stripDiacritics(domainIdentityKey.toLowerCase()).split('.');
  const label = segments[segments.length - 1] ?? '';
  return {
    label: label.replace(/[^a-z0-9]/g, ''),
    tokens: label
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0),
  };
}

// ─── Puerta de entrada ────────────────────────────────────────────────────────

function isInstitutionalTerm(token: string): boolean {
  return INSTITUTIONAL_HEAD_NOUNS.has(token) || INSTITUTIONAL_ADJECTIVES.has(token);
}

/**
 * ¿El nombre se presenta como una entidad institucional? Es la condición previa
 * de las tres reglas: sin ella, "Constructora Andina SAS" nunca puede llegar a
 * `dian.gov.co`, y "Ferretería El Tornillo" nunca a `minambiente.gov.co`.
 */
export function looksLikeInstitutionalName(companyName: string): boolean {
  return tokenize(companyName).some(isInstitutionalTerm);
}

/**
 * Tokens DISTINTIVOS: lo que queda del nombre al quitar el sustantivo
 * institucional que encabeza (una sola ocurrencia, la que la regla usa) y los
 * adjetivos institucionales.
 *
 * Se quita una sola ocurrencia a propósito: en «Superintendencia de Servicios
 * Públicos» el segundo sustantivo institucional ("Servicios") SÍ es la parte
 * distintiva, y es exactamente lo que el dominio `superservicios` transcribe.
 */
function distinctiveTokens(tokens: readonly string[], headNounIndex: number): string[] {
  return tokens.filter(
    (token, index) => index !== headNounIndex && !INSTITUTIONAL_ADJECTIVES.has(token),
  );
}

function initialsOf(tokens: readonly string[]): string {
  return tokens.map((token) => token[0] ?? '').join('');
}

// ─── Regla A — entidades territoriales ────────────────────────────────────────

function isTerritorialQualifier(token: string): boolean {
  return COLOMBIAN_DEPARTMENT_WORDS.has(token) || ADMINISTRATIVE_QUALIFIER_WORDS.has(token);
}

function evaluateTerritorialRule(
  nameTokens: readonly string[],
  headNounIndex: number,
  domainTokens: readonly string[],
): InstitutionalCorrespondenceResult {
  const headNoun = nameTokens[headNounIndex] ?? '';
  if (!TERRITORIAL_HEAD_NOUNS.has(headNoun)) return NO_MATCH;

  const placeTokens = distinctiveTokens(nameTokens, headNounIndex);
  if (placeTokens.length === 0) return NO_MATCH;

  const domainTokenSet = new Set(domainTokens);
  const concatenatedPlace = placeTokens.join('');

  // El topónimo aparece en el dominio: token a token, o concatenado
  // (`puertoberrio`), que es la forma que usan los dominios oficiales.
  const consumedDomainTokens = new Set<string>();
  let placeMatched = false;

  if (placeTokens.every((token) => domainTokenSet.has(token))) {
    placeMatched = true;
    for (const token of placeTokens) consumedDomainTokens.add(token);
  } else if (
    concatenatedPlace.length >= MIN_EVIDENCE_TOKEN_LENGTH &&
    domainTokenSet.has(concatenatedPlace)
  ) {
    placeMatched = true;
    consumedDomainTokens.add(concatenatedPlace);
  }

  if (!placeMatched) return NO_MATCH;

  // Todo token sobrante del dominio debe ser un calificativo territorial
  // reconocido. Sin esta comprobación, `segovia-turismo-privado.gov.co` pasaría
  // igual que `segovia-antioquia.gov.co`, y no es la misma organización.
  const unexplained = domainTokens.filter(
    (token) => !consumedDomainTokens.has(token) && !isTerritorialQualifier(token),
  );
  if (unexplained.length > 0) return NO_MATCH;

  return {
    matched: true,
    signal: 'institutional_territorial_domain_match',
    detail: `entidad territorial "${headNoun}" con topónimo "${concatenatedPlace}" presente en el dominio (${domainTokens.join('-')})`,
  };
}

// ─── Regla B — abreviatura del sustantivo institucional ───────────────────────

/**
 * ¿El resto del dominio (lo que sigue a la abreviatura) se corresponde con los
 * tokens distintivos del nombre?
 *
 * Cuatro formas, todas observadas en dominios oficiales:
 *   `minambiente`   → el resto ES un token distintivo
 *   `minsalud`      → ídem
 *   `minenergia`    → un token distintivo que no es el primero
 *   `mintic`        → las iniciales de los tokens distintivos
 *   `mineducacion`  → la concatenación de los tokens distintivos
 */
function remainderMatchesDistinctiveTokens(
  remainder: string,
  tokens: readonly string[],
): string | null {
  if (remainder.length < MIN_EVIDENCE_TOKEN_LENGTH || tokens.length === 0) return null;
  if (tokens.includes(remainder)) return `resto "${remainder}" es un token del nombre`;
  if (tokens.join('') === remainder) return `resto "${remainder}" concatena los tokens del nombre`;
  if (tokens.length >= 2 && initialsOf(tokens) === remainder) {
    return `resto "${remainder}" son las iniciales de los tokens del nombre`;
  }
  if (
    remainder.length >= 4 &&
    tokens.some((token) => token.length > remainder.length && token.startsWith(remainder))
  ) {
    return `resto "${remainder}" es prefijo de un token del nombre`;
  }
  return null;
}

function evaluateAbbreviationRule(
  nameTokens: readonly string[],
  headNounIndex: number,
  domainTokens: readonly string[],
): InstitutionalCorrespondenceResult {
  const headNoun = nameTokens[headNounIndex] ?? '';
  const tokens = distinctiveTokens(nameTokens, headNounIndex);
  if (tokens.length === 0) return NO_MATCH;

  for (const domainToken of domainTokens) {
    const maxPrefix = Math.min(headNoun.length, domainToken.length - MIN_EVIDENCE_TOKEN_LENGTH);
    for (let length = MIN_HEAD_NOUN_PREFIX_LENGTH; length <= maxPrefix; length++) {
      const prefix = domainToken.slice(0, length);
      if (!headNoun.startsWith(prefix)) continue;
      const detail = remainderMatchesDistinctiveTokens(domainToken.slice(length), tokens);
      if (detail === null) continue;
      return {
        matched: true,
        signal: 'institutional_abbreviation_domain_match',
        detail: `dominio "${domainToken}" = abreviatura "${prefix}" de "${headNoun}" + ${detail}`,
      };
    }
  }
  return NO_MATCH;
}

// ─── Regla C — sigla oficial ──────────────────────────────────────────────────

/**
 * 🔴 X6.9 — la regla de sigla EXIGE igualdad exacta de la etiqueta con las
 * iniciales, así que no necesitaba la puerta léxica institucional para ser
 * segura: la necesitaba para ser ALCANZABLE, y esa puerta la estaba matando.
 *
 * La auditoría X6.8 lo midió sobre el lote `71a6f75b`: «Hospital Universitario
 * de Santander» ↔ `hus.gov.co` tiene iniciales `hus` IDÉNTICAS a la etiqueta
 * del dominio, y la regla nunca corrió porque `hospital` no está en
 * `INSTITUTIONAL_HEAD_NOUNS`. Un catálogo de sustantivos no puede ser la
 * condición de una regla que ya se defiende sola.
 *
 * ── La ÚNICA variante añadida ────────────────────────────────────────────────
 *
 *   token final de país descartado  `iss` (no `issc`) ↔ «Instituto de Seguros
 *                                                        Sociales, Colombia»
 *
 * No relaja la igualdad: sólo dice qué se iguala. Y va en la dirección segura —
 * descarta información del NOMBRE, no la inventa desde el dominio.
 *
 * ── 🔴 La variante «sigla + sufijo territorial», DESCARTADA ──────────────────
 *
 * X6.9 la implementó y la retiró. Habría recuperado «Secretaría de Educación
 * Departamental» ↔ `sedguaviare.gov.co`, pero la prueba de sobre-aceptación la
 * condenó: ese nombre no contiene ningún topónimo, así que la sigla `sed`
 * igualaba **49 dominios distintos** —`sedamazonas`, `sedantioquia`,
 * `sedatlantico`…—, uno por cada departamento y calificativo del léxico. Son 49
 * organizaciones DIFERENTES, y la regla no podía decir cuál.
 *
 * Funcionaba sintácticamente y no acreditaba nada. Además contradecía a su
 * módulo hermano: `domain-name-coverage.ts` rechaza
 * `secretariadeeducacion-yopal` para «Secretaría de Educación y Cultura` por
 * exactamente el mismo motivo —el dominio aporta un topónimo que el nombre no
 * sostiene—, y las dos reglas no pueden juzgar lo mismo de forma opuesta.
 *
 * Si algún día hay que recuperar esos casos, la evidencia tendrá que venir del
 * NOMBRE (que traiga su topónimo), nunca de admitir cualquier sufijo del léxico.
 */
function isTerritorialOrAdministrativeSuffix(token: string): boolean {
  return COLOMBIAN_DEPARTMENT_WORDS.has(token) || ADMINISTRATIVE_QUALIFIER_WORDS.has(token);
}

/**
 * Las formas del nombre con las que se puede construir una sigla: el nombre
 * completo y, si el último token es un calificativo territorial/administrativo
 * («…, Colombia»), el nombre sin él.
 */
function acronymCandidates(nameTokens: readonly string[]): Array<{
  tokens: readonly string[];
  detail: string;
}> {
  const forms: Array<{ tokens: readonly string[]; detail: string }> = [
    { tokens: nameTokens, detail: `las iniciales de "${nameTokens.join(' ')}"` },
  ];
  const last = nameTokens[nameTokens.length - 1];
  if (last !== undefined && isTerritorialOrAdministrativeSuffix(last)) {
    const trimmed = nameTokens.slice(0, -1);
    if (trimmed.length >= 2) {
      forms.push({
        tokens: trimmed,
        detail: `las iniciales de "${trimmed.join(' ')}" (sin el calificativo final "${last}")`,
      });
    }
  }
  return forms;
}

function evaluateAcronymRule(
  nameTokens: readonly string[],
  domainLabel: string,
): InstitutionalCorrespondenceResult {
  if (nameTokens.length < 2) return NO_MATCH;

  for (const form of acronymCandidates(nameTokens)) {
    const acronym = initialsOf(form.tokens);
    if (acronym.length < MIN_ACRONYM_LENGTH) continue;
    // Igualdad EXACTA con la etiqueta entera. Un prefijo no basta: lo que
    // sobrara del dominio nombraría algo que el nombre no dice.
    if (acronym !== domainLabel) continue;
    return {
      matched: true,
      signal: 'institutional_acronym_domain_match',
      detail: `dominio "${domainLabel}" son ${form.detail}`,
    };
  }

  return NO_MATCH;
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

/**
 * Evalúa la correspondencia institucional entre el nombre de una entidad y su
 * dominio. Sólo puede AÑADIR un pase: si no encuentra correspondencia devuelve
 * `matched: false` y el gate sigue su curso normal hacia el rechazo.
 *
 * @param companyName       Nombre de la entidad candidata.
 * @param domainIdentityKey Dominio SIN el TLD conocido, tal como el gate lo
 *                          calcula (`segovia-antioquia`, `minambiente`).
 */
export function evaluateInstitutionalNameDomainCorrespondence(
  companyName: string,
  domainIdentityKey: string,
): InstitutionalCorrespondenceResult {
  const nameTokens = tokenize(companyName);
  if (nameTokens.length === 0) return NO_MATCH;

  const { label, tokens: domainTokens } = readDomainTokens(domainIdentityKey);
  if (label.length === 0 || domainTokens.length === 0) return NO_MATCH;

  // Reglas A y B — SIGUEN tras la puerta léxica. Ambas razonan sobre el
  // sustantivo institucional que encabeza el nombre: sin él no tienen sujeto,
  // y sin la puerta aceptarían correspondencias parciales de razones sociales
  // privadas. Su contrato no se mueve en X6.9.
  if (nameTokens.some(isInstitutionalTerm)) {
    const headNounIndex = nameTokens.findIndex((token) => INSTITUTIONAL_HEAD_NOUNS.has(token));
    if (headNounIndex >= 0) {
      const territorial = evaluateTerritorialRule(nameTokens, headNounIndex, domainTokens);
      if (territorial.matched) return territorial;

      const abbreviation = evaluateAbbreviationRule(nameTokens, headNounIndex, domainTokens);
      if (abbreviation.matched) return abbreviation;
    }
  }

  // 🔴 X6.9 — regla C FUERA de la puerta léxica. Exige igualdad exacta de la
  // etiqueta con las iniciales (o con las iniciales más un calificativo
  // territorial cerrado), así que se defiende sola: el léxico sólo le impedía
  // llegar a nombres que no empiezan por un sustantivo institucional
  // catalogado, como «Hospital Universitario de Santander».
  return evaluateAcronymRule(nameTokens, label);
}
