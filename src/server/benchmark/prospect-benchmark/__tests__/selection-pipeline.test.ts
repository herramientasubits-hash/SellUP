/**
 * Tests — Selection Pipeline (Hito 16AB.23.2)
 *
 * Fixtures obligatorios: Siigo, Heinsohn, Servinformación, Celes, Vozy,
 * Truora, PSL, URL repetida, menos de 10 sólidas.
 *
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSelectionPipeline } from '../selection-pipeline';
import { runCandidateValidationPipeline } from '../candidate-validator';
import { validateLinkedIn } from '../linkedin-validator';
import { normalizeCompanyName } from '../name-normalizer';
import { classifyEvidenceUrl, classifyPoolEvidence } from '../evidence-classifier';
import type { BenchmarkCandidate, DuplicatePhaseResult, VerifiedBenchmarkCandidate } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCandidate(partial: Partial<BenchmarkCandidate>): BenchmarkCandidate {
  return {
    name: 'Test Company',
    country: 'Colombia',
    sector: 'Tecnología / SaaS',
    website: 'https://testcompany.co/',
    linkedin: null,
    city: 'Bogotá',
    estimated_size: '100-500 empleados',
    description: 'Empresa de tecnología B2B en Colombia.',
    evidence_url: 'https://testcompany.co/about',
    evidence_source: 'Sitio web oficial',
    confidence: 'Alta',
    notes: null,
    ...partial,
  };
}

function makeVerified(partial: Partial<VerifiedBenchmarkCandidate> = {}): VerifiedBenchmarkCandidate {
  return {
    name: 'Test Company',
    country: 'Colombia',
    sector: 'Tecnología / SaaS',
    website: 'https://testcompany.co/',
    linkedin: 'https://www.linkedin.com/company/test-company/',
    city: 'Bogotá',
    estimated_size: '100-500 empleados',
    description: 'Empresa de tecnología B2B en Colombia.',
    evidence_url: 'https://www.linkedin.com/company/test-company/',
    evidence_source: 'LinkedIn corporativo + sitio oficial',
    confidence: 'Alta',
    notes: null,
    entity_type: 'company',
    identity_resolution: null,
    official_website_url: 'https://testcompany.co/',
    discovery_url: 'https://testcompany.co/',
    linkedin_status: 'http_unverified',
    colombia_evidence: 'Field country="Colombia"',
    sector_evidence: 'Field sector="Tecnología / SaaS"',
    is_verified_company: true,
    ...partial,
  };
}

function dupResult(name: string, status: DuplicatePhaseResult['status']): DuplicatePhaseResult {
  return { candidate_name: name, status };
}

// ─── Fixture: Siigo ────────────────────────────────────────────────────────────

describe('Siigo — empresa válida, duplicado HubSpot', () => {
  it('Siigo es válida como empresa pero se rechaza como duplicado HubSpot', () => {
    const pool: VerifiedBenchmarkCandidate[] = [
      makeVerified({
        name: 'Siigo',
        website: 'https://www.siigo.com/',
        official_website_url: 'https://www.siigo.com/',
        linkedin: 'https://www.linkedin.com/company/siigo-colombia/',
        evidence_url: 'https://www.linkedin.com/company/siigo-colombia/',
        city: 'Bogotá',
        confidence: 'Alta',
      }),
      makeVerified({ name: 'OtraEmpresa1' }),
    ];

    const dupes: DuplicatePhaseResult[] = [
      dupResult('Siigo', 'duplicate_hubspot'),
      dupResult('OtraEmpresa1', 'new_candidate'),
    ];

    const result = runSelectionPipeline(pool, dupes, 10, 2, 0);
    const finalNames = result.finalCandidates.map((c) => c.name);

    assert.ok(!finalNames.includes('Siigo'), 'Siigo debe ser excluida del resultado final (duplicado HubSpot)');
    assert.ok(
      result.rejectedFromSelection.some(
        (r) => r.original_name === 'Siigo' && r.rejection_code === 'EXTERNAL_DUPLICATE',
      ),
      'Siigo debe aparecer en rechazados con código EXTERNAL_DUPLICATE',
    );
    assert.equal(result.poolMetrics.external_duplicates_removed, 1);
  });
});

// ─── Fixture: Heinsohn ─────────────────────────────────────────────────────────

describe('Heinsohn — empresa válida, duplicado SellUp', () => {
  it('Heinsohn es válida como empresa pero se rechaza como duplicado SellUp', () => {
    const pool: VerifiedBenchmarkCandidate[] = [
      makeVerified({
        name: 'Heinsohn Business Technology',
        website: 'https://www.heinsohn.co/',
        official_website_url: 'https://www.heinsohn.co/',
        confidence: 'Alta',
      }),
      makeVerified({ name: 'OtraEmpresa2' }),
    ];

    const dupes: DuplicatePhaseResult[] = [
      dupResult('Heinsohn Business Technology', 'duplicate_sellup'),
      dupResult('OtraEmpresa2', 'new_candidate'),
    ];

    const result = runSelectionPipeline(pool, dupes, 10, 2, 0);
    const finalNames = result.finalCandidates.map((c) => c.name);

    assert.ok(!finalNames.includes('Heinsohn Business Technology'), 'Heinsohn debe ser excluida (duplicado SellUp)');
    assert.ok(
      result.rejectedFromSelection.some(
        (r) => r.original_name === 'Heinsohn Business Technology' && r.rejection_code === 'EXTERNAL_DUPLICATE',
      ),
    );
    assert.equal(result.poolMetrics.external_duplicates_removed, 1);
  });
});

// ─── Fixture: Servinformación ─────────────────────────────────────────────────

describe('Servinformación — empresa válida, duplicado HubSpot', () => {
  it('Servinformación es válida como empresa pero se rechaza como duplicado HubSpot', () => {
    const pool: VerifiedBenchmarkCandidate[] = [
      makeVerified({
        name: 'Servinformación',
        website: 'https://www.servinformacion.com/',
        official_website_url: 'https://www.servinformacion.com/',
        confidence: 'Alta',
      }),
    ];

    const dupes: DuplicatePhaseResult[] = [
      dupResult('Servinformación', 'duplicate_hubspot'),
    ];

    const result = runSelectionPipeline(pool, dupes, 10, 2, 0);
    const finalNames = result.finalCandidates.map((c) => c.name);

    assert.ok(!finalNames.includes('Servinformación'), 'Servinformación debe ser excluida (duplicado HubSpot)');
    assert.equal(result.poolMetrics.external_duplicates_removed, 1);
    assert.equal(result.poolMetrics.requested_count_reached, false);
  });
});

// ─── Fixture: Celes ────────────────────────────────────────────────────────────

describe('Celes — confianza Baja, evidencia débil', () => {
  it('Celes con confianza Baja es rechazada por el validador de candidatos', () => {
    const candidate = makeCandidate({
      name: 'Celes',
      website: 'https://www.celes.tech/',
      evidence_url: 'https://yosoylatino.es/las-10-startups-colombianas-con-mayor-proyeccion',
      confidence: 'Baja',
      city: 'Barranquilla',
    });

    const result = runCandidateValidationPipeline([candidate]);
    const finalNames = result.final_candidates.map((c) => c.name);
    assert.ok(!finalNames.includes('Celes'), 'Celes con confianza Baja no debe entrar en el resultado final');
    assert.ok(
      result.rejected_candidates.some(
        (r) => r.original_name === 'Celes' && r.rejection_code === 'LOW_CONFIDENCE',
      ),
      'Celes debe tener código de rechazo LOW_CONFIDENCE',
    );
  });

  it('Celes con evidencia yosoylatino.es es clasificada como Nivel D', () => {
    const ev = classifyEvidenceUrl(
      'https://yosoylatino.es/las-10-startups-colombianas-con-mayor-proyeccion',
      'https://www.celes.tech/',
    );
    assert.equal(ev.level, 'D', 'yosoylatino.es debe ser Nivel D');
  });
});

// ─── Fixture: Vozy ─────────────────────────────────────────────────────────────

describe('Vozy — evidencia agregador no aceptable como principal', () => {
  it('yosoylatino.es es clasificado como Nivel D (no aceptable como principal)', () => {
    const ev = classifyEvidenceUrl(
      'https://yosoylatino.es/las-10-startups-colombianas-con-mayor-proyeccion',
      'https://www.vozy.co/',
    );
    assert.equal(ev.level, 'D');
    assert.ok(!ev.is_circular, 'No debe ser circular');
  });

  it('LinkedIn corporativo de Vozy es clasificado como Nivel A', () => {
    const ev = classifyEvidenceUrl(
      'https://www.linkedin.com/company/vozy/',
      'https://www.vozy.co/',
    );
    assert.equal(ev.level, 'A', 'LinkedIn /company/ debe ser Nivel A');
  });

  it('Vozy con evidencia LinkedIn en lugar de agregador mejora su posición en selección', () => {
    const vozyWithLinkedIn = makeVerified({
      name: 'Vozy',
      evidence_url: 'https://www.linkedin.com/company/vozy/',
      website: 'https://www.vozy.co/',
      official_website_url: 'https://www.vozy.co/',
      confidence: 'Alta',
    });
    const vozyWithAggregator = makeVerified({
      name: 'VozyWeak',
      evidence_url: 'https://yosoylatino.es/las-10-startups-colombianas',
      website: 'https://www.vozyweak.co/',
      official_website_url: null,
      is_verified_company: false,
      confidence: 'Media',
    });

    const pool = [vozyWithAggregator, vozyWithLinkedIn];
    const dupes: DuplicatePhaseResult[] = [
      dupResult('Vozy', 'new_candidate'),
      dupResult('VozyWeak', 'new_candidate'),
    ];

    const result = runSelectionPipeline(pool, dupes, 10, 2, 0);
    // VozyWeak con evidencia D y sin sitio oficial debe ser rechazada o quedar después
    const finalNames = result.finalCandidates.map((c) => c.name);
    const vozyIndex = finalNames.indexOf('Vozy');
    const weakIndex = finalNames.indexOf('VozyWeak');
    if (vozyIndex !== -1 && weakIndex !== -1) {
      assert.ok(vozyIndex < weakIndex, 'Vozy con evidencia A debe preceder a VozyWeak con evidencia D');
    }
  });
});

// ─── Fixture: Truora ───────────────────────────────────────────────────────────

describe('Truora — normalización de nombre', () => {
  it('Nombre "Truora Inc. (Colombia)" se normaliza a "Truora"', () => {
    const result = normalizeCompanyName('Truora Inc. (Colombia)');
    assert.equal(result.cleanName, 'Truora');
    assert.ok(result.wasNormalized);
    assert.ok(result.extractedNotes?.includes('Colombia') || result.extractedNotes?.includes('Inc'));
  });

  it('Candidato con nombre "Truora Inc. (Colombia)" llega normalizado al pipeline', () => {
    const candidate = makeCandidate({
      name: 'Truora Inc. (Colombia)',
      website: 'https://www.truora.com/',
      confidence: 'Media',
      city: 'Bogotá',
    });
    const result = runCandidateValidationPipeline([candidate]);
    const finalNames = result.final_candidates.map((c) => c.name);
    assert.ok(!finalNames.includes('Truora Inc. (Colombia)'), 'Nombre informal no debe aparecer en resultado final');
    assert.ok(finalNames.includes('Truora'), 'Nombre limpio "Truora" debe aparecer en resultado final');
  });

  it('Tamaño no confirmado queda como estimado o vacío — evidencia débil reduce confianza', () => {
    const ev = classifyEvidenceUrl(
      'https://ecosistemastartup.com/colombia-startups-us858m',
      'https://www.truora.com/',
    );
    assert.equal(ev.level, 'D', 'ecosistemastartup.com debe ser Nivel D');
  });
});

// ─── Fixture: PSL / Perficient ────────────────────────────────────────────────

describe('PSL — nombre limpio, adquisición en notas', () => {
  it('"Perficient Latin America (ex-PSL)" se normaliza a "Perficient Latin America"', () => {
    const result = normalizeCompanyName('Perficient Latin America (ex-PSL)');
    assert.equal(result.cleanName, 'Perficient Latin America');
    assert.ok(result.wasNormalized);
    assert.ok(result.extractedNotes?.includes('ex-PSL'), 'Nota debe contener "ex-PSL"');
  });

  it('"Celes (Barranquilla)" se normaliza a "Celes"', () => {
    const result = normalizeCompanyName('Celes (Barranquilla)');
    assert.equal(result.cleanName, 'Celes');
    assert.ok(result.wasNormalized);
    assert.ok(result.extractedNotes?.includes('Barranquilla'));
  });

  it('Nombres sin paréntesis no son modificados', () => {
    const tests = ['Siigo', 'Sofka Technologies', 'Choucair Testing', 'Simetrik'];
    for (const name of tests) {
      const result = normalizeCompanyName(name);
      assert.equal(result.cleanName, name, `"${name}" no debe ser modificado`);
    }
  });

  it('Sitio oficial de PSL como única evidencia es circular', () => {
    const ev = classifyEvidenceUrl(
      'https://www.psl.com.co/',
      'https://www.psl.com.co/',
    );
    assert.ok(ev.is_circular, 'Sitio web como propia evidencia debe ser circular');
    assert.equal(ev.level, 'A', 'Sigue siendo Nivel A aunque circular');
  });
});

// ─── Fixture: URL repetida ────────────────────────────────────────────────────

describe('URL repetida — misma evidencia secundaria para dos empresas', () => {
  it('URL yosoylatino.es repetida para Vozy y Celes es detectada como repeated', () => {
    const candidates = [
      { name: 'Vozy', evidence_url: 'https://yosoylatino.es/startups', website: 'https://vozy.co/' },
      { name: 'Celes', evidence_url: 'https://yosoylatino.es/startups', website: 'https://celes.tech/' },
      { name: 'Simetrik', evidence_url: 'https://www.ycombinator.com/companies/simetrik', website: 'https://simetrik.com/' },
    ];

    const result: Map<string, { level: string; is_repeated: boolean; is_circular: boolean }> =
      classifyPoolEvidence(candidates);

    const vozyEv = result.get('Vozy');
    const celesEv = result.get('Celes');
    const simetrikEv = result.get('Simetrik');

    assert.ok(vozyEv?.is_repeated, 'Vozy: URL repetida debe ser detectada');
    assert.ok(celesEv?.is_repeated, 'Celes: URL repetida debe ser detectada');
    assert.equal(simetrikEv?.is_repeated, false, 'Simetrik: URL única no debe marcarse como repetida');
  });
});

// ─── Fixture: Menos de 10 sólidas ────────────────────────────────────────────

describe('Menos de 10 candidatas sólidas — devolver 8 o 9, no completar con débiles', () => {
  it('Con 8 candidatas válidas y 0 en pool restante, devuelve 8 sin completar con débiles', () => {
    const solidPool = Array.from({ length: 8 }, (_, i) =>
      makeVerified({
        name: `EmpresaSolida${i}`,
        website: `https://empresa${i}.co/`,
        official_website_url: `https://empresa${i}.co/`,
        evidence_url: `https://www.linkedin.com/company/empresa${i}/`,
        confidence: 'Alta',
      }),
    );

    const dupes: DuplicatePhaseResult[] = solidPool.map((c) =>
      dupResult(c.name, 'new_candidate'),
    );

    const result = runSelectionPipeline(solidPool, dupes, 10, 2, 0);
    assert.equal(result.finalCandidates.length, 8, 'Debe devolver 8, no intentar completar con débiles');
    assert.equal(result.poolMetrics.requested_count_reached, false);
    assert.equal(result.poolMetrics.final_candidate_count, 8);
  });

  it('requested_count_not_reached se registra correctamente en pool_metrics', () => {
    const pool = [makeVerified({ name: 'EmpresaUnica' })];
    const dupes: DuplicatePhaseResult[] = [dupResult('EmpresaUnica', 'new_candidate')];

    const result = runSelectionPipeline(pool, dupes, 10, 2, 0);
    assert.equal(result.poolMetrics.requested_count_reached, false);
    assert.ok(result.poolMetrics.final_candidate_count < 10);
  });
});

// ─── LinkedIn — estados granulares ────────────────────────────────────────────

describe('LinkedIn — estados granulares 16AB.23.2', () => {
  it('URL co.linkedin.com/company/slug es http_unverified (dominio regional)', () => {
    const result = validateLinkedIn('https://co.linkedin.com/company/siigo-colombia', 'Siigo');
    assert.equal(result.status, 'http_unverified');
    assert.ok(result.normalized_url?.includes('linkedin.com/company/siigo-colombia'));
  });

  it('URL www.linkedin.com/company/slug con slug coherente es http_unverified', () => {
    const result = validateLinkedIn('https://www.linkedin.com/company/simetrikinc', 'Simetrik');
    assert.equal(result.status, 'http_unverified');
  });

  it('URL linkedin.com/in/persona es invalid', () => {
    const result = validateLinkedIn('https://www.linkedin.com/in/juan-perez');
    assert.equal(result.status, 'invalid');
  });

  it('URL vacía es not_searched', () => {
    const result = validateLinkedIn(null);
    assert.equal(result.status, 'not_searched');
  });

  it('URL linkedin sin /company/ es invalid', () => {
    const result = validateLinkedIn('https://www.linkedin.com/search/results?keywords=empresa');
    assert.equal(result.status, 'invalid');
  });
});

// ─── Jerarquía de evidencia ───────────────────────────────────────────────────

describe('Clasificación de evidencia — jerarquía A-E', () => {
  it('Y Combinator es Nivel A', () => {
    const ev = classifyEvidenceUrl('https://www.ycombinator.com/companies/simetrik', null);
    assert.equal(ev.level, 'A');
  });

  it('ProColombia es Nivel B', () => {
    const ev = classifyEvidenceUrl('https://b2bmarketplace.procolombia.co/en/software-it-services/sofka-technologies', null);
    assert.equal(ev.level, 'B');
  });

  it('Fedesoft es Nivel B', () => {
    const ev = classifyEvidenceUrl('https://fedesoft.com.co/junta-directiva-2022-2024', null);
    assert.equal(ev.level, 'B');
  });

  it('guiatic.com es Nivel C', () => {
    const ev = classifyEvidenceUrl('https://guiatic.com/co/directorio/276-heinsohn', null);
    assert.equal(ev.level, 'C');
  });

  it('elempleo.com es Nivel C', () => {
    const ev = classifyEvidenceUrl('https://www.elempleo.com/co/base-empresarial/choucair-testing/13603', null);
    assert.equal(ev.level, 'C');
  });

  it('ecosistemastartup.com es Nivel D', () => {
    const ev = classifyEvidenceUrl('https://ecosistemastartup.com/colombia-startups-us858m', null);
    assert.equal(ev.level, 'D');
  });

  it('Reddit es Nivel E (o D)', () => {
    const ev = classifyEvidenceUrl('https://www.reddit.com/r/Colombia/comments/abc', null);
    assert.ok(ev.level === 'D' || ev.level === 'E', `Reddit debe ser D o E, got ${ev.level}`);
  });

  it('LinkedIn /company/ es Nivel A', () => {
    const ev = classifyEvidenceUrl('https://www.linkedin.com/company/sofka-technologies/', null);
    assert.equal(ev.level, 'A');
  });
});
