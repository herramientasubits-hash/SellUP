/**
 * Pre-LLM Result Filter — Hito 16W.1
 *
 * Classifier barato (sin IA, sin APIs) que descarta resultados
 * que claramente NO son empresas candidatas antes de enviarlos al LLM evaluator.
 * Reduce gasto de tokens y mejora calidad del pipeline.
 *
 * Complementa el noise-filter existente: opera sobre resultados que ya
 * pasaron el noise-filter de URL/dominio y detecta señales de contenido
 * editorial en títulos y snippets que escapan a ese primer filtro.
 *
 * Reglas críticas:
 * - Sin IA ni llamadas externas.
 * - Sin escritura en DB ni en candidatos.
 * - Sin imports de providers externos.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type PreLLMSourceType =
  | 'company_candidate'
  | 'content_article'
  | 'content_platform'       // Hito 16W.4 — Scribd, SlideShare, Medium, Notion, etc.
  | 'directory'
  | 'media'
  | 'job_board'
  | 'association'
  | 'government'
  | 'education'
  | 'social'
  | 'marketplace'
  | 'unknown';

export type PreLLMClassification = {
  shouldPassToLLM: boolean;
  sourceType: PreLLMSourceType;
  confidence: number;
  reasons: string[];
};

export type PreLLMFilterSummary = {
  enabled: true;
  total_input_results: number;
  passed_to_llm: number;
  filtered_out: number;
  by_source_type: Partial<Record<PreLLMSourceType, number>>;
  sample_filtered: Array<{
    title: string;
    domain: string;
    source_type: string;
    reasons: string[];
  }>;
};

// ─── Signal lists ─────────────────────────────────────────────────────────────

/**
 * Señales fuertes en el TÍTULO que indican artículo editorial con alta certeza.
 * Una sola coincidencia es suficiente para descartar.
 */
const STRONG_ARTICLE_TITLE_SIGNALS = [
  'qué es',
  'que es',
  'cómo funciona',
  'como funciona',
  'qué son',
  'que son',
  'artículo especial',
  'articulo especial',
  'retos y logros',
  'tendencias del',
  'ventajas y desventajas',
  'todo lo que debes saber',
  'lo que necesitas saber',
  'qué necesitas saber',
];

/**
 * Señales débiles de artículo. Dos o más en el título indican artículo.
 * Una sola no es suficiente (evita falsos positivos en páginas de empresa).
 */
const WEAK_ARTICLE_TEXT_SIGNALS = [
  'inclusión financiera',
  'inclusion financiera',
  'para tu empresa',
  'para tu negocio',
  'para las empresas',
  'guía de',
  'guia de',
  'beneficios del',
  'beneficios de la',
  'beneficios de los',
  'beneficios y',
  'cómo elegir',
  'como elegir',
  'mejores prácticas',
  'mejores practicas',
];

/** Paths de contenido que indican artículo, no homepage corporativa. */
const CONTENT_PATH_SIGNALS = [
  '/blog/',
  '/noticias/',
  '/news/',
  '/articulo/',
  '/article/',
  '/post/',
  '/guia/',
  '/guide/',
  '/ranking/',
  '/directorio/',
];

/** Señales positivas de empresa en path — aumentan confianza de candidato. */
const POSITIVE_PATH_SIGNALS = [
  '/nosotros',
  '/quienes-somos',
  '/servicios',
  '/soluciones',
  '/contacto',
  '/clientes',
  '/casos-de-exito',
  '/about',
  '/empresa',
  '/company',
  '/contact',
];

/** Señales positivas en título/snippet que refuerzan candidato corporativo. */
const POSITIVE_TEXT_SIGNALS = [
  'soluciones',
  'servicios',
  'nosotros',
  'clientes',
  'casos de éxito',
  'casos de exito',
  'contacto',
  'corporativo',
  'plataforma',
  'consultoría',
  'consultoria',
  'implementación',
  'implementacion',
  'ciberseguridad',
  'automatización',
  'automatizacion',
];

// Subset de dominios de medios conocidos (complementa noise-filter).
// domainMatchesSet() cubre subdominios: yahoo.com bloquea finance.yahoo.com,
// es-us.noticias.yahoo.com, etc.
const MEDIA_DOMAINS = new Set([
  // Aggregadores / portales globales de noticias
  'yahoo.com',          // cubre noticias.yahoo.com, es-us.noticias.yahoo.com, finance.yahoo.com
  'bloomberg.com',
  'reuters.com',
  'forbes.com',         // cubre forbes.com.co
  'businesswire.com',
  'prnewswire.com',
  'infobae.com',
  // Medios Colombia
  'dinero.com', 'semana.com', 'eltiempo.com', 'portafolio.co',
  'larepublica.co', 'elespectador.com', 'valoraanalitik.com',
  'enter.co', 'impactotic.co', 'colombiadigital.net',
  'pulzo.com', 'kienyke.com',
]);

// Subset de dominios de marketplace/directorio conocidos
const MARKETPLACE_DOMAINS = new Set([
  'capterra.com', 'capterra.co', 'g2.com', 'comparasoftware.com',
  'clutch.co', 'techbehemoths.com', 'goodfirms.co', 'sortlist.com',
  'crunchbase.com', 'f6s.com', 'tracxn.com', 'dealroom.co',
  'connectamericas.com', 'lasempresas.com.co',
  'guiatic.com', 'paginasamarillas.com.co', 'einforma.com', 'einforma.co',
]);

// Plataformas de contenido y documentos — Hito 16W.4
// Estos dominios alojan documentos, presentaciones o artículos de terceros,
// no son sedes corporativas de empresas candidatas.
// domainMatchesSet() cubre subdomains (es.scribd.com → scribd.com).
const CONTENT_PLATFORM_DOMAINS = new Set([
  'scribd.com',
  'slideshare.net',
  'issuu.com',
  'medium.com',
  'substack.com',
  'notion.site',
  'docs.google.com',
  'drive.google.com',
  'academia.edu',
  'researchgate.net',
  'prezi.com',
  'calameo.com',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractPath(url: string): string {
  try { return new URL(url).pathname.toLowerCase(); }
  catch { return ''; }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function domainMatchesSet(domain: string, set: Set<string>): boolean {
  if (set.has(domain)) return true;
  for (const entry of set) {
    if (domain.endsWith(`.${entry}`)) return true;
  }
  return false;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Clasifica un resultado de búsqueda antes de enviarlo al LLM evaluator.
 * Completamente determinístico — sin IA ni llamadas externas.
 *
 * Prioridad de señales:
 *   1. Dominio conocido (media, marketplace, gov, edu)
 *   2. Path de contenido (/blog/, /noticias/, etc.)
 *   3. Señales fuertes de artículo en título
 *   4. Señales positivas de empresa (path o texto)
 *   5. Dos señales débiles de artículo en título
 *   6. Default → unknown → pasa al LLM
 */
export function classifySearchResultForProspecting(result: {
  title: string;
  url: string;
  domain?: string | null;
  snippet?: string | null;
}): PreLLMClassification {
  const reasons: string[] = [];
  const titleLower = (result.title ?? '').toLowerCase();
  const snippetLower = (result.snippet ?? '').toLowerCase();
  const path = extractPath(result.url);
  const domain = result.domain ?? extractDomain(result.url);

  // ── 1. Clasificaciones rápidas por dominio ────────────────────────────────

  if (domain) {
    if (domain.endsWith('.gov.co') || domain.endsWith('.gob.co')) {
      reasons.push(`Dominio gubernamental: ${domain}`);
      return { shouldPassToLLM: false, sourceType: 'government', confidence: 0.99, reasons };
    }
    if (domain.endsWith('.edu.co') || domain.endsWith('.edu')) {
      reasons.push(`Dominio educativo: ${domain}`);
      return { shouldPassToLLM: false, sourceType: 'education', confidence: 0.99, reasons };
    }
    if (domainMatchesSet(domain, MEDIA_DOMAINS)) {
      reasons.push(`Dominio de medio/noticia: ${domain}`);
      return { shouldPassToLLM: false, sourceType: 'media', confidence: 0.95, reasons };
    }
    if (domainMatchesSet(domain, MARKETPLACE_DOMAINS)) {
      reasons.push(`Dominio de marketplace/directorio: ${domain}`);
      return { shouldPassToLLM: false, sourceType: 'marketplace', confidence: 0.95, reasons };
    }
    // Hito 16W.4 — plataformas de contenido/documentos (Scribd, SlideShare, etc.)
    if (domainMatchesSet(domain, CONTENT_PLATFORM_DOMAINS)) {
      reasons.push(`Plataforma de contenido/documentos: ${domain}`);
      return { shouldPassToLLM: false, sourceType: 'content_platform', confidence: 0.99, reasons };
    }
  }

  // ── 2. Path de contenido editorial ───────────────────────────────────────

  const matchedContentPath = CONTENT_PATH_SIGNALS.find((seg) => path.includes(seg));
  if (matchedContentPath) {
    reasons.push(`Path de contenido editorial: ${matchedContentPath}`);
    return { shouldPassToLLM: false, sourceType: 'content_article', confidence: 0.90, reasons };
  }

  // ── 3. Señal fuerte de artículo en título (una sola es suficiente) ────────

  const strongSignal = STRONG_ARTICLE_TITLE_SIGNALS.find((s) => titleLower.includes(s));
  if (strongSignal) {
    reasons.push(`Señal fuerte de artículo en título: "${strongSignal}"`);
    return { shouldPassToLLM: false, sourceType: 'content_article', confidence: 0.87, reasons };
  }

  // ── 4. Señales positivas de empresa (evita filtrar candidatos legítimos) ──

  const positivePath = POSITIVE_PATH_SIGNALS.find((seg) => path.startsWith(seg));
  if (positivePath) {
    reasons.push(`Path de sitio oficial corporativo: ${positivePath}`);
    return { shouldPassToLLM: true, sourceType: 'company_candidate', confidence: 0.85, reasons };
  }

  const positiveText = POSITIVE_TEXT_SIGNALS.find(
    (s) => titleLower.includes(s) || snippetLower.includes(s)
  );

  // ── 5. Dos señales débiles de artículo en título ──────────────────────────

  const weakTitleMatches = WEAK_ARTICLE_TEXT_SIGNALS.filter((s) => titleLower.includes(s));

  if (weakTitleMatches.length >= 2) {
    reasons.push(`Múltiples señales débiles de artículo en título: ${weakTitleMatches.slice(0, 3).join(', ')}`);
    // If there's also a strong positive signal, give benefit of the doubt
    if (positiveText) {
      reasons.push(`Señal positiva de empresa también presente: "${positiveText}" → unknown`);
      return { shouldPassToLLM: true, sourceType: 'unknown', confidence: 0.50, reasons };
    }
    return { shouldPassToLLM: false, sourceType: 'content_article', confidence: 0.78, reasons };
  }

  // ── 6. Señal positiva de empresa en texto ────────────────────────────────

  if (positiveText) {
    reasons.push(`Señal de empresa en título/snippet: "${positiveText}"`);
    return { shouldPassToLLM: true, sourceType: 'company_candidate', confidence: 0.70, reasons };
  }

  // ── 7. Default: sin señales claras → pasa al LLM ─────────────────────────

  reasons.push('Sin señales claras — pasa a evaluación LLM');
  return { shouldPassToLLM: true, sourceType: 'unknown', confidence: 0.50, reasons };
}
