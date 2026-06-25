/**
 * Content-Intermediary Gate — Hito v1.16K-H
 *
 * Detecta y bloquea candidatos que NO son vendedores directos:
 * - Sitios de contenido editorial / blogs
 * - Portales intermediarios o brokers
 *
 * Función pura. Sin llamadas externas. Sin escritura DB. Sin LLM. Sin Tavily.
 *
 * Flujo del Agente 1 (codificado aquí como referencia):
 *   discover → normalize → hard gates → duplicate checks
 *   → automatic country source enrichment
 *   → automatic LinkedIn company enrichment (cuando flag habilitado)
 *   → scoring / ICP / reviewability
 *   → persist only reviewable candidates   ← este gate actúa aquí
 *   → human approve / discard
 */

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type ContentIntermediaryReason =
  | 'blog_content_site'
  | 'not_a_direct_vendor'
  | 'content_or_intermediary_site';

export type ContentIntermediaryResult = {
  blocked: boolean;
  reasons: ContentIntermediaryReason[];
  confidence: number;
  signals: string[];
};

// ─── Señales de blog / contenido ─────────────────────────────────────────────

/** Detecta "blog" como componente en el nombre de empresa (incluye compuestos tipo "CiberBlog"). */
const BLOG_NAME_RE = /blog/i;

/** Detecta "blog" como componente de dominio (ciberblog.net, blog.empresa.com). */
const BLOG_DOMAIN_RE = /blog/i;

/**
 * Palabras que, si son el nombre completo del candidato o aparecen como
 * palabra aislada en él, indican que es un portal de contenido, no empresa.
 */
const CONTENT_ONLY_NAME_WORDS = new Set([
  'portal', 'directorio', 'medio', 'noticias', 'revista', 'blog',
]);

// ─── Señales de intermediario en título / snippet ─────────────────────────────

interface IntermediarySignal {
  pattern: string;
  reason: ContentIntermediaryReason;
}

const INTERMEDIARY_LANGUAGE: IntermediarySignal[] = [
  { pattern: 'te conectamos con partners', reason: 'not_a_direct_vendor' },
  { pattern: 'conectamos con partners', reason: 'not_a_direct_vendor' },
  { pattern: 'partners certificados', reason: 'not_a_direct_vendor' },
  { pattern: 'partners certificadas', reason: 'not_a_direct_vendor' },
  { pattern: 'marcas líderes a nivel mundial', reason: 'not_a_direct_vendor' },
  { pattern: 'marcas lideres a nivel mundial', reason: 'not_a_direct_vendor' },
  { pattern: 'somos un directorio', reason: 'content_or_intermediary_site' },
  { pattern: 'directorio de empresas', reason: 'content_or_intermediary_site' },
  { pattern: 'directorio de proveedores', reason: 'content_or_intermediary_site' },
  { pattern: 'somos un portal', reason: 'content_or_intermediary_site' },
  { pattern: 'buscador de proveedores', reason: 'content_or_intermediary_site' },
  { pattern: 'buscador de empresas', reason: 'content_or_intermediary_site' },
];

// ─── Señales de empresa directa (contra-señales) ─────────────────────────────

/**
 * Señales positivas que sugieren empresa directa, reducen falsos positivos.
 * Si el nombre/dominio tiene "blog" pero además tiene señales de empresa directa,
 * se permite pasar cuando la evidencia directa es fuerte.
 */
const DIRECT_VENDOR_SIGNALS_IN_NAME = [
  'software', 'technologies', 'tecnología', 'tecnologia', 'solutions', 'soluciones',
  'systems', 'sistemas', 'consulting', 'consultores', 'services', 'servicios',
  's.a.s', 's.a', 'ltda', 'corp', 'inc', 'group', 'grupo',
];

function hasDirectVendorSignalInName(name: string): boolean {
  const lower = name.toLowerCase();
  return DIRECT_VENDOR_SIGNALS_IN_NAME.some((sig) => lower.includes(sig));
}

// ─── Función principal ────────────────────────────────────────────────────────

export interface ContentIntermediaryInput {
  name: string;
  domain?: string | null;
  title?: string | null;
  snippet?: string | null;
  taxIdentifier?: string | null;
  linkedinUrl?: string | null;
  companySize?: string | null;
  hubspotMatchStatus?: string | null;
}

export function evaluateContentIntermediaryGate(
  input: ContentIntermediaryInput,
): ContentIntermediaryResult {
  const signals: string[] = [];
  const reasons = new Set<ContentIntermediaryReason>();

  const nameRaw = input.name.trim();
  const nameLower = nameRaw.toLowerCase();
  const domainLower = (input.domain ?? '').toLowerCase().replace(/^www\./, '');
  const titleLower = (input.title ?? '').toLowerCase();
  const snippetLower = (input.snippet ?? '').toLowerCase();
  const combinedText = `${titleLower} ${snippetLower}`;

  // ── Check 1: "blog" como palabra en el nombre de empresa ─────────────────
  if (BLOG_NAME_RE.test(nameRaw)) {
    // Contra-señal: si el nombre tiene evidencia fuerte de empresa directa
    // (e.g. "Blog Analytics Technologies S.A.S."), no bloquear solo por "blog".
    if (!hasDirectVendorSignalInName(nameLower)) {
      signals.push(`name_contains_blog:"${nameRaw}"`);
      reasons.add('blog_content_site');
    }
  }

  // ── Check 2: "blog" como componente del dominio ───────────────────────────
  if (domainLower && BLOG_DOMAIN_RE.test(domainLower)) {
    // Contra-señal: si el nombre es claramente una empresa real, el blog podría
    // ser solo el subdirectorio. Bloqueamos solo si el nombre también es débil.
    if (!hasDirectVendorSignalInName(nameLower)) {
      signals.push(`domain_contains_blog:"${domainLower}"`);
      reasons.add('blog_content_site');
    }
  }

  // ── Check 3: nombre completo es una palabra de contenido ─────────────────
  const nameWords = nameLower.split(/[\s,.\-_]+/).filter(Boolean);
  if (nameWords.length <= 2) {
    for (const word of nameWords) {
      if (CONTENT_ONLY_NAME_WORDS.has(word)) {
        signals.push(`name_is_content_word:"${word}"`);
        reasons.add('content_or_intermediary_site');
        break;
      }
    }
  }

  // ── Check 4: lenguaje de intermediario en título o snippet ────────────────
  for (const { pattern, reason } of INTERMEDIARY_LANGUAGE) {
    if (combinedText.includes(pattern)) {
      signals.push(`intermediary_pattern:"${pattern}"`);
      reasons.add(reason);
    }
  }

  const reasonsArray = Array.from(reasons);
  const blocked = reasonsArray.length > 0;
  const confidence = blocked
    ? Math.min(0.4 + signals.length * 0.2, 1.0)
    : 0.0;

  return { blocked, reasons: reasonsArray, confidence, signals };
}

// ─── Review flags builder — Hito v1.16K-H ────────────────────────────────────

export type ReviewFlag =
  | 'no_tax_id'
  | 'size_unknown'
  | 'enrichment_partial'
  | 'source_enrichment_no_match'
  | 'possible_intermediary'
  | 'possible_content_site'
  | 'not_recommended_for_approval';

export interface ReviewFlagsInput {
  taxIdentifier?: string | null;
  companySize?: string | null;
  sourceEnrichmentStatus?: string | null;
  contentGateResult?: ContentIntermediaryResult | null;
  existingFlags?: string[];
}

/**
 * Construye la lista de review_flags para un candidato que pasa los gates
 * pero necesita advertencias para el revisor humano.
 */
export function buildReviewFlags(input: ReviewFlagsInput): ReviewFlag[] {
  const flags = new Set<ReviewFlag>(
    (input.existingFlags ?? []).filter((f): f is ReviewFlag =>
      ['no_tax_id', 'size_unknown', 'enrichment_partial',
       'source_enrichment_no_match', 'possible_intermediary',
       'possible_content_site', 'not_recommended_for_approval'].includes(f),
    ),
  );

  if (!input.taxIdentifier) {
    flags.add('no_tax_id');
  }

  if (!input.companySize) {
    flags.add('size_unknown');
  }

  if (input.sourceEnrichmentStatus === 'no_match') {
    flags.add('source_enrichment_no_match');
  }

  const contentReasons = input.contentGateResult?.reasons ?? [];
  if (contentReasons.includes('not_a_direct_vendor')) {
    flags.add('possible_intermediary');
  }
  if (
    contentReasons.includes('blog_content_site') ||
    contentReasons.includes('content_or_intermediary_site')
  ) {
    flags.add('possible_content_site');
  }

  return Array.from(flags);
}

// ─── Pre-review enrichment metadata builder ───────────────────────────────────

export interface SourceEnrichmentAttempt {
  source: string;
  status: 'attempted' | 'no_match' | 'skipped' | 'error';
  reason?: string;
}

export interface PreReviewEnrichmentMetadata {
  status: 'attempted' | 'skipped' | 'partial' | 'no_sources';
  sources: SourceEnrichmentAttempt[];
  produced_tax_id: boolean;
  produced_size: boolean;
  produced_linkedin: boolean;
}

/**
 * Construye el objeto metadata.pre_review_enrichment que documenta
 * qué enriquecimiento automático se intentó antes de persistir el candidato.
 *
 * Esta función es puramente constructiva: acepta los resultados de los intentos
 * de enriquecimiento y los convierte en un resumen legible para el UI y auditoría.
 */
export function buildPreReviewEnrichmentMetadata(
  sources: SourceEnrichmentAttempt[],
  outcomes: { producedTaxId: boolean; producedSize: boolean; producedLinkedin: boolean },
): PreReviewEnrichmentMetadata {
  const attempted = sources.filter((s) => s.status === 'attempted' || s.status === 'no_match');
  const anyAttempted = attempted.length > 0;
  const anyMatch = sources.some((s) => s.status === 'attempted');

  const status: PreReviewEnrichmentMetadata['status'] = !anyAttempted
    ? 'no_sources'
    : anyMatch
    ? 'attempted'
    : 'partial';

  return {
    status,
    sources,
    produced_tax_id: outcomes.producedTaxId,
    produced_size: outcomes.producedSize,
    produced_linkedin: outcomes.producedLinkedin,
  };
}
