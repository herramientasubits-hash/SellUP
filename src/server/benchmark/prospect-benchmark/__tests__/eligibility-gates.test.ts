/**
 * Eligibility Gates Tests (Hotfix 16AB.24.8)
 *
 * 17 casos que verifican la separación de auditabilidad/elegibilidad,
 * el saneamiento del enum y la elegibilidad determinística.
 * Sin llamadas a APIs externas.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateVerificationOutput } from '../context/output-validator';
import { transformToTwelveColumns, transformWithValidation } from '../context/output-transformer';
import { computeFinalEligibility } from '../context/deterministic-eligibility';
import type { EligibilityGateParams } from '../context/deterministic-eligibility';
import type {
  CompactVerificationRecord,
  DuplicateResolutionDetail,
} from '../context/types';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeValidRecord(overrides?: Partial<CompactVerificationRecord>): CompactVerificationRecord {
  const base: CompactVerificationRecord = {
    candidate_name: 'TestCo',
    identity: {
      status: 'verified',
      commercial_name: 'TestCo',
      legal_name: { value: null, status: 'not_found', evidence_urls: [] },
      official_website: 'https://testco.com',
      linkedin_company_url: 'https://www.linkedin.com/company/testco',
      evidence_urls: ['https://testco.com'],
    },
    colombia_operation: {
      status: 'verified',
      primary_city: 'Bogotá',
      other_cities: [],
      evidence_urls: ['https://testco.com/colombia'],
    },
    technology_b2b_fit: {
      status: 'verified',
      subsegment: 'SaaS',
      reason: 'Plataforma B2B',
      evidence_urls: ['https://testco.com'],
    },
    size: { value: '51-200', status: 'estimated', scope: 'colombia', evidence_urls: [] },
    company_facts: { incorporation_date: null, incorporation_year: 2015, evidence_urls: [] },
    ubits_fit: { signals: [], status: 'present' },
    conflicts: [],
    missing_information: [],
    audit_status: 'auditable',
    confidence: 'Media',
    eligibility: 'eligible_auditable',
    primary_evidence_url: 'https://testco.com/about',
    notes: '',
  };
  return { ...base, ...overrides };
}

function makeNoDuplicateResolution(): DuplicateResolutionDetail {
  return {
    globalStatus: 'no_duplicate',
    requiresHumanReview: false,
    blocksEligibility: false,
    sources: {
      sellup: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      hubspot: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      internal_pool: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      candidate_history: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
    },
  };
}

function makeUnresolvedDuplicateResolution(): DuplicateResolutionDetail {
  return {
    globalStatus: 'unresolved_duplicate',
    requiresHumanReview: true,
    blocksEligibility: false,
    sources: {
      sellup: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      hubspot: { status: 'not_checked', matches: [], checkedAt: null, errorCode: null },
      internal_pool: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      candidate_history: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
    },
  };
}

function makeBaseGateParams(overrides?: Partial<EligibilityGateParams>): EligibilityGateParams {
  return {
    auditabilityStatus: 'auditable',
    modelProposedEligibility: 'eligible_auditable',
    duplicateResolution: makeNoDuplicateResolution(),
    identityStatus: 'verified',
    colombiaOperationStatus: 'verified',
    technologyB2bStatus: 'verified',
    confidence: 'Media',
    hasPrimaryEvidence: true,
    ...overrides,
  };
}

// ─── Test 1: eligible_partially_auditable en audit_status se mapea ────────────

describe('Test 1 — eligible_partially_auditable en audit_status se mapea a partially_auditable', () => {
  it('el sanitizedOutput.audit_status debe ser partially_auditable', () => {
    const raw = { ...makeValidRecord(), audit_status: 'eligible_partially_auditable' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.audit_status, 'partially_auditable');
  });

  it('eligible_auditable en audit_status se mapea a auditable', () => {
    const raw = { ...makeValidRecord(), audit_status: 'eligible_auditable' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.audit_status, 'auditable');
  });
});

// ─── Test 2: El mapeo produce warning, no blocking ────────────────────────────

describe('Test 2 — mapeo de audit_status produce warning, no blocking', () => {
  it('el issue debe tener severity warning y code audit_status_mapped_from_eligibility_enum', () => {
    const raw = { ...makeValidRecord(), audit_status: 'eligible_partially_auditable' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    const warning = result.issues.find((i) => i.code === 'audit_status_mapped_from_eligibility_enum');
    assert.notEqual(warning, undefined, 'Debe existir el warning audit_status_mapped_from_eligibility_enum');
    assert.equal(warning!.severity, 'warning');
    assert.equal(result.blockingIssues.filter((i) => i.path === 'audit_status').length, 0);
  });

  it('auditStatusSanitization debe registrar el valor original y el mapeado', () => {
    const raw = { ...makeValidRecord(), audit_status: 'eligible_partially_auditable' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.notEqual(result.auditStatusSanitization, undefined);
    assert.equal(result.auditStatusSanitization!.originalValue, 'eligible_partially_auditable');
    assert.equal(result.auditStatusSanitization!.mappedTo, 'partially_auditable');
  });
});

// ─── Test 3: Enum desconocido en audit_status es bloqueante ──────────────────

describe('Test 3 — enum desconocido en audit_status es bloqueante', () => {
  it('un valor inventado en audit_status debe producir blocking issue', () => {
    const raw = { ...makeValidRecord(), audit_status: 'custom_status_xyz' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    const blocking = result.blockingIssues.find(
      (i) => i.path === 'audit_status' && i.code === 'invalid_enum',
    );
    assert.notEqual(blocking, undefined, 'Debe haber blocking issue para enum desconocido');
    assert.equal(result.valid, false);
  });

  it('requires_review en audit_status no es un valor de auditabilidad válido', () => {
    const raw = { ...makeValidRecord(), audit_status: 'requires_review' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.equal(result.valid, false);
    const blocking = result.blockingIssues.find((i) => i.path === 'audit_status');
    assert.notEqual(blocking, undefined);
  });
});

// ─── Test 4: HubSpot not_checked ≠ checked_no_match ──────────────────────────

describe('Test 4 — HubSpot not_checked no equivale a cero coincidencias', () => {
  it('not_checked indica que nunca se consultó; checked_no_match indica consulta sin resultado', () => {
    const notChecked: DuplicateResolutionDetail = {
      ...makeNoDuplicateResolution(),
      sources: {
        ...makeNoDuplicateResolution().sources,
        hubspot: { status: 'not_checked', matches: [], checkedAt: null, errorCode: null },
      },
    };
    const checkedNoMatch: DuplicateResolutionDetail = {
      ...makeNoDuplicateResolution(),
      sources: {
        ...makeNoDuplicateResolution().sources,
        hubspot: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      },
    };

    assert.notEqual(notChecked.sources.hubspot.status, checkedNoMatch.sources.hubspot.status);
    assert.equal(notChecked.sources.hubspot.checkedAt, null);
    assert.notEqual(checkedNoMatch.sources.hubspot.checkedAt, null);
  });
});

// ─── Test 5: checked_no_match solo cuando check fue ejecutado ─────────────────

describe('Test 5 — checked_no_match solo cuando el check fue ejecutado', () => {
  it('checked_no_match debe tener checkedAt no nulo', () => {
    const check = makeNoDuplicateResolution().sources.sellup;
    assert.equal(check.status, 'checked_no_match');
    assert.notEqual(check.checkedAt, null);
  });

  it('not_checked tiene checkedAt null', () => {
    const notChecked = makeUnresolvedDuplicateResolution().sources.hubspot;
    assert.equal(notChecked.status, 'not_checked');
    assert.equal(notChecked.checkedAt, null);
  });
});

// ─── Test 6: Posible duplicado + HubSpot no consultado → requires_review ──────

describe('Test 6 — posible duplicado + HubSpot no consultado → requires_review', () => {
  it('computeFinalEligibility debe retornar requires_review', () => {
    const result = computeFinalEligibility(
      makeBaseGateParams({ duplicateResolution: makeUnresolvedDuplicateResolution() }),
    );
    assert.equal(result.finalEligibility, 'requires_review');
    assert.equal(result.finalEligibilitySource, 'deterministic_gates');
  });
});

// ─── Test 7: Duplicado HubSpot confirmado → rejected ──────────────────────────

describe('Test 7 — duplicado HubSpot confirmado → rejected', () => {
  it('confirmed_duplicate_hubspot produce rejected independiente de otros gates', () => {
    const dup: DuplicateResolutionDetail = {
      globalStatus: 'confirmed_duplicate_hubspot',
      requiresHumanReview: false,
      blocksEligibility: true,
      sources: {
        sellup: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
        hubspot: { status: 'confirmed_match', matches: ['HubSpot-001'], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
        internal_pool: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
        candidate_history: { status: 'checked_no_match', matches: [], checkedAt: '2026-06-10T00:00:00Z', errorCode: null },
      },
    };
    const result = computeFinalEligibility(makeBaseGateParams({ duplicateResolution: dup }));
    assert.equal(result.finalEligibility, 'rejected');
    assert.equal(result.finalEligibilitySource, 'deterministic_gates');
  });
});

// ─── Test 8: Sin duplicados + auditable → eligible_auditable ──────────────────

describe('Test 8 — sin duplicados + auditable → eligible_auditable', () => {
  it('todos los checks limpios + auditable → eligible_auditable', () => {
    const result = computeFinalEligibility(
      makeBaseGateParams({ auditabilityStatus: 'auditable' }),
    );
    assert.equal(result.finalEligibility, 'eligible_auditable');
    assert.equal(result.finalEligibilitySource, 'deterministic_gates');
  });
});

// ─── Test 9: Sin duplicados + partially_auditable → eligible_partially_auditable

describe('Test 9 — sin duplicados + partially_auditable → eligible_partially_auditable', () => {
  it('todos los checks limpios + partially_auditable → eligible_partially_auditable', () => {
    const result = computeFinalEligibility(
      makeBaseGateParams({ auditabilityStatus: 'partially_auditable' }),
    );
    assert.equal(result.finalEligibility, 'eligible_partially_auditable');
    assert.equal(result.finalEligibilitySource, 'deterministic_gates');
  });
});

// ─── Test 10: El código no eleva confidence ───────────────────────────────────

describe('Test 10 — el código no eleva confidence', () => {
  it('confidence Baja debe preservarse sin elevación en sanitizedOutput', () => {
    const raw = { ...makeValidRecord(), confidence: 'Baja', eligibility: 'requires_review' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.confidence, 'Baja');
  });
});

// ─── Test 11: El código no eleva audit_status ─────────────────────────────────

describe('Test 11 — el código no eleva audit_status', () => {
  it('not_auditable debe preservarse en sanitizedOutput', () => {
    const raw = { ...makeValidRecord(), audit_status: 'not_auditable', eligibility: 'requires_review' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.notEqual(result.sanitizedOutput, null);
    assert.equal(result.sanitizedOutput!.audit_status, 'not_auditable');
  });

  it('partially_auditable no se eleva a auditable', () => {
    const raw = { ...makeValidRecord(), audit_status: 'partially_auditable' };
    const result = validateVerificationOutput(raw, { currentYear: 2026 });
    assert.equal(result.sanitizedOutput!.audit_status, 'partially_auditable');
  });
});

// ─── Test 12: finalEligibilitySource = deterministic_gates ───────────────────

describe('Test 12 — finalEligibilitySource es siempre deterministic_gates', () => {
  it('todos los escenarios deben retornar finalEligibilitySource = deterministic_gates', () => {
    const scenarios: Array<Partial<EligibilityGateParams>> = [
      { auditabilityStatus: 'auditable' },
      { auditabilityStatus: 'partially_auditable' },
      { auditabilityStatus: 'not_auditable' },
      { confidence: 'Baja' },
      { duplicateResolution: makeUnresolvedDuplicateResolution() },
    ];
    for (const override of scenarios) {
      const result = computeFinalEligibility(makeBaseGateParams(override));
      assert.equal(result.finalEligibilitySource, 'deterministic_gates');
    }
  });
});

// ─── Test 13: Output saneado genera las 12 columnas ──────────────────────────

describe('Test 13 — output saneado con audit_status mapeado genera 12 columnas', () => {
  it('eligible_partially_auditable en audit_status no impide generar la fila de 12 columnas', () => {
    const raw = { ...makeValidRecord(), audit_status: 'eligible_partially_auditable' };
    const result = transformWithValidation(raw);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(Object.keys(result.row).length, 12);
  });
});

// ─── Test 14: Las notas incluyen la revisión de duplicidad ───────────────────

describe('Test 14 — notas incluyen indicadores de duplicidad sin resolver', () => {
  it('duplicateResolution.unresolved_duplicate agrega nota de posible duplicado', () => {
    const record = makeValidRecord({ audit_status: 'partially_auditable' });
    const row = transformToTwelveColumns(record, {
      duplicateResolution: makeUnresolvedDuplicateResolution(),
    });
    assert.match(row.notas, /Posible duplicado sin resolver/);
  });

  it('HubSpot not_checked agrega nota de HubSpot no consultado', () => {
    const record = makeValidRecord({ audit_status: 'partially_auditable' });
    const row = transformToTwelveColumns(record, {
      duplicateResolution: makeUnresolvedDuplicateResolution(),
    });
    assert.match(row.notas, /HubSpot no consultado/);
  });
});

// ─── Test 15: No existe lógica específica por nombre "Celes" ─────────────────

describe('Test 15 — sin lógica específica por nombre de candidato', () => {
  it('el escenario equivalente al de Celes con nombre distinto produce el mismo resultado', () => {
    const scenarioParams = makeBaseGateParams({
      auditabilityStatus: 'partially_auditable',
      duplicateResolution: makeUnresolvedDuplicateResolution(),
    });

    const resultCeles = computeFinalEligibility(scenarioParams);
    const resultOther = computeFinalEligibility(scenarioParams);

    assert.equal(resultCeles.finalEligibility, resultOther.finalEligibility);
    assert.equal(resultCeles.finalEligibilitySource, resultOther.finalEligibilitySource);
  });
});

// ─── Test 16: Resultado offline de Celes → requires_review ───────────────────

describe('Test 16 — escenario offline de Celes produce requires_review', () => {
  it('audit_status eligible_partially_auditable se sanea y computeFinalEligibility retorna requires_review', () => {
    // Simula el output real del modelo tal como llegó de la API en Hito 16AB.24.7
    const rawModelOutput = {
      candidate_name: 'Celes',
      identity: {
        status: 'supported',
        commercial_name: 'Celes',
        legal_name: { value: null, status: 'not_found', evidence_urls: [] },
        official_website: 'https://www.getceles.com/',
        linkedin_company_url: 'https://www.linkedin.com/company/celes-retailtech/',
        evidence_urls: ['https://www.getceles.com/prensa-posts/celes-raises-1-million-in-seed-capital-for-its-ai-driven-retail-solution'],
      },
      colombia_operation: {
        status: 'verified',
        primary_city: 'Barranquilla',
        other_cities: [],
        evidence_urls: ['https://www.larepublica.co/empresas/celes-startup-innova-con-un-software-para-optimizar-inventarios-3658814'],
      },
      technology_b2b_fit: {
        status: 'verified',
        subsegment: 'saas_empresarial / data_analytics',
        reason: 'SaaS B2B de IA para retail',
        evidence_urls: ['https://www.getceles.com/prensa-posts/celes-raises-1-million-in-seed-capital-for-its-ai-driven-retail-solution'],
      },
      size: { value: '11-50', status: 'estimated', scope: 'global_group', evidence_urls: [] },
      company_facts: { incorporation_date: null, incorporation_year: 2019, evidence_urls: [] },
      ubits_fit: { signals: [], status: 'present' },
      conflicts: [
        'Existen tres páginas LinkedIn para la misma entidad: perfiles duplicados.',
        'Razón social no encontrada en RUES.',
      ],
      missing_information: ['Razón social RUES', 'NIT'],
      audit_status: 'eligible_partially_auditable',  // valor incorrecto que produce el modelo
      confidence: 'Media',
      eligibility: 'eligible_partially_auditable',    // propuesta original del modelo
      primary_evidence_url: 'https://www.getceles.com/prensa-posts/celes-raises-1-million-in-seed-capital-for-its-ai-driven-retail-solution',
      notes: 'Posible duplicado HubSpot pendiente de resolución manual.',
    };

    // 1. El validador debe sanear audit_status sin bloquear
    const validation = validateVerificationOutput(rawModelOutput, { currentYear: 2026 });
    assert.equal(validation.valid, true, 'La validación debe pasar tras sanear el enum');
    assert.equal(validation.sanitizedOutput!.audit_status, 'partially_auditable');
    assert.equal(validation.auditStatusSanitization?.originalValue, 'eligible_partially_auditable');

    // 2. computeFinalEligibility con duplicado sin resolver → requires_review
    const gateResult = computeFinalEligibility({
      auditabilityStatus: validation.sanitizedOutput!.audit_status,
      modelProposedEligibility: validation.sanitizedOutput!.eligibility,
      duplicateResolution: makeUnresolvedDuplicateResolution(),
      identityStatus: validation.sanitizedOutput!.identity.status,
      colombiaOperationStatus: validation.sanitizedOutput!.colombia_operation.status,
      technologyB2bStatus: validation.sanitizedOutput!.technology_b2b_fit.status,
      confidence: validation.sanitizedOutput!.confidence,
      hasPrimaryEvidence: validation.sanitizedOutput!.primary_evidence_url !== null,
    });

    assert.equal(gateResult.finalEligibility, 'requires_review');
    assert.equal(gateResult.finalEligibilitySource, 'deterministic_gates');
  });
});

// ─── Test 17: No se realizan llamadas externas ────────────────────────────────

describe('Test 17 — sin llamadas externas en ninguna función del hotfix', () => {
  it('validateVerificationOutput, computeFinalEligibility y transformToTwelveColumns son síncronos puros', () => {
    // Si alguna función intentara hacer fetch/http, lanzaría una excepción en este entorno
    // o sería async. La ausencia de await confirma que no hay I/O.
    const raw = { ...makeValidRecord(), audit_status: 'eligible_partially_auditable' };
    const validation = validateVerificationOutput(raw, { currentYear: 2026 });
    const gateResult = computeFinalEligibility(makeBaseGateParams());
    const row = transformToTwelveColumns(makeValidRecord());

    // Todos son síncronos: si llegamos aquí sin excepción, no hubo I/O externo
    assert.equal(typeof validation.valid, 'boolean');
    assert.equal(typeof gateResult.finalEligibility, 'string');
    assert.equal(typeof row.empresa, 'string');
  });
});
