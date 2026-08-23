/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 — BATCH TRUTHFULNESS.
 *
 * Qué se defiende aquí, en una frase: un contribuyente que ADOPTA un lote que ya
 * existía puede añadirle candidatos y su propia telemetría, pero no puede
 * reescribir de qué iba la petición.
 *
 * Esta suite cubre el módulo PURO y los trinquetes estáticos. El comportamiento
 * del escritor REAL —incluida la ruta de creación, que no debe cambiar— vive en
 * `candidate-writer-adopted-batch-truth.test.ts`.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 créditos,
 * 0 migraciones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  REQUEST_GLOBAL_BATCH_COLUMNS,
  STRUCTURED_SOURCE_BATCH_METADATA_KEYS,
  mergeAdoptedBatchMetadata,
  resolveAdoptedBatchPatch,
  type ExistingAdoptedBatchRow,
} from '../adopted-batch-truth';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/** Bloque observacional propio de un contribuyente cualquiera. */
const WRITER_OWNED = ['generated_by', 'pipeline_summary', 'warnings', 'warning'] as const;

/** Lote del wizard tal y como lo deja `reserveWizardExecutionSlot` + § 14 CASO A. */
function existingWizardBatch(
  overrides: Partial<ExistingAdoptedBatchRow> = {},
): ExistingAdoptedBatchRow {
  return {
    name: 'Wizard X',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'pharmaceuticals',
    target_count: 10,
    search_depth: 'standard',
    metadata: {
      request_source: 'chat_wizard',
      catalog_version_id: 'v2.0.0',
      industry_id: 'pharma-001',
      subindustry_ids: ['sub-a'],
      country_code: 'CO',
      additional_criteria: null,
    },
    ...overrides,
  };
}

/** Contribuyente de PAGO que llega con su residual y su clasificación local. */
function paidContribution(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Apollo Search',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'healthcare',
    target_count: 3,
    search_depth: 'deep',
    metadata: {
      generated_by: 'agent_1_candidate_writer',
      pipeline_summary: { requested: 3 },
      warnings: [],
    } as Record<string, unknown>,
    contributorOwnedMetadataKeys: WRITER_OWNED as readonly string[],
    ...overrides,
  };
}

// ─── § 5 — `target_count` es portante ────────────────────────────────────────

describe('CUT-2 § 5 — el objetivo del lote no es el residual del contribuyente', () => {
  it('objetivo 10, residual de pago 3 ⇒ el lote sigue pidiendo 10', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch(),
      incoming: paidContribution(),
    });

    assert.equal('target_count' in result.patch, false);
    assert.ok(result.preservedColumns.includes('target_count'));
  });

  it('objetivo 10 y entrante 10 ⇒ tampoco se reescribe (no es «gana el último» ni empatando)', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch(),
      incoming: paidContribution({ target_count: 10 }),
    });
    assert.equal('target_count' in result.patch, false);
  });

  it('objetivo 10 y entrante 25 ⇒ sigue siendo 10: nadie AMPLÍA la petición al adoptar', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch(),
      incoming: paidContribution({ target_count: 25 }),
    });
    assert.equal('target_count' in result.patch, false);
  });

  it('objetivo 0 SÍ es una verdad escrita y se respeta (no se trata como vacío)', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ target_count: 0 }),
      incoming: paidContribution(),
    });
    assert.equal('target_count' in result.patch, false);
  });

  it('objetivo NULL ⇒ el primero lo ESTABLECE: la reserva del wizard lo deja sin fijar', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ target_count: null }),
      incoming: paidContribution(),
    });
    assert.equal(result.patch['target_count'], 3);
    assert.ok(result.establishedColumns.includes('target_count'));
  });
});

// ─── § 6 / § 7 — país, industria, nombre, profundidad ────────────────────────

describe('CUT-2 § 6/§ 7 — la identidad de la petición gana sobre la del proveedor', () => {
  it('CASO A — ninguna columna global viaja en el PATCH cuando el lote ya las tiene', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch(),
      incoming: paidContribution(),
    });

    for (const column of REQUEST_GLOBAL_BATCH_COLUMNS) {
      assert.equal(column in result.patch, false, `${column} no puede reescribirse`);
    }
    assert.deepEqual(
      [...result.preservedColumns].sort(),
      [...REQUEST_GLOBAL_BATCH_COLUMNS].sort(),
    );
    assert.deepEqual(Object.keys(result.patch), ['metadata']);
  });

  it('CASO B — valores entrantes IDÉNTICOS tampoco se reescriben', () => {
    const existing = existingWizardBatch();
    const result = resolveAdoptedBatchPatch({
      existingBatch: existing,
      incoming: paidContribution({
        name: existing.name as string,
        country: existing.country as string,
        country_code: existing.country_code as string,
        industry: existing.industry as string,
        target_count: existing.target_count as number,
        search_depth: existing.search_depth as string,
      }),
    });
    assert.deepEqual(Object.keys(result.patch), ['metadata']);
  });

  it('la industria del proveedor (healthcare) no desplaza a la del usuario (pharmaceuticals)', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch(),
      incoming: paidContribution(),
    });
    assert.equal('industry' in result.patch, false);
  });

  it('`search_depth` es de la petición: `deep` entrante no pisa el `standard` del lote', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ search_depth: 'standard' }),
      incoming: paidContribution({ search_depth: 'deep' }),
    });
    assert.equal('search_depth' in result.patch, false);
  });

  it('columnas NULL ⇒ se establecen; columnas con valor ⇒ se preservan, en la MISMA adopción', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({
        country: null,
        country_code: null,
        industry: null,
        target_count: null,
      }),
      incoming: paidContribution(),
    });

    assert.equal(result.patch['country'], 'Colombia');
    assert.equal(result.patch['country_code'], 'CO');
    assert.equal(result.patch['industry'], 'healthcare');
    assert.equal(result.patch['target_count'], 3);
    assert.equal('name' in result.patch, false);
    assert.equal('search_depth' in result.patch, false);
  });

  it('columna NULL y contribuyente sin valor ⇒ no se escribe NULL sobre NULL', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ industry: null }),
      incoming: paidContribution({ industry: null }),
    });
    assert.equal('industry' in result.patch, false);
    assert.equal(result.establishedColumns.includes('industry'), false);
  });
});

// ─── § 12 — matriz de preservación de metadata ───────────────────────────────

describe('CUT-2 § 12 — matriz de metadata', () => {
  it('A · bloque gratuito existente + bloque del contribuyente ⇒ SOBREVIVEN LOS DOS', () => {
    const { metadata } = mergeAdoptedBatchMetadata({
      existingMetadata: { discovery_layer: 'country_source', macro_industry_key: 'health_pharma' },
      incomingMetadata: { generated_by: 'agent_1_candidate_writer', pipeline_summary: { requested: 3 } },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.equal(metadata['discovery_layer'], 'country_source');
    assert.equal(metadata['macro_industry_key'], 'health_pharma');
    assert.equal(metadata['generated_by'], 'agent_1_candidate_writer');
    assert.deepEqual(metadata['pipeline_summary'], { requested: 3 });
  });

  it('B · el entrante trae la MISMA clave gratuita con otro valor ⇒ gana lo existente', () => {
    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { discovery_layer: 'country_source' },
      incomingMetadata: { discovery_layer: 'apollo_paid' },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.equal(metadata['discovery_layer'], 'country_source');
    assert.deepEqual(preservedKeys, ['discovery_layer']);
  });

  it('B-bis · clave DISPUTADA (del contribuyente Y del origen gratuito) ⇒ gana lo existente', () => {
    // `warning` la reclaman los dos bloques. Sin dueño único no se pisa: dejar
    // ganar al de pago borraría verdad gratuita en silencio.
    assert.ok((STRUCTURED_SOURCE_BATCH_METADATA_KEYS as readonly string[]).includes('warning'));

    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { warning: 'Modo preview — ningún candidato aprobado.' },
      incomingMetadata: { warning: 'Datos de prueba. No convertir a empresas reales.' },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.equal(metadata['warning'], 'Modo preview — ningún candidato aprobado.');
    assert.deepEqual(preservedKeys, ['warning']);
  });

  it('C · el contribuyente actualiza SU PROPIO bloque observacional', () => {
    const { metadata, updatedOwnKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { generated_by: 'agent_1_candidate_writer', pipeline_summary: { requested: 10 } },
      incomingMetadata: { pipeline_summary: { requested: 3 } },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.deepEqual(metadata['pipeline_summary'], { requested: 3 });
    assert.deepEqual(updatedOwnKeys, ['pipeline_summary']);
  });

  it('D · clave DESCONOCIDA que colisiona ⇒ NO se pisa en silencio', () => {
    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { alguna_clave_futura: { v: 1 } },
      incomingMetadata: { alguna_clave_futura: { v: 2 } },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.deepEqual(metadata['alguna_clave_futura'], { v: 1 });
    assert.deepEqual(preservedKeys, ['alguna_clave_futura']);
  });

  it('E · metadata entrante vacía o ausente ⇒ lo existente queda equivalente clave a clave', () => {
    const existing = { request_source: 'chat_wizard', subindustry_ids: ['sub-a'], nested: { a: [1, 2] } };

    for (const incoming of [null, undefined, {}] as const) {
      const { metadata, preservedKeys, addedKeys, updatedOwnKeys } = mergeAdoptedBatchMetadata({
        existingMetadata: existing,
        incomingMetadata: incoming,
        contributorOwnedKeys: WRITER_OWNED,
      });
      assert.deepEqual(metadata, existing);
      assert.equal(JSON.stringify(metadata), JSON.stringify(existing));
      assert.deepEqual([preservedKeys, addedKeys, updatedOwnKeys], [[], [], []]);
    }
  });

  it('metadata existente ilegible (no objeto) ⇒ se trata como `{}` y NO revienta', () => {
    for (const broken of [null, undefined, 'texto', 42, ['a']]) {
      const { metadata } = mergeAdoptedBatchMetadata({
        existingMetadata: broken,
        incomingMetadata: { generated_by: 'x' },
        contributorOwnedKeys: WRITER_OWNED,
      });
      assert.deepEqual(metadata, { generated_by: 'x' });
    }
  });
});

// ─── § 8 — las dos colisiones REALES de hoy ──────────────────────────────────

describe('CUT-2 § 8 — el «no se solapan» del comentario anterior era falso', () => {
  it('`run_provider_selection` la escriben la reserva Y el escritor ⇒ gana la reserva', () => {
    const reserva = { requested: 'apollo', resolved: 'apollo', reason: 'admin_override' };
    const { metadata } = mergeAdoptedBatchMetadata({
      existingMetadata: { run_provider_selection: reserva },
      incomingMetadata: { run_provider_selection: { requested: null } },
      contributorOwnedKeys: WRITER_OWNED,
    });
    assert.deepEqual(metadata['run_provider_selection'], reserva);
  });

  it('`apollo_discovery_taxonomy`: la de la reserva es SUPERCONJUNTO y deja de degradarse', () => {
    // La reserva escribe `toDiscoveryTaxonomyMetadata(...)` MÁS tres campos; el
    // runner reescribía sólo la base. El spread anterior perdía los tres.
    const reserva = {
      mode: 'macro_industry',
      macro_industry_key: 'health_pharma',
      macro_industry_display_name: 'Salud y Farma',
      requested_subindustries: ['Farmacéutica'],
    };
    const { metadata } = mergeAdoptedBatchMetadata({
      existingMetadata: { apollo_discovery_taxonomy: reserva },
      incomingMetadata: { apollo_discovery_taxonomy: { mode: 'macro_industry' } },
      contributorOwnedKeys: WRITER_OWNED,
    });

    assert.deepEqual(metadata['apollo_discovery_taxonomy'], reserva);
  });
});

// ─── § 16 — reintentos ───────────────────────────────────────────────────────

describe('CUT-2 § 16 — un reintento no muta progresivamente la verdad del lote', () => {
  it('dos adopciones seguidas con residuales distintos dejan el lote igual', () => {
    const existing = existingWizardBatch();

    const first = resolveAdoptedBatchPatch({
      existingBatch: existing,
      incoming: paidContribution({ target_count: 3 }),
    });
    // La segunda adopción ve la fila tal y como la dejó la primera.
    const afterFirst: ExistingAdoptedBatchRow = { ...existing, metadata: first.metadata };
    const second = resolveAdoptedBatchPatch({
      existingBatch: afterFirst,
      incoming: paidContribution({ target_count: 1, industry: 'other', name: 'Otro' }),
    });

    assert.deepEqual(Object.keys(first.patch), ['metadata']);
    assert.deepEqual(Object.keys(second.patch), ['metadata']);
    assert.equal(afterFirst.target_count, 10);
    assert.equal(afterFirst.industry, 'pharmaceuticals');
    assert.equal(afterFirst.name, 'Wizard X');
  });

  it('la metadata del wizard sobrevive a N adopciones (idempotente y convergente)', () => {
    let row = existingWizardBatch();
    for (let i = 0; i < 5; i += 1) {
      const { metadata } = resolveAdoptedBatchPatch({
        existingBatch: row,
        incoming: paidContribution({
          metadata: { generated_by: 'agent_1_candidate_writer', pipeline_summary: { requested: i } },
        }),
      });
      row = { ...row, metadata };
    }

    const meta = row.metadata as Record<string, unknown>;
    assert.equal(meta['request_source'], 'chat_wizard');
    assert.equal(meta['catalog_version_id'], 'v2.0.0');
    assert.deepEqual(meta['subindustry_ids'], ['sub-a']);
    assert.deepEqual(meta['pipeline_summary'], { requested: 4 });
  });
});

// ─── § 10 / § 15 — forma del PATCH ───────────────────────────────────────────

describe('CUT-2 § 10/§ 15 — el PATCH de adopción no es el payload de creación', () => {
  it('el PATCH nunca lleva `status` (CUT-1 § 2 intacto)', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ country: null, target_count: null }),
      incoming: paidContribution(),
    });
    assert.equal('status' in result.patch, false);
  });

  it('el PATCH nunca lleva `source`, `created_by`, `owner_id`, `client_request_id` ni `created_at`', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ country: null }),
      incoming: paidContribution(),
    });
    for (const forbidden of ['source', 'created_by', 'owner_id', 'client_request_id', 'created_at', 'completed_at']) {
      assert.equal(forbidden in result.patch, false, `${forbidden} no pertenece al PATCH de adopción`);
    }
  });

  it('el módulo no inventa `country_name`: el esquema 040 no la tiene', () => {
    assert.equal((REQUEST_GLOBAL_BATCH_COLUMNS as readonly string[]).includes('country_name'), false);
    const ddl = read('supabase/migrations/040_prospect_batches_foundation.sql');
    assert.equal(/country_name/.test(ddl), false);
  });
});

// ─── § 18 — trinquetes de alcance ────────────────────────────────────────────

describe('CUT-2 § 18/§ 19 — este PR no enciende ni redefine nada fuera de su alcance', () => {
  it('PARTIAL GAP sigue apagado en Apollo y en Lusha', () => {
    const apollo = read('src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts');
    assert.ok(/WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED\s*(:[^=]*)?=\s*false/.test(apollo));
    const lusha = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    assert.ok(/LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED\s*(:[^=]*)?=\s*false/.test(lusha));
  });

  it('el módulo nuevo no toca identidad cruzada, visibilidad, exclusiones ni objetivo aceptado', () => {
    const src = read('src/server/prospect-batches/adopted-batch-truth.ts');
    for (const forbidden of [
      'isUsefulReviewCandidate',
      'identity_key',
      'APOLLO_EXCLUSION_CAPABILITY',
      'provider_seen',
      'accepted_for_target',
      'tax_identifier',
    ]) {
      assert.ok(!src.includes(forbidden), `${forbidden} está fuera de alcance`);
    }
  });

  it('frontera económica intacta: ni proveedores, ni créditos, ni presupuesto en el módulo nuevo', () => {
    const code = read('src/server/prospect-batches/adopted-batch-truth.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'fetch', 'credits', 'budget', 'reservation', 'provider_usage_logs', 'estimated_cost_usd',
    ]) {
      assert.ok(!new RegExp(`\\b${forbidden}\\b`, 'i').test(code), `${forbidden} no pertenece a CUT-2`);
    }
  });

  it('CUT-2 no añade migraciones', () => {
    const src = read('src/server/prospect-batches/adopted-batch-truth.ts');
    assert.ok(!src.includes('ALTER TABLE'));
    assert.ok(!src.includes('CREATE TABLE'));
  });

  it('el módulo es PURO: sin I/O, sin Supabase, sin env, sin reloj', () => {
    const src = read('src/server/prospect-batches/adopted-batch-truth.ts');
    assert.equal(/\bimport\s/.test(src), false, 'un módulo puro no importa nada');
    for (const forbidden of ['createClient', 'process.env', 'Date.now', 'new Date(']) {
      assert.ok(!src.includes(forbidden), forbidden);
    }
  });
});
