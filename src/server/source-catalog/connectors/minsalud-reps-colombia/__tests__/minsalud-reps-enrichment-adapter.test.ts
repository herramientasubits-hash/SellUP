// Tests — MinSalud REPS enrichment adapter
//
// Verifica el comportamiento del adapter ante los casos críticos:
// guard clauses, lookup por NIT, deduplicación de sedes, protección de datos
// personales, priority boost y fallback ante error Socrata.
// Sin llamadas reales a datos.gov.co. Sin Supabase. Solo lógica in-process.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeRepsNIT,
  calculateRepsPriorityBoost,
  buildMatchResultFromRepsGroup,
  enrichCandidateImpl,
} from '../minsalud-reps-enrichment-adapter';

// ─── Raw record factory ───────────────────────────────────────────────────────

function makeRawRepsRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    numeroidentificacion: '900123456',
    tipoid: 'NI',
    nombreprestador: 'Clínica Test SAS',
    codigoprestador: 'ANT0123',
    claseprestador: 'IPS',
    naturalezajuridica: 'PRIVADA',
    ese: 'NO',
    departamentoprestadordesc: 'ANTIOQUIA',
    municipioprestadordesc: 'MEDELLÍN',
    direccionprestador: 'CL 50 No 40-20',
    email_prestador: 'contacto@clinica.com',
    telefonoprestador: '4448888',
    codigohabilitacionsede: 'ANT0123S001',
    nombresede: 'Sede Principal',
    direcci_nsede: 'CL 50 No 40-20',
    email_sede: 'sede@clinica.com',
    t_lefonosede: '4448888',
    ...overrides,
  };
}

// ─── Fake fetch that must never be called ────────────────────────────────────

const neverCalledFetch: typeof import('../../socrata-colombia/socrata-client').fetchSocrataDatasetSample =
  async () => { throw new Error('fetchSocrataDatasetSample should not have been called'); };

// ─── 1. normalizeRepsNIT ──────────────────────────────────────────────────────

describe('normalizeRepsNIT', () => {
  it('strips dots and spaces', () => {
    assert.equal(normalizeRepsNIT('900.123.456'), '900123456');
  });

  it('strips verification digit after dash', () => {
    assert.equal(normalizeRepsNIT('900123456-1'), '900123456');
  });

  it('strips dots and verification digit', () => {
    assert.equal(normalizeRepsNIT('900.123.456-1'), '900123456');
  });

  it('strips leading/trailing spaces', () => {
    assert.equal(normalizeRepsNIT('  900123456  '), '900123456');
  });

  it('returns plain digits unchanged', () => {
    assert.equal(normalizeRepsNIT('900123456'), '900123456');
  });

  it('returns empty string for non-digit input', () => {
    assert.equal(normalizeRepsNIT('---'), '');
  });
});

// ─── 2. calculateRepsPriorityBoost ───────────────────────────────────────────

describe('calculateRepsPriorityBoost', () => {
  it('NI tipoid + single site → 6', () => {
    assert.equal(calculateRepsPriorityBoost('NI', 1), 6);
  });

  it('NI tipoid + multiple sites → 8', () => {
    assert.equal(calculateRepsPriorityBoost('NI', 3), 8);
  });

  it('CC tipoid → 3 regardless of site count', () => {
    assert.equal(calculateRepsPriorityBoost('CC', 1), 3);
    assert.equal(calculateRepsPriorityBoost('CC', 5), 3);
  });

  it('null tipoid → 3', () => {
    assert.equal(calculateRepsPriorityBoost(null, 1), 3);
  });
});

// ─── 3. Guard clauses — país y NIT ───────────────────────────────────────────

// 1. País distinto a CO → skipped
describe('enrichCandidateImpl — guard: non-CO country', () => {
  it('returns skipped for MX', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'MX', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'country_not_supported');
    assert.equal(result.sourceKey, 'co_minsalud_reps');
  });
});

// 2. missing_tax_id → skipped
describe('enrichCandidateImpl — guard: missing tax_id', () => {
  it('returns skipped when candidateTaxId is null', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: null, capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when candidateTaxId is empty string', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '  ', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });

  it('returns skipped when NIT normalizes to empty', async () => {
    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '---', capability: 'enrichment_after_discovery' },
      neverCalledFetch,
    );
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_tax_id');
  });
});

// ─── 4. Match tipoid NI con una sede → matched + priorityBoost 6 ─────────────

describe('enrichCandidateImpl — NI tipoid, single site', () => {
  it('returns matched with priorityBoost 6 and health_provider_registered true', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [makeRawRepsRecord()],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Clínica Test SAS', countryCode: 'CO', candidateTaxId: '900.123.456-1', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    assert.equal(result.matchedBy, 'tax_id');
    assert.equal(result.confidence, 0.95);
    assert.equal(result.priorityBoost, 6);
    assert.equal(result.sourceKey, 'co_minsalud_reps');

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['health_provider_registered'], true);
    assert.equal(signals['total_sites'], 1);
    assert.equal(signals['has_multiple_sites'], false);
    assert.equal(signals['provider_class'], 'IPS');

    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['source_dataset_id'], 'c36g-9fc2');
    assert.equal(meta['matched_by'], 'tax_id');
    assert.equal(meta['personal_data_guard_applied'], false);

    const enrichment = meta['enrichment'] as Record<string, unknown>;
    assert.equal(enrichment['provider_name'], 'Clínica Test SAS');
    assert.equal(enrichment['tax_id'], '900123456');
    assert.equal(enrichment['email'], 'contacto@clinica.com');
    assert.equal(enrichment['phone'], '4448888');

    const sites = enrichment['sites'] as unknown[];
    assert.equal(sites.length, 1);
    const site0 = sites[0] as Record<string, unknown>;
    assert.equal(site0['site_code'], 'ANT0123S001');
    assert.equal(site0['site_name'], 'Sede Principal');
  });
});

// ─── 5. Match tipoid NI con múltiples sedes → matched + total_sites > 1 + priorityBoost 8 ──

describe('enrichCandidateImpl — NI tipoid, multiple sites', () => {
  it('deduplicates sedes and returns priorityBoost 8', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [
        makeRawRepsRecord({
          codigohabilitacionsede: 'ANT0123S001',
          nombresede: 'Sede Principal',
        }),
        makeRawRepsRecord({
          codigohabilitacionsede: 'ANT0123S002',
          nombresede: 'Sede Norte',
          municipioprestadordesc: 'BELLO',
        }),
      ],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Clínica Test SAS', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    assert.equal(result.priorityBoost, 8);

    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['total_sites'], 2);
    assert.equal(signals['has_multiple_sites'], true);

    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    const sites = enrichment['sites'] as unknown[];
    assert.equal(sites.length, 2);
  });
});

// ─── 6. Match tipoid CC → personal_data_guard + email/phone null + priorityBoost 3 ──

describe('enrichCandidateImpl — CC tipoid (persona natural)', () => {
  it('guards personal data: email and phone null, personal_data_guard_applied true, priorityBoost 3', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [
        makeRawRepsRecord({
          tipoid: 'CC',
          numeroidentificacion: '12345678',
          nombreprestador: 'Médico Natural',
          email_prestador: 'medico@personal.com',  // must NOT appear in enrichment
          telefonoprestador: '3001234567',           // must NOT appear in enrichment
        }),
      ],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Médico Natural', countryCode: 'CO', candidateTaxId: '12345678', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');
    assert.equal(result.priorityBoost, 3);

    const meta = result.metadata as Record<string, unknown>;
    assert.equal(meta['personal_data_guard_applied'], true);

    const enrichment = meta['enrichment'] as Record<string, unknown>;
    // 10. No expone contacto de persona natural como dato principal
    assert.equal(enrichment['email'], null, 'email should be null for CC tipoid');
    assert.equal(enrichment['phone'], null, 'phone should be null for CC tipoid');
  });
});

// ─── 7. Socrata error → error controlado ─────────────────────────────────────

describe('enrichCandidateImpl — Socrata error', () => {
  it('returns status error without throwing', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: false,
      error: 'HTTP 503 desde c36g-9fc2',
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'error');
    assert.equal(result.matchedBy, null);
    assert.equal(result.confidence, 0);
    assert.match(result.reason ?? '', /503/);
  });
});

// ─── 3. Socrata no match → no_match ──────────────────────────────────────────

describe('enrichCandidateImpl — Socrata no_match', () => {
  it('returns no_match when Socrata returns empty array', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({ ok: true, records: [] });

    const result = await enrichCandidateImpl(
      { candidateName: 'Empresa X', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'no_match');
    assert.equal(result.matchedBy, null);
  });
});

// ─── 8 & 9. dedupeRepsRecordsByProvider + codigohabilitacionsede en sites[] ──

describe('enrichCandidateImpl — deduplication and site structure', () => {
  it('uses dedupeRepsRecordsByProvider: two raw records collapse into one entity with sites[]', async () => {
    const mockFetch: typeof neverCalledFetch = async () => ({
      ok: true,
      records: [
        makeRawRepsRecord({ codigohabilitacionsede: 'ANT0123S001', nombresede: 'Sede A' }),
        makeRawRepsRecord({ codigohabilitacionsede: 'ANT0123S002', nombresede: 'Sede B' }),
      ],
    });

    const result = await enrichCandidateImpl(
      { candidateName: 'Clínica Test SAS', countryCode: 'CO', candidateTaxId: '900123456', capability: 'enrichment_after_discovery' },
      mockFetch,
    );

    assert.equal(result.status, 'matched');

    // 8. dedupeRepsRecordsByProvider colapsó 2 filas en 1 entidad
    const signals = result.signals as Record<string, unknown>;
    assert.equal(signals['total_sites'], 2);

    // 9. codigohabilitacionsede queda en sites[], no como identidad principal
    const enrichment = (result.metadata as Record<string, unknown>)['enrichment'] as Record<string, unknown>;
    const sites = enrichment['sites'] as Array<Record<string, unknown>>;
    assert.equal(sites.length, 2);

    const siteCodes = sites.map((s) => s['site_code']);
    assert.ok(siteCodes.includes('ANT0123S001'), 'site_code ANT0123S001 must be in sites[]');
    assert.ok(siteCodes.includes('ANT0123S002'), 'site_code ANT0123S002 must be in sites[]');

    // La identidad principal (reps_provider_code) es el prestador, no una sede
    assert.equal(enrichment['reps_provider_code'], 'ANT0123');
  });
});
