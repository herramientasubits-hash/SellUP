/**
 * Perú.6A — Migo Legal Enrichment Foundation Tests
 *
 * Tests for src/server/prospect-batches/peru-migo-legal-enrichment.ts
 * Uses Node.js built-in test module. No Supabase connection. No real Migo calls.
 * lookupFn is always injected — no external calls made.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  enrichPeruCandidateWithMigoLegalLookup,
  resolveRucFromMigoInput,
} from '../../../../prospect-batches/peru-migo-legal-enrichment';
import type {
  PeMigoApiEnrichmentInput,
  PeMigoApiLookupResult,
  PeMigoApiLookupPayload,
} from '../../../../prospect-batches/peru-migo-legal-enrichment';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

const ENRICHMENT_FILE = join(
  __dirname_path,
  '..',
  '..',
  '..',
  '..',
  'prospect-batches',
  'peru-migo-legal-enrichment.ts',
);

// ── Test helpers ───────────────────────────────────────────────────────────────

const VALID_RUC = '20100047218';

function makeFoundPayload(
  overrides: Partial<PeMigoApiLookupPayload> = {},
): PeMigoApiLookupPayload {
  return {
    ruc: VALID_RUC,
    legal_name: 'EMPRESA TEST SAC',
    taxpayer_status: 'ACTIVO',
    domicile_condition: 'HABIDO',
    ubigeo: '150101',
    address: 'AV. TEST 123, LIMA',
    updated_at_source: '2024-06-01T00:00:00Z',
    ...overrides,
  };
}

function makeFoundResult(
  overrides: Partial<PeMigoApiLookupPayload> = {},
): PeMigoApiLookupResult {
  return { status: 'found', payload: makeFoundPayload(overrides) };
}

const mockFound = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve(makeFoundResult());

const mockNotFound = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve({ status: 'not_found' });

const mockApiUnavailable = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve({ status: 'api_unavailable', error: 'connection_timeout' });

const mockInactiveTaxpayer = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve(makeFoundResult({ taxpayer_status: 'BAJA DE OFICIO' }));

const mockNotHabido = (_ruc: string): Promise<PeMigoApiLookupResult> =>
  Promise.resolve(makeFoundResult({ domicile_condition: 'NO HABIDO' }));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Perú.6A — Migo Legal Enrichment Foundation', () => {

  // Test 1: PE with valid RUC and active Migo response → verified
  it('1. PE con RUC válido y Migo activo → metadata verified + migo_ruc_found_active', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockFound);

    assert.equal(result.enriched, true);
    assert.equal(result.countryCode, 'PE');
    assert.equal(result.ruc, VALID_RUC);
    assert.equal(result.reason, 'migo_lookup_completed');
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'verified');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'migo_ruc_found_active');
    assert.equal(result.pe_migo_api!.source_key, 'pe_migo_api');
    assert.equal(result.pe_migo_api!.ruc, VALID_RUC);
    assert.equal(result.pe_migo_api!.legal_name, 'EMPRESA TEST SAC');
    assert.equal(result.pe_migo_api!.taxpayer_status, 'ACTIVO');
    assert.equal(result.pe_migo_api!.domicile_condition, 'HABIDO');
  });

  // Test 2: PE with RUC not found by Migo → not_found
  it('2. PE con RUC no encontrado en Migo → not_found + migo_ruc_not_found', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockNotFound);

    assert.equal(result.enriched, true);
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'not_found');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'migo_ruc_not_found');
    assert.equal(result.pe_migo_api!.ruc, VALID_RUC);
    assert.equal(result.pe_migo_api!.legal_name, null);
  });

  // Test 3: PE with inactive taxpayer → flagged + migo_taxpayer_inactive
  it('3. PE con contribuyente inactivo → flagged + migo_taxpayer_inactive', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockInactiveTaxpayer);

    assert.equal(result.enriched, true);
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'flagged');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'migo_taxpayer_inactive');
    assert.equal(result.pe_migo_api!.taxpayer_status, 'BAJA DE OFICIO');
  });

  // Test 4: PE without RUC → pending_validation + missing_ruc
  it('4. PE sin RUC → pending_validation + missing_ruc', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
    };
    // Should not call lookupFn — asserting with a spy that throws if called
    const spyLookup = (_ruc: string): Promise<PeMigoApiLookupResult> => {
      throw new Error('lookupFn must NOT be called when RUC is missing');
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, spyLookup);

    assert.equal(result.enriched, true);
    assert.equal(result.ruc, null);
    assert.equal(result.reason, 'no_ruc');
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'pending_validation');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'missing_ruc');
    assert.equal(result.pe_migo_api!.ruc, null);
  });

  // Test 5: PE with invalid RUC format → invalid_ruc_format
  it('5. PE con RUC inválido → invalid_ruc_format', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: '12345',
    };
    const spyLookup = (_ruc: string): Promise<PeMigoApiLookupResult> => {
      throw new Error('lookupFn must NOT be called when RUC is invalid');
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, spyLookup);

    assert.equal(result.enriched, true);
    assert.equal(result.reason, 'invalid_ruc_format');
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'invalid_ruc_format');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'invalid_ruc_format');
  });

  // Test 6: API unavailable mock → api_unavailable
  it('6. API Migo no disponible → api_unavailable + migo_api_unavailable', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockApiUnavailable);

    assert.equal(result.enriched, true);
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'api_unavailable');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'migo_api_unavailable');
  });

  // Test 7: Not applicable for CO
  it('7. CO → no aplica Migo, enriched=false, pe_migo_api=null', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'CO',
      ruc: VALID_RUC,
    };
    const spyLookup = (_ruc: string): Promise<PeMigoApiLookupResult> => {
      throw new Error('lookupFn must NOT be called for CO');
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, spyLookup);

    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });

  // Test 8: Not applicable for MX
  it('8. MX → no aplica Migo, enriched=false, pe_migo_api=null', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'MX',
      ruc: VALID_RUC,
    };
    const spyLookup = (_ruc: string): Promise<PeMigoApiLookupResult> => {
      throw new Error('lookupFn must NOT be called for MX');
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, spyLookup);

    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });

  // Test 9: Not applicable for CL
  it('9. CL → no aplica Migo, enriched=false, pe_migo_api=null', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'CL',
      ruc: VALID_RUC,
    };
    const spyLookup = (_ruc: string): Promise<PeMigoApiLookupResult> => {
      throw new Error('lookupFn must NOT be called for CL');
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, spyLookup);

    assert.equal(result.enriched, false);
    assert.equal(result.pe_migo_api, null);
    assert.equal(result.reason, 'not_pe_country');
  });

  // Test 10: Does not delete pe_sunat_bulk
  it('10. No borra pe_sunat_bulk — resultado contiene pe_migo_api como clave separada', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockFound);

    // The result only has pe_migo_api, not pe_sunat_bulk
    assert.ok(result.pe_migo_api, 'pe_migo_api debe existir');
    assert.ok(
      !('pe_sunat_bulk' in result),
      'resultado no debe contener pe_sunat_bulk — son bloques separados',
    );
    // Source key is pe_migo_api
    assert.equal(result.pe_migo_api!.source_key, 'pe_migo_api');
  });

  // Test 11: Does not create CIIU
  it('11. No crea CIIU — ciiu_status siempre unavailable_for_mvp', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockFound);

    assert.ok(result.pe_migo_api, 'pe_migo_api debe existir');
    assert.equal(
      result.pe_migo_api!.ciiu_status,
      'unavailable_for_mvp',
      'ciiu_status debe ser unavailable_for_mvp',
    );
    assert.equal(
      result.pe_migo_api!.official_ciiu_available,
      false,
      'official_ciiu_available debe ser false',
    );
  });

  // Test 12: Does not create official sector
  it('12. No crea sector oficial — sector_source siempre not_provided_by_migo', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockFound);

    assert.ok(result.pe_migo_api, 'pe_migo_api debe existir');
    assert.equal(
      result.pe_migo_api!.sector_source,
      'not_provided_by_migo',
      'sector_source debe ser not_provided_by_migo',
    );
  });

  // Test 13: Does not save raw_payload
  it('13. No guarda raw_payload — archivo fuente no contiene raw_payload en bloque de metadata', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    // Allowed: the string 'raw_payload' only in comments/guardrails, NOT as object key assignment
    const rawPayloadInCode = source.match(/raw_payload\s*:/g) ?? [];
    const rawPayloadUpperInCode = source.match(/rawPayload\s*:/g) ?? [];
    assert.equal(
      rawPayloadInCode.length,
      0,
      `Archivo no debe asignar raw_payload como clave en objetos: ${rawPayloadInCode.join(', ')}`,
    );
    assert.equal(
      rawPayloadUpperInCode.length,
      0,
      `Archivo no debe asignar rawPayload como clave en objetos: ${rawPayloadUpperInCode.join(', ')}`,
    );
  });

  // Test 14: Does not expose API key via code (comments mentioning it as guardrail are allowed)
  it('14. No expone API key — archivo fuente no usa process.env.NEXT_PUBLIC_MIGO ni hardcodea MIGO_API_KEY=', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    // Check actual runtime usage, not just mention in comments
    assert.ok(
      !source.includes('process.env.NEXT_PUBLIC_MIGO'),
      'Archivo no debe leer process.env.NEXT_PUBLIC_MIGO en tiempo de ejecución',
    );
    assert.ok(
      !source.includes('MIGO_API_KEY='),
      'Archivo no debe hardcodear MIGO_API_KEY= como asignación',
    );
  });

  // Test 15: Does not call real Migo (no direct fetch)
  it('15. No llama Migo real — archivo fuente no hace fetch() directo', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    // The enrichment module itself must not contain fetch() calls
    // (the lookup is always injected via lookupFn)
    const fetchCalls = source.match(/\bfetch\s*\(/g) ?? [];
    assert.equal(
      fetchCalls.length,
      0,
      `Archivo no debe llamar fetch() directamente — lookupFn es siempre inyectada. Encontrado: ${fetchCalls.length}`,
    );
  });

  // Test 16: Does not call Tavily (guardrail comment mentioning it is allowed)
  it('16. No llama Tavily — archivo fuente no contiene llamadas reales a Tavily API', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    // Check for actual Tavily API usage patterns, not just the word in guardrail comments
    assert.ok(
      !source.includes('tavily('),
      'Archivo no debe llamar tavily() directamente',
    );
    assert.ok(
      !source.includes('TAVILY_API'),
      'Archivo no debe referenciar TAVILY_API key',
    );
    assert.ok(
      !source.includes('tavilySearch'),
      'Archivo no debe llamar tavilySearch',
    );
    assert.ok(
      !source.includes('tavilyClient'),
      'Archivo no debe instanciar tavilyClient',
    );
  });

  // Test 17: Does not call SUNAT web API
  it('17. No llama SUNAT web — archivo fuente no contiene fetch www2.sunat', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    assert.ok(
      !source.includes('www2.sunat'),
      "Archivo no debe llamar al endpoint SUNAT web (www2.sunat)",
    );
    assert.ok(
      !source.includes('padron_reducido_ruc.zip'),
      'Archivo no debe referenciar padron_reducido_ruc.zip',
    );
  });

  // Test 18: Does not execute importer
  it('18. No ejecuta importer — archivo fuente no llama import-peru-sunat-snapshot', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    assert.ok(
      !source.includes('import-peru-sunat-snapshot'),
      'Archivo no debe importar ni llamar el importer de SUNAT snapshot',
    );
    assert.ok(
      !source.includes('importPeruSunatSnapshot'),
      'Archivo no debe llamar importPeruSunatSnapshot',
    );
  });

  // Test 19: Does not create candidates, accounts, or batches
  it('19. No crea candidatos/cuentas/batches — archivo fuente no inserta en tablas principales', () => {
    const source = readFileSync(ENRICHMENT_FILE, 'utf-8');
    assert.ok(
      !source.includes('prospect_candidates.insert'),
      'Archivo no debe insertar en prospect_candidates',
    );
    assert.ok(
      !source.includes('prospect_batches.insert'),
      'Archivo no debe insertar en prospect_batches',
    );
    assert.ok(
      !source.includes("from('prospect_candidates').insert"),
      "Archivo no debe insertar en prospect_candidates via supabase",
    );
    assert.ok(
      !source.includes("from('prospect_batches').insert"),
      "Archivo no debe insertar en prospect_batches via supabase",
    );
    assert.ok(
      !source.includes("from('accounts').insert"),
      "Archivo no debe insertar en accounts via supabase",
    );
  });

  // Test 20: Domicile not_habido → flagged + migo_domicile_not_habido
  it('20. PE con domicilio no habido → flagged + migo_domicile_not_habido', async () => {
    const input: PeMigoApiEnrichmentInput = {
      countryCode: 'PE',
      ruc: VALID_RUC,
    };
    const result = await enrichPeruCandidateWithMigoLegalLookup(input, mockNotHabido);

    assert.equal(result.enriched, true);
    assert.ok(result.pe_migo_api, 'pe_migo_api block debe existir');
    assert.equal(result.pe_migo_api!.legal_validation_status, 'flagged');
    assert.equal(result.pe_migo_api!.legal_validation_reason, 'migo_domicile_not_habido');
    assert.equal(result.pe_migo_api!.domicile_condition, 'NO HABIDO');
    // CIIU invariants still present
    assert.equal(result.pe_migo_api!.ciiu_status, 'unavailable_for_mvp');
    assert.equal(result.pe_migo_api!.official_ciiu_available, false);
    assert.equal(result.pe_migo_api!.sector_source, 'not_provided_by_migo');
  });

  // ── Additional edge cases ────────────────────────────────────────────────────

  describe('resolveRucFromMigoInput', () => {
    it('resuelve desde input.ruc directamente', () => {
      assert.equal(
        resolveRucFromMigoInput({ countryCode: 'PE', ruc: VALID_RUC }),
        VALID_RUC,
      );
    });

    it('resuelve desde input.taxId cuando ruc es null', () => {
      assert.equal(
        resolveRucFromMigoInput({ countryCode: 'PE', ruc: null, taxId: VALID_RUC }),
        VALID_RUC,
      );
    });

    it('resuelve desde metadata.ruc cuando campos directos son null', () => {
      assert.equal(
        resolveRucFromMigoInput({
          countryCode: 'PE',
          ruc: null,
          taxId: null,
          metadata: { ruc: VALID_RUC },
        }),
        VALID_RUC,
      );
    });

    it('resuelve desde metadata.tax_id', () => {
      assert.equal(
        resolveRucFromMigoInput({
          countryCode: 'PE',
          metadata: { tax_id: VALID_RUC },
        }),
        VALID_RUC,
      );
    });

    it('resuelve desde metadata.tax_identifier', () => {
      assert.equal(
        resolveRucFromMigoInput({
          countryCode: 'PE',
          metadata: { tax_identifier: VALID_RUC },
        }),
        VALID_RUC,
      );
    });

    it('retorna null cuando no hay RUC en ningún campo', () => {
      assert.equal(
        resolveRucFromMigoInput({ countryCode: 'PE' }),
        null,
      );
    });
  });
});
