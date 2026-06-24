/**
 * Candidate Rich Profile — v1.16A
 *
 * Builder puro para metadata.rich_profile dentro de prospect_candidates.
 * Sin llamadas externas. Sin LLM. Sin Tavily. Sin Supabase.
 * cost_usd = 0 siempre en este hito.
 *
 * v1.16A mejoras sin costo:
 * - primary_source_type detecta official_website y article
 * - evidence_quality usa source type + LinkedIn signal
 * - description.short combina sourceTitle + sourceSnippet (max 280 chars)
 * - subindustry inferido de texto sin IA
 * - relationship_type auto-detecta technology_provider / content_provider
 * - executive_note factual basada en evidencia disponible
 * - completeness incluye has_company y has_subindustry
 */

import type { LinkedInEnrichmentMetadata } from './types';
import type { IcpSizeGateResult } from './icp-size-gate';

// ─── Tipo principal ──────────────────────────────────────────────────────────

export type CandidateRichProfileV1 = {
  schema_version: 'candidate_rich_profile_v1';

  company: {
    name: string;
    normalized_name?: string | null;
    website?: string | null;
    domain?: string | null;
    linkedin_url?: string | null;
  };

  classification: {
    country?: string | null;
    country_code?: string | null;
    industry?: string | null;
    subindustry?: string | null;
    relationship_type?: 'sales_prospect' | 'vendor' | 'partner' | 'content_provider' | 'technology_provider' | 'unknown';
    not_sales_prospect?: boolean;
  };

  location: {
    city?: string | null;
    hq_country?: string | null;
    source?: 'linkedin' | 'website' | 'snippet' | 'manual' | 'unknown';
  };

  size: {
    estimated_range?: string | null;
    status: 'confirmed' | 'estimated' | 'unknown';
    source?: 'linkedin' | 'website' | 'registry' | 'snippet' | 'manual' | 'unknown';
    notes?: string | null;
    icp_size_gate?: IcpSizeGateResult | null;
  };

  description: {
    short?: string | null;
    source?: 'website' | 'linkedin' | 'snippet' | 'llm_summary' | 'manual' | 'unknown';
  };

  evidence: {
    primary_url?: string | null;
    primary_source_type?: 'official_website' | 'linkedin_company' | 'registry' | 'directory' | 'article' | 'unknown';
    evidence_summary?: string | null;
    evidence_quality?: 'high' | 'medium' | 'low' | 'unknown';
    warnings?: string[];
  };

  confidence: {
    confidence_score?: number | null;
    fit_score?: number | null;
    confidence_level?: 'high' | 'medium' | 'low' | 'unknown';
    reasons?: string[];
  };

  notes: {
    executive_note?: string | null;
    review_note?: string | null;
    missing_fields?: string[];
    requires_human_review?: boolean;
  };

  provenance: {
    generated_at: string;
    generated_by: 'agent_1';
    enrichment_level: 'basic' | 'controlled' | 'deep';
    external_calls_used: boolean;
    cost_usd: number;
  };
};

// ─── Input ───────────────────────────────────────────────────────────────────

export type CandidateRichProfileInput = {
  name: string;
  website?: string | null;
  domain?: string | null;
  country?: string | null;
  countryCode?: string | null;
  industry?: string | null;
  subindustry?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
  sourceSnippet?: string | null;

  confidenceScore?: number | null;
  fitScore?: number | null;
  fitLabel?: 'high' | 'medium' | 'low' | 'reject' | null;
  fitReasons?: string[] | null;

  linkedInEnrichment?: LinkedInEnrichmentMetadata | null;

  countryEvidenceLevel?: 'strong' | 'weak' | 'query_only' | null;
  countryEvidenceSources?: string[] | null;
  countryEvidenceWarning?: string | null;

  evidencePolicyWarnings?: string[] | null;

  relationshipType?: 'sales_prospect' | 'vendor' | 'partner' | 'content_provider' | 'technology_provider' | 'unknown' | null;
  notSalesProspect?: boolean | null;

  clockFn?: () => string;
};

// ─── Completeness ────────────────────────────────────────────────────────────

export type CandidateRichProfileCompleteness = {
  has_company: boolean;
  has_website: boolean;
  has_linkedin: boolean;
  has_primary_evidence: boolean;
  has_description: boolean;
  has_subindustry: boolean;
  has_size: boolean;
  has_city: boolean;
  missing_fields: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractDomainFromUrl(urlOrDomain: string): string | null {
  try {
    const normalized = urlOrDomain.includes('://') ? urlOrDomain : `https://${urlOrDomain}`;
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function inferPrimarySourceType(
  sourceUrl: string | null | undefined,
  website?: string | null,
  domain?: string | null,
): CandidateRichProfileV1['evidence']['primary_source_type'] {
  if (!sourceUrl) return 'unknown';

  // LinkedIn company check
  if (/linkedin\.com\/company/i.test(sourceUrl)) return 'linkedin_company';

  // Official website: sourceUrl domain matches candidate's own domain
  const sourceDomain = extractDomainFromUrl(sourceUrl);
  const candidateDomain =
    domain
      ? domain.toLowerCase().replace(/^www\./, '')
      : website
        ? extractDomainFromUrl(website)
        : null;
  if (sourceDomain && candidateDomain && sourceDomain === candidateDomain) {
    return 'official_website';
  }

  // Registry sources
  if (/\.gov\b|registro[.-]|rut\.|registro-mercantil|cnpj|ruc\.|camara-de-comercio|supersociedades|sic\.gov/i.test(sourceUrl)) {
    return 'registry';
  }

  // Article / blog / news sources
  if (/\/blog\/|\/news\/|\/noticias\/|\/articulo\/|\/article\/|\/case-study\/|\/case-studies\/|blog\.|medium\.com|wordpress\.com|blogspot\.com|substack\.com/i.test(sourceUrl)) {
    return 'article';
  }

  // Directory / comparator sources
  if (/directorio|directory|amarillas|paginas-amarillas|clutch\.co|g2\.com|capterra\.com|trustpilot\.com|yelp\.com|foursquare\.com|getapp\.com|softwareadvice\./i.test(sourceUrl)) {
    return 'directory';
  }

  return 'unknown';
}

function inferEvidenceQuality(
  countryEvidenceLevel: 'strong' | 'weak' | 'query_only' | null | undefined,
  hasPrimaryUrl: boolean,
  primarySourceType: CandidateRichProfileV1['evidence']['primary_source_type'],
  hasLinkedIn: boolean,
): CandidateRichProfileV1['evidence']['evidence_quality'] {
  if (!hasPrimaryUrl) return 'unknown';

  const isOfficialWebsite = primarySourceType === 'official_website';
  const isLinkedInSource = primarySourceType === 'linkedin_company';
  const isLowQualitySource = primarySourceType === 'directory' || primarySourceType === 'article';

  // high: official website + strong country, OR LinkedIn enrichment found + official website
  if (isOfficialWebsite && countryEvidenceLevel === 'strong') return 'high';
  if (hasLinkedIn && isOfficialWebsite) return 'high';

  // medium: official website without strong country, OR linkedin source, OR strong country with other source
  if (isOfficialWebsite) return 'medium';
  if (isLinkedInSource) return 'medium';
  if (countryEvidenceLevel === 'strong') return 'medium';

  // low: directory/article, OR weak country evidence
  if (isLowQualitySource) return 'low';
  if (countryEvidenceLevel === 'weak') return 'low';

  return 'unknown';
}

function inferConfidenceLevel(
  score: number | null | undefined
): CandidateRichProfileV1['confidence']['confidence_level'] {
  if (score == null) return 'unknown';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  if (score > 0) return 'low';
  return 'unknown';
}

function buildDescriptionShort(
  sourceTitle?: string | null,
  sourceSnippet?: string | null,
): { short: string | null; source: CandidateRichProfileV1['description']['source'] } {
  if (!sourceTitle && !sourceSnippet) {
    return { short: null, source: 'unknown' };
  }

  if (sourceTitle && sourceSnippet) {
    const title = sourceTitle.trim();
    const snippet = sourceSnippet.trim();

    // Avoid duplicating if snippet already starts with the same content as title
    const titlePrefix = title.toLowerCase().slice(0, 40);
    const snippetStartsWithTitle = snippet.toLowerCase().startsWith(titlePrefix);

    let combined: string;
    if (snippetStartsWithTitle || title.length < 10) {
      combined = snippet;
    } else {
      combined = `${title}. ${snippet}`;
    }

    // Normalize spaces
    combined = combined.replace(/\s+/g, ' ').trim();

    if (combined.length > 280) {
      combined = combined.slice(0, 277) + '...';
    }

    return { short: combined, source: 'snippet' };
  }

  if (sourceSnippet) {
    const snippet = sourceSnippet.trim();
    return { short: snippet.length > 280 ? snippet.slice(0, 277) + '...' : snippet, source: 'snippet' };
  }

  // Only title
  const title = sourceTitle!.trim();
  return { short: title.length > 280 ? title.slice(0, 277) + '...' : title, source: 'snippet' };
}

// ─── Subindustry keyword map ──────────────────────────────────────────────────

const SUBINDUSTRY_KEYWORDS: Array<{ subindustry: string; keywords: string[] }> = [
  {
    subindustry: 'ERP',
    keywords: ['erp', 'enterprise resource planning', 'sap erp', 'oracle erp', 'netsuite', 'epicor', 'acumatica', 'odoo'],
  },
  {
    subindustry: 'CRM',
    keywords: ['crm', 'customer relationship management', 'salesforce crm', 'pipedrive', 'zoho crm', 'hubspot crm'],
  },
  {
    subindustry: 'HRTech',
    keywords: [
      'hrtech', 'hr tech', 'recursos humanos', 'rrhh', 'nómina', 'payroll',
      'talento humano', 'gestión del talento', 'workforce management', 'human resources software',
    ],
  },
  {
    subindustry: 'LMS',
    keywords: [
      'lms', 'learning management system', 'e-learning', 'elearning',
      'plataforma de aprendizaje', 'gestión del aprendizaje', 'moodle',
      'blackboard', 'canvas lms', 'sistema de aprendizaje',
    ],
  },
  {
    subindustry: 'SaaS B2B',
    keywords: ['saas b2b', 'software b2b', 'b2b saas'],
  },
  {
    subindustry: 'Martech / Salestech',
    keywords: [
      'martech', 'salestech', 'marketing automation', 'sales automation',
      'email marketing b2b', 'marketing b2b', 'automatización de marketing',
    ],
  },
  {
    subindustry: 'Fintech',
    keywords: [
      'fintech', 'finanzas digitales', 'pagos digitales', 'pagos en línea',
      'factura electrónica', 'facturación electrónica', 'pagos b2b',
    ],
  },
  {
    subindustry: 'HealthTech',
    keywords: [
      'healthtech', 'health tech', 'salud digital', 'telemedicina', 'telesalud',
    ],
  },
  {
    subindustry: 'RetailTech',
    keywords: [
      'retailtech', 'retail tech', 'e-commerce b2b', 'comercio electrónico b2b', 'retail software',
    ],
  },
];

function inferSubindustry(
  industry?: string | null,
  sourceTitle?: string | null,
  sourceSnippet?: string | null,
  existingSubindustry?: string | null,
): string | null {
  if (existingSubindustry) return existingSubindustry;

  const text = [industry, sourceTitle, sourceSnippet]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!text) return null;

  for (const { subindustry, keywords } of SUBINDUSTRY_KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw)) return subindustry;
    }
  }

  return null;
}

// ─── Relationship type auto-detection ────────────────────────────────────────

// Well-known names that indicate technology providers for UBITS context
const KNOWN_TECH_PROVIDER_NAMES = new Set([
  'hubspot', 'salesforce', 'zendesk', 'workday', 'servicenow',
  'datadog', 'snowflake', 'sap', 'oracle', 'microsoft', 'tableau',
]);

// Well-known names that indicate content/academic providers
const KNOWN_CONTENT_PROVIDER_NAMES = new Set([
  'harvard', 'stanford', 'ted', 'wobi', 'coursera', 'edx',
  'mit opencourseware', 'pluralsight', 'linkedin learning',
]);

function inferRelationshipTypeFromText(
  companyName: string,
  sourceTitle?: string | null,
  sourceSnippet?: string | null,
): 'technology_provider' | 'content_provider' | 'partner' | null {
  const nameLower = companyName.toLowerCase().trim();

  // Exact company name match against well-known providers
  if (KNOWN_TECH_PROVIDER_NAMES.has(nameLower)) return 'technology_provider';
  if (KNOWN_CONTENT_PROVIDER_NAMES.has(nameLower)) return 'content_provider';

  // Text signal search in title + snippet
  const fullText = [sourceTitle, sourceSnippet].filter(Boolean).join(' ').toLowerCase();
  if (!fullText) return null;

  // Partner signals (very explicit)
  if (/\b(alianza estratégica|partner oficial|socio estratégico|aliado comercial)\b/.test(fullText)) {
    return 'partner';
  }

  // Technology provider signals (require UBITS reference to be safe)
  if (/\b(proveedor tecnológico de ubits|plataforma tecnológica de ubits|herramienta de ubits|vendor de ubits)\b/.test(fullText)) {
    return 'technology_provider';
  }

  // Content provider signals (academic/catalog explicit reference)
  if (/\b(catálogo de contenidos|creador académico|editorial académica|publisher académico|contenidos e-learning para ubits)\b/.test(fullText)) {
    return 'content_provider';
  }

  return null;
}

function inferRelationshipType(
  input: Pick<CandidateRichProfileInput, 'name' | 'relationshipType' | 'notSalesProspect' | 'sourceTitle' | 'sourceSnippet'>
): {
  relationship_type: CandidateRichProfileV1['classification']['relationship_type'];
  not_sales_prospect?: boolean;
} {
  // Explicit non-default type takes priority
  if (input.relationshipType && input.relationshipType !== 'sales_prospect' && input.relationshipType !== 'unknown') {
    return {
      relationship_type: input.relationshipType,
      not_sales_prospect: true,
    };
  }

  // Explicit notSalesProspect flag
  if (input.notSalesProspect === true) {
    return {
      relationship_type: input.relationshipType ?? 'unknown',
      not_sales_prospect: true,
    };
  }

  // Explicit sales_prospect — respect it, skip auto-detection
  if (input.relationshipType === 'sales_prospect') {
    return { relationship_type: 'sales_prospect' };
  }

  // Auto-detect from company name and text evidence (only when no explicit type)
  const autoDetected = inferRelationshipTypeFromText(
    input.name,
    input.sourceTitle,
    input.sourceSnippet,
  );
  if (autoDetected) {
    return {
      relationship_type: autoDetected,
      not_sales_prospect: true,
    };
  }

  // Explicit unknown
  if (input.relationshipType === 'unknown') {
    return { relationship_type: 'unknown' };
  }

  // Default
  return { relationship_type: 'sales_prospect' };
}

function buildExecutiveNote(
  hasWebsite: boolean,
  hasLinkedIn: boolean,
  primarySourceType: CandidateRichProfileV1['evidence']['primary_source_type'] | undefined,
): string | null {
  const parts: string[] = [];

  if (hasWebsite && hasLinkedIn) {
    parts.push('Candidato con sitio web y LinkedIn encontrados');
  } else if (hasWebsite) {
    parts.push('Candidato con sitio web encontrado; sin perfil de LinkedIn verificado');
  } else if (hasLinkedIn) {
    parts.push('Candidato sin sitio web identificado; perfil de LinkedIn encontrado');
  } else {
    parts.push('Sin sitio web ni LinkedIn verificados');
  }

  if (primarySourceType === 'official_website') {
    parts.push('evidencia principal proviene del sitio oficial');
  } else if (primarySourceType === 'linkedin_company') {
    parts.push('evidencia principal es perfil de LinkedIn');
  } else if (primarySourceType === 'registry') {
    parts.push('evidencia proviene de registro oficial');
  } else if (primarySourceType === 'directory') {
    parts.push('evidencia proviene de directorio de empresas');
  } else if (primarySourceType === 'article') {
    parts.push('evidencia proviene de artículo o publicación');
  }

  if (parts.length === 0) return null;
  if (parts.length === 1) return `${parts[0]}.`;
  return `${parts[0]}; ${parts[1]}.`;
}

// ─── Builder principal ───────────────────────────────────────────────────────

export function buildCandidateRichProfileV1(
  input: CandidateRichProfileInput
): CandidateRichProfileV1 {
  const clock = input.clockFn ?? (() => new Date().toISOString());

  // LinkedIn: sólo de linkedInEnrichment.company_url si status=found
  const linkedInUrl =
    input.linkedInEnrichment?.status === 'found' &&
    input.linkedInEnrichment.company_url
      ? input.linkedInEnrichment.company_url
      : null;
  const hasLinkedIn = !!linkedInUrl;

  // Evidence
  const primaryUrl = input.sourceUrl ?? null;
  const primarySourceType = inferPrimarySourceType(primaryUrl, input.website, input.domain);
  const evidenceQuality = inferEvidenceQuality(
    input.countryEvidenceLevel,
    !!primaryUrl,
    primarySourceType,
    hasLinkedIn,
  );
  const evidenceWarnings: string[] = [];
  if (input.countryEvidenceWarning) evidenceWarnings.push(input.countryEvidenceWarning);
  if (input.evidencePolicyWarnings?.length) evidenceWarnings.push(...input.evidencePolicyWarnings);

  // Description: título + snippet, sin inventar
  const { short: descriptionShort, source: descriptionSource } = buildDescriptionShort(
    input.sourceTitle,
    input.sourceSnippet,
  );

  // Subindustry: inferida de señales existentes
  const inferredSubindustry = inferSubindustry(
    input.industry,
    input.sourceTitle,
    input.sourceSnippet,
    input.subindustry,
  );

  // Confidence
  const confidenceLevel = inferConfidenceLevel(input.confidenceScore);
  const confidenceReasons: string[] = [];
  if (input.fitReasons?.length) confidenceReasons.push(...input.fitReasons);

  // Relationship type
  const { relationship_type, not_sales_prospect } = inferRelationshipType({
    name: input.name,
    relationshipType: input.relationshipType,
    notSalesProspect: input.notSalesProspect,
    sourceTitle: input.sourceTitle,
    sourceSnippet: input.sourceSnippet,
  });

  // Missing fields para notes
  const missingFields: string[] = [];
  if (!input.website && !input.domain) missingFields.push('website');
  if (!linkedInUrl) missingFields.push('linkedin_url');
  if (!descriptionShort) missingFields.push('description');
  if (!inferredSubindustry) missingFields.push('subindustry');
  // ciudad y tamaño no disponibles sin llamadas externas
  missingFields.push('city', 'size');

  const requiresHumanReview =
    evidenceQuality === 'low' ||
    evidenceQuality === 'unknown' ||
    confidenceLevel === 'low' ||
    confidenceLevel === 'unknown' ||
    not_sales_prospect === true;

  // Executive note: factual, no inventada
  const executiveNote = buildExecutiveNote(
    !!(input.website || input.domain),
    hasLinkedIn,
    primarySourceType,
  );

  const profile: CandidateRichProfileV1 = {
    schema_version: 'candidate_rich_profile_v1',

    company: {
      name: input.name,
      normalized_name: normalizeName(input.name),
      website: input.website ?? null,
      domain: input.domain ?? null,
      linkedin_url: linkedInUrl,
    },

    classification: {
      country: input.country ?? null,
      country_code: input.countryCode ?? null,
      industry: input.industry ?? null,
      subindustry: inferredSubindustry,
      relationship_type,
      ...(not_sales_prospect ? { not_sales_prospect: true } : {}),
    },

    location: {
      city: null,
      hq_country: input.country ?? null,
      source: 'unknown',
    },

    size: {
      estimated_range: null,
      status: 'unknown',
      source: 'unknown',
      notes: null,
    },

    description: {
      short: descriptionShort,
      source: descriptionSource,
    },

    evidence: {
      primary_url: primaryUrl,
      primary_source_type: primarySourceType,
      evidence_summary: input.sourceSnippet?.slice(0, 300) ?? null,
      evidence_quality: evidenceQuality,
      ...(evidenceWarnings.length ? { warnings: evidenceWarnings } : {}),
    },

    confidence: {
      confidence_score: input.confidenceScore ?? null,
      fit_score: input.fitScore ?? null,
      confidence_level: confidenceLevel,
      ...(confidenceReasons.length ? { reasons: confidenceReasons } : {}),
    },

    notes: {
      executive_note: executiveNote,
      review_note: null,
      missing_fields: missingFields,
      requires_human_review: requiresHumanReview,
    },

    provenance: {
      generated_at: clock(),
      generated_by: 'agent_1',
      enrichment_level: 'basic',
      external_calls_used: false,
      cost_usd: 0,
    },
  };

  return profile;
}

// ─── Merge helper ────────────────────────────────────────────────────────────

export function mergeCandidateRichProfileIntoMetadata(
  metadata: Record<string, unknown>,
  richProfile: CandidateRichProfileV1
): Record<string, unknown> {
  return {
    ...metadata,
    rich_profile: richProfile,
  };
}

// ─── Completeness reporter ───────────────────────────────────────────────────

export function getCandidateRichProfileCompleteness(
  profile: CandidateRichProfileV1
): CandidateRichProfileCompleteness {
  const hasCompany = !!profile.company.name;
  const hasWebsite = !!(profile.company.website || profile.company.domain);
  const hasLinkedin = !!profile.company.linkedin_url;
  const hasPrimaryEvidence = !!profile.evidence.primary_url;
  const hasDescription = !!profile.description.short;
  const hasSubindustry = !!profile.classification.subindustry;
  const hasSize = profile.size.status !== 'unknown';
  const hasCity = !!profile.location.city;

  const missing: string[] = [];
  if (!hasCompany) missing.push('company');
  if (!hasWebsite) missing.push('website');
  if (!hasLinkedin) missing.push('linkedin_url');
  if (!hasPrimaryEvidence) missing.push('primary_evidence');
  if (!hasDescription) missing.push('description');
  if (!hasSubindustry) missing.push('subindustry');
  if (!hasSize) missing.push('size');
  if (!hasCity) missing.push('city');

  return {
    has_company: hasCompany,
    has_website: hasWebsite,
    has_linkedin: hasLinkedin,
    has_primary_evidence: hasPrimaryEvidence,
    has_description: hasDescription,
    has_subindustry: hasSubindustry,
    has_size: hasSize,
    has_city: hasCity,
    missing_fields: missing,
  };
}
