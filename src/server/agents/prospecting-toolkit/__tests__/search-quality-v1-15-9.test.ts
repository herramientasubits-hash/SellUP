/**
 * Tests — Candidate Rich Profile Metadata Contract (v1.15.9)
 *
 * Verifica buildCandidateRichProfileV1, mergeCandidateRichProfileIntoMetadata
 * y getCandidateRichProfileCompleteness.
 *
 * F1  — candidato básico name/domain/website → company lleno, size/city unknown
 * F2  — linkedInEnrichment found → linkedin_url lleno
 * F3  — sin LinkedIn → linkedin_url null, sin error
 * F4  — country/industry/subindustry existentes → classification preserva valores
 * F5  — source/evidence existente → primary_url y evidence_summary se llenan
 * F6  — no inventar ciudad → location.city null, source unknown
 * F7  — no inventar tamaño → size.status unknown
 * F8  — confidence_score / fit_score → confidence usa valores y calcula level
 * F9  — metadata merge → metadata previa no se borra
 * F10 — vendor/content_provider → not_sales_prospect=true, no forzar sales_prospect
 * F11 — provenance sin costo → external_calls_used=false, cost_usd=0
 * F12 — completeness missing_fields → reporta ciudad/tamaño si faltan
 * F13 — integración candidate-writer → buildCandidateRichProfileV1 produce schema_version correcto
 *
 * Uses Node.js built-in test runner. Sin Tavily. Sin APIs externas. Sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCandidateRichProfileV1,
  mergeCandidateRichProfileIntoMetadata,
  getCandidateRichProfileCompleteness,
} from '../candidate-rich-profile';
import type { CandidateRichProfileInput, CandidateRichProfileV1 } from '../candidate-rich-profile';
import type { LinkedInEnrichmentMetadata } from '../types';

// ─── Clock fijo para tests deterministas ─────────────────────────────────────

const FIXED_TS = '2026-06-23T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseInput(overrides?: Partial<CandidateRichProfileInput>): CandidateRichProfileInput {
  return {
    name: 'Acme Corp',
    website: 'https://acmecorp.com',
    domain: 'acmecorp.com',
    country: 'Colombia',
    countryCode: 'CO',
    industry: 'Software',
    clockFn: fixedClock,
    ...overrides,
  };
}

function linkedInFound(overrides?: Partial<LinkedInEnrichmentMetadata>): LinkedInEnrichmentMetadata {
  return {
    enabled: true,
    status: 'found',
    company_url: 'https://www.linkedin.com/company/acmecorp',
    normalized_company_slug: 'acmecorp',
    confidence: 85,
    match_reason: 'name_and_domain',
    signals: { name_match: true, domain_match: true, country_match: true, is_company_page: true },
    warnings: [],
    source: 'controlled_linkedin_search',
    checked_at: FIXED_TS,
    ...overrides,
  };
}

function linkedInNotFound(): LinkedInEnrichmentMetadata {
  return {
    enabled: true,
    status: 'not_found',
    company_url: null,
    confidence: 0,
    warnings: [],
    source: 'controlled_linkedin_search',
    checked_at: FIXED_TS,
  };
}

// ─── F1 — candidato básico con name/domain/website ───────────────────────────

describe('F1 — candidato básico name/domain/website', () => {
  const profile = buildCandidateRichProfileV1(baseInput());

  it('company.name es correcto', () => {
    assert.equal(profile.company.name, 'Acme Corp');
  });

  it('company.website es correcto', () => {
    assert.equal(profile.company.website, 'https://acmecorp.com');
  });

  it('company.domain es correcto', () => {
    assert.equal(profile.company.domain, 'acmecorp.com');
  });

  it('size.status es unknown', () => {
    assert.equal(profile.size.status, 'unknown');
  });

  it('size.estimated_range es null', () => {
    assert.equal(profile.size.estimated_range, null);
  });

  it('location.city es null', () => {
    assert.equal(profile.location.city, null);
  });

  it('schema_version es candidate_rich_profile_v1', () => {
    assert.equal(profile.schema_version, 'candidate_rich_profile_v1');
  });
});

// ─── F2 — candidato con linkedInEnrichment found ─────────────────────────────

describe('F2 — linkedInEnrichment found → linkedin_url lleno', () => {
  const profile = buildCandidateRichProfileV1(
    baseInput({ linkedInEnrichment: linkedInFound() })
  );

  it('company.linkedin_url es la URL de LinkedIn', () => {
    assert.equal(profile.company.linkedin_url, 'https://www.linkedin.com/company/acmecorp');
  });
});

// ─── F3 — sin LinkedIn → linkedin_url null, sin error ────────────────────────

describe('F3 — sin LinkedIn → linkedin_url null, sin error', () => {
  it('no lanza error con linkedInEnrichment null', () => {
    assert.doesNotThrow(() =>
      buildCandidateRichProfileV1(baseInput({ linkedInEnrichment: null }))
    );
  });

  it('linkedin_url es null cuando status=not_found', () => {
    const profile = buildCandidateRichProfileV1(
      baseInput({ linkedInEnrichment: linkedInNotFound() })
    );
    assert.equal(profile.company.linkedin_url, null);
  });

  it('linkedin_url es null cuando linkedInEnrichment omitido', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    assert.equal(profile.company.linkedin_url, null);
  });
});

// ─── F4 — country/industry/subindustry existentes ────────────────────────────

describe('F4 — classification preserva valores existentes', () => {
  const profile = buildCandidateRichProfileV1(
    baseInput({
      country: 'México',
      countryCode: 'MX',
      industry: 'ERP',
      subindustry: 'Manufacturing ERP',
    })
  );

  it('country es México', () => {
    assert.equal(profile.classification.country, 'México');
  });

  it('country_code es MX', () => {
    assert.equal(profile.classification.country_code, 'MX');
  });

  it('industry es ERP', () => {
    assert.equal(profile.classification.industry, 'ERP');
  });

  it('subindustry es Manufacturing ERP', () => {
    assert.equal(profile.classification.subindustry, 'Manufacturing ERP');
  });
});

// ─── F5 — source/evidence existente → primary_url y evidence_summary ─────────

describe('F5 — evidence se llena desde sourceUrl y sourceSnippet', () => {
  const profile = buildCandidateRichProfileV1(
    baseInput({
      sourceUrl: 'https://acmecorp.com/about',
      sourceSnippet: 'Acme Corp es una empresa de software colombiana fundada en 2010.',
      countryEvidenceLevel: 'strong',
    })
  );

  it('evidence.primary_url es el sourceUrl', () => {
    assert.equal(profile.evidence.primary_url, 'https://acmecorp.com/about');
  });

  it('evidence.evidence_summary no es null', () => {
    assert.ok(profile.evidence.evidence_summary);
  });

  it('evidence_quality es high cuando evidence strong + primary_url', () => {
    assert.equal(profile.evidence.evidence_quality, 'high');
  });
});

// ─── F6 — no inventar ciudad ──────────────────────────────────────────────────

describe('F6 — no inventar ciudad', () => {
  const profile = buildCandidateRichProfileV1(baseInput());

  it('location.city es null', () => {
    assert.equal(profile.location.city, null);
  });

  it('location.source es unknown', () => {
    assert.equal(profile.location.source, 'unknown');
  });
});

// ─── F7 — no inventar tamaño ──────────────────────────────────────────────────

describe('F7 — no inventar tamaño', () => {
  const profile = buildCandidateRichProfileV1(baseInput());

  it('size.status es unknown', () => {
    assert.equal(profile.size.status, 'unknown');
  });

  it('size.estimated_range es null', () => {
    assert.equal(profile.size.estimated_range, null);
  });

  it('size.source es unknown', () => {
    assert.equal(profile.size.source, 'unknown');
  });
});

// ─── F8 — confidence_score / fit_score → level calculado ─────────────────────

describe('F8 — confidence usa valores existentes y calcula level', () => {
  it('confidence_level high cuando score >= 70', () => {
    const p = buildCandidateRichProfileV1(baseInput({ confidenceScore: 75, fitScore: 80 }));
    assert.equal(p.confidence.confidence_level, 'high');
    assert.equal(p.confidence.confidence_score, 75);
    assert.equal(p.confidence.fit_score, 80);
  });

  it('confidence_level medium cuando score entre 40 y 69', () => {
    const p = buildCandidateRichProfileV1(baseInput({ confidenceScore: 55 }));
    assert.equal(p.confidence.confidence_level, 'medium');
  });

  it('confidence_level low cuando score entre 1 y 39', () => {
    const p = buildCandidateRichProfileV1(baseInput({ confidenceScore: 30 }));
    assert.equal(p.confidence.confidence_level, 'low');
  });

  it('confidence_level unknown cuando score es null', () => {
    const p = buildCandidateRichProfileV1(baseInput({ confidenceScore: null }));
    assert.equal(p.confidence.confidence_level, 'unknown');
  });

  it('fitReasons se propagan a confidence.reasons', () => {
    const p = buildCandidateRichProfileV1(
      baseInput({ fitReasons: ['b2b_signal', 'country_fit'] })
    );
    assert.ok(p.confidence.reasons?.includes('b2b_signal'));
    assert.ok(p.confidence.reasons?.includes('country_fit'));
  });
});

// ─── F9 — metadata merge → no se borra metadata previa ───────────────────────

describe('F9 — mergeCandidateRichProfileIntoMetadata no borra metadata previa', () => {
  const existingMetadata: Record<string, unknown> = {
    generated_by: 'agent_1_candidate_writer',
    scoring: { confidence_score: 80, fit_score: 75 },
    linkedin_enrichment: { status: 'found' },
    country_evidence: { evidence_level: 'strong' },
    evidence_policy: { decision: 'ok' },
    duplicate_guard: { matched: false },
  };

  const profile = buildCandidateRichProfileV1(baseInput({ clockFn: fixedClock }));
  const merged = mergeCandidateRichProfileIntoMetadata(existingMetadata, profile);

  it('generated_by original no se borra', () => {
    assert.equal(merged.generated_by, 'agent_1_candidate_writer');
  });

  it('scoring original no se borra', () => {
    assert.ok(merged.scoring);
  });

  it('linkedin_enrichment no se borra', () => {
    assert.ok(merged.linkedin_enrichment);
  });

  it('country_evidence no se borra', () => {
    assert.ok(merged.country_evidence);
  });

  it('evidence_policy no se borra', () => {
    assert.ok(merged.evidence_policy);
  });

  it('rich_profile fue agregado', () => {
    assert.ok((merged.rich_profile as CandidateRichProfileV1)?.schema_version === 'candidate_rich_profile_v1');
  });
});

// ─── F10 — vendor/content_provider → not_sales_prospect=true ─────────────────

describe('F10 — vendor/content_provider → not_sales_prospect, no forzar sales_prospect', () => {
  it('vendor → relationship_type=vendor, not_sales_prospect=true', () => {
    const p = buildCandidateRichProfileV1(
      baseInput({ relationshipType: 'vendor', name: 'AWS' })
    );
    assert.equal(p.classification.relationship_type, 'vendor');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('content_provider → relationship_type=content_provider, not_sales_prospect=true', () => {
    const p = buildCandidateRichProfileV1(
      baseInput({ relationshipType: 'content_provider', name: 'Harvard Business Review' })
    );
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('technology_provider → not_sales_prospect=true', () => {
    const p = buildCandidateRichProfileV1(
      baseInput({ relationshipType: 'technology_provider', name: 'Zendesk' })
    );
    assert.equal(p.classification.relationship_type, 'technology_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('sin relationshipType → relationship_type=sales_prospect por defecto', () => {
    const p = buildCandidateRichProfileV1(baseInput());
    assert.equal(p.classification.relationship_type, 'sales_prospect');
    assert.equal(p.classification.not_sales_prospect, undefined);
  });

  it('notSalesProspect=true con unknown → not_sales_prospect=true', () => {
    const p = buildCandidateRichProfileV1(
      baseInput({ notSalesProspect: true, relationshipType: 'unknown' })
    );
    assert.equal(p.classification.not_sales_prospect, true);
    assert.equal(p.classification.relationship_type, 'unknown');
  });
});

// ─── F11 — provenance sin costo ───────────────────────────────────────────────

describe('F11 — provenance: external_calls_used=false, cost_usd=0', () => {
  const profile = buildCandidateRichProfileV1(baseInput());

  it('external_calls_used es false', () => {
    assert.equal(profile.provenance.external_calls_used, false);
  });

  it('cost_usd es 0', () => {
    assert.equal(profile.provenance.cost_usd, 0);
  });

  it('generated_by es agent_1', () => {
    assert.equal(profile.provenance.generated_by, 'agent_1');
  });

  it('enrichment_level es basic', () => {
    assert.equal(profile.provenance.enrichment_level, 'basic');
  });

  it('generated_at usa el clock inyectado', () => {
    assert.equal(profile.provenance.generated_at, FIXED_TS);
  });
});

// ─── F12 — completeness missing_fields ───────────────────────────────────────

describe('F12 — getCandidateRichProfileCompleteness reporta campos faltantes', () => {
  it('candidato básico: city y size siempre en missing_fields', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.ok(comp.missing_fields.includes('city'));
    assert.ok(comp.missing_fields.includes('size'));
  });

  it('has_website=true cuando domain existe', () => {
    const profile = buildCandidateRichProfileV1(baseInput({ website: null, domain: 'acmecorp.com' }));
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_website, true);
  });

  it('has_website=false cuando ni website ni domain', () => {
    const profile = buildCandidateRichProfileV1(baseInput({ website: null, domain: null }));
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_website, false);
    assert.ok(comp.missing_fields.includes('website'));
  });

  it('has_linkedin=true cuando linkedin_url lleno', () => {
    const profile = buildCandidateRichProfileV1(
      baseInput({ linkedInEnrichment: linkedInFound() })
    );
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_linkedin, true);
  });

  it('has_linkedin=false cuando sin LinkedIn', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_linkedin, false);
  });

  it('has_city=false siempre en nivel basic', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_city, false);
  });

  it('has_size=false siempre en nivel basic', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    const comp = getCandidateRichProfileCompleteness(profile);
    assert.equal(comp.has_size, false);
  });
});

// ─── F13 — integración: schema_version correcto ───────────────────────────────

describe('F13 — buildCandidateRichProfileV1 produce schema_version correcto', () => {
  it('schema_version siempre es candidate_rich_profile_v1', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    assert.equal(profile.schema_version, 'candidate_rich_profile_v1');
  });

  it('el perfil es un objeto plano serializable (no contiene funciones)', () => {
    const profile = buildCandidateRichProfileV1(baseInput({ clockFn: fixedClock }));
    const json = JSON.parse(JSON.stringify(profile)) as CandidateRichProfileV1;
    assert.equal(json.schema_version, 'candidate_rich_profile_v1');
    assert.equal(json.provenance.cost_usd, 0);
  });

  it('merge produce metadata.rich_profile con schema_version correcto', () => {
    const profile = buildCandidateRichProfileV1(baseInput());
    const merged = mergeCandidateRichProfileIntoMetadata({}, profile);
    const rp = merged.rich_profile as CandidateRichProfileV1;
    assert.equal(rp.schema_version, 'candidate_rich_profile_v1');
  });
});
