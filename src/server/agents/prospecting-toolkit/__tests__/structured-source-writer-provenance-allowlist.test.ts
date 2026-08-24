/**
 * Tests — AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 §§ 6, 10, 11.
 *
 * `SourceDiscoveryCandidate.metadata` es `Record<string, unknown>` arbitrario:
 * un adapter puede meter cualquier cosa ahí, incluido PII o payload crudo.
 * Antes de este fix el writer no leía metadata.discovery_layer /
 * macro_industry_key / website_available EN ABSOLUTO — se perdían entre
 * `adaptCandidate` y el INSERT final.
 *
 * ── 🔴 Por qué la allowlist de CLAVES no bastaba ────────────────────────────
 *
 * La primera versión del fix copiaba `metadata[key]` como `unknown` para tres
 * claves autorizadas. Eso deja pasar exactamente el daño que pretendía cerrar:
 *
 *     { discovery_layer: { email: '…', raw_payload: { … } } }
 *
 * clave permitida, VALOR con PII. Por eso la frontera valida ahora también el
 * valor de cada clave (`sanitizeStructuredDiscoveryProvenance`) y lo hace DOS
 * veces: al adaptar y otra vez justo antes del INSERT, porque un borrador que ya
 * llega estructurado no pasa por la adaptación.
 *
 * Todo con un doble de Supabase local. Sin red, sin proveedores. Ningún valor de
 * PII sintética se imprime: las aserciones comprueban AUSENCIA.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeStructuredSourceCandidatesPreview } from '../structured-source-candidate-writer';
import type { SourceDiscoveryCandidate } from '../../../source-catalog/source-discovery-types';
import type {
  CommercialTrace,
  HubspotTrace,
  StructuredSourceCandidateDraft,
  StructuredSourceTrace,
} from '../structured-candidate-types';

import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';
type Stats = { candidateInserts: Array<Record<string, unknown>> };

function makeFakeSupabase(stats: Stats): SupabaseClient {
  let batchSeq = 0;
  return {
    // CUT-3B4-CORRECCIÓN — la 126 SIN aplicar se declara como lo hace la BASE.
    // Omitir `rpc` modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          insert() {
            return {
              select() {
                return { single: async () => ({ data: { id: `batch-${++batchSeq}` }, error: null }) };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        // CUT-3B4-CORRECCIÓN — la siembra del registro de identidad LEE esta tabla.
        // El doble tiene que responderla: antes se caía y el `catch` acababa
        // contando como «la 126 no está aplicada», que era el defecto —una avería
        // habilitando una escritura sin valla—. Un lote nuevo está vacío.
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          in: async () => ({ data: [], error: null }),
          insert(row: Record<string, unknown>) {
            stats.candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

async function writeOne(metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
  const stats: Stats = { candidateInserts: [] };
  const candidate: SourceDiscoveryCandidate = {
    name: 'Empresa Sintetica Provenance',
    taxId: null,
    countryCode: 'CO',
    sourcePrimary: 'public_source',
    metadata,
    reviewFlags: ['missing_website'],
  };

  await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
    dryRun: false,
    country: 'Colombia',
    countryCode: 'CO',
    sourceKey: 'co_siis_discovery',
    sourceProvider: 'public_source',
    batchSource: 'agent_1',
    dataset: 'co_siis_discovery',
    candidates: [candidate],
  });

  assert.equal(stats.candidateInserts.length, 1, 'debe haber insertado exactamente un candidato');
  return stats.candidateInserts[0].metadata as Record<string, unknown>;
}

// ─── Camino de BYPASS: un borrador YA estructurado ─────────────────────────
//
// `adaptCandidate` devuelve intacto todo lo que trae `hubspotTrace` y
// `commercialTrace` (duck typing). Un borrador así NUNCA pasa por el saneado de
// adaptación, así que es el camino por el que un caller podría colar
// procedencia arbitraria. Estas ayudas lo construyen para poder demostrar que la
// segunda pasada —la del límite de la fila— lo detiene igual.

const EMPTY_HUBSPOT_TRACE: HubspotTrace = {
  lookupAttempted: false,
  lookupAt: null,
  matchStatus: 'not_attempted',
  matchedCompanyId: null,
  matchedBy: null,
  possibleMatches: [],
  syncAttempted: false,
  syncAt: null,
  syncStatus: null,
  syncError: null,
  syncedByUserId: null,
};

const EMPTY_COMMERCIAL_TRACE: CommercialTrace = {
  employeeCountStatus: 'unknown_requires_manual_validation',
  employeeCountSource: null,
  employeeCountConfidence: null,
  fitReasons: [],
  reviewFlags: [],
  reviewedBy: null,
  reviewedAt: null,
  reviewNotes: null,
  approvedBy: null,
  approvedAt: null,
};

const DRAFT_SOURCE_TRACE: StructuredSourceTrace = {
  sourceProvider: 'public_source',
  sourceKey: 'co_siis_discovery',
  sourceType: 'structured_registry',
  sourceMode: 'discovery',
  datasetId: null,
  sourceRecordId: null,
  queryParams: {},
  fetchedAt: '2026-08-20T00:00:00.000Z',
  connectorVersion: '0.1.0',
  normalizedAt: '2026-08-20T00:00:00.000Z',
  countryCode: 'CO',
};

/**
 * Escribe un borrador YA estructurado cuya `discoveryProvenance` se fuerza con
 * un `as`, exactamente como podría hacerlo un caller sin tipar (o mintiendo).
 */
async function writeOneStructuredDraft(
  provenance: unknown,
): Promise<Record<string, unknown>> {
  const stats: Stats = { candidateInserts: [] };
  const draft = {
    name: 'Empresa Sintetica Draft Bypass',
    taxId: null,
    taxIdentifierType: null,
    city: null,
    department: null,
    sectorCode: null,
    sectorDescription: null,
    legalStatus: null,
    website: null,
    countryCode: 'CO',
    sourcePrimary: 'public_source',
    employeeCount: null,
    employeeCountStatus: 'unknown_requires_manual_validation',
    commercialFitStatus: 'needs_manual_review',
    hubspotMatchStatus: 'not_attempted',
    reviewStatus: 'needs_manual_review',
    reviewFlags: [],
    sourceTrace: DRAFT_SOURCE_TRACE,
    hubspotTrace: EMPTY_HUBSPOT_TRACE,
    commercialTrace: EMPTY_COMMERCIAL_TRACE,
    // 🔴 El `as` es el punto de la prueba: simula al caller que se salta el tipo.
    discoveryProvenance: provenance,
  } as unknown as StructuredSourceCandidateDraft;

  await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
    dryRun: false,
    country: 'Colombia',
    countryCode: 'CO',
    sourceKey: 'co_siis_discovery',
    sourceProvider: 'public_source',
    batchSource: 'agent_1',
    dataset: 'co_siis_discovery',
    candidates: [draft],
  });

  assert.equal(stats.candidateInserts.length, 1, 'debe haber insertado exactamente un candidato');
  return stats.candidateInserts[0].metadata as Record<string, unknown>;
}

// ─── § 10 — la procedencia real de co_siis sobrevive ───────────────────────

describe('§ 10 — provenance co_siis sobrevive al INSERT final', () => {
  it('discovery_layer, macro_industry_key y website_available llegan al candidato', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      declared_industry: 'Fabricación de productos farmacéuticos',
      coarse_sector: 'MANUFACTURA',
      website: null,
      website_available: false,
    });

    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);
  });
});

// ─── § 11 — metadata security ratchet: SOLO el allowlist sobrevive ─────────

describe('§ 11 — metadata security ratchet: PII y payloads crudos NUNCA sobreviven', () => {
  it('raw_payload, email, phone y arbitrary_secret son descartados', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
      raw_payload: { anything: 'goes here', nested: { secrets: true } },
      email: 'ceo@empresa-sintetica.example',
      phone: '+57 300 000 0000',
      arbitrary_secret: 'sk_live_totally_not_real',
    });

    // Las tres allowlisted sobreviven.
    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);

    // Nada más del metadata de discovery sobrevive.
    assert.equal(metadata.raw_payload, undefined);
    assert.equal(metadata.email, undefined);
    assert.equal(metadata.phone, undefined);
    assert.equal(metadata.arbitrary_secret, undefined);

    // Y ninguno de esos valores aparece en NINGÚN lugar del objeto serializado
    // (cinturón y tirantes: no basta con que la clave exacta falte).
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /ceo@empresa-sintetica\.example/);
    assert.doesNotMatch(serialized, /\+57 300 000 0000/);
    assert.doesNotMatch(serialized, /sk_live_totally_not_real/);
    assert.doesNotMatch(serialized, /anything.*goes here/);
  });

  it('las claves canónicas del writer NUNCA pueden ser sobrescritas por metadata externa', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
      // Un adapter hostil o con bug intentando pisar claves canónicas del
      // writer. Ninguna de estas tres claves está en el allowlist, así que ni
      // siquiera llegan a competir — pero lo comprobamos explícitamente.
      writer_version: 'fake-version-injected',
      dataset: 'fake-dataset-injected',
      preview_mode: 'not-a-boolean-injected',
    });

    assert.notEqual(metadata.writer_version, 'fake-version-injected');
    assert.notEqual(metadata.dataset, 'fake-dataset-injected');
    assert.notEqual(metadata.preview_mode, 'not-a-boolean-injected');
    assert.equal(metadata.preview_mode, true);
  });
});

// ─── Mutaciones — cada una debe FALLAR si el fix se revierte parcialmente ──

describe('mutación § 17 — discovery_layer perdido', () => {
  it('sin discovery_layer en la metadata de origen, el candidato tampoco lo tiene (no se inventa)', async () => {
    const metadata = await writeOne({
      macro_industry_key: 'health_pharma',
      website_available: false,
    });
    assert.equal(metadata.discovery_layer, undefined);
    assert.equal(metadata.macro_industry_key, 'health_pharma');
  });
});

describe('mutación § 17 — macro_industry_key perdido', () => {
  it('sin macro_industry_key en la metadata de origen, el candidato tampoco lo tiene', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      website_available: false,
    });
    assert.equal(metadata.macro_industry_key, undefined);
    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
  });
});

describe('mutación § 17 — spread arbitrario de metadata (regresión del defecto original)', () => {
  it('un objeto de metadata con 20 claves arbitrarias no las traslada todas: SOLO el allowlist', async () => {
    const noisy: Record<string, unknown> = {
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
    };
    for (let i = 0; i < 20; i++) {
      noisy[`noise_field_${i}`] = `noise-value-${i}`;
    }

    const metadata = await writeOne(noisy);
    const keys = Object.keys(metadata);
    for (let i = 0; i < 20; i++) {
      assert.ok(!keys.includes(`noise_field_${i}`), `noise_field_${i} no debe sobrevivir`);
    }
  });
});

// ─── § 6 — VALIDACIÓN DE VALOR, no sólo de clave ───────────────────────────
//
// Los seis casos que la revisión exige. Cada uno ataca la frontera por el valor,
// que es por donde la allowlist de claves sola no defendía.

describe('§ 6 — el VALOR de una clave permitida también se valida', () => {
  // Caso A — objeto con PII bajo una clave permitida.
  it('A · discovery_layer con un objeto (raw_payload + email) se OMITE y su PII no aparece en ningún sitio', async () => {
    const metadata = await writeOne({
      discovery_layer: {
        email: 'ceo@empresa-sintetica.example',
        raw_payload: { nested: { secrets: true }, note: 'anything goes here' },
      },
      macro_industry_key: 'health_pharma',
      website_available: false,
    });

    assert.equal(metadata.discovery_layer, undefined, 'un objeto NO es una capa de discovery');

    // Ni la clave ni —lo que de verdad importa— ninguno de sus valores.
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /ceo@empresa-sintetica\.example/);
    assert.doesNotMatch(serialized, /raw_payload/);
    assert.doesNotMatch(serialized, /anything goes here/);
    assert.doesNotMatch(serialized, /secrets/);

    // Y las claves válidas de la MISMA metadata siguen sobreviviendo: rechazar
    // un valor malo no puede tirar la procedencia buena.
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);
  });

  // Caso B — array con una clave macro válida dentro.
  it('B · macro_industry_key como array se OMITE (aunque el primer elemento sea válido)', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: ['health_pharma', { raw_payload: 'injected' }],
      website_available: false,
    });

    assert.equal(metadata.macro_industry_key, undefined, 'un array NO es una clave canónica');
    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /injected/);
    assert.doesNotMatch(serialized, /raw_payload/);

    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
  });

  // Caso C — booleano escrito como texto. Nunca se coacciona.
  it("C · website_available: 'false' (string) se OMITE — jamás se coacciona a boolean", async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: 'false',
    });

    assert.equal(metadata.website_available, undefined);
    // La trampa concreta: `Boolean('false')` es `true`. Si alguien coaccionara,
    // la fila diría lo CONTRARIO de lo que la fuente observó.
    assert.notEqual(metadata.website_available, true);
    assert.notEqual(metadata.website_available, false);
  });

  // Caso D — el booleano legítimo, incluido el falso.
  it('D · website_available: false (boolean) SOBREVIVE — `false` no es «ausente»', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
    });

    assert.equal(metadata.website_available, false);
    assert.ok(
      Object.prototype.hasOwnProperty.call(metadata, 'website_available'),
      'la clave debe EXISTIR con valor false, no desaparecer por falsy',
    );
  });

  // Caso E — la procedencia real de co_siis, entera.
  it('E · la terna válida completa sobrevive tal cual', async () => {
    const metadata = await writeOne({
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
    });

    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);
  });

  it('E(bis) · una capa de discovery NO declarada se OMITE, aunque sea un string', async () => {
    const metadata = await writeOne({
      discovery_layer: 'attacker_invented_layer',
      macro_industry_key: 'not_a_macro_key_at_all',
      website_available: 1,
    });

    assert.equal(metadata.discovery_layer, undefined);
    assert.equal(metadata.macro_industry_key, undefined);
    assert.equal(metadata.website_available, undefined);
  });
});

// ─── Caso F — el bypass del borrador ya estructurado ──────────────────────

describe('§ 6 — F · un borrador YA estructurado no puede saltarse la frontera', () => {
  it('discoveryProvenance arbitraria en un draft se sanea igual en el límite de la FILA', async () => {
    const metadata = await writeOneStructuredDraft({
      raw_payload: { nested: { secrets: true } },
      email: 'ceo@empresa-sintetica.example',
      phone: '+57 300 000 0000',
      arbitrary_secret: 'sk_live_totally_not_real',
      discovery_layer: 'country_source_prepaid',
      macro_industry_key: 'health_pharma',
      website_available: false,
    });

    // Sólo la procedencia válida.
    assert.equal(metadata.discovery_layer, 'country_source_prepaid');
    assert.equal(metadata.macro_industry_key, 'health_pharma');
    assert.equal(metadata.website_available, false);

    // Nada de lo demás, ni como clave ni como valor.
    assert.equal(metadata.raw_payload, undefined);
    assert.equal(metadata.email, undefined);
    assert.equal(metadata.phone, undefined);
    assert.equal(metadata.arbitrary_secret, undefined);

    const serialized = JSON.stringify(metadata);
    assert.doesNotMatch(serialized, /ceo@empresa-sintetica\.example/);
    assert.doesNotMatch(serialized, /\+57 300 000 0000/);
    assert.doesNotMatch(serialized, /sk_live_totally_not_real/);
    assert.doesNotMatch(serialized, /secrets/);
  });

  it('valores INVÁLIDOS en un draft se omiten igual que en la adaptación', async () => {
    const metadata = await writeOneStructuredDraft({
      discovery_layer: { email: 'ceo@empresa-sintetica.example' },
      macro_industry_key: ['health_pharma'],
      website_available: 'false',
    });

    assert.equal(metadata.discovery_layer, undefined);
    assert.equal(metadata.macro_industry_key, undefined);
    assert.equal(metadata.website_available, undefined);
    assert.doesNotMatch(JSON.stringify(metadata), /ceo@empresa-sintetica\.example/);
  });

  it('una procedencia que NO es objeto (string, array, null) degrada a vacío sin lanzar', async () => {
    for (const hostile of ['country_source_prepaid', ['country_source_prepaid'], null, 42]) {
      const metadata = await writeOneStructuredDraft(hostile);
      assert.equal(metadata.discovery_layer, undefined);
      assert.equal(metadata.macro_industry_key, undefined);
      assert.equal(metadata.website_available, undefined);
      // Y las claves canónicas del writer siguen intactas.
      assert.equal(metadata.preview_mode, true);
    }
  });
});
