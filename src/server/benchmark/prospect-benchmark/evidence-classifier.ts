/**
 * Benchmark — Evidence Classifier (Hito 16AB.23.2)
 *
 * Clasifica la URL de evidencia de un candidato en niveles A-E según la jerarquía
 * de fuentes definida en el hito. Detecta evidencia circular y repetida.
 *
 * Sin llamadas externas. Completamente determinístico.
 */

import type { EvidenceClassification, EvidenceLevel } from './types';

// ─── Dominios Nivel A — Primaria ─────────────────────────────────────────────
// Sitio oficial de la empresa, LinkedIn corporativo, documentos corporativos,
// páginas de inversores, directorios de programas oficiales, Y Combinator.

const LEVEL_A_DOMAINS = new Set([
  'ycombinator.com',
  'prnewswire.com',
  'businesswire.com',
  'globenewswire.com',
  'sec.gov',
  // linkedin.com/company/ se maneja como caso especial (ver abajo)
]);

// ─── Dominios Nivel B — Autoridad alta ───────────────────────────────────────
// ProColombia, cámaras de comercio, Fedesoft, organismos oficiales,
// IBM PartnerPlus, medios financieros/tecnológicos reconocidos,
// comunicados oficiales de inversión.

const LEVEL_B_DOMAINS = new Set([
  'procolombia.co',
  'b2bmarketplace.procolombia.co',
  'fedesoft.com.co',
  'ccb.org.co',
  'camara.ccb.org.co',
  'confecamaras.co',
  'camaraedtech.com',
  'ibm.com',
  'partner.microsoft.com',
  'techcrunch.com',
  'bloomberg.com',
  'bloomberg.co',
  'reuters.com',
  'ft.com',
  'crunchbase.com',
  'emis.com',
  'valoraanalitik.com',
  'bloomberglinea.com',
  'eltiempo.com',
  'elcolombiano.com',
  'portafolio.co',
]);

// ─── Dominios Nivel C — Secundaria aceptable ─────────────────────────────────
// Directorios empresariales reconocidos, medios sectoriales,
// perfiles de empleo corporativos.

const LEVEL_C_DOMAINS = new Set([
  'guiatic.com',
  'elempleo.com',
  'computrabajo.com.co',
  'themanifest.com',
  'comparably.com',
  'glassdoor.com',
  'informacolombia.com',
  'bebee.com',
  'f6s.com',
  'nearshore-americas.com',
  'builtin.com',
  'clutch.co',
  'goodfirms.co',
  'itfirms.co',
  'softwarereviews.com',
]);

// ─── Dominios Nivel D — Débil ─────────────────────────────────────────────────
// Agregadores, rankings republicados, blogs genéricos,
// sitios que citan indirectamente otra fuente.

const LEVEL_D_DOMAINS = new Set([
  'yosoylatino.es',
  'ecosistemastartup.com',
  'revistaclevel.com',
  'latamstartup.co',
  'startupblink.com',
  'crunchbase-alternative.com',
]);

// ─── Dominios Nivel E — No aceptable ─────────────────────────────────────────
// Reddit, foros, contenido sin autor, títulos SEO, páginas sin identidad.

const LEVEL_E_DOMAINS = new Set([
  'reddit.com',
  'quora.com',
  'yahoo.com',
  'answers.com',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function extractRootDomain(url: string | null): string | null {
  const host = extractHostname(url);
  if (!host) return null;
  // Return base domain (last two parts)
  const parts = host.split('.');
  return parts.slice(-2).join('.');
}

function isLinkedInCompanyUrl(url: string | null): boolean {
  if (!url) return false;
  return /linkedin\.com\/company\/[a-z0-9\-_%]+/i.test(url);
}

function isOfficialWebsiteUrl(evidenceUrl: string | null, websiteUrl: string | null): boolean {
  if (!evidenceUrl || !websiteUrl) return false;
  const evHost = extractHostname(evidenceUrl);
  const siteHost = extractHostname(websiteUrl);
  if (!evHost || !siteHost) return false;
  return evHost === siteHost || evHost.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${evHost}`);
}

function isCircularEvidence(evidenceUrl: string | null, websiteUrl: string | null): boolean {
  // Circular = evidence_url tiene exactamente el mismo dominio que website
  // (usar el sitio web como única "evidencia" de sí mismo)
  if (!evidenceUrl || !websiteUrl) return false;
  const evHost = extractHostname(evidenceUrl);
  const siteHost = extractHostname(websiteUrl);
  return !!evHost && !!siteHost && evHost === siteHost;
}

// ─── Clasificación principal ──────────────────────────────────────────────────

export function classifyEvidenceUrl(
  evidenceUrl: string | null,
  websiteUrl: string | null,
): { level: EvidenceLevel; is_circular: boolean; reason: string } {
  if (!evidenceUrl) {
    return { level: 'E', is_circular: false, reason: 'Sin URL de evidencia' };
  }

  const isCircular = isCircularEvidence(evidenceUrl, websiteUrl);
  const host = extractHostname(evidenceUrl);
  const rootDomain = extractRootDomain(evidenceUrl);

  if (!host) {
    return { level: 'E', is_circular: false, reason: 'URL de evidencia no válida' };
  }

  // LinkedIn corporativo → Nivel A
  if (isLinkedInCompanyUrl(evidenceUrl)) {
    return { level: 'A', is_circular: false, reason: 'LinkedIn corporativo (/company/)' };
  }

  // Sitio oficial de la empresa — puede ser A pero marca como circular
  if (isOfficialWebsiteUrl(evidenceUrl, websiteUrl)) {
    // Official site used as evidence = valid A source, but circular
    return {
      level: 'A',
      is_circular: true,
      reason: 'Sitio oficial de la empresa (circular — mismo dominio que website)',
    };
  }

  // Nivel A explícito
  if (LEVEL_A_DOMAINS.has(host) || (rootDomain && LEVEL_A_DOMAINS.has(rootDomain))) {
    return { level: 'A', is_circular: false, reason: `Fuente primaria: ${host}` };
  }

  // Nivel B
  if (LEVEL_B_DOMAINS.has(host) || (rootDomain && LEVEL_B_DOMAINS.has(rootDomain))) {
    return { level: 'B', is_circular: false, reason: `Fuente de alta autoridad: ${host}` };
  }

  // Nivel C
  if (LEVEL_C_DOMAINS.has(host) || (rootDomain && LEVEL_C_DOMAINS.has(rootDomain))) {
    return { level: 'C', is_circular: false, reason: `Directorio o medio sectorial: ${host}` };
  }

  // Nivel D
  if (LEVEL_D_DOMAINS.has(host) || (rootDomain && LEVEL_D_DOMAINS.has(rootDomain))) {
    return { level: 'D', is_circular: false, reason: `Agregador o blog genérico: ${host}` };
  }

  // Nivel E
  if (LEVEL_E_DOMAINS.has(host) || (rootDomain && LEVEL_E_DOMAINS.has(rootDomain))) {
    return { level: 'E', is_circular: false, reason: `Fuente no aceptable: ${host}` };
  }

  // Desconocido — asignar C por defecto (sitio sin clasificación conocida)
  return { level: 'C', is_circular: isCircular, reason: `Fuente sin clasificación explícita: ${host}` };
}

// ─── Clasificación completa con detección de repetición ─────────────────────

/**
 * Clasifica la evidencia de todos los candidatos en un pool.
 * Detecta URLs repetidas entre candidatos distintos.
 *
 * @param candidates Lista de {name, evidence_url, website}
 * @returns Mapa nombre→EvidenceClassification
 */
export function classifyPoolEvidence(
  candidates: Array<{ name: string; evidence_url: string | null; website: string | null }>,
): Map<string, EvidenceClassification> {
  // Primero: contar frecuencia de cada URL de evidencia
  const urlFrequency = new Map<string, number>();
  for (const c of candidates) {
    if (c.evidence_url) {
      urlFrequency.set(c.evidence_url, (urlFrequency.get(c.evidence_url) ?? 0) + 1);
    }
  }

  const result = new Map<string, EvidenceClassification>();

  for (const c of candidates) {
    const { level, is_circular, reason } = classifyEvidenceUrl(c.evidence_url, c.website);
    const is_repeated = !!c.evidence_url && (urlFrequency.get(c.evidence_url) ?? 0) > 1;

    result.set(c.name, {
      level,
      is_circular,
      is_repeated,
      reason,
    });
  }

  return result;
}

// ─── Score de calidad de candidato ───────────────────────────────────────────

/**
 * Retorna un número 0-100 que representa la calidad relativa del candidato
 * para la selección final. Usado para ordenar el pool.
 */
export function candidateQualityScore(
  classification: EvidenceClassification,
  confidence: 'Alta' | 'Media' | 'Baja',
  isExternalDuplicate: boolean,
): number {
  if (isExternalDuplicate) return 0;
  if (confidence === 'Baja') return 0;

  const levelScore: Record<EvidenceLevel, number> = { A: 40, B: 30, C: 15, D: 5, E: 0 };
  let score = levelScore[classification.level];

  if (classification.is_circular) score -= 10;
  if (classification.is_repeated) score -= 5;

  if (confidence === 'Alta') score += 30;
  else if (confidence === 'Media') score += 15;

  return Math.max(0, score);
}
