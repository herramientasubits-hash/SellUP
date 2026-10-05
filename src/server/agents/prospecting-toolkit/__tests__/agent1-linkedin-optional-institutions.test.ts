/**
 * AGENT1-LINKEDIN-OPTIONAL-INSTITUTIONS-1 — el LinkedIn no se exige a quien no
 * suele tenerlo y sí es cliente UBITS.
 *
 * Decisión de la dueña (01-10): obligatorio sólo donde tiene sentido. Entidades
 * del Estado, educación, ONG y gremios/cámaras son clientes (decisión 29-09) y
 * muchas no tienen página de empresa en LinkedIn. Prod 01-10: la SIC (501+), la
 * Alcaldía de Córdoba Quindío (201+) y el Servicio de Salud Coquimbo (201+)
 * cumplían todo salvo el LinkedIn. El TAMAÑO se sigue exigiendo.
 * Sin Supabase real. Sin proveedores. Sin LLM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveLinkedinRequirement } from '../linkedin-requirement';
import { evaluateCandidateSubindustryTargetEligibility } from '../candidate-completeness-contract';

describe('resolveLinkedinRequirement — dominios oficiales del Estado y educación', () => {
  for (const domain of [
    'sic.gov.co', 'sedeelectronica.sic.gov.co', 'cordoba-quindio.gov.co', 'sat.gob.mx', 'minsa.gob.pe',
    'sscoquimbo.redsalud.gob.cl', 'imm.gub.uy', 'mep.go.cr', 'usa.gov', 'unal.edu.co', 'udec.edu.cl',
    'harvard.edu', 'ucr.ac.cr', 'ejercito.mil.co',
  ]) {
    it(`no exige LinkedIn: ${domain}`, () => {
      const r = resolveLinkedinRequirement({ domain, name: null });
      assert.equal(r.required, false);
      assert.equal(r.reason, 'public_or_education_domain');
    });
  }
});

describe('resolveLinkedinRequirement — ONG y gremios', () => {
  for (const [name, domain] of [
    ['Cámara de Comercio de Bogotá', 'ccb.org.co'],
    ['Federación Nacional de Comerciantes FENALCO', 'fenalco.com.co'],
    ['Asociación Nacional de Empresarios de Colombia', 'andi.com.co'],
    ['Fundación Santa Fe de Bogotá', 'fsfb.org.co'],
    ['Confederación Colombiana de Cámaras de Comercio', 'confecamaras.org.co'],
    ['Corporación Transparencia por Colombia', 'transparenciacolombia.org.co'],
  ] as const) {
    it(`no exige LinkedIn: ${name}`, () => {
      const r = resolveLinkedinRequirement({ domain, name });
      assert.equal(r.required, false, name);
      assert.equal(r.reason, 'ngo_or_guild');
    });
  }

  it('«corporación» con dominio comercial sigue exigiendo LinkedIn (puede ser una empresa)', () => {
    assert.equal(resolveLinkedinRequirement({ domain: 'corporacionx.com', name: 'Corporación X S.A.S.' }).required, true);
  });
});

describe('resolveLinkedinRequirement — empresas comerciales', () => {
  for (const [name, domain] of [
    ['Bancolombia', 'bancolombia.com'],
    ['Claro Colombia', 'claro.com.co'],
    ['Laboratorio Chile', 'laboratoriochile.cl'],
    ['Gobernalia Software', 'gobernalia.com'],
    [null, 'edunext.co'],
    [null, 'government-solutions.com'],
  ] as const) {
    it(`exige LinkedIn: ${domain}`, () => {
      const r = resolveLinkedinRequirement({ domain, name });
      assert.equal(r.required, true);
      assert.equal(r.reason, null);
    });
  }
  it('sin dominio ni nombre ⇒ se exige (fail-closed)', () => {
    assert.equal(resolveLinkedinRequirement({ domain: null, name: null }).required, true);
  });
});

describe('contrato de completitud', () => {
  const base = {
    persistenceSuccess: true,
    sectorEvidenceState: 'confirmed',
    requestedSubindustries: [],
    subindustryPrecision: null,
    employeeCountStatus: 'confirmed' as const,
    linkedinStatus: 'not_returned' as const,
    duplicateStatus: 'no_match',
    ownershipGate: 'pass' as const,
    qualityGate: 'pass' as const,
  };

  it('por defecto el LinkedIn sigue siendo obligatorio (nada cambia para quien no lo diga)', () => {
    const e = evaluateCandidateSubindustryTargetEligibility(base);
    assert.ok(e.failedConditions.includes('linkedin_status'));
  });

  it('linkedinRequired=false ⇒ el LinkedIn deja de ser condición', () => {
    const e = evaluateCandidateSubindustryTargetEligibility({ ...base, linkedinRequired: false });
    assert.equal(e.failedConditions.includes('linkedin_status'), false);
  });

  it('linkedinRequired=false NO relaja el tamaño', () => {
    const e = evaluateCandidateSubindustryTargetEligibility({
      ...base, linkedinRequired: false, employeeCountStatus: 'not_returned',
    });
    assert.ok(e.failedConditions.includes('employee_count_status'));
    assert.equal(e.countsTowardTarget, false);
  });
});

describe('AGENT1-TAVILY-HOSPITAL-LINKEDIN-1 — salud pública por el nombre (CL×Salud a5227f3f)', () => {
  for (const [name, domain] of [
    ['Hospital Clínico San Borja Arriarán', 'hcsba.cl'],
    ['Servicio de Salud Metropolitano Sur', 'redsalud.cl'],
    ['CESFAM Lo Barnechea', 'cesfamlobarnechea.cl'],
    ['Caja Nacional de Salud', 'cns.com.bo'],
  ] as const) {
    it(`no exige LinkedIn: ${name}`, () => {
      const r = resolveLinkedinRequirement({ domain, name });
      assert.equal(r.required, false);
      assert.equal(r.reason, 'public_health_by_name');
    });
  }
  it('una clínica privada sigue exigiendo LinkedIn', () => {
    assert.equal(resolveLinkedinRequirement({ domain: 'clinicalplus.cl', name: 'Clinical Plus' }).required, true);
  });
});
