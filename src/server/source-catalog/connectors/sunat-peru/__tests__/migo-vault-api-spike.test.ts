/**
 * Migo Vault API Spike — Tests
 *
 * Mockea resolveSourceCredential via setter de test, fetch global, y writeFile.
 * No hace llamadas reales a Migo API. No lee snapshot real.
 * No escribe Supabase. No crea candidatos.
 *
 * Nota: NO usa mock.module (conflicto con mock.restoreAll en afterEach).
 * Usa __setWriteFileForTest y __setResolveSourceCredentialForTest (inyección directa).
 * El mock de fetch se restaura manualmente entre tests guardando ref original.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  runMigoVaultApiSpike,
  __setResolveSourceCredentialForTest,
  __setWriteFileForTest,
} from '../migo-vault-api-spike';

import { MIGO_API_BASE } from '../types';

// ─── Mutable mock state ─────────────────────────────────────────────────────

let mockResolverShouldThrow = false;
let mockResolverReturnNull = false;
let mockResolverToken = 'mock-key-test-1234';
let mockWriteFilePath = '';
let mockWriteFileData = '';
let _origFetch: typeof globalThis.fetch | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMigoJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function resetRuntimeState(): void {
  mockResolverShouldThrow = false;
  mockResolverReturnNull = false;
  mockResolverToken = 'mock-key-test-1234';
  mockWriteFilePath = '';
  mockWriteFileData = '';
  if (_origFetch) {
    globalThis.fetch = _origFetch;
    _origFetch = null;
  }
}

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): void {
  _origFetch = globalThis.fetch;
  globalThis.fetch = impl as typeof globalThis.fetch;
}

function setupWriteFileMock(): void {
  __setWriteFileForTest(async (path: string, data: string) => {
    mockWriteFilePath = path;
    mockWriteFileData = data;
  });
}

function setupDefaultResolveMock(): void {
  __setResolveSourceCredentialForTest(async () => {
    if (mockResolverShouldThrow) throw new Error('mock no credential');
    if (mockResolverReturnNull) return null;
    return {
      token: mockResolverToken,
      authType: 'api_key',
      sourceKey: 'pe_migo_api',
      vaultSecretName: 'sellup_source_pe_migo_api_api_key',
    };
  });
}

function buildFullMockPayload(ruc: string): Record<string, unknown> {
  return {
    success: true,
    ruc,
    nombre_o_razon_social: `EMPRESA DE PRUEBA ${ruc} SAC`,
    ciiu: '6201',
    ciiu_descripcion: 'Actividades de programación informática',
    ciiu_revision: '4',
    actividad_economica: 'Actividades de programación informática y consultoría',
    actividades_secundarias: [
      { ciiu: '6202', descripcion: 'Consultoría informática' },
      { ciiu: '6209', descripcion: 'Otros servicios informáticos' },
    ],
    estado: 'ACTIVO',
    condicion: 'HABIDO',
    direccion_completa: 'AV. PRUEBA NRO 123',
    ubigeo: '150101',
    departamento: 'LIMA',
    provincia: 'LIMA',
    distrito: 'LIMA',
  };
}

afterEach(() => {
  resetRuntimeState();
});

// ─── Bootstrap: install writeFile mock once (replaced mock.module) ────────
setupWriteFileMock();

// ─── Guardrail Tests ─────────────────────────────────────────────────────────

describe('guardrails', () => {
  it('bloquea sin MIGO_API_SPIKE_ACK', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    delete process.env.MIGO_API_SPIKE_ACK;

    try {
      const output = await runMigoVaultApiSpike({ requireAck: true, sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.ackProvided, false);
      assert.ok(output.errors.some((e) => e.includes('ACK_REQUIRED')));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('bloquea si no hay credencial en Vault', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    mockResolverShouldThrow = true;
    setupDefaultResolveMock();

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'missing_vault_credential');
      assert.equal(output.environment.vaultCredentialPresent, false);
      assert.ok(output.errors.some((e) => e.includes('credencial')));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('bloquea en Vercel', async () => {
    const origVercel = process.env.VERCEL;
    process.env.VERCEL = '1';

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.vercelDetected, true);
      assert.ok(output.errors.some((e) => e.includes('VERCEL')));
    } finally {
      if (origVercel) process.env.VERCEL = origVercel;
      else delete process.env.VERCEL;
    }
  });

  it('bloquea en production', async () => {
    const env = process.env as Record<string, string | undefined>;
    const origNodeEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'blocked');
      assert.equal(output.environment.productionDetected, true);
      assert.ok(output.errors.some((e) => e.includes('PRODUCTION')));
    } finally {
      if (origNodeEnv) env.NODE_ENV = origNodeEnv;
      else delete env.NODE_ENV;
    }
  });

  it('bloquea sin credencial cuando resolveSourceCredential retorna null', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    mockResolverReturnNull = true;
    setupDefaultResolveMock();

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'missing_vault_credential');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Token Safety Tests ──────────────────────────────────────────────────────

describe('token safety', () => {
  it('no imprime token', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse((init?.body ?? '') as string);
      assert.equal(body.token, mockResolverToken);
      assert.equal(body.ruc, '20100047218');
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      const outputStr = JSON.stringify(output);
      assert.ok(!outputStr.includes(mockResolverToken));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('no incluye token en reporte', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.ok(mockWriteFileData.length > 0);
      const report = JSON.parse(mockWriteFileData);
      const reportStr = JSON.stringify(report);
      assert.ok(!reportStr.includes(mockResolverToken));
      assert.ok(!reportStr.includes('mock-key'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Request Limits Tests ────────────────────────────────────────────────────

describe('request limits', () => {
  it('limita llamadas a 10 por defecto', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();
    let callCount = 0;

    mockFetch(async () => {
      callCount++;
      return makeMigoJsonResponse(buildFullMockPayload(`2010000000${callCount}`));
    });

    try {
      const manyRucs = Array.from({ length: 20 }, (_, i) => `2010000000${i}`);
      const output = await runMigoVaultApiSpike({ sampleRucs: manyRucs });
      assert.ok(output.requestProfile.attemptedRequests <= 10);
      assert.equal(output.requestProfile.successfulResponses, callCount);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('respeta maxRucsToTest', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();
    let callCount = 0;

    mockFetch(async () => {
      callCount++;
      return makeMigoJsonResponse(buildFullMockPayload(`2010000000${callCount}`));
    });

    try {
      const manyRucs = Array.from({ length: 10 }, (_, i) => `2010000000${i}`);
      const output = await runMigoVaultApiSpike({ sampleRucs: manyRucs, maxRucsToTest: 3 });
      assert.equal(output.requestProfile.attemptedRequests, 3);
      assert.equal(output.requestProfile.successfulResponses, 3);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('respeta ABSOLUTE_MAX_RUCS de 50', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const manyRucs = Array.from({ length: 100 }, (_, i) => `2010000000${i}`);
      const output = await runMigoVaultApiSpike({ sampleRucs: manyRucs, maxRucsToTest: 100 });
      assert.ok(output.requestProfile.attemptedRequests <= 50);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Error Handling Tests ────────────────────────────────────────────────────

describe('error handling', () => {
  it('para en 401', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 401);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218', '20100047219'] });
      assert.equal(output.status, 'unauthorized');
      assert.ok(output.requestProfile.stoppedBecause?.startsWith('auth_failed'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('para en 403', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 403);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'unauthorized');
      assert.ok(output.requestProfile.stoppedBecause?.startsWith('auth_failed'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('para en 429', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 429);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'rate_limited');
      assert.equal(output.requestProfile.rateLimitDetected, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('para tras 5 errores consecutivos', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 500);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: Array.from({ length: 10 }, (_, i) => `2010000000${i}`) });
      assert.ok(output.requestProfile.stoppedBecause?.includes('max_consecutive_errors'));
      assert.equal(output.requestProfile.failedResponses, 5);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Payload Detection Tests ─────────────────────────────────────────────────

describe('payload detection', () => {
  it('detecta CIIU en payload mock', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsCiiu, true);
      assert.equal(output.dataProfile.containsCiiuRev4, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta actividad económica en payload mock', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsActivityDescription, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta actividades secundarias', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsSecondaryActivities, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta razón social', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsLegalName, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta estado tributario', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsTaxpayerStatus, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta condición de domicilio', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsDomicileCondition, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta dirección', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsAddress, true);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('detecta representantes legales como sensitive', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      const payload = buildFullMockPayload('20100047218');
      payload.representantes_legales = [
        { documento: '12345678', nombre: 'JUAN PEREZ' },
      ];
      return makeMigoJsonResponse(payload);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.dataProfile.containsLegalRepresentatives, true);
      assert.ok(output.persistenceRecommendation.sensitiveFieldsDetected.includes('representantes_legales'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Safety Tests ────────────────────────────────────────────────────────────

describe('safety', () => {
  it('no devuelve campo raw_payload en datos', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.status, 'completed', 'spike debe completarse');
      const hasRawPayloadField =
        Object.keys(output).some(k => k === 'raw_payload' || k === 'rawPayload') ||
        output.sampleRows.some(row =>
          Object.keys(row).some(k => k === 'raw_payload' || k === 'rawPayload')
        );
      assert.ok(!hasRawPayloadField, 'no debe contener raw_payload ni rawPayload como campo');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('escribe reporte solo en .tmp/sunat-peru/', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.ok(mockWriteFilePath.startsWith('.tmp/sunat-peru/'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('no referencia Supabase writes en el código fuente', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'migo-vault-api-spike.ts'),
      'utf-8',
    );
    assert.ok(!src.includes('supabase'));
    assert.ok(!src.includes('insert('));
    assert.ok(!src.includes('upsert('));
    assert.ok(!src.includes('.from('));
  });

  it('no referencia registry/preflight/wizard', () => {
    const fs = require('node:fs');
    const src = fs.readFileSync(
      require('node:path').join(__dirname, '..', 'migo-vault-api-spike.ts'),
      'utf-8',
    );
    assert.ok(!src.includes('SOURCE_DISCOVERY_REGISTRY'));
    assert.ok(!src.includes('source-discovery-preflight'));
    assert.ok(!src.includes('preflight'));
    assert.ok(!src.includes('wizard'));
    assert.ok(!src.includes('HubSpot'));
    assert.ok(!src.includes('Tavily'));
  });

  it('redacta preview en sample rows', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.ok(output.sampleRows.length > 0);
      assert.ok(typeof output.sampleRows[0].redactedPreview === 'string');
      assert.ok(output.sampleRows[0].redactedPreview.length > 0);
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('redacta representantes legales del preview', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      const payload = buildFullMockPayload('20100047218');
      payload.representantes_legales = [
        { documento: '12345678', nombre: 'JUAN PEREZ' },
      ];
      return makeMigoJsonResponse(payload);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      const preview = output.sampleRows[0].redactedPreview;
      assert.ok(!preview.includes('representante'));
      assert.ok(!preview.includes('12345678'));
      assert.ok(!preview.includes('JUAN PEREZ'));
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});

// ─── Verdict Tests ───────────────────────────────────────────────────────────

describe('verdict', () => {
  it('genera confirmed cuando hay RUC + CIIU + actividad', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse(buildFullMockPayload('20100047218'));
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.verdict, 'MIGO_CONFIRMED_FOR_CIIU_ENRICHMENT');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('genera partial cuando solo CIIU sin actividad', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      const payload = buildFullMockPayload('20100047218');
      delete payload.actividad_economica;
      return makeMigoJsonResponse(payload);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.verdict, 'MIGO_PARTIAL_PAYLOAD');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('genera auth_failed en 401', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 401);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.verdict, 'MIGO_AUTH_FAILED');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });

  it('genera rate_limited en 429', async () => {
    const origAck = process.env.MIGO_API_SPIKE_ACK;
    process.env.MIGO_API_SPIKE_ACK = 'YES';
    setupDefaultResolveMock();

    mockFetch(async () => {
      return makeMigoJsonResponse({ success: false }, 429);
    });

    try {
      const output = await runMigoVaultApiSpike({ sampleRucs: ['20100047218'] });
      assert.equal(output.verdict, 'MIGO_RATE_LIMIT_BLOCKED');
    } finally {
      if (origAck) process.env.MIGO_API_SPIKE_ACK = origAck;
    }
  });
});
