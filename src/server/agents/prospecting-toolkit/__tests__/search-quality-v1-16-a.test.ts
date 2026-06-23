/**
 * Tests — Agent 1 v1.16A — No-Cost Rich Profile Completion
 *
 * Verifica mejoras en buildCandidateRichProfileV1 usando solo datos existentes.
 * Sin Tavily. Sin APIs externas. Sin LLM. Sin Supabase.
 *
 * F1  — sourceUrl mismo dominio → primary_source_type=official_website
 * F2  — sourceUrl linkedin.com/company → primary_source_type=linkedin_company
 * F3  — sourceUrl directorio → primary_source_type=directory
 * F4  — sourceUrl blog/article → primary_source_type=article
 * F5  — evidence_quality high: official_website + strong country
 * F6  — evidence_quality low: directory + weak evidence
 * F7  — description usa title + snippet (max 280 chars, sin duplicados)
 * F8  — sin title/snippet → description.short=null
 * F9  — subindustry=ERP inferido de señales de texto
 * F10 — subindustry=null si no hay señal clara
 * F11 — relationship_type=technology_provider desde nombre conocido, not_sales_prospect=true
 * F12 — relationship_type=content_provider desde nombre conocido, not_sales_prospect=true
 * F13 — relationship_type=sales_prospect para empresa normal
 * F14 — executive_note factual, sin inventar ciudad/tamaño
 * F15 — no inventar ciudad ni tamaño
 * F16 — completeness actualizado: has_company, has_subindustry, missing_fields correcto
 * F17 — metadata merge intacto: no borra linkedin_enrichment, scoring, evidence_policy, duplicate_guard
 * F18 — integración: metadata.rich_profile incluye mejoras sin llamadas externas
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

// ─── Clock fijo ───────────────────────────────────────────────────────────────

const FIXED_TS = '2026-06-23T12:00:00.000Z';
const fixedClock = () => FIXED_TS;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function base(overrides?: Partial<CandidateRichProfileInput>): CandidateRichProfileInput {
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

// ─── F1 — primary_source_type = official_website ─────────────────────────────

describe('F1 — sourceUrl mismo dominio → primary_source_type=official_website', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://acmecorp.com/about',
      countryEvidenceLevel: 'strong',
    })
  );

  it('primary_source_type es official_website', () => {
    assert.equal(profile.evidence.primary_source_type, 'official_website');
  });

  it('primary_url es el sourceUrl', () => {
    assert.equal(profile.evidence.primary_url, 'https://acmecorp.com/about');
  });
});

// ─── F2 — primary_source_type = linkedin_company ─────────────────────────────

describe('F2 — sourceUrl linkedin.com/company → primary_source_type=linkedin_company', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://www.linkedin.com/company/acmecorp',
      website: null,
      domain: null,
    })
  );

  it('primary_source_type es linkedin_company', () => {
    assert.equal(profile.evidence.primary_source_type, 'linkedin_company');
  });
});

// ─── F3 — primary_source_type = directory ────────────────────────────────────

describe('F3 — sourceUrl directorio → primary_source_type=directory', () => {
  const profileClutch = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://clutch.co/profile/acmecorp',
      website: null,
      domain: null,
    })
  );

  it('clutch.co → directory', () => {
    assert.equal(profileClutch.evidence.primary_source_type, 'directory');
  });

  const profileG2 = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://www.g2.com/products/acmecorp/reviews',
      website: null,
      domain: null,
    })
  );

  it('g2.com → directory', () => {
    assert.equal(profileG2.evidence.primary_source_type, 'directory');
  });
});

// ─── F4 — primary_source_type = article ──────────────────────────────────────

describe('F4 — sourceUrl blog/article/case-study → primary_source_type=article', () => {
  const profileBlog = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://otherdomain.com/blog/post-about-acmecorp',
      website: null,
      domain: null,
    })
  );

  it('/blog/ → article', () => {
    assert.equal(profileBlog.evidence.primary_source_type, 'article');
  });

  const profileCaseStudy = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://sap.com/case-studies/acmecorp-success',
      website: null,
      domain: null,
    })
  );

  it('/case-studies/ → article', () => {
    assert.equal(profileCaseStudy.evidence.primary_source_type, 'article');
  });

  const profileMedium = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://medium.com/@author/acmecorp-review',
      website: null,
      domain: null,
    })
  );

  it('medium.com → article', () => {
    assert.equal(profileMedium.evidence.primary_source_type, 'article');
  });
});

// ─── F5 — evidence_quality = high ────────────────────────────────────────────

describe('F5 — evidence_quality high: official_website + strong country', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://acmecorp.com/about',
      countryEvidenceLevel: 'strong',
    })
  );

  it('evidence_quality es high', () => {
    assert.equal(profile.evidence.evidence_quality, 'high');
  });
});

describe('F5b — evidence_quality high: LinkedIn found + official_website', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://acmecorp.com/about',
      linkedInEnrichment: linkedInFound(),
      countryEvidenceLevel: 'weak',
    })
  );

  it('evidence_quality es high cuando LinkedIn + official_website', () => {
    assert.equal(profile.evidence.evidence_quality, 'high');
  });
});

// ─── F6 — evidence_quality = low ─────────────────────────────────────────────

describe('F6 — evidence_quality low: directory/weak evidence', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceUrl: 'https://clutch.co/profile/acmecorp',
      website: null,
      domain: null,
      countryEvidenceLevel: 'weak',
    })
  );

  it('evidence_quality es low para directorio', () => {
    assert.equal(profile.evidence.evidence_quality, 'low');
  });
});

describe('F6b — evidence_quality unknown: sin primary_url', () => {
  const profile = buildCandidateRichProfileV1(base({ sourceUrl: null }));

  it('evidence_quality es unknown sin URL', () => {
    assert.equal(profile.evidence.evidence_quality, 'unknown');
  });
});

// ─── F7 — description usa title + snippet ────────────────────────────────────

describe('F7 — description.short combina title + snippet (max 280 chars)', () => {
  const title = 'Acme Corp - Software ERP para Colombia';
  const snippet = 'Empresa colombiana líder en soluciones ERP para pymes. Fundada en 2005. Más de 500 clientes en el país.';

  const profile = buildCandidateRichProfileV1(
    base({ sourceTitle: title, sourceSnippet: snippet })
  );

  it('description.short no es null', () => {
    assert.ok(profile.description.short);
  });

  it('description.short tiene máximo 280 caracteres', () => {
    assert.ok((profile.description.short?.length ?? 0) <= 280);
  });

  it('description.short contiene contenido del snippet', () => {
    assert.ok(profile.description.short?.includes('ERP'));
  });

  it('description.source es snippet', () => {
    assert.equal(profile.description.source, 'snippet');
  });
});

describe('F7b — description.short solo snippet cuando no hay title', () => {
  const snippet = 'Soluciones ERP para empresas colombianas.';
  const profile = buildCandidateRichProfileV1(base({ sourceSnippet: snippet }));

  it('description.short es el snippet', () => {
    assert.equal(profile.description.short, snippet);
  });
});

describe('F7c — description.short trunca a 280 chars con elipsis', () => {
  const longSnippet = 'A'.repeat(300);
  const profile = buildCandidateRichProfileV1(base({ sourceSnippet: longSnippet }));

  it('description.short termina en ...', () => {
    assert.ok(profile.description.short?.endsWith('...'));
    assert.ok((profile.description.short?.length ?? 0) <= 280);
  });
});

// ─── F8 — sin title/snippet → description.short=null ────────────────────────

describe('F8 — sin title/snippet → description.short=null', () => {
  const profile = buildCandidateRichProfileV1(
    base({ sourceTitle: null, sourceSnippet: null })
  );

  it('description.short es null', () => {
    assert.equal(profile.description.short, null);
  });

  it('description.source es unknown', () => {
    assert.equal(profile.description.source, 'unknown');
  });
});

// ─── F9 — subindustry=ERP inferido de señales ────────────────────────────────

describe('F9 — subindustry=ERP inferido de industry/title/snippet', () => {
  const profileFromIndustry = buildCandidateRichProfileV1(
    base({ industry: 'ERP Software' })
  );

  it('subindustry=ERP desde industry', () => {
    assert.equal(profileFromIndustry.classification.subindustry, 'ERP');
  });

  const profileFromSnippet = buildCandidateRichProfileV1(
    base({
      industry: 'Software',
      sourceSnippet: 'Plataforma de enterprise resource planning para medianas empresas.',
    })
  );

  it('subindustry=ERP desde sourceSnippet', () => {
    assert.equal(profileFromSnippet.classification.subindustry, 'ERP');
  });

  const profileFromTitle = buildCandidateRichProfileV1(
    base({
      industry: 'Software',
      sourceTitle: 'Soluciones ERP para manufactura',
    })
  );

  it('subindustry=ERP desde sourceTitle', () => {
    assert.equal(profileFromTitle.classification.subindustry, 'ERP');
  });
});

// ─── F10 — subindustry=null si no hay señal clara ────────────────────────────

describe('F10 — subindustry=null si no hay señal clara', () => {
  const profile = buildCandidateRichProfileV1(
    base({ industry: 'Servicios Generales', sourceSnippet: 'Empresa de consultoría.' })
  );

  it('subindustry es null cuando no hay señal de subindustria', () => {
    assert.equal(profile.classification.subindustry, null);
  });
});

describe('F10b — subindustry respeta valor explícito pasado en input', () => {
  const profile = buildCandidateRichProfileV1(
    base({ subindustry: 'Manufactura Digital', industry: 'Software' })
  );

  it('subindustry preserva valor explícito', () => {
    assert.equal(profile.classification.subindustry, 'Manufactura Digital');
  });
});

// ─── F11 — technology_provider desde nombre conocido ─────────────────────────

describe('F11 — relationship_type=technology_provider desde nombre conocido, not_sales_prospect=true', () => {
  it('HubSpot → technology_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'HubSpot' }));
    assert.equal(p.classification.relationship_type, 'technology_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('Salesforce → technology_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'Salesforce' }));
    assert.equal(p.classification.relationship_type, 'technology_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('Zendesk → technology_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'Zendesk' }));
    assert.equal(p.classification.relationship_type, 'technology_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('notes.requires_human_review=true para technology_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'HubSpot' }));
    assert.equal(p.notes.requires_human_review, true);
  });

  it('relationshipType explícito technology_provider también funciona', () => {
    const p = buildCandidateRichProfileV1(
      base({ name: 'OtraPlatforma', relationshipType: 'technology_provider' })
    );
    assert.equal(p.classification.relationship_type, 'technology_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });
});

// ─── F12 — content_provider desde nombre conocido ────────────────────────────

describe('F12 — relationship_type=content_provider desde nombre conocido, not_sales_prospect=true', () => {
  it('Harvard → content_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'Harvard' }));
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('WOBI → content_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'WOBI' }));
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('TED → content_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'TED' }));
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('Coursera → content_provider', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'Coursera' }));
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });

  it('relationshipType explícito content_provider también funciona', () => {
    const p = buildCandidateRichProfileV1(
      base({ name: 'OtraEditorial', relationshipType: 'content_provider' })
    );
    assert.equal(p.classification.relationship_type, 'content_provider');
    assert.equal(p.classification.not_sales_prospect, true);
  });
});

// ─── F13 — sales_prospect normal ─────────────────────────────────────────────

describe('F13 — relationship_type=sales_prospect para empresa normal', () => {
  it('empresa desconocida → sales_prospect', () => {
    const p = buildCandidateRichProfileV1(base({ name: 'Siesa Enterprise' }));
    assert.equal(p.classification.relationship_type, 'sales_prospect');
    assert.equal(p.classification.not_sales_prospect, undefined);
  });

  it('Acme Corp → sales_prospect por defecto', () => {
    const p = buildCandidateRichProfileV1(base());
    assert.equal(p.classification.relationship_type, 'sales_prospect');
  });

  it('relationshipType explícito sales_prospect no se sobreescribe por auto-detección', () => {
    // Incluso con nombre que podría confundirse, si es explícito sales_prospect respeta
    const p = buildCandidateRichProfileV1(
      base({ name: 'Acme Corp', relationshipType: 'sales_prospect' })
    );
    assert.equal(p.classification.relationship_type, 'sales_prospect');
    assert.equal(p.classification.not_sales_prospect, undefined);
  });
});

// ─── F14 — executive_note factual ────────────────────────────────────────────

describe('F14 — executive_note factual, sin mencionar datos ausentes como ciudad/tamaño', () => {
  it('nota no menciona empleados ni tamaño cuando no hay datos', () => {
    const p = buildCandidateRichProfileV1(base());
    const note = p.notes.executive_note ?? '';
    assert.ok(!note.includes('empleados'), `nota menciona empleados: ${note}`);
    assert.ok(!note.includes('tamaño'), `nota menciona tamaño: ${note}`);
    assert.ok(!note.includes('ciudad'), `nota menciona ciudad: ${note}`);
  });

  it('nota existe cuando hay website', () => {
    const p = buildCandidateRichProfileV1(base());
    assert.ok(p.notes.executive_note);
  });

  it('nota menciona LinkedIn cuando está disponible', () => {
    const p = buildCandidateRichProfileV1(
      base({ linkedInEnrichment: linkedInFound() })
    );
    const note = p.notes.executive_note ?? '';
    assert.ok(note.toLowerCase().includes('linkedin'), `nota no menciona LinkedIn: ${note}`);
  });

  it('nota menciona sitio oficial cuando sourceUrl es del mismo dominio', () => {
    const p = buildCandidateRichProfileV1(
      base({ sourceUrl: 'https://acmecorp.com/about' })
    );
    const note = p.notes.executive_note ?? '';
    assert.ok(note.toLowerCase().includes('sitio'), `nota no menciona sitio: ${note}`);
  });
});

// ─── F15 — no inventar ciudad ni tamaño ──────────────────────────────────────

describe('F15 — no inventar ciudad ni tamaño', () => {
  const profile = buildCandidateRichProfileV1(
    base({
      sourceSnippet: 'Empresa de Bogotá con 5000 empleados y sede en Madrid.',
      sourceTitle: 'Acme Corp - Gran empresa',
    })
  );

  it('location.city es null aunque snippet mencione ciudad', () => {
    assert.equal(profile.location.city, null);
  });

  it('size.status es unknown aunque snippet mencione empleados', () => {
    assert.equal(profile.size.status, 'unknown');
  });

  it('size.estimated_range es null', () => {
    assert.equal(profile.size.estimated_range, null);
  });

  it('location.source es unknown', () => {
    assert.equal(profile.location.source, 'unknown');
  });
});

// ─── F16 — completeness actualizado ──────────────────────────────────────────

describe('F16 — getCandidateRichProfileCompleteness incluye has_company y has_subindustry', () => {
  it('has_company=true cuando company.name existe', () => {
    const p = buildCandidateRichProfileV1(base());
    const c = getCandidateRichProfileCompleteness(p);
    assert.equal(c.has_company, true);
  });

  it('has_subindustry=true cuando subindustry inferida', () => {
    const p = buildCandidateRichProfileV1(base({ industry: 'ERP Software' }));
    const c = getCandidateRichProfileCompleteness(p);
    assert.equal(c.has_subindustry, true);
    assert.ok(!c.missing_fields.includes('subindustry'));
  });

  it('has_subindustry=false cuando no hay señal de subindustria', () => {
    const p = buildCandidateRichProfileV1(base({ industry: 'Servicios' }));
    const c = getCandidateRichProfileCompleteness(p);
    assert.equal(c.has_subindustry, false);
    assert.ok(c.missing_fields.includes('subindustry'));
  });

  it('city y size siempre en missing_fields en nivel basic', () => {
    const p = buildCandidateRichProfileV1(base());
    const c = getCandidateRichProfileCompleteness(p);
    assert.ok(c.missing_fields.includes('city'));
    assert.ok(c.missing_fields.includes('size'));
  });

  it('missing_fields correcto: todos los ausentes están presentes', () => {
    const p = buildCandidateRichProfileV1(
      base({ website: null, domain: null, sourceUrl: null, sourceSnippet: null })
    );
    const c = getCandidateRichProfileCompleteness(p);
    assert.ok(c.missing_fields.includes('website'));
    assert.ok(c.missing_fields.includes('linkedin_url'));
    assert.ok(c.missing_fields.includes('primary_evidence'));
    assert.ok(c.missing_fields.includes('description'));
  });
});

// ─── F17 — metadata merge intacto ────────────────────────────────────────────

describe('F17 — mergeCandidateRichProfileIntoMetadata no borra campos existentes', () => {
  const existingMetadata: Record<string, unknown> = {
    generated_by: 'agent_1_candidate_writer',
    scoring: { confidence_score: 80, fit_score: 75 },
    linkedin_enrichment: { status: 'found', company_url: 'https://linkedin.com/company/acme' },
    country_evidence: { evidence_level: 'strong' },
    evidence_policy: { decision: 'ok' },
    duplicate_guard: { matched: false },
  };

  const profile = buildCandidateRichProfileV1(base({ clockFn: fixedClock }));
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

  it('evidence_policy no se borra', () => {
    assert.ok(merged.evidence_policy);
  });

  it('duplicate_guard no se borra', () => {
    assert.ok(merged.duplicate_guard);
  });

  it('rich_profile fue agregado con schema_version correcto', () => {
    const rp = merged.rich_profile as CandidateRichProfileV1;
    assert.equal(rp.schema_version, 'candidate_rich_profile_v1');
  });
});

// ─── F18 — integración: rich_profile con mejoras, sin llamadas externas ──────

describe('F18 — metadata.rich_profile incluye mejoras sin llamadas externas', () => {
  const input = base({
    sourceUrl: 'https://acmecorp.com/erp-solutions',
    sourceTitle: 'Acme Corp - ERP para Colombia',
    sourceSnippet: 'Plataforma ERP colombiana para pymes del sector manufacturero.',
    countryEvidenceLevel: 'strong',
    linkedInEnrichment: linkedInFound(),
  });

  const profile = buildCandidateRichProfileV1(input);

  it('external_calls_used es false', () => {
    assert.equal(profile.provenance.external_calls_used, false);
  });

  it('cost_usd es 0', () => {
    assert.equal(profile.provenance.cost_usd, 0);
  });

  it('schema_version es candidate_rich_profile_v1', () => {
    assert.equal(profile.schema_version, 'candidate_rich_profile_v1');
  });

  it('primary_source_type es official_website', () => {
    assert.equal(profile.evidence.primary_source_type, 'official_website');
  });

  it('evidence_quality es high (official + LinkedIn + strong)', () => {
    assert.equal(profile.evidence.evidence_quality, 'high');
  });

  it('subindustry es ERP inferido del contenido', () => {
    assert.equal(profile.classification.subindustry, 'ERP');
  });

  it('description.short contiene contenido útil', () => {
    assert.ok(profile.description.short && profile.description.short.length > 0);
  });

  it('executive_note es factual y no nula', () => {
    assert.ok(profile.notes.executive_note);
  });

  it('perfil es JSON serializable', () => {
    const json = JSON.parse(JSON.stringify(profile)) as CandidateRichProfileV1;
    assert.equal(json.schema_version, 'candidate_rich_profile_v1');
    assert.equal(json.provenance.cost_usd, 0);
  });
});
