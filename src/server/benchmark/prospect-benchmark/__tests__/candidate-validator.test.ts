/**
 * Tests — Candidate Validator + Identity Resolver (Hito 16AB.23.1)
 *
 * Usa Node.js built-in test runner (node:test + node:assert).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCandidateValidationPipeline } from '../candidate-validator';
import type { BenchmarkCandidate } from '../types';

function makeCandidate(partial: Partial<BenchmarkCandidate>): BenchmarkCandidate {
  return {
    name: 'Test Company',
    country: 'Colombia',
    sector: 'Tecnología',
    website: null,
    linkedin: null,
    city: null,
    estimated_size: null,
    description: 'Descripción de prueba',
    evidence_url: null,
    evidence_source: null,
    confidence: 'Media',
    notes: null,
    ...partial,
  };
}

describe('runCandidateValidationPipeline — rechazos obligatorios', () => {
  it('artículo de Payments Way no entra con el título del artículo como nombre', () => {
    const candidate = makeCandidate({
      name: 'Artículo Especial Libro Empresas Fintech en Colombia sus Retos y Logros, de Colombia Fintech',
      website: 'https://paymentsway.co/soluciones-marca-blancael-futuro-de-los-pagosdigitales-en-colombia',
      evidence_url: 'https://paymentsway.co/soluciones-marca-blancael-futuro-de-los-pagosdigitales-en-colombia',
    });
    const result = runCandidateValidationPipeline([candidate]);
    const finalNames = result.final_candidates.map((c) => c.name);
    assert.ok(!finalNames.includes(candidate.name), 'Article title must not be used as company name');
  });

  it('artículo de Payments Way puede resolver a la empresa "Payments Way"', () => {
    const candidate = makeCandidate({
      name: 'Artículo Especial Libro Empresas Fintech en Colombia sus Retos y Logros, de Colombia Fintech',
      website: 'https://paymentsway.co/soluciones-marca-blancael-futuro-de-los-pagosdigitales-en-colombia',
      evidence_url: 'https://paymentsway.co/soluciones-marca-blancael-futuro-de-los-pagosdigitales-en-colombia',
    });
    const result = runCandidateValidationPipeline([candidate]);
    if (result.verified_candidates.length > 0) {
      assert.equal(result.verified_candidates[0].name, 'Payments Way');
      assert.equal(result.verified_candidates[0].official_website_url, 'https://paymentsway.co/');
    } else {
      // Also acceptable: rejected (article could not be auto-resolved)
      assert.ok(result.rejected_candidates.length > 0);
    }
  });

  it('Reddit nunca se considera sitio oficial — se rechaza con REDDIT_URL', () => {
    const candidate = makeCandidate({
      name: '¿Qué software de nómina recomiendan en Colombia para una PyME?',
      website: 'https://www.reddit.com/r/ColombiaDevs/comments/1s3l18k/',
      evidence_url: 'https://www.reddit.com/r/ColombiaDevs/comments/1s3l18k/',
    });
    const result = runCandidateValidationPipeline([candidate]);
    assert.equal(result.final_candidates.length, 0);
    assert.equal(result.rejected_candidates[0]?.rejection_code, 'REDDIT_URL');
  });

  it('Colombiafintech se clasifica como asociación y se rechaza', () => {
    const candidate = makeCandidate({
      name: 'Colombiafintech',
      website: 'https://colombiafintech.co',
      evidence_url: 'https://colombiafintech.co',
      description: 'Somos la asociación de empresas de tecnología e innovación financiera.',
    });
    const result = runCandidateValidationPipeline([candidate]);
    assert.equal(result.final_candidates.length, 0);
    const code = result.rejected_candidates[0]?.rejection_code;
    assert.ok(['ASSOCIATION', 'UNRESOLVABLE_IDENTITY'].includes(code ?? ''), `Unexpected code: ${code}`);
  });

  it('"Icon Isotype" no entra en resultados finales con ese nombre', () => {
    const candidate = makeCandidate({
      name: 'Icon Isotype',
      website: 'https://www.indragroup.com/es/america-latina/colombia',
      evidence_url: 'https://www.indragroup.com/es/america-latina/colombia',
    });
    const result = runCandidateValidationPipeline([candidate]);
    const finalNames = result.final_candidates.map((c) => c.name);
    assert.ok(!finalNames.includes('Icon Isotype'));
  });

  it('"Paytech 💳 en América Latina" se rechaza (emoji + directorio)', () => {
    const candidate = makeCandidate({
      name: 'Paytech 💳 en América Latina',
      website: 'https://www.latamfintech.co/segments/paytech',
      evidence_url: 'https://www.latamfintech.co/segments/paytech',
    });
    const result = runCandidateValidationPipeline([candidate]);
    assert.equal(result.final_candidates.length, 0);
  });
});

describe('normalización de sitio oficial', () => {
  it('página interna de Puntored se normaliza al dominio raíz', () => {
    const candidate = makeCandidate({
      name: 'Fintech y pagos masivos:inclusión financiera para tu empresa',
      website: 'https://puntored.co/fintech-inclusion-financiera-pagos-masivos',
      evidence_url: 'https://puntored.co/fintech-inclusion-financiera-pagos-masivos',
    });
    const result = runCandidateValidationPipeline([candidate]);
    if (result.verified_candidates.length > 0) {
      const v = result.verified_candidates[0];
      assert.equal(v.official_website_url, 'https://puntored.co/');
      assert.equal(v.name, 'Puntored');
    } else {
      assert.ok(result.rejected_candidates.length > 0);
    }
  });

  it('página interna de AXD se normaliza al dominio raíz', () => {
    const candidate = makeCandidate({
      name: 'AXD',
      website: 'https://axd.com.co/soluciones-de-ciberseguridad-en-colombia',
      evidence_url: 'https://axd.com.co/soluciones-de-ciberseguridad-en-colombia',
      description: 'Soluciones de ciberseguridad en Colombia.',
      city: 'Bogotá',
    });
    const result = runCandidateValidationPipeline([candidate]);
    if (result.verified_candidates.length > 0) {
      assert.equal(result.verified_candidates[0].official_website_url, 'https://axd.com.co/');
    }
  });
});

describe('URL válida ajena no otorga veracidad', () => {
  it('google.com válido no verifica la empresa', () => {
    const candidate = makeCandidate({
      name: 'Empresa Inexistente',
      website: 'https://google.com/search?q=empresa+colombia',
      evidence_url: 'https://google.com/search?q=empresa+colombia',
    });
    const result = runCandidateValidationPipeline([candidate]);
    if (result.verified_candidates.length > 0) {
      assert.equal(result.verified_candidates[0].is_verified_company, false);
    }
    // Either not verified or in rejected
  });
});

describe('empresas reales que deben pasar', () => {
  it('AXD no debe estar en rechazados', () => {
    const candidate = makeCandidate({
      name: 'AXD',
      website: 'https://axd.com.co/soluciones-de-ciberseguridad-en-colombia',
      evidence_url: 'https://axd.com.co/soluciones-de-ciberseguridad-en-colombia',
      description: 'Empresa de ciberseguridad en Colombia.',
      city: 'Bogotá',
    });
    const result = runCandidateValidationPipeline([candidate]);
    const rejectedNames = result.rejected_candidates.map((r) => r.original_name);
    assert.ok(!rejectedNames.includes('AXD'), 'AXD must not be in rejected');
  });

  it('Softland no debe estar en rechazados', () => {
    const candidate = makeCandidate({
      name: 'Softland',
      website: 'https://softland.com/co/software-gestion-recursos-humanos',
      evidence_url: 'https://softland.com/co/software-gestion-recursos-humanos',
      description: 'Software ERP para LATAM',
      city: 'Bogotá',
    });
    const result = runCandidateValidationPipeline([candidate]);
    const rejectedNames = result.rejected_candidates.map((r) => r.original_name);
    assert.ok(!rejectedNames.includes('Softland'), 'Softland must not be in rejected');
  });
});
