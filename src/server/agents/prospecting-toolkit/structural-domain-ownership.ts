/**
 * Structural Domain Ownership — AGENT1-STRUCTURAL-DOMAIN-OWNERSHIP-X6.10-A
 *
 * ── Qué problema resuelve, y por qué NO es otra heurística de texto ──────────
 *
 * X6.9 agotó lo que se puede demostrar comparando el NOMBRE con el DOMINIO. Lo
 * que queda fuera no falla por afinación: falla porque entre las dos cadenas no
 * hay ninguna relación textual que descubrir.
 *
 *   «rtvc»                ↔ senalcolombia.tv
 *   «Caracol Televisión»  ↔ caracoltv.com
 *
 * Nadie puede derivar el segundo del primero sin inventarse un mapa de marcas.
 * Este módulo no lo intenta. Cambia de PREGUNTA: en vez de buscar más parecido
 * entre dos cadenas, busca una TERCERA cadena que el proveedor ya haya ligado a
 * la misma organización, y exige que la prueba textual —la de X6.9, sin tocarla—
 * se sostenga sobre ESA.
 *
 * Es, por tanto, una capa de FUENTES, no de reglas. La autoridad textual sigue
 * siendo una sola: `evaluateCompanyOwnership`.
 *
 * ── Las dos reglas ──────────────────────────────────────────────────────────
 *
 *   E1 · conjunto de alias de dominio del proveedor (`all_domains`)
 *        El dominio a acreditar pertenece al conjunto, existe OTRO alias
 *        distinto en el conjunto, y ese otro alias sí lo acredita el gate para
 *        este nombre. Produce `confirmed`.
 *
 *   E2 · slug de empresa de LinkedIn
 *        Doble pata obligatoria: el slug acredita el dominio, y el nombre está
 *        anclado en el slug. Produce CORROBORACIÓN, nunca `confirmed`.
 *
 * ── 🔴 LinkedIn NUNCA decide solo ────────────────────────────────────────────
 *
 * E2 no puede devolver `confirmed` bajo ninguna entrada. Es una restricción del
 * contrato, no una casualidad de la implementación, y hay un test que la fija.
 *
 * La razón es medible, no doctrinal. Sobre las 71 filas de Producción con
 * `disposition = 'ownership_domain_rejected'`, dominio y `linkedin_url`, el slug
 * es LITERALMENTE el nombre normalizado en 47 (66 %): no aporta información
 * nueva, sólo repite la cadena que el gate ya rechazó. Y Apollo asocia con
 * frecuencia la página corporativa del GRUPO a cada filial, de modo que una
 * sola pata convertiría «el grupo tiene página» en «la filial es dueña del
 * dominio». X6.10-A registra lo que LinkedIn apoya —para poder medirlo— y no
 * actúa sobre ello.
 *
 * ── Lo que este módulo NO hace ──────────────────────────────────────────────
 *
 *   · NO hace coincidencia difusa: ni Levenshtein, ni n-gramas, ni umbrales de
 *     similitud. Es lo que deja fuera a `rtvc---senialcolombia` ↔
 *     `senalcolombia.tv`, que difieren en una letra: un umbral que tolere esa
 *     letra tolera cientos de vecinos reales.
 *   · NO hace red: ni scraping, ni WHOIS, ni DNS, ni Supabase, ni proveedor.
 *   · NO lee el reloj.
 *   · NO mira el TLD, ni el sector, ni las keywords, ni la descripción.
 *   · NO acepta `primary_domain` por sí solo. Un conjunto de alias con un solo
 *     elemento no acredita nada: es exactamente la afirmación que el gate de
 *     ownership existe para no creerse.
 *   · NO modela propiedad societaria. Que una relación histórica o de marca
 *     exista no demuestra que el dominio actual sea de la candidata. El caso
 *     `EPM ↔ une.com.co` se queda rechazado y tiene test de regresión negativa.
 *
 * ── Frontera de confianza, declarada ────────────────────────────────────────
 *
 * E1 confía en la AGRUPACIÓN del proveedor (qué dominios pertenecen al mismo
 * registro de organización) y sólo en ella; la prueba de que la organización es
 * la candidata la sigue poniendo el texto, vía el gate. Si un proveedor agrupara
 * mal, E1 heredaría ese error. No se puede evitar sin una segunda fuente
 * independiente, y no la hay en el punto del gate: las fuentes oficiales
 * (co_siis / RUES) corren DESPUÉS y necesitan base de datos.
 *
 * Puro y determinístico. Sin IA.
 */

import {
  evaluateCompanyOwnership,
  isBlockedByCompanyOwnership,
} from './company-ownership-gate';
import { normalizeLinkedInCompanyUrl } from './linkedin-company-enrichment';
import {
  ADMINISTRATIVE_QUALIFIER_WORDS,
  COLOMBIAN_DEPARTMENT_WORDS,
  INSTITUTIONAL_ADJECTIVES,
  INSTITUTIONAL_HEAD_NOUNS,
  SPANISH_CONNECTOR_TOKENS,
  TERRITORIAL_HEAD_NOUNS,
} from './public-entity-lexicon';

// ─── Contrato ─────────────────────────────────────────────────────────────────

/**
 * El desenlace de la capa estructural.
 *
 * 🔴 `insufficient_evidence` NO es una aceptación ni una negación: es la
 * ausencia de una respuesta. El llamador que lo reciba debe dejar el veredicto
 * de `evaluateCompanyOwnership` EXACTAMENTE como estaba. Convertirlo en pase es
 * el único modo de que esta capa se vuelva una vía de falsos positivos.
 */
export type StructuralOwnershipOutcome =
  | 'confirmed'
  | 'rejected'
  | 'insufficient_evidence';

/** Las fuentes estructurales admisibles. Sólo dos, y ninguna es textual. */
export type StructuralOwnershipSource =
  | 'provider_domain_alias_set'
  | 'provider_linkedin_company_slug';

export const STRUCTURAL_OWNERSHIP_SOURCES: readonly StructuralOwnershipSource[] = [
  'provider_domain_alias_set',
  'provider_linkedin_company_slug',
];

/**
 * Qué aporta LinkedIn. Se registra SIEMPRE y no decide NUNCA.
 *
 *   · `supports`     — las dos patas de E2 se sostienen.
 *   · `inconclusive` — hay slug utilizable, pero las dos patas no se sostienen.
 *   · `absent`       — el proveedor no dio LinkedIn, o lo que dio no es una
 *                      página de EMPRESA (un perfil `/in/` nunca entra).
 *
 * No existe un valor `contradicts`: con las señales disponibles no se puede
 * demostrar que un slug CONTRADIGA la propiedad de un dominio, y fabricar esa
 * categoría sería afirmar más de lo que la evidencia dice.
 */
export type LinkedInCorroboration = 'supports' | 'inconclusive' | 'absent';

/**
 * La evidencia estructural de UNA candidata, tal como la fuente la entregó.
 *
 * `null` / `[]` significan SIEMPRE «la fuente no lo aportó», nunca «no
 * coincide». La distinción viaja al resultado en `absentSources`.
 */
export type StructuralOwnershipEvidence = {
  /** Nombre ya recuperado, el MISMO que recibe `evaluateCompanyOwnership`. */
  readonly companyName: string;
  /** Dominio a acreditar, tal como el gate lo resolvió. */
  readonly domain: string | null;
  /**
   * Alias de dominio que el proveedor declara para ESTA organización
   * (`all_domains` de Apollo, ya normalizado). `[]` = no los aportó.
   */
  readonly providerDomainAliases: readonly string[];
  /** URL de empresa de LinkedIn tal como el proveedor la dio. */
  readonly providerLinkedInCompanyUrl: string | null;
  /** Procedencia. No decide nada; se persiste para poder auditar. */
  readonly provenance: StructuralOwnershipProvenance;
};

export type StructuralOwnershipProvenance = {
  readonly provider: 'apollo' | 'lusha' | null;
  readonly operation: 'organizations_search' | 'organization_enrichment' | null;
  readonly observedAt: string | null;
};

export type StructuralOwnershipResult = {
  readonly outcome: StructuralOwnershipOutcome;
  /** La fuente que produjo `confirmed` o `rejected`. `null` si no hubo. */
  readonly decidingSource: StructuralOwnershipSource | null;
  /** Nombre estático de la señal. `null` cuando nadie decidió. */
  readonly signal: string | null;
  /** Explicación legible. Vacía cuando no hay nada que explicar. */
  readonly detail: string;
  /** 🔴 Lo que LinkedIn apoya. NUNCA es lo que decide. */
  readonly linkedInCorroboration: LinkedInCorroboration;
  /** Fuentes que llegaron con contenido y se evaluaron. */
  readonly evaluatedSources: readonly StructuralOwnershipSource[];
  /** Fuentes que la fuente no aportó. Distinguirlas de las evaluadas importa. */
  readonly absentSources: readonly StructuralOwnershipSource[];
};

/** Longitud mínima de un token del nombre para valer como ancla en el slug. */
const MIN_ANCHOR_TOKEN_LENGTH = 4;

/**
 * 🔴 X6.10-C — longitud mínima de un token para que el NOMBRE identifique a
 * alguien, que es un umbral distinto del ancla del slug y por eso tiene su
 * propia constante.
 *
 * Tres, no cuatro: una razón social puede ser una sigla corta y legítima, y
 * subirlo a cuatro excluiría a empresas reales sin ganar nada. Lo que este
 * umbral filtra no es la brevedad sino el VOCABULARIO, abajo.
 */
const MIN_IDENTIFYING_TOKEN_LENGTH = 3;

/**
 * Tope de cardinalidad del conjunto de alias.
 *
 * Un registro con decenas de dominios no está describiendo una organización:
 * está acumulando redirecciones, dominios comprados y ruido. Por encima del
 * tope el conjunto deja de ser evidencia de agrupación.
 */
export const MAX_TRUSTED_DOMAIN_ALIASES = 8;

// ─── Normalización local ──────────────────────────────────────────────────────

function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Hostname comparable: minúsculas, sin protocolo, sin `www.`, sin path. */
function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  let hostname: string;
  try {
    const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    hostname = new URL(withProtocol).hostname;
  } catch {
    return null;
  }
  hostname = hostname.replace(/^www\./, '');
  if (!hostname.includes('.')) return null;
  return hostname;
}

/**
 * ¿Es este token contenido que identifique a UNA organización, o vocabulario?
 *
 * Consulta el léxico compartido (`public-entity-lexicon.ts`) y NADA más. El
 * `GENERIC_DOMAIN_WORDS` del gate no se consulta porque no está exportado y
 * duplicarlo crearía una segunda copia divergente de la misma política. Su
 * ausencia sólo hace a E2 MÁS permisiva, y E2 no puede confirmar nada: el
 * efecto está acotado a qué se registra como apoyo.
 */
function isVocabularyToken(token: string): boolean {
  return (
    SPANISH_CONNECTOR_TOKENS.has(token) ||
    INSTITUTIONAL_HEAD_NOUNS.has(token) ||
    TERRITORIAL_HEAD_NOUNS.has(token) ||
    INSTITUTIONAL_ADJECTIVES.has(token) ||
    COLOMBIAN_DEPARTMENT_WORDS.has(token) ||
    ADMINISTRATIVE_QUALIFIER_WORDS.has(token)
  );
}

/** Tokens distintivos del nombre: ni vocabulario, ni demasiado cortos. */
function distinctiveNameTokens(companyName: string): string[] {
  return stripDiacritics(companyName.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(
      (token) => token.length >= MIN_ANCHOR_TOKEN_LENGTH && !isVocabularyToken(token),
    );
}

/**
 * 🔴 X6.10-C — ¿este nombre identifica a ALGUIEN?
 *
 * ── El hueco que cierra ──────────────────────────────────────────────────────
 *
 * E1 exige que OTRO alias del conjunto lo acredite el gate. Pero las reglas 1-4
 * del gate son de subcadena y NO tienen la guarda de contenido distintivo que
 * X6.9 sí puso en su regla 6: «Alcaldía» contra `alcaldia.gov.co` es
 * coincidencia EXACTA, `confidence: high`.
 *
 * El efecto era que un nombre genérico se acreditaba a sí mismo con su dominio
 * homónimo y, por E1, arrastraba a CUALQUIER otro dominio que el proveedor
 * agrupara con él: «Alcaldía» + `[gachancipa-cundinamarca.gov.co,
 * alcaldia.gov.co]` quedaba admitida sin que nadie supiera de qué alcaldía se
 * hablaba. Es exactamente lo que X6.9 § 3b rechaza, entrando por otra puerta.
 *
 * No es una heurística nueva de nombre↔dominio: no mira el dominio. Comprueba
 * una propiedad del NOMBRE con el léxico compartido que ya existía.
 */
function nameIdentifiesSomeone(companyName: string): boolean {
  return stripDiacritics(companyName.toLowerCase())
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .some(
      (token) => token.length >= MIN_IDENTIFYING_TOKEN_LENGTH && !isVocabularyToken(token),
    );
}

// ─── La autoridad textual, invocada — nunca reimplementada ────────────────────

/**
 * ¿El gate de ownership acredita `domain` para `name`?
 *
 * Es UNA llamada a `evaluateCompanyOwnership` con el mismo juez que decide en
 * Producción (`isBlockedByCompanyOwnership`). No se reinterpreta el veredicto y
 * no se añade ninguna regla: lo que esta capa no puede hacer, por construcción,
 * es aceptar un par que el gate rechazaría.
 *
 * 🔴 NO lleva guarda de nombre vacío. La llevó, y el mutation testing demostró
 * que era código muerto: la entrada pública ya descarta un `companyName` en
 * blanco antes de llegar aquí, y la rama del slug comprueba que quede algo
 * después de normalizar. Una guarda que ninguna entrada puede ejercitar no
 * protege nada; sólo hace creer que sí.
 */
function gateAccredits(name: string, domain: string): boolean {
  return !isBlockedByCompanyOwnership(evaluateCompanyOwnership(name, null, domain));
}

// ─── E1 · conjunto de alias de dominio del proveedor ──────────────────────────

type AliasVerdict = {
  readonly outcome: 'confirmed' | 'rejected' | 'insufficient_evidence';
  readonly signal: string | null;
  readonly detail: string;
};

const ALIAS_NO_EVIDENCE: AliasVerdict = {
  outcome: 'insufficient_evidence',
  signal: null,
  detail: '',
};

/**
 * E1 — las cuatro condiciones, todas necesarias:
 *
 *   1. el dominio a acreditar PERTENECE al conjunto declarado por el proveedor;
 *   2. existe en el conjunto al menos OTRO alias distinto de él;
 *   3. ese otro alias lo acredita el gate para este nombre;
 *   4. el conjunto no excede el tope de cardinalidad.
 *
 * Si `all_domains = [primary_domain]`, la condición 2 falla y no hay evidencia:
 * un dominio no puede probarse a sí mismo.
 *
 * 🔴 `rejected` sólo puede salir de una CONTRADICCIÓN demostrada: el proveedor
 * enumeró los dominios de la organización, uno de ellos queda acreditado por el
 * nombre —así que el conjunto SÍ describe a esta candidata— y el dominio que se
 * juzga no está entre ellos. Sin esa segunda mitad no hay contradicción, sólo
 * ausencia, y la ausencia no rechaza: un `website_url` del que se derivó el
 * dominio puede legítimamente no figurar en `all_domains`.
 */
function evaluateDomainAliasSet(
  companyName: string,
  domain: string,
  aliases: readonly string[],
): AliasVerdict {
  // 🔴 X6.10-C — puerta de entrada: un nombre que no identifica a nadie no puede
  // acreditar nada, por muchos alias que el proveedor agrupe. Va ANTES que todo
  // lo demás porque ninguna de las condiciones siguientes puede compensarlo.
  if (!nameIdentifiesSomeone(companyName)) return ALIAS_NO_EVIDENCE;

  const normalizedAliases: string[] = [];
  for (const alias of aliases) {
    const hostname = normalizeHostname(alias);
    if (hostname !== null && !normalizedAliases.includes(hostname)) {
      normalizedAliases.push(hostname);
    }
  }
  if (normalizedAliases.length === 0) return ALIAS_NO_EVIDENCE;

  if (normalizedAliases.length > MAX_TRUSTED_DOMAIN_ALIASES) {
    return {
      outcome: 'insufficient_evidence',
      signal: null,
      detail: `conjunto de ${normalizedAliases.length} alias por encima del tope de ${MAX_TRUSTED_DOMAIN_ALIASES}: acumulación, no agrupación`,
    };
  }

  const others = normalizedAliases.filter((alias) => alias !== domain);
  const accreditedOther = others.find((alias) => gateAccredits(companyName, alias)) ?? null;

  if (!normalizedAliases.includes(domain)) {
    if (accreditedOther === null) return ALIAS_NO_EVIDENCE;
    return {
      outcome: 'rejected',
      signal: 'domain_absent_from_accredited_alias_set',
      detail: `el proveedor declara los dominios de la organización (${normalizedAliases.join(', ')}), "${accreditedOther}" queda acreditado por el nombre, y "${domain}" no está entre ellos`,
    };
  }

  // Condición 2 — el dominio no puede probarse a sí mismo. La sostiene el
  // FILTRO de arriba (`alias !== domain`), no una guarda aparte: con el
  // conjunto de «otros» vacío no hay nada que acreditar y `accreditedOther`
  // sale null por el mismo camino que cuando ninguno acredita.
  //
  // 🔴 Hubo aquí un `if (others.length === 0)` explícito. El mutation testing
  // lo mató: quitarlo no cambiaba un solo desenlace. El que SÍ es
  // imprescindible es el filtro, y su mutación deja cuatro tests en rojo.
  if (accreditedOther === null) return ALIAS_NO_EVIDENCE;

  return {
    outcome: 'confirmed',
    signal: 'alias_domain_accredited_by_company_name',
    detail: `"${domain}" es alias declarado por el proveedor de "${accreditedOther}", y el gate acredita "${accreditedOther}" para "${companyName}"`,
  };
}

// ─── E2 · slug de empresa de LinkedIn (corrobora, no decide) ──────────────────

/**
 * E2 — doble pata OBLIGATORIA:
 *
 *   pata 1 · el slug, tratado como nombre, acredita el dominio ante el gate;
 *   pata 2 · el nombre de la candidata está ANCLADO en el slug (al menos un
 *            token distintivo del nombre aparece dentro del slug).
 *
 * La pata 2 es la que impide que la página del GRUPO acredite el dominio de una
 * filial cualquiera: «Alimentos XYZ» no está anclada en `grupo-nutresa`.
 * La pata 1 es la que impide que un slug que sólo repite el nombre —el 66 % de
 * los casos medidos— aporte nada.
 */
function evaluateLinkedInSlug(
  companyName: string,
  domain: string,
  linkedInUrl: string | null,
): { corroboration: LinkedInCorroboration; detail: string } {
  if (linkedInUrl === null || linkedInUrl.trim().length === 0) {
    return { corroboration: 'absent', detail: '' };
  }

  const normalized = normalizeLinkedInCompanyUrl(linkedInUrl);
  if (normalized.rejected || normalized.slug === null) {
    return {
      corroboration: 'absent',
      detail: `LinkedIn no utilizable (${normalized.rejectReason ?? 'unknown'})`,
    };
  }

  const slugAsName = stripDiacritics(normalized.slug).replace(/[^a-z0-9]+/g, ' ').trim();
  const slugCompact = slugAsName.replace(/\s+/g, '');
  if (slugCompact.length === 0) {
    return { corroboration: 'absent', detail: 'slug vacío tras normalizar' };
  }

  const slugAccreditsDomain = gateAccredits(slugAsName, domain);
  const anchor =
    distinctiveNameTokens(companyName).find((token) => slugCompact.includes(token)) ?? null;

  if (slugAccreditsDomain && anchor !== null) {
    return {
      corroboration: 'supports',
      detail: `slug "${normalized.slug}" acredita "${domain}" y el nombre está anclado en él por "${anchor}"`,
    };
  }

  const missing = [
    slugAccreditsDomain ? null : 'el slug no acredita el dominio',
    anchor === null ? 'el nombre no está anclado en el slug' : null,
  ].filter((entry): entry is string => entry !== null);

  return {
    corroboration: 'inconclusive',
    detail: `slug "${normalized.slug}": ${missing.join(' y ')}`,
  };
}

// ─── Entrada pública ──────────────────────────────────────────────────────────

function buildSourcePresence(evidence: StructuralOwnershipEvidence): {
  evaluatedSources: StructuralOwnershipSource[];
  absentSources: StructuralOwnershipSource[];
} {
  const evaluatedSources: StructuralOwnershipSource[] = [];
  const absentSources: StructuralOwnershipSource[] = [];

  const hasAliases = evidence.providerDomainAliases.some(
    (alias) => normalizeHostname(alias) !== null,
  );
  (hasAliases ? evaluatedSources : absentSources).push('provider_domain_alias_set');

  const linkedIn = evidence.providerLinkedInCompanyUrl;
  const hasLinkedIn =
    linkedIn !== null &&
    linkedIn.trim().length > 0 &&
    !normalizeLinkedInCompanyUrl(linkedIn).rejected;
  (hasLinkedIn ? evaluatedSources : absentSources).push('provider_linkedin_company_slug');

  return { evaluatedSources, absentSources };
}

/**
 * Evalúa la evidencia ESTRUCTURAL de que `domain` pertenece a `companyName`.
 *
 * 🔴 Esta función no decide si una candidata se persiste. Produce un desenlace
 * que un llamador —que X6.10-A todavía no cablea— podrá usar SÓLO para añadir
 * un pase que el gate textual no pudo dar. `insufficient_evidence` obliga a
 * dejar el veredicto del gate intacto, y `rejected` no está autorizado a
 * degradar nada en esta fase.
 *
 * Puro: sin red, sin base, sin reloj, sin proveedor.
 */
export function evaluateStructuralDomainOwnership(
  evidence: StructuralOwnershipEvidence,
): StructuralOwnershipResult {
  const { evaluatedSources, absentSources } = buildSourcePresence(evidence);
  const domain = evidence.domain === null ? null : normalizeHostname(evidence.domain);

  // Sin dominio no hay nada que acreditar. No es un rechazo: es que la pregunta
  // no se puede formular.
  if (domain === null || evidence.companyName.trim().length === 0) {
    return {
      outcome: 'insufficient_evidence',
      decidingSource: null,
      signal: null,
      detail:
        domain === null
          ? 'sin dominio que acreditar'
          : 'sin nombre de empresa con el que acreditar',
      linkedInCorroboration: 'absent',
      evaluatedSources: [],
      absentSources: [...STRUCTURAL_OWNERSHIP_SOURCES],
    };
  }

  const linkedIn = evaluateLinkedInSlug(
    evidence.companyName,
    domain,
    evidence.providerLinkedInCompanyUrl,
  );

  const alias = evaluateDomainAliasSet(
    evidence.companyName,
    domain,
    evidence.providerDomainAliases,
  );

  if (alias.outcome !== 'insufficient_evidence') {
    return {
      outcome: alias.outcome,
      decidingSource: 'provider_domain_alias_set',
      signal: alias.signal,
      detail: alias.detail,
      linkedInCorroboration: linkedIn.corroboration,
      evaluatedSources,
      absentSources,
    };
  }

  // 🔴 Aquí es donde LinkedIn NO decide. Por fuerte que sea su apoyo, sin E1 el
  // desenlace es la ausencia de respuesta, y el gate conserva su veredicto.
  return {
    outcome: 'insufficient_evidence',
    decidingSource: null,
    signal: null,
    detail: [alias.detail, linkedIn.detail].filter((entry) => entry.length > 0).join(' · '),
    linkedInCorroboration: linkedIn.corroboration,
    evaluatedSources,
    absentSources,
  };
}
