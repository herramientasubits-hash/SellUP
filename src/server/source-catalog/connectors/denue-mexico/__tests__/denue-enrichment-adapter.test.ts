import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Mock } from 'node:test';
import type { SourceEnrichmentInput } from '../../../enrichment/types';
import type { FetchDenueResult } from '../denue-client';
import { enrichCandidateImpl, denueEnrichmentAdapter, type DenueFetchFn } from '../denue-enrichment-adapter';

function mockDenueFetch(result: FetchDenueResult): { fn: DenueFetchFn; mock: Mock<DenueFetchFn> } {
  const m = mock.fn(async () => result) as unknown as Mock<DenueFetchFn>;
  return { fn: m as unknown as DenueFetchFn, mock: m };
}

const MX_INPUT: SourceEnrichmentInput = {
  candidateName: 'OXXO',
  countryCode: 'MX',
  capability: 'enrichment_after_discovery',
};

const CO_INPUT: SourceEnrichmentInput = {
  candidateName: 'Empresa CO',
  countryCode: 'CO',
  capability: 'enrichment_after_discovery',
};

const MATCH_RECORD = {
  Nombre: 'OXXO',
  Razon_social: 'OXXO SA de CV',
  Clase_actividad: 'Comercio al por menor',
  Estrato: '51 a 100 personas',
  CLEE: 'DENUE001',
  Tipo_vialidad: 'Calle',
  Calle: 'Av Principal',
  Num_Exterior: '123',
  Colonia: 'Centro',
  CP: '06000',
  Ubicacion: 'Ciudad de Mexico, Cuauhtemoc, CIUDAD DE MEXICO',
  Telefono: '555-1234',
  Sitio_internet: 'www.oxxo.com',
};

const MULTIPLE_MATCHES = [
  { ...MATCH_RECORD, CLEE: 'DENUE001', Nombre: 'OXXO' },
  { ...MATCH_RECORD, CLEE: 'DENUE002', Nombre: 'OXXO GAS', Ubicacion: 'Monterrey, Nuevo Leon, NUEVO LEON' },
  { ...MATCH_RECORD, CLEE: 'DENUE003', Nombre: 'OXXO ALMACEN', Ubicacion: 'Guadalajara, Jalisco, JALISCO' },
];

describe('DENUE enrichment adapter', () => {
  describe('enrichCandidateImpl', () => {
    it('returns skipped for non-MX country', async () => {
      const { fn, mock: m } = mockDenueFetch({ ok: true, records: [] });
      const result = await enrichCandidateImpl(CO_INPUT, fn);
      assert.equal(result.status, 'skipped');
      assert.equal(result.reason, 'country_not_supported');
      assert.equal(m.mock.callCount(), 0);
    });

    it('returns skipped for empty name', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [] });
      const result = await enrichCandidateImpl(
        { ...MX_INPUT, candidateName: '' },
        fn,
      );
      assert.equal(result.status, 'skipped');
      assert.equal(result.reason, 'missing_candidate_name');
    });

    it('returns error when DENUE API fails', async () => {
      const { fn } = mockDenueFetch({ ok: false, error: 'API failure' });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      assert.equal(result.status, 'error');
      assert.equal(result.confidence, 0);
    });

    it('returns no_match when DENUE returns empty', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [] });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      assert.equal(result.status, 'no_match');
      assert.equal(result.confidence, 0);
    });

    it('returns matched with confidence 0.75 for exact name match', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [MATCH_RECORD] });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      assert.equal(result.status, 'matched');
      assert.equal(result.confidence, 0.75);
      assert.equal(result.matchedBy, 'exact_name');
    });

    it('returns ambiguous with multiple matches', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: MULTIPLE_MATCHES });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      assert.equal(result.status, 'matched');
      assert.ok(result.metadata);
      const meta = result.metadata as Record<string, unknown>;
      assert.equal(meta['status'], 'ambiguous');
      assert.ok(Array.isArray(meta['matches']));
      assert.equal((meta['matches'] as unknown[]).length, 3);
    });

    it('caps matches at 5', async () => {
      const manyRecords = Array.from({ length: 10 }, (_, i) => ({
        ...MATCH_RECORD,
        CLEE: `DENUE${i}`,
        Nombre: `OXXO ${i}`,
      }));
      const { fn } = mockDenueFetch({ ok: true, records: manyRecords });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      const meta = result.metadata as Record<string, unknown>;
      assert.ok(Array.isArray(meta['matches']));
      assert.equal((meta['matches'] as unknown[]).length, 5);
    });

    it('returns no_match when all results are below confidence threshold', async () => {
      const lowMatchRecords = [
        { ...MATCH_RECORD, CLEE: 'DENUE001', Nombre: 'Farmacia Benavides' },
        { ...MATCH_RECORD, CLEE: 'DENUE002', Nombre: 'Farmacia Guadalajara' },
      ];
      const { fn } = mockDenueFetch({ ok: true, records: lowMatchRecords });
      const result = await enrichCandidateImpl(
        { ...MX_INPUT, candidateName: 'OXXO' },
        fn,
      );
      assert.equal(result.status, 'no_match');
    });

    it('searches with first significant token', async () => {
      const { fn, mock: m } = mockDenueFetch({ ok: true, records: [] });
      await enrichCandidateImpl(
        { ...MX_INPUT, candidateName: 'CEMEX Mexico SA de CV' },
        fn,
      );
      const callArgs = m.mock.calls[0]?.arguments[0] as Record<string, unknown> | undefined;
      assert.ok(callArgs);
      assert.equal(callArgs['condicion'], 'cemex mexico');
    });
  });

  describe('does_not_resolve_tax_identifier contract', () => {
    it('metadata always includes does_not_resolve_tax_identifier: true', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [MATCH_RECORD] });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      const meta = result.metadata as Record<string, unknown> | undefined;
      assert.ok(meta);
      assert.equal(meta['does_not_resolve_tax_identifier'], true);
    });

    it('metadata always includes human_review_required: true', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [MATCH_RECORD] });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      const meta = result.metadata as Record<string, unknown> | undefined;
      assert.ok(meta);
      assert.equal(meta['human_review_required'], true);
    });

    it('error metadata includes does_not_resolve_tax_identifier', async () => {
      const { fn } = mockDenueFetch({ ok: false, error: 'fail' });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      const meta = result.metadata as Record<string, unknown> | undefined;
      assert.ok(meta);
      assert.equal(meta['does_not_resolve_tax_identifier'], true);
    });

    it('no_match metadata includes does_not_resolve_tax_identifier', async () => {
      const { fn } = mockDenueFetch({ ok: true, records: [] });
      const result = await enrichCandidateImpl(MX_INPUT, fn);
      const meta = result.metadata as Record<string, unknown> | undefined;
      assert.ok(meta);
      assert.equal(meta['does_not_resolve_tax_identifier'], true);
    });
  });

  describe('adapter interface', () => {
    it('has correct sourceKey', () => {
      assert.equal(denueEnrichmentAdapter.sourceKey, 'mx_denue');
    });

    it('supports enrichment_after_discovery', () => {
      assert.ok(denueEnrichmentAdapter.supportedCapabilities.includes('enrichment_after_discovery'));
    });
  });
});
