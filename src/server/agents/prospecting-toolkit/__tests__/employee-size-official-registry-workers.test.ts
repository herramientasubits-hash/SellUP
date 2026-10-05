/**
 * AGENT1-SIZE-OFFICIAL-REGISTRY-WORKERS-1 — los trabajadores informados por el
 * registro oficial (hoy: SII de Chile, `cl_sii_registry`) alimentan el gate ICP
 * de tamaño cuando ninguna otra fuente trajo dato.
 *
 * Reglas que fija esta suite:
 *   · Prioridad: DESPUÉS de rich_profile / company_size / HubSpot, ANTES de unknown.
 *   · Sólo APRUEBA: «trabajadores dependientes informados» es un piso del tamaño
 *     real (no cuenta honorarios ni contratistas), así que ≥ umbral ⇒ pase
 *     ESTIMADO; por debajo del umbral NO bloquea, cae a unknown (revisión).
 *   · Sólo con identidad fuerte (mismo número fiscal) y con dato reciente.
 *   · Cubre Apollo y Tavily: se lee de `officialSourceIdentity`, que ambos llenan.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS,
  OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF,
  extractOfficialRegistryWorkforce,
  resolveEmployeeSizeForIcpGate,
} from '../employee-size-resolver';
import { evaluateIcpSizeGate, resolveIcpSizeGateWriterAction } from '../icp-size-gate';

const SII = { workers: 350, year: 2024, source: 'cl_sii_registry' };

function decide(input: Parameters<typeof resolveEmployeeSizeForIcpGate>[0]) {
  const resolved = resolveEmployeeSizeForIcpGate({ threshold: 200, referenceYear: 2026, ...input });
  const gate = evaluateIcpSizeGate(resolved.icpInput);
  return { resolved, gate, action: resolveIcpSizeGateWriterAction(gate).action };
}

function candidateWith(metadata: Record<string, unknown> | null, strong = true) {
  return {
    name: 'Empresa SpA',
    officialSourceIdentity: metadata === null
      ? null
      : { officialSourceMetadata: metadata, typedColumns: {}, strongIdentityAvailable: strong },
  };
}

describe('resolver — fuente official_registry_workers', () => {
  it('sin otra fuente, ≥ umbral ⇒ pase ESTIMADO con la fuente nombrada', () => {
    const { resolved, gate, action } = decide({ officialRegistryWorkforce: SII });
    assert.equal(resolved.selectedSource, 'official_registry_workers');
    assert.equal(resolved.selectedValue, '350+');
    assert.equal(resolved.confidence, 'medium');
    assert.equal(action, 'pass');
    assert.equal(gate.size_status, 'estimated_above_threshold');
    assert.match(resolved.reason, /2024/);
  });

  it('exactamente el umbral (200) pasa: el ICP es inclusivo', () => {
    const { action } = decide({ officialRegistryWorkforce: { ...SII, workers: 200 } });
    assert.equal(action, 'pass');
  });

  it('entre el corte de pequeña y el umbral NO bloquea: queda en revisión como unknown', () => {
    const { resolved, action } = decide({ officialRegistryWorkforce: { ...SII, workers: 120 } });
    assert.equal(resolved.selectedSource, 'unknown');
    assert.equal(action, 'needs_review');
    const attempt = resolved.attemptedSources.find((a) => a.source === 'official_registry_workers');
    assert.equal(attempt?.usable, false);
    assert.equal(attempt?.value, 120);
  });

  it('AGENT1-SIZE-OFFICIAL-REGISTRY-SMALL-1 — menos de 50 informados ⇒ pequeña, el gate bloquea (Clinical Plus, 9)', () => {
    const { resolved, gate, action } = decide({ officialRegistryWorkforce: { ...SII, workers: 9 } });
    assert.equal(resolved.selectedSource, 'official_registry_workers');
    assert.equal(resolved.selectedValue, `9-${OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF - 1}`);
    assert.equal(gate.size_status, 'estimated_below_threshold');
    assert.equal(action, 'skip');
    const at = decide({ officialRegistryWorkforce: { ...SII, workers: OFFICIAL_REGISTRY_WORKERS_SMALL_CUTOFF } });
    assert.equal(at.action, 'needs_review', 'el corte no es inclusivo');
  });

  it('cero trabajadores informados NO bloquea (la planilla puede estar en otra razón social)', () => {
    const { action } = decide({ officialRegistryWorkforce: { ...SII, workers: 0 } });
    assert.equal(action, 'needs_review');
  });

  it('un dato pequeño pero viejo tampoco bloquea', () => {
    const { action } = decide({ officialRegistryWorkforce: { ...SII, workers: 9, year: 2026 - OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS - 1 } });
    assert.equal(action, 'needs_review');
  });

  it(`dato con más de ${OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS} años se ignora`, () => {
    const { resolved } = decide({ officialRegistryWorkforce: { ...SII, year: 2026 - OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS - 1 } });
    assert.equal(resolved.selectedSource, 'unknown');
    const edge = decide({ officialRegistryWorkforce: { ...SII, year: 2026 - OFFICIAL_REGISTRY_WORKERS_MAX_AGE_YEARS } });
    assert.equal(edge.resolved.selectedSource, 'official_registry_workers');
  });

  it('LinkedIn / rich_profile manda aunque diga menos', () => {
    const { resolved, action } = decide({
      richProfileSize: { estimated_range: '51-200', status: 'estimated', source: 'linkedin' },
      officialRegistryWorkforce: SII,
    });
    assert.equal(resolved.selectedSource, 'rich_profile_size');
    assert.equal(action, 'needs_review');
  });

  it('company_size y HubSpot van antes', () => {
    assert.equal(decide({ candidateCompanySize: '11-50', officialRegistryWorkforce: SII }).resolved.selectedSource, 'candidate_company_size');
    assert.equal(decide({ matchedHubspotEmployees: 40, officialRegistryWorkforce: SII }).resolved.selectedSource, 'hubspot_number_of_employees');
  });

  it('sin dato del registro el comportamiento previo no cambia', () => {
    const { resolved, action } = decide({});
    assert.equal(resolved.selectedSource, 'unknown');
    assert.equal(action, 'needs_review');
  });
});

describe('extractOfficialRegistryWorkforce — lee lo que Apollo y Tavily ya guardan', () => {
  it('identidad fuerte con workforce ⇒ el dato', () => {
    assert.deepEqual(extractOfficialRegistryWorkforce(candidateWith({ workforce: { ...SII, salesBracket: 'x' } })), SII);
  });

  it('identidad débil ⇒ null aunque venga el dato', () => {
    assert.equal(extractOfficialRegistryWorkforce(candidateWith({ workforce: SII }, false)), null);
  });

  it('sin metadata, sin workforce o con valores inválidos ⇒ null', () => {
    assert.equal(extractOfficialRegistryWorkforce(candidateWith(null)), null);
    assert.equal(extractOfficialRegistryWorkforce(candidateWith({})), null);
    assert.equal(extractOfficialRegistryWorkforce({}), null);
    assert.equal(extractOfficialRegistryWorkforce(null), null);
    for (const bad of [
      { ...SII, workers: -1 },
      { ...SII, workers: 1.5 },
      { ...SII, workers: '350' },
      { ...SII, year: undefined },
      { ...SII, source: '' },
    ]) {
      assert.equal(extractOfficialRegistryWorkforce(candidateWith({ workforce: bad })), null, JSON.stringify(bad));
    }
  });
});
