/**
 * Candidate Rich Profile — v1.15.9
 *
 * Builder puro para metadata.rich_profile dentro de prospect_candidates.
 * Sin llamadas externas. Sin LLM. Sin Tavily. Sin Supabase.
 * cost_usd = 0 siempre en este hito.
 */

import type { LinkedInEnrichmentMetadata } from './types';

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
    external_calls_used: false;
    cost_usd: 0;
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
  has_website: boolean;
  has_linkedin: boolean;
  has_primary_evidence: boolean;
  has_description: boolean;
  has_size: boolean;
  has_city: boolean;
  missing_fields: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function inferPrimarySourceType(
  url: string | null | undefined
): CandidateRichProfileV1['evidence']['primary_source_type'] {
  if (!url) return 'unknown';
  if (/linkedin\.com\/company/i.test(url)) return 'linkedin_company';
  if (/\.gov\b|registro|rut\.|registro-mercantil|cnpj|ruc\./i.test(url)) return 'registry';
  if (/directorio|directory|amarillas|paginas-amarillas|clutch\.co|g2\.com/i.test(url)) return 'directory';
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

function inferEvidenceQuality(
  countryEvidenceLevel: 'strong' | 'weak' | 'query_only' | null | undefined,
  hasPrimaryUrl: boolean
): CandidateRichProfileV1['evidence']['evidence_quality'] {
  if (countryEvidenceLevel === 'strong' && hasPrimaryUrl) return 'high';
  if (countryEvidenceLevel === 'strong') return 'medium';
  if (countryEvidenceLevel === 'weak') return 'low';
  return 'unknown';
}

function inferRelationshipType(
  input: Pick<CandidateRichProfileInput, 'relationshipType' | 'notSalesProspect'>
): {
  relationship_type: CandidateRichProfileV1['classification']['relationship_type'];
  not_sales_prospect?: boolean;
} {
  if (input.relationshipType && input.relationshipType !== 'sales_prospect' && input.relationshipType !== 'unknown') {
    return {
      relationship_type: input.relationshipType,
      not_sales_prospect: true,
    };
  }
  if (input.notSalesProspect === true) {
    return {
      relationship_type: input.relationshipType ?? 'unknown',
      not_sales_prospect: true,
    };
  }
  if (input.relationshipType) {
    return { relationship_type: input.relationshipType };
  }
  return { relationship_type: 'sales_prospect' };
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

  // Evidence
  const primaryUrl = input.sourceUrl ?? null;
  const primarySourceType = inferPrimarySourceType(primaryUrl);
  const evidenceQuality = inferEvidenceQuality(input.countryEvidenceLevel, !!primaryUrl);
  const evidenceWarnings: string[] = [];
  if (input.countryEvidenceWarning) evidenceWarnings.push(input.countryEvidenceWarning);
  if (input.evidencePolicyWarnings?.length) evidenceWarnings.push(...input.evidencePolicyWarnings);

  // Description: sólo del snippet, no inventar
  const descriptionShort = input.sourceSnippet?.slice(0, 200) ?? null;
  const descriptionSource: CandidateRichProfileV1['description']['source'] =
    descriptionShort ? 'snippet' : 'unknown';

  // Confidence
  const confidenceLevel = inferConfidenceLevel(input.confidenceScore);
  const confidenceReasons: string[] = [];
  if (input.fitReasons?.length) confidenceReasons.push(...input.fitReasons);

  // Relationship type
  const { relationship_type, not_sales_prospect } = inferRelationshipType(input);

  // Missing fields para notes
  const missingFields: string[] = [];
  if (!input.website && !input.domain) missingFields.push('website');
  if (!linkedInUrl) missingFields.push('linkedin_url');
  if (!descriptionShort) missingFields.push('description');
  // ciudad y tamaño siempre unknown en este hito (Nivel 2/3)
  missingFields.push('city', 'size');

  const requiresHumanReview =
    evidenceQuality === 'low' ||
    evidenceQuality === 'unknown' ||
    confidenceLevel === 'low' ||
    confidenceLevel === 'unknown' ||
    not_sales_prospect === true;

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
      subindustry: input.subindustry ?? null,
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
      executive_note: null,
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
  const hasWebsite = !!(profile.company.website || profile.company.domain);
  const hasLinkedin = !!profile.company.linkedin_url;
  const hasPrimaryEvidence = !!profile.evidence.primary_url;
  const hasDescription = !!profile.description.short;
  const hasSize = profile.size.status !== 'unknown';
  const hasCity = !!profile.location.city;

  const missing: string[] = [];
  if (!hasWebsite) missing.push('website');
  if (!hasLinkedin) missing.push('linkedin_url');
  if (!hasPrimaryEvidence) missing.push('primary_evidence');
  if (!hasDescription) missing.push('description');
  if (!hasSize) missing.push('size');
  if (!hasCity) missing.push('city');

  return {
    has_website: hasWebsite,
    has_linkedin: hasLinkedin,
    has_primary_evidence: hasPrimaryEvidence,
    has_description: hasDescription,
    has_size: hasSize,
    has_city: hasCity,
    missing_fields: missing,
  };
}
