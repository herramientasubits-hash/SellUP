/**
 * Agente 1 · Rescate con Claude — descartadas SIN DOMINIO (Fase B, paso 1; puro).
 *
 * Apollo devuelve empresas con LinkedIn pero sin sitio web (`missing_domain_final`,
 * 160 en Prod el 30-09). Claude busca el sitio oficial (`domain-finder.ts`), se
 * revisa si ya existe en SellUp/HubSpot y, si es nueva, sigue el rescate de siempre.
 *
 * Qué se guarda en la evidencia (`claude_domain_search`): el sitio encontrado y cómo
 * se comprobó, o por qué no se encontró. Así una segunda corrida NO vuelve a pagar
 * la búsqueda: reutiliza el dominio ya comprobado.
 */

import { LATAM_COUNTRIES } from '@/modules/prospect-batches/types';
import type { LogProviderUsageInput } from '@/modules/usage-tracking/types';
import { normalizeLinkedInCompanyUrl } from '../../linkedin-company-enrichment';
import type { DuplicateStatus } from '../../types';
import { evaluateExternalPlatformGate } from '../../external-platform-blocklist';
import { normalizeDomain } from '../../normalization';
import {
  domainCarriesName,
  type DomainFinderInput,
  type DomainFinderOutcome,
  type DomainVerification,
} from '../domain-finder';
import { CLAUDE_CLASSIFIER_CONTRACT_VERSION, CLAUDE_CLASSIFIER_PROVIDER_KEY } from '../types';
import { CLAUDE_RESCUE_METADATA_KEY } from './rescue-patch';

export const DOMAIN_SEARCH_REASON_CODE = 'missing_domain_final';
export const CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY = 'claude_domain_search';
export const CLAUDE_DOMAIN_SEARCH_OPERATION_KEY = 'company_domain_search';
/**
 * Versión del buscador. d1 = #514 (30-09). d2 (01-10): nombre desde el slug de LinkedIn
 * cuando falta el original, subdominios de un resultado y URL fuera de la búsqueda si
 * enlaza al mismo LinkedIn. d3 (01-10): si el sitio bloquea nuestra descarga, vale el título
 * del resultado de búsqueda de ese dominio; redirección válida si el destino salió de la
 * búsqueda; el nombre se compara en todas sus formas. Un «no encontrado» de una versión
 * anterior se reintenta UNA vez. d4 (06-10): país por su nombre («Chile», no «CL») y,
 * para comparar con la página, también el nombre sin forma societaria ni palabras
 * genéricas («ACCENTURE CHILE ASESORIAS Y SERVICIOS LIMITADA» → «accenture»): la
 * razón social de los registros oficiales casi nunca es la marca del sitio. Medido en
 * la 1.ª corrida de Chile (lote bd751c34): Claude propuso accenture.com y sonda.com y
 * la comprobación los rechazó. d5 (06-10): Claude también BUSCA con el nombre corto; si
 * el dominio lleva el nombre de la empresa (entel.cl, clarochile.cl, vtr.com) vale aunque
 * no saliera de la búsqueda, siempre que la página que bajamos lo confirme; y una
 * redirección a otro dominio vale si ese dominio lleva el nombre (indracompany.com →
 * indragroup.com). Medido en Chile (bd751c34) y Argentina (17da92cf). d6 (06-10): PISTA
 * sin confirmar — ver `unverifiedWebsiteHint`. d7 (06-10): el nombre corto quita las letras
 * sueltas («HEXACTA S. R. L.» → «hexacta») y «company»; los «no encontrado» de d6 se
 * reintentan una vez. d8 (06-10): el dominio puede ser la SIGLA del nombre (meds.cl,
 * ucmchile.cl) si la página la confirma — ver `pageConfirmsAcronym`. d9 (06-10): la página
 * se lee hasta 400 KB (`CLAUDE_PAGE_MAX_HTML_BYTES`): en sitios WordPress los primeros
 * 50 KB eran sólo estilos y la comprobación nunca veía el texto.
 */
export const DOMAIN_SEARCH_VERSION = 'd9';

/**
 * PISTA (decisión de la dueña, 06-10-2026, «si pista»): la web que Claude propuso pero
 * que NO pudimos abrir (bloqueos, geo). Llega a revisión marcada como «Inferido», nunca
 * como comprobada.
 */
export const UNVERIFIED_HINT_VERIFICATION = 'unverified_hint' as const;

/**
 * SOURCES-EC-CLOSE-2 — la web que Claude propuso es EXACTAMENTE el nombre comercial
 * o la sigla que el registro oficial guarda para ese mismo número fiscal («NETLIFE»
 * del SRI para MEGADATOS S.A. → netlife.ec). Es prueba oficial de identidad aunque
 * la página no abra, redirija o no diga la razón social.
 */
export const OFFICIAL_TRADE_NAME_VERIFICATION = 'official_trade_name' as const;
/**
 * SOURCES-EC-CLOSE-2 — la web que Claude propuso es la PRIMERA palabra propia de la
 * razón social oficial (huawei.com ← «HUAWEI TECHNOLOGIES ECUADOR CIA. LTDA.»,
 * devsu.com ← «DEVSUSOFTWARE CIA. LTDA.»). Más débil que la marca oficial: llega a
 * revisión como «Inferido».
 */
export const REGISTRY_FIRST_WORD_VERIFICATION = 'registry_first_word' as const;
export type FoundVerification =
  | DomainVerification
  | typeof UNVERIFIED_HINT_VERIFICATION
  | typeof OFFICIAL_TRADE_NAME_VERIFICATION
  | typeof REGISTRY_FIRST_WORD_VERIFICATION;
const VERIFICATIONS: readonly FoundVerification[] = [
  'linkedin_cross_link',
  'name_match',
  'search_result_match',
  'acronym_match',
  UNVERIFIED_HINT_VERIFICATION,
  OFFICIAL_TRADE_NAME_VERIFICATION,
  REGISTRY_FIRST_WORD_VERIFICATION,
];

/**
 * Países con nombre comercial / sigla oficial por número fiscal ya cargados
 * (Ecuador: `ec_sri_trade_name_registry` + `ec_scvs_alias_registry`).
 */
/**
 * SOURCES-BO-CLOSE-1 — Bolivia: siglas oficiales por NIT (`bo_name_alias`). Activa
 * también, a propósito, la web por la primera palabra propia de la razón social
 * (huawei.com ← HUAWEI TECHNOLOGIES (BOLIVIA) S.R.L.), como en Ecuador.
 */
export const OFFICIAL_NAME_COUNTRIES: ReadonlySet<string> = new Set(['EC', 'BO']);

/** Errores pasajeros (modelo, sitio caído) se reintentan hasta este número de búsquedas. */
export const DOMAIN_SEARCH_MAX_ATTEMPTS = 3;
const TRANSIENT_REASONS: ReadonlySet<string> = new Set(['model_error', 'page_unreachable']);

/**
 * Errores de la CUENTA de Anthropic, no de la empresa: saldo agotado o petición
 * rechazada (400), credenciales (401), pago (402), permisos (403). Prod 06-10
 * 13:07Z: 194 llamadas seguidas con http_400 en 5 lotes; cada una gastaba un
 * intento y, tras 3, la fila quedaba «sitio no encontrado» para siempre.
 */
const ACCOUNT_ERROR_CODES: ReadonlySet<string> = new Set(['http_400', 'http_401', 'http_402', 'http_403']);

/** ¿Falló la CUENTA de Anthropic (no la búsqueda de esta empresa)? */
export function isAccountLevelModelError(outcome: DomainFinderOutcome): boolean {
  return !outcome.found && outcome.reason === 'model_error' && ACCOUNT_ERROR_CODES.has(outcome.errorCode ?? '');
}

function previousAttempts(evidence: Evidence | null): number {
  const attempts = (evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { attempts?: unknown } | undefined)?.attempts;
  return typeof attempts === 'number' && attempts > 0 ? attempts : 0;
}

type Evidence = Record<string, unknown>;

export type DomainSearchRow = {
  id: string;
  name: string;
  domain: string | null;
  country_code: string | null;
  reason_code: string | null;
  evidence: Evidence | null;
  /** `tax:<número fiscal>` cuando la fila vino de un registro oficial. */
  provider_identifier?: string | null;
};

/** El número fiscal de la fila (`provider_identifier = tax:…`), o `null`. */
export function dispositionTaxId(row: Pick<DomainSearchRow, 'provider_identifier'>): string | null {
  const id = row.provider_identifier?.trim() ?? '';
  return id.startsWith('tax:') && id.length > 4 ? id.slice(4) : null;
}

export type FoundWebsite = {
  website: string;
  domain: string;
  verification: FoundVerification;
};

/** Resultado de revisar duplicados en SellUp + HubSpot (sólo lectura). */
export type DomainDuplicateCheck = { status: DuplicateStatus; summary: string };

function readString(evidence: Evidence | null, key: string): string | null {
  const value = evidence?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * «bbva-technology-en-america» → «Bbva Technology En America». Conserva el orden de
 * las palabras, que el `name` normalizado pierde. Quita el sufijo numérico que
 * LinkedIn agrega a slugs repetidos («unam_3», «prepa-en-linea-sep-286»).
 */
export function nameFromLinkedInSlug(linkedinUrl: string | null): string | null {
  if (!linkedinUrl) return null;
  const slug = normalizeLinkedInCompanyUrl(linkedinUrl).slug;
  if (!slug) return null;
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // slug con % suelto: se usa tal cual
  }
  const words = decoded
    .replace(/[-_.]+\d+$/, '')
    .split(/[-_.]+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  return words.map((w) => w.charAt(0).toLocaleUpperCase('es') + w.slice(1)).join(' ');
}

/**
 * El `name` de la disposición viene normalizado y desordenado («america bbva en
 * technology»). Primero el nombre original del proveedor; si falta (56 de 166 en
 * Prod el 01-10, todo el lote MX×Tec), el del slug de LinkedIn.
 */
export function dispositionDisplayName(row: Pick<DomainSearchRow, 'name' | 'evidence'>): string {
  return (
    readString(row.evidence, 'provider_raw_name') ??
    nameFromLinkedInSlug(readString(row.evidence, 'linkedin_url')) ??
    row.name
  );
}

export function dispositionLinkedInUrl(row: Pick<DomainSearchRow, 'evidence'>): string | null {
  const raw = readString(row.evidence, 'linkedin_url');
  if (!raw) return null;
  const normalized = normalizeLinkedInCompanyUrl(raw);
  return normalized.rejected ? null : normalized.normalized;
}

/** «Sitio no encontrado» con una versión vieja del buscador: vale un intento con la nueva. */
export function websiteNotFoundWithOlderSearch(evidence: Evidence | null): boolean {
  const rescue = evidence?.[CLAUDE_RESCUE_METADATA_KEY] as { decision?: unknown } | undefined;
  if (rescue?.decision !== 'website_not_found') return false;
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { search_version?: unknown } | undefined;
  return search?.search_version !== DOMAIN_SEARCH_VERSION;
}

/**
 * «Sitio no encontrado» que en realidad fue la CUENTA de Anthropic caída (saldo,
 * credenciales): no es un veredicto sobre la empresa y se vuelve a intentar.
 * Prod 06-10: 8 filas de Chile × Salud (5bbae7eb) agotaron sus 3 intentos así.
 */
export function websiteNotFoundByAccountError(evidence: Evidence | null): boolean {
  const rescue = evidence?.[CLAUDE_RESCUE_METADATA_KEY] as { decision?: unknown } | undefined;
  if (rescue?.decision !== 'website_not_found') return false;
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { reason?: unknown; error_code?: unknown } | undefined;
  return search?.reason === 'model_error' && ACCOUNT_ERROR_CODES.has(String(search?.error_code ?? ''));
}

export function isDomainSearchCandidate(row: Pick<DomainSearchRow, 'domain' | 'reason_code'>): boolean {
  return !row.domain && row.reason_code === DOMAIN_SEARCH_REASON_CODE;
}

/**
 * Formas societarias, conectores y palabras genéricas de las razones sociales de
 * registros oficiales («SERVICIOS EQUIFAX CHILE LIMITADA»). Sólo sirven para COMPARAR
 * con la página: nunca para buscar.
 */
const REGISTRY_NAME_FILLER_WORDS: ReadonlySet<string> = new Set([
  // formas societarias
  's', 'a', 'sa', 'spa', 'ltda', 'limitada', 'sociedad', 'anonima', 'cia', 'compania', 'eirl', 'srl', 'sac',
  'sas', 'cv', 'saa', 'sl', 'inc', 'llc', 'corp', 'company', 'corporation', 'corporacion',
  // conectores
  'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'en', 'para',
  // países
  'chile', 'mexico', 'colombia', 'peru', 'argentina', 'ecuador', 'uruguay', 'paraguay', 'bolivia', 'latam',
  // descriptores genéricos
  'asesorias', 'asesoria', 'servicios', 'servicio', 'sistemas', 'consultoria', 'ingenieria', 'inversiones',
  'comercial', 'comercializadora', 'empresa', 'empresas', 'grupo', 'group', 'holding', 'holdco', 'agencia',
  'profesionales', 'soluciones', 'negocio', 'negocios', 'corporativa', 'corporativo', 'importaciones',
  'internacional', 'chilena', 'comunicaciones', 'telecomunicaciones',
]);

/**
 * El nombre sin forma societaria ni palabras genéricas, o `null` si no cambia o no
 * queda nada distintivo (al menos 3 letras): «IBM CHILE SPA» → «ibm».
 */
export function registryNameCore(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // Letras sueltas fuera: «S. R. L.» llega como s, r, l (AR 17da92cf: «HEXACTA S. R. L.»).
  const kept = words.filter((w) => w.length > 1 && !REGISTRY_NAME_FILLER_WORDS.has(w));
  if (kept.length === 0 || kept.length === words.length) return null;
  const core = kept.join(' ');
  return core.replace(/\s/g, '').length >= 3 ? core : null;
}

/** Palabra con la que empieza el nombre propio de un establecimiento de salud. */
const HEALTH_FACILITY_START_RE = /\b(hospital|instituto|clinica|consultorio|cesfam|sanatorio|centro de salud)\b/;

/**
 * d9 — el establecimiento dentro de una razón social pública. Prod 06-10 (CL×Salud,
 * e4fec102): «SERVICIO DE SALUD HOSPITAL DE SAN FERNANDO», «SERVICIO DE SALUD NORTE
 * HOSPITAL ROBERTO DEL RIO»: la web (hospitalsanfernando.cl, hrrio.cl) lleva el nombre
 * del hospital, no el del Servicio de Salud que lo administra, y la comprobación no
 * pasaba. Devuelve «hospital de san fernando»; null si el nombre ya empieza así.
 */
export function healthFacilityName(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const match = HEALTH_FACILITY_START_RE.exec(plain);
  if (!match || match.index === 0) return null;
  // El nombre de la persona que lo bautiza no está en la web («… DR BENICIO ARZOLA MEDINA»).
  const facility = plain.slice(match.index).split(/ (?:dr|dra|doctor|doctora) /)[0].trim();
  // Sólo «hospital» (sin más) no identifica a nadie.
  return facility.split(' ').length >= 2 && facility.length > match[0].length + 2 ? facility : null;
}

/** «CL» → «Chile». El buscador entiende mejor el nombre que el código. */
export function countryNameFromCode(code: string | null | undefined): string | null {
  if (typeof code !== 'string' || !code.trim()) return null;
  const upper = code.trim().toUpperCase();
  return LATAM_COUNTRIES.find((c) => c.code === upper)?.name ?? null;
}

export function buildDomainFinderInput(
  row: DomainSearchRow,
  countryName: string | null,
  /** SOURCES-EC-CLOSE-2 — nombre comercial / sigla oficial del mismo número fiscal. */
  officialNames: readonly string[] = [],
): DomainFinderInput {
  const displayName = dispositionDisplayName(row);
  const names = [row.name, nameFromLinkedInSlug(readString(row.evidence, 'linkedin_url'))].filter(
    (n): n is string => !!n,
  );
  const cores = [displayName, ...names].map(registryNameCore).filter((n): n is string => !!n);
  const facilities = [displayName, ...names].map(healthFacilityName).filter((n): n is string => !!n);
  const official = officialNames.map((n) => n.trim()).filter((n) => n.length >= 3);
  return {
    name: displayName,
    alternateNames: [...new Set([...names, ...cores, ...facilities, ...official])],
    // La marca oficial es como se conoce a la empresa («NETLIFE», no «MEGADATOS»).
    searchHint: official[0] ?? cores[0] ?? null,
    countryName: countryName ?? countryNameFromCode(row.country_code),
    countryCode: row.country_code,
    linkedinUrl: dispositionLinkedInUrl(row),
  };
}

/** Sitio ya encontrado y comprobado en una corrida anterior (no se vuelve a pagar). */
export function readFoundWebsite(evidence: Evidence | null): FoundWebsite | null {
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as
    | { found?: unknown; website?: unknown; domain?: unknown; verification?: unknown }
    | undefined;
  if (search?.found !== true) return null;
  if (typeof search.website !== 'string' || typeof search.domain !== 'string') return null;
  if (!(VERIFICATIONS as readonly unknown[]).includes(search.verification)) return null;
  return { website: search.website, domain: search.domain, verification: search.verification as FoundVerification };
}

/**
 * La web que Claude propuso y no pudimos abrir, como PISTA sin confirmar. Sólo si:
 *  1. la búsqueda terminó en `page_unreachable` con una URL propuesta;
 *  2. la fila viene de un registro oficial CON número fiscal (buscador gratuito);
 *  3. no es una plataforma (LinkedIn, directorios, redes…);
 *  4. el dominio lleva el nombre de la empresa (`domainCarriesName`).
 * Después pasa igual por duplicados (SellUp + HubSpot) y por la clasificación.
 */
export function unverifiedWebsiteHint(
  row: Pick<DomainSearchRow, 'name' | 'evidence' | 'country_code' | 'domain' | 'reason_code' | 'id'>,
  outcome: DomainFinderOutcome,
): FoundWebsite | null {
  if (outcome.found || outcome.reason !== 'page_unreachable' || !outcome.claimedUrl) return null;
  if (row.evidence?.tax_identifier_present !== true) return null;
  const domain = normalizeDomain(outcome.claimedUrl);
  if (!domain) return null;
  if (!evaluateExternalPlatformGate(outcome.claimedUrl, dispositionDisplayName(row)).allowed) return null;
  const input = buildDomainFinderInput(row as DomainSearchRow, null);
  if (!domainCarriesName(domain, [input.name, ...(input.alternateNames ?? [])])) return null;
  return { website: `https://${domain}`, domain, verification: UNVERIFIED_HINT_VERIFICATION };
}

const GOVERNMENT_HOST = /\.(gob|gov|mil)(\.[a-z]{2})?$/;
/** Sufijos de país que una marca suele pegar a su dominio («heyecuador», «cns-ec»). */
/**
 * Lo que la web de una marca puede pegar a su nombre, POR PAÍS («netlife.ec»,
 * «dismatecbolivia.com»). Por país para que una sigla corta de Ecuador no se
 * verifique con «<sigla>bo.com» ni una de Bolivia con «<sigla>ec» (SOURCES-BO-CLOSE-1).
 */
const COUNTRY_LABEL_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  EC: ['', 'ecuador', 'ec'],
  BO: ['', 'bolivia', 'bo'],
};

/** Sufijos del país de la fila; sin país conocido, sólo la etiqueta exacta. */
function countryLabelSuffixes(countryCode: string): readonly string[] {
  return COUNTRY_LABEL_SUFFIXES[countryCode.trim().toUpperCase()] ?? [''];
}
const compactName = (text: string): string =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * SOURCES-EC-CLOSE-2 — la web propuesta es el nombre comercial o la sigla OFICIAL de
 * ese número fiscal. Sólo si:
 *  1. el dominio es registrable, no es de gobierno ni una plataforma (redes, directorios);
 *  2. su etiqueta propia, sin guiones, es EXACTAMENTE el nombre oficial compactado (3+
 *     letras), o ese nombre + «ecuador»/«ec» («netlife.ec» ← NETLIFE, «teuno.com» ← TE
 *     UNO, «cns-ec.com» ← CNS). Nada de parecidos: «point.com.ec» ← POINT TECHNOLOGY no.
 * Después pasa igual por duplicados (SellUp + HubSpot) y por la clasificación.
 */
export function officialTradeNameWebsite(
  claimedUrl: string | null | undefined,
  officialNames: readonly string[],
  displayName: string,
  /** País de la fila; Ecuador por defecto (su comportamiento de siempre). */
  countryCode = 'EC',
): FoundWebsite | null {
  if (!claimedUrl || officialNames.length === 0) return null;
  const domain = normalizeDomain(claimedUrl);
  if (!domain || GOVERNMENT_HOST.test(domain)) return null;
  if (!evaluateExternalPlatformGate(claimedUrl, displayName).allowed) return null;
  const parts = domain.split('.');
  const registrable = parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'net', 'org', 'edu', 'gob', 'gov', 'co', 'info'].includes(parts[parts.length - 2])
    ? parts.slice(-3)
    : parts.slice(-2);
  const label = compactName(registrable[0] ?? '');
  if (label.length < 3) return null;
  const matches = officialNames.some((name) => {
    const core = compactName(name);
    return core.length >= 3 && countryLabelSuffixes(countryCode).some((suffix) => label === `${core}${suffix}`);
  });
  if (!matches) return null;
  const host = registrable.join('.');
  return { website: `https://${host}`, domain: host, verification: OFFICIAL_TRADE_NAME_VERIFICATION };
}

/**
 * AGENT1-RESCUE-SUBSIDIARY-WITHOUT-WEB-1 (dueña 07-10: «sí, pero sólo si es un buen
 * prospecto, no cualquiera sin web»). Prod 07-10, Costa Rica × Servicios (47f4c893):
 * AMAZON SUPPORT SERVICES COSTA RICA → amazon.com, DOLE SHARED SERVICES → dole.com,
 * rechazadas con `identity_not_confirmed` porque la portada de la MATRIZ no nombra a
 * la filial. La web global NUNCA se acepta como la de la filial (chocaría con la misma
 * marca en otros países); sólo prueba que la filial es del grupo cuando el dominio es
 * la primera palabra propia de su razón social (o las dos primeras juntas:
 * «KIMBERLY – CLARK» → kimberly-clark.com). Nunca gobierno ni plataformas.
 */
export type ParentGroupWebsite = { website: string; domain: string };

export function parentGroupWebsite(
  row: Pick<DomainSearchRow, 'name' | 'evidence'>,
  outcome: DomainFinderOutcome,
): ParentGroupWebsite | null {
  if (outcome.found || outcome.reason !== 'identity_not_confirmed' || !outcome.claimedUrl) return null;
  if (row.evidence?.tax_identifier_present !== true) return null;
  const legalName = dispositionDisplayName(row as DomainSearchRow);
  const domain = normalizeDomain(outcome.claimedUrl);
  if (!domain || GOVERNMENT_HOST.test(domain)) return null;
  if (!evaluateExternalPlatformGate(outcome.claimedUrl, legalName).allowed) return null;
  const core = registryNameCore(legalName) ?? legalName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const words = core.split(/\s+/).map(compactName).filter(Boolean);
  const first = words[0] ?? '';
  if (first.length < 4 || REGISTRY_DESCRIPTOR_WORDS.has(first)) return null;
  const parts = domain.split('.');
  const registrable =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'net', 'org', 'co'].includes(parts[parts.length - 2])
      ? parts.slice(-3)
      : parts.slice(-2);
  const label = compactName(registrable[0] ?? '');
  const matches = label === first || (words.length > 1 && label === `${first}${words[1]}`);
  if (!matches) return null;
  const host = registrable.join('.');
  return { website: `https://${host}`, domain: host };
}

/** Clave de la metadata/evidencia con la web de la matriz (nunca es la web del candidato). */
export const PARENT_GROUP_WEBSITE_KEY = 'parent_group_website';

/** Primeras palabras de razón social que describen el giro, no a la empresa. */
const REGISTRY_DESCRIPTOR_WORDS: ReadonlySet<string> = new Set([
  'distribuidora', 'importadora', 'exportadora', 'constructora', 'industrial', 'industrias', 'industria',
  'laboratorios', 'laboratorio', 'farmaceutica', 'transportes', 'transporte', 'agricola', 'hospital', 'clinica',
  'banco', 'cooperativa', 'universidad', 'colegio', 'unidad', 'instituto', 'centro', 'consorcio', 'compania',
  'fabrica', 'productora', 'procesadora', 'tecnologia', 'tecnologias', 'technologies', 'technology', 'software',
  'electronica', 'electrica', 'seguridad', 'telecomunicaciones', 'comercializadora', 'operadora', 'administradora',
]);
/** Lo que una marca suele pegar a su nombre en la razón social («DEVSU» + «SOFTWARE»). */
const REGISTRY_WORD_SUFFIXES = ['software', 'soft', 'solutions', 'tech', 'technologies', 'group', 'ecuador', 'ec', 'corp', 'consulting', 'systems', 'sistemas', 'digital', 'labs'] as const;

/**
 * SOURCES-EC-CLOSE-2 — la web propuesta es la primera palabra propia de la razón social
 * (5+ letras, no un descriptor del giro): la etiqueta del dominio es esa palabra, esa
 * palabra + «ecuador»/«ec», o la palabra sin un sufijo de marca («devsu» ←
 * «devsusoftware»). Nunca gobierno ni plataformas.
 */
export function registryFirstWordWebsite(
  claimedUrl: string | null | undefined,
  legalName: string,
  /** País de la fila; Ecuador por defecto (su comportamiento de siempre). */
  countryCode = 'EC',
): FoundWebsite | null {
  if (!claimedUrl) return null;
  const core = registryNameCore(legalName) ?? legalName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const first = compactName(core.split(/\s+/)[0] ?? '');
  if (first.length < 5 || REGISTRY_DESCRIPTOR_WORDS.has(first)) return null;
  const domain = normalizeDomain(claimedUrl);
  if (!domain || GOVERNMENT_HOST.test(domain)) return null;
  if (!evaluateExternalPlatformGate(claimedUrl, legalName).allowed) return null;
  const parts = domain.split('.');
  const registrable =
    parts.length >= 3 && parts[parts.length - 1].length === 2 && ['com', 'net', 'org', 'edu', 'co', 'info'].includes(parts[parts.length - 2])
      ? parts.slice(-3)
      : parts.slice(-2);
  const label = compactName(registrable[0] ?? '');
  const matches =
    countryLabelSuffixes(countryCode).some((suffix) => label === `${first}${suffix}`) ||
    (label.length >= 5 && REGISTRY_WORD_SUFFIXES.some((suffix) => first === `${label}${suffix}`));
  if (!matches) return null;
  const host = registrable.join('.');
  return { website: `https://${host}`, domain: host, verification: REGISTRY_FIRST_WORD_VERIFICATION };
}

/** La web que Claude propuso en una búsqueda anterior que no pasó la comprobación. */
export function previousClaimedUrl(evidence: Evidence | null): string | null {
  const search = evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { found?: unknown; claimed_url?: unknown } | undefined;
  if (search?.found !== false) return null;
  return typeof search.claimed_url === 'string' && search.claimed_url.trim() ? search.claimed_url.trim() : null;
}

/**
 * SOURCES-EC-CLOSE-2 — «sitio no encontrado» de una fila con número fiscal de un país
 * con nombres oficiales, buscada ANTES de usarlos: vale UNA vuelta más (primero sin
 * pagar, con la web que Claude ya había propuesto).
 */
export function websiteNotFoundBeforeOfficialNames(
  row: Pick<DomainSearchRow, 'country_code' | 'evidence' | 'provider_identifier'>,
): boolean {
  const rescue = row.evidence?.[CLAUDE_RESCUE_METADATA_KEY] as { decision?: unknown } | undefined;
  if (rescue?.decision !== 'website_not_found') return false;
  if (!OFFICIAL_NAME_COUNTRIES.has((row.country_code ?? '').toUpperCase())) return false;
  if (dispositionTaxId(row) === null) return false;
  const search = row.evidence?.[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as { official_names_checked?: unknown } | undefined;
  return search?.official_names_checked !== true;
}

/**
 * Lo que ve el vendedor en «Validación del sitio web»: para una pista, «Inferido» + el
 * dominio, nunca «Verificado»; para la marca oficial del mismo RUC, «Verificado».
 */
export function buildUnverifiedHintWebsiteVerification(found: FoundWebsite): Record<string, unknown> | null {
  if (found.verification === OFFICIAL_TRADE_NAME_VERIFICATION) {
    // SOURCES-EC-CLOSE-2 — comprobada por el registro oficial, no por la página.
    return {
      status: 'verified',
      domain: found.domain,
      confidence: 80,
      source: CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
      reason: 'El registro oficial (SRI / Superintendencia) lista esta marca para el mismo RUC.',
    };
  }
  if (found.verification === REGISTRY_FIRST_WORD_VERIFICATION) {
    return {
      status: 'inferred',
      domain: found.domain,
      confidence: 50,
      source: CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
      reason: 'Inferido: el dominio es el nombre de la razón social oficial, pero la página no lo confirmó. Verifícalo antes de aprobar.',
    };
  }
  if (found.verification !== UNVERIFIED_HINT_VERIFICATION) return null;
  return {
    status: 'inferred',
    domain: found.domain,
    confidence: 30,
    source: CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY,
    reason: 'Pista sin confirmar: Claude encontró este sitio pero no se pudo abrir para comprobarlo. Verifícalo antes de aprobar.',
  };
}

export function buildFoundEvidence(evidence: Evidence | null, found: FoundWebsite, searchedAt: string): Evidence {
  return {
    ...(evidence ?? {}),
    [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      search_version: DOMAIN_SEARCH_VERSION,
      searched_at: searchedAt,
      found: true,
      website: found.website,
      domain: found.domain,
      verification: found.verification,
    },
  };
}

/**
 * La empresa se QUEDA en Descartadas por la búsqueda del sitio (no encontrado, o ya
 * existe en SellUp/HubSpot). Un error pasajero se reintenta hasta DOMAIN_SEARCH_MAX_ATTEMPTS
 * búsquedas en total; lo demás es final.
 */
export function buildDomainSearchStaysEvidence(
  evidence: Evidence | null,
  params:
    | { kind: 'not_found'; outcome: Extract<DomainFinderOutcome, { found: false }> }
    | { kind: 'duplicate'; found: FoundWebsite; duplicate: DomainDuplicateCheck },
  decidedAt: string,
  /** SOURCES-EC-CLOSE-2 — la búsqueda ya usó los nombres oficiales: no se repite por ellos. */
  options: { officialNamesChecked?: boolean } = {},
): Evidence {
  // Un error de la cuenta no es un intento de buscar ESTA empresa: no se cuenta.
  const accountError = params.kind === 'not_found' && isAccountLevelModelError(params.outcome);
  const attempts = previousAttempts(evidence) + (params.kind === 'not_found' && !accountError ? 1 : 0);
  const base = params.kind === 'duplicate' ? buildFoundEvidence(evidence, params.found, decidedAt) : { ...(evidence ?? {}) };
  const search =
    params.kind === 'not_found'
      ? {
          contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
          search_version: DOMAIN_SEARCH_VERSION,
          searched_at: decidedAt,
          found: false,
          attempts,
          reason: params.outcome.reason,
          claimed_url: params.outcome.claimedUrl ?? null,
          error_code: params.outcome.errorCode ?? null,
          ...(options.officialNamesChecked ? { official_names_checked: true } : {}),
        }
      : {
          ...(base[CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY] as Evidence),
          duplicate_status: params.duplicate.status,
          duplicate_summary: params.duplicate.summary,
        };
  const retryable =
    accountError ||
    (params.kind === 'not_found' && TRANSIENT_REASONS.has(params.outcome.reason) && attempts < DOMAIN_SEARCH_MAX_ATTEMPTS);
  return {
    ...base,
    [CLAUDE_DOMAIN_SEARCH_EVIDENCE_KEY]: search,
    [CLAUDE_RESCUE_METADATA_KEY]: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      decided_at: decidedAt,
      decision: retryable ? 'retryable' : params.kind === 'duplicate' ? 'duplicate' : 'website_not_found',
    },
  };
}

/** Columnas del candidato nuevo: nombre original, sitio comprobado y LinkedIn. */
export function buildFoundWebsiteColumns(row: DomainSearchRow, found: FoundWebsite): Record<string, unknown> {
  const linkedinUrl = dispositionLinkedInUrl(row);
  return {
    name: dispositionDisplayName(row),
    domain: found.domain,
    website: found.website,
    ...(linkedinUrl ? { linkedin_url: linkedinUrl } : {}),
  };
}

export function buildDomainSearchUsageLog(
  outcome: DomainFinderOutcome,
  context: { batchId: string; dispositionId: string; triggeredBy: string | null; searchedAt: string; durationMs: number },
): LogProviderUsageInput | null {
  if (!outcome.usage) return null;
  const isError = !outcome.found && outcome.reason === 'model_error';
  const errorCode = outcome.found ? undefined : outcome.errorCode ?? undefined;
  return {
    batch_id: context.batchId,
    usage_key: `${CLAUDE_DOMAIN_SEARCH_OPERATION_KEY}:${context.dispositionId}:${context.searchedAt}`,
    provider_key: CLAUDE_CLASSIFIER_PROVIDER_KEY,
    operation_key: CLAUDE_DOMAIN_SEARCH_OPERATION_KEY,
    model: outcome.usage.model,
    input_tokens: outcome.usage.inputTokens,
    output_tokens: outcome.usage.outputTokens,
    results_returned: outcome.found ? 1 : 0,
    estimated_cost_usd: outcome.usage.estimatedCostUsd,
    status: isError && errorCode === 'rate_limited' ? 'rate_limited' : isError ? 'error' : 'success',
    error_code: errorCode,
    duration_ms: context.durationMs,
    triggered_by: context.triggeredBy ?? undefined,
    metadata: {
      contract_version: CLAUDE_CLASSIFIER_CONTRACT_VERSION,
      flow: 'claude_rescue',
      disposition_id: context.dispositionId,
      found: outcome.found,
      reason: outcome.found ? outcome.verification : outcome.reason,
      web_search_requests: outcome.usage.webSearchRequests,
      pricing_source: outcome.usage.pricingSource,
    },
  };
}
