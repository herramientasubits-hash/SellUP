/**
 * Perú.6B — Migo Legal Lookup Tests
 *
 * Tests for src/server/services/peru-migo-legal-lookup.ts
 * Uses Node.js built-in test module. No real Migo calls.
 * fetch and getApiKeyFn are always injected — no external HTTP calls made.
 * No module mocks needed — follows the same injection pattern as Perú.6A.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { lookupPeruMigoByRuc } from '../../../../services/peru-migo-legal-lookup';

const __filename = fileURLToPath(import.meta.url);
const __dirname_path = dirname(__filename);

const LOOKUP_FILE = join(
  __dirname_path,
  '..',
  '..',
  '..',
  '..',
  'services',
  'peru-migo-legal-lookup.ts',
);

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_RUC = '20100050359';

function mockApiKey(key: string | null): () => Promise<string | null> {
  return async () => key;
}

const validApiKey = mockApiKey('test-api-key-mock');

function makeMigoSuccessResponse(overrides: Record<string, unknown> = {}): Response {
  const body = {
    success: true,
    ruc: VALID_RUC,
    nombre_o_razon_social: 'A W FABER CASTELL PERUANA S A',
    estado_del_contribuyente: 'ACTIVO',
    condicion_de_domicilio: 'HABIDO',
    ubigeo: '150101',
    direccion: 'AV DEFENSORES DEL MORRO 1277, CHORRILLOS, LIMA',
    actualizado_en: '2024-06-01T00:00:00Z',
    ...overrides,
  };
  return {
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function makeNotFoundResponse(): Response {
  return {
    status: 200,
    json: async () => ({ success: false, message: 'RUC no encontrado' }),
  } as unknown as Response;
}

function makeHttpErrorResponse(status: number): Response {
  return {
    status,
    json: async () => ({ error: 'error' }),
  } as unknown as Response;
}

function makeFetch(response: Response): typeof fetch {
  return async () => response;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('peru-6b lookupPeruMigoByRuc', () => {

  // 1. RUC válido ACTIVO → found + payload normalizado
  it('1. returns found with normalized payload for active habido RUC', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse()),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    assert.ok(result.payload, 'should have payload');
    assert.equal(result.payload!.ruc, VALID_RUC);
    assert.equal(result.payload!.taxpayer_status, 'ACTIVO');
    assert.equal(result.payload!.domicile_condition, 'HABIDO');
    assert.ok(result.payload!.legal_name?.includes('FABER'));
  });

  // 2. RUC no encontrado → not_found
  it('2. returns not_found when API returns success=false', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeNotFoundResponse()),
      validApiKey,
    );

    assert.equal(result.status, 'not_found');
    assert.equal(result.payload, undefined);
  });

  // 3. RUC inactivo → found (lookup normaliza, caller decide flag)
  it('3. returns found with inactive taxpayer status for inactive RUC', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse({ estado_del_contribuyente: 'BAJA DEFINITIVA' })),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    assert.equal(result.payload!.taxpayer_status, 'BAJA DEFINITIVA');
  });

  // 4. Domicilio no HABIDO → found con condición propagada
  it('4. returns found with non-habido domicile condition', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse({ condicion_de_domicilio: 'NO HABIDO' })),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    assert.equal(result.payload!.domicile_condition, 'NO HABIDO');
  });

  // 5. API error (500) → api_unavailable
  it('5. returns api_unavailable on HTTP 500', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeHttpErrorResponse(500)),
      validApiKey,
    );

    assert.equal(result.status, 'api_unavailable');
    assert.ok(result.error?.includes('500'), `error should include 500, got: ${result.error}`);
  });

  // 6. RUC inválido → api_unavailable con invalid_ruc_format
  it('6. returns api_unavailable with invalid_ruc_format for non-11-digit RUC', async () => {
    const result = await lookupPeruMigoByRuc(
      '1234',
      makeFetch(makeMigoSuccessResponse()),
      validApiKey,
    );

    assert.equal(result.status, 'api_unavailable');
    assert.equal(result.error, 'invalid_ruc_format');
  });

  // 7. No devuelve CIIU
  it('7. does not return ciiu in normalized payload', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse({
        ciiu: '4711',
        ciiu_descripcion: 'Comercio al por menor',
      })),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    const payload = result.payload!;
    assert.ok(!('ciiu' in payload), 'payload must not contain ciiu');
    assert.ok(!('ciiu_code' in payload), 'payload must not contain ciiu_code');
    assert.ok(!('ciiu_description' in payload), 'payload must not contain ciiu_description');
  });

  // 8. No devuelve sector oficial
  it('8. does not return sector_source in normalized payload', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse()),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    const payload = result.payload!;
    assert.ok(!('sector_source' in payload), 'payload must not contain sector_source');
    assert.ok(!('official_ciiu_available' in payload), 'payload must not contain official_ciiu_available');
  });

  // 9. No guarda raw_payload
  it('9. does not include raw_payload in result', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse({
        extra_internal_field: 'secret',
        raw_data: 'big object',
      })),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('raw_payload'), 'must not contain raw_payload');
    assert.ok(!resultStr.includes('rawPayload'), 'must not contain rawPayload');
    assert.ok(!resultStr.includes('extra_internal_field'), 'must not contain extra raw fields');
  });

  // 10. No expone API key
  it('10. does not expose API key in result', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeMigoSuccessResponse()),
      mockApiKey('super-secret-migo-key-12345'),
    );

    const resultStr = JSON.stringify(result);
    assert.ok(!resultStr.includes('super-secret-migo-key-12345'), 'must not expose API key');
    assert.ok(!resultStr.includes('"token"'), 'must not expose token field in result');
  });

  // 11. No usa Authorization Bearer
  it('11. does not send Authorization: Bearer header', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchFn: typeof fetch = async (_url, opts) => {
      capturedHeaders = opts?.headers;
      return makeMigoSuccessResponse();
    };

    await lookupPeruMigoByRuc(VALID_RUC, fetchFn, validApiKey);

    const headersStr = JSON.stringify(capturedHeaders ?? {}).toLowerCase();
    assert.ok(!headersStr.includes('authorization'), 'must not use Authorization header');
    assert.ok(!headersStr.includes('bearer'), 'must not use Bearer token');
  });

  // 12. Usa POST con body { token, ruc }
  it('12. calls Migo API with POST and body containing token + ruc', async () => {
    let capturedMethod: string | undefined;
    let capturedBody: string | undefined;

    const fetchFn: typeof fetch = async (_url, opts) => {
      capturedMethod = opts?.method;
      capturedBody = opts?.body as string;
      return makeMigoSuccessResponse();
    };

    await lookupPeruMigoByRuc(VALID_RUC, fetchFn, mockApiKey('expected-token-value'));

    assert.equal(capturedMethod, 'POST');
    assert.ok(capturedBody, 'must have a body');
    const parsed = JSON.parse(capturedBody!);
    assert.equal(parsed.token, 'expected-token-value');
    assert.equal(parsed.ruc, VALID_RUC);
    assert.ok(!('authorization' in parsed), 'body must not contain authorization');
  });

  // 13. No llama Tavily — comprueba que no hay imports ni llamadas reales
  it('13. source file does not contain Tavily API calls or imports', () => {
    const source = readFileSync(LOOKUP_FILE, 'utf-8');
    // Check for actual code patterns (import statements, API calls) not comment mentions
    assert.ok(!source.includes("from 'tavily'"), 'must not import tavily');
    assert.ok(!source.includes('from "@tavily'), 'must not import @tavily');
    assert.ok(!source.includes('tavily.search('), 'must not call tavily.search');
    assert.ok(!source.includes('tavilyClient'), 'must not use tavilyClient');
    assert.ok(!source.includes('TAVILY_API_KEY'), 'must not reference TAVILY_API_KEY');
  });

  // 14. No llama SUNAT web
  it('14. source file does not contain SUNAT web URL references', () => {
    const source = readFileSync(LOOKUP_FILE, 'utf-8');
    assert.ok(!source.includes('http://www2.sunat'), 'must not reference SUNAT web URL');
    assert.ok(!source.includes('padron_reducido_ruc.zip'), 'must not reference SUNAT ZIP');
  });

  // 15. No ejecuta importer
  it('15. source file does not reference the SUNAT importer', () => {
    const source = readFileSync(LOOKUP_FILE, 'utf-8');
    assert.ok(!source.includes('import-peru-sunat-snapshot'), 'must not reference importer');
    assert.ok(!source.includes('runImporter'), 'must not reference runImporter');
  });

  // 16. No crea candidatos/cuentas/batches — verifica patrones de código, no comentarios
  it('16. source file does not insert into candidates, batches, or accounts', () => {
    const source = readFileSync(LOOKUP_FILE, 'utf-8');
    // Check for actual Supabase insert/upsert calls, not comment mentions
    assert.ok(!source.includes(".from('prospect_candidates')"), 'must not query prospect_candidates');
    assert.ok(!source.includes(".from('prospect_batches')"), 'must not query prospect_batches');
    assert.ok(!source.includes(".from('accounts')"), 'must not touch accounts');
    assert.ok(!source.includes('.insert('), 'must not call .insert()');
    assert.ok(!source.includes('.upsert('), 'must not call .upsert() on candidates/batches');
  });

  // 17. Sin credencial → api_unavailable, sin llamar fetch
  it('17. returns api_unavailable without calling fetch when no credential', async () => {
    let fetchCalled = false;
    const fetchFn: typeof fetch = async () => {
      fetchCalled = true;
      return makeMigoSuccessResponse();
    };

    const result = await lookupPeruMigoByRuc(VALID_RUC, fetchFn, mockApiKey(null));

    assert.equal(result.status, 'api_unavailable');
    assert.equal(result.error, 'migo_credential_not_configured');
    assert.equal(fetchCalled, false, 'fetch must not be called without credential');
  });

  // Network error → api_unavailable
  it('returns api_unavailable on network error', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error('network failure');
    };
    const result = await lookupPeruMigoByRuc(VALID_RUC, fetchFn, validApiKey);

    assert.equal(result.status, 'api_unavailable');
    assert.equal(result.error, 'migo_network_error');
  });

  // 401 → api_unavailable con auth_failed
  it('returns api_unavailable with migo_auth_failed on 401', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeHttpErrorResponse(401)),
      validApiKey,
    );

    assert.equal(result.status, 'api_unavailable');
    assert.equal(result.error, 'migo_auth_failed');
  });

  // 429 → rate limited
  it('returns api_unavailable with migo_rate_limited on 429', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch(makeHttpErrorResponse(429)),
      validApiKey,
    );

    assert.equal(result.status, 'api_unavailable');
    assert.equal(result.error, 'migo_rate_limited');
  });

  // Normalizes razon_social fallback
  it('normalizes razon_social fallback when nombre_o_razon_social is absent', async () => {
    const result = await lookupPeruMigoByRuc(
      VALID_RUC,
      makeFetch({
        status: 200,
        json: async () => ({
          success: true,
          ruc: VALID_RUC,
          razon_social: 'EMPRESA FALLBACK SAC',
          estado: 'ACTIVO',
          condicion: 'HABIDO',
          ubigeo: '150101',
          direccion: 'AV LIMA 100',
        }),
      } as unknown as Response),
      validApiKey,
    );

    assert.equal(result.status, 'found');
    assert.equal(result.payload!.legal_name, 'EMPRESA FALLBACK SAC');
  });

  // source file does not use NEXT_PUBLIC_MIGO as an actual env var reference
  it('source file does not use NEXT_PUBLIC_MIGO as env var', () => {
    const source = readFileSync(LOOKUP_FILE, 'utf-8');
    // Check for actual env var access patterns, not comment mentions
    assert.ok(!source.includes('process.env.NEXT_PUBLIC_MIGO'), 'must not access NEXT_PUBLIC_MIGO env');
    assert.ok(!source.includes('NEXT_PUBLIC_MIGO_API'), 'must not reference NEXT_PUBLIC_MIGO_API');
    assert.ok(!source.includes('NEXT_PUBLIC_MIGO_KEY'), 'must not reference NEXT_PUBLIC_MIGO_KEY');
  });
});
