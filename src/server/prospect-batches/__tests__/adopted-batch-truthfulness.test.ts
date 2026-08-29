/**
 * AGENT1-MIXED-FREE-PAID-SINGLE-BATCH-1 · CUT-2 — BATCH TRUTHFULNESS.
 *
 * Qué se defiende aquí, en una frase: un contribuyente que ADOPTA un lote que ya
 * existía puede añadirle candidatos, su propia telemetría y el nombre humano
 * canónico, pero no puede reescribir de qué iba la petición.
 *
 * Esta suite cubre el módulo PURO y los trinquetes estáticos. El comportamiento
 * del escritor REAL —incluida la ruta de creación, que no debe cambiar— vive en
 * `candidate-writer-adopted-batch-truth.test.ts`; la autoridad del objetivo
 * global en origen vive en `mixed-global-target-authority.test.ts`.
 *
 * Offline y determinista: sin Supabase, sin red, sin credenciales, 0 créditos,
 * 0 migraciones.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  PRESENTATION_BATCH_COLUMNS,
  REQUEST_GLOBAL_BATCH_COLUMNS,
  STRUCTURED_SOURCE_BATCH_METADATA_KEYS,
  mergeAdoptedBatchMetadata,
  resolveAdoptedBatchPatch,
  type ExistingAdoptedBatchRow,
} from '../adopted-batch-truth';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

/** Lote del wizard tal y como lo deja `reserveWizardExecutionSlot` + § 14 CASO A. */
function existingWizardBatch(
  overrides: Partial<ExistingAdoptedBatchRow> = {},
): ExistingAdoptedBatchRow {
  return {
    name: 'Wizard: pharma-001 / CO',
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
    name: 'Agente 1 · Pipeline · Colombia · healthcare · 17 jun 2026',
    country: 'Colombia',
    country_code: 'CO',
    industry: 'healthcare',
    target_count: 3,
    search_depth: 'deep',
    writerOwnedMetadata: {
      generated_by: 'agent_1_candidate_writer',
      pipeline_summary: { requested: 3 },
      warnings: [],
    } as Record<string, unknown>,
    passthroughMetadata: {} as Record<string, unknown>,
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

  it('§ 11 — objetivo NULL ⇒ RESPALDO para filas heredadas: el primero lo establece', () => {
    // 🔴 Para el wizard esta rama YA NO se ejerce: la reserva escribe el 10 en
    // origen (REVIEW-1 § 3). Se conserva porque una fila anterior al hito, o
    // creada por un camino ad-hoc, quedaría en NULL para siempre bajo una regla
    // de «lo existente gana siempre».
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ target_count: null }),
      incoming: paidContribution(),
    });
    assert.equal(result.patch['target_count'], 3);
    assert.ok(result.establishedColumns.includes('target_count'));
  });
});

// ─── § 6 / § 7 — país, industria, profundidad ────────────────────────────────

describe('CUT-2 § 6/§ 7 — la identidad de la petición gana sobre la del proveedor', () => {
  it('CASO A — ninguna columna GLOBAL viaja en el PATCH cuando el lote ya las tiene', () => {
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
    // `name` es de PRESENTACIÓN (§ 6) y sí viaja siempre.
    assert.deepEqual(Object.keys(result.patch).sort(), ['metadata', 'name']);
  });

  it('CASO B — valores entrantes IDÉNTICOS tampoco se reescriben', () => {
    const existing = existingWizardBatch();
    const result = resolveAdoptedBatchPatch({
      existingBatch: existing,
      incoming: paidContribution({
        country: existing.country as string,
        country_code: existing.country_code as string,
        industry: existing.industry as string,
        target_count: existing.target_count as number,
        search_depth: existing.search_depth as string,
      }),
    });
    assert.deepEqual(Object.keys(result.patch).sort(), ['metadata', 'name']);
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

// ─── § 6 REVIEW-1 — `name` es PRESENTACIÓN, no verdad global ─────────────────

describe('CUT-2 REVIEW-1 § 6 — el nombre es una etiqueta humana, no identidad de la petición', () => {
  it('`name` NO pertenece a las columnas request-global', () => {
    assert.equal((REQUEST_GLOBAL_BATCH_COLUMNS as readonly string[]).includes('name'), false);
    assert.deepEqual([...PRESENTATION_BATCH_COLUMNS], ['name']);
  });

  it('el rótulo técnico de la reserva NO sobrevive a la adopción', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ name: 'Wizard: pharma-001 / CO' }),
      incoming: paidContribution(),
    });

    assert.equal(
      result.patch['name'],
      'Agente 1 · Pipeline · Colombia · healthcare · 17 jun 2026',
    );
    assert.ok(!String(result.patch['name']).startsWith('Wizard: '));
    assert.deepEqual(result.presentationColumns, ['name']);
  });

  it('el nombre se escribe también cuando la fila lo tenía en NULL', () => {
    const result = resolveAdoptedBatchPatch({
      existingBatch: existingWizardBatch({ name: null }),
      incoming: paidContribution(),
    });
    assert.equal(typeof result.patch['name'], 'string');
  });

  it('el módulo no fabrica el nombre: sólo transporta el que le dan', () => {
    // 🔴 Sobre el CÓDIGO, no sobre los comentarios: el docstring cita
    // `apollo_discovery_taxonomy` como ejemplo de clave disputada, y un grep
    // ingenuo de «apollo» daría un falso positivo.
    const code = read('src/server/prospect-batches/adopted-batch-truth.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['Agente 1', 'toLocaleDateString', 'Pipeline ·', 'Wizard:']) {
      assert.ok(!code.includes(forbidden), `${forbidden} no pertenece a este módulo`);
    }
    // Y el nombre sale del input, nunca de una plantilla local.
    assert.ok(code.includes("patch['name'] = incoming.name;"));
  });
});

// ─── § 12 / REVIEW-1 § 9 — matriz de preservación de metadata ────────────────

describe('CUT-2 § 12 — matriz de metadata', () => {
  it('A · escritor-propia existente + escritor-propia nueva, sin paso a través ⇒ gana la NUEVA del escritor', () => {
    const { metadata, updatedOwnKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { pipeline_summary: { requested: 10 } },
      writerOwnedMetadata: { pipeline_summary: { requested: 3 } },
      passthroughMetadata: {},
    });

    assert.deepEqual(metadata['pipeline_summary'], { requested: 3 });
    assert.deepEqual(updatedOwnKeys, ['pipeline_summary']);
  });

  it('B · el PASO A TRAVÉS no puede SUPLANTAR al escritor colisionando con su clave', () => {
    // Éste es EXACTAMENTE el agujero que REVIEW-1 encontró: antes los dos
    // canales se recombinaban antes de resolver dueño, así que el valor de paso
    // a través quedaba dentro del objeto mientras la clave seguía etiquetada
    // como «propia del escritor».
    const { metadata, passthroughBlockedByWriterKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { pipeline_summary: { requested: 10 } },
      writerOwnedMetadata: { pipeline_summary: { requested: 3, truthful: true } },
      passthroughMetadata: { pipeline_summary: { requested: 999, forged: true } },
    });

    assert.deepEqual(metadata['pipeline_summary'], { requested: 3, truthful: true });
    assert.deepEqual(passthroughBlockedByWriterKeys, ['pipeline_summary']);
  });

  it('B-bis · suplantación sobre una clave del escritor que NO existía antes', () => {
    const { metadata, passthroughBlockedByWriterKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: {},
      writerOwnedMetadata: { generated_by: 'agent_1_candidate_writer' },
      passthroughMetadata: { generated_by: 'llamador_falsificado' },
    });

    assert.equal(metadata['generated_by'], 'agent_1_candidate_writer');
    assert.deepEqual(passthroughBlockedByWriterKeys, ['generated_by']);
  });

  it('C · `run_provider_selection`: la verdad RICA de la reserva sobrevive al paso a través pobre', () => {
    const reserva = {
      requested_discovery_provider: 'apollo_organizations',
      resolved_discovery_provider: 'apollo_organizations',
      selection_reason: 'admin_override',
    };
    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { run_provider_selection: reserva },
      writerOwnedMetadata: { generated_by: 'agent_1_candidate_writer' },
      passthroughMetadata: { run_provider_selection: { requested_discovery_provider: null } },
    });

    assert.deepEqual(metadata['run_provider_selection'], reserva);
    assert.deepEqual(preservedKeys, ['run_provider_selection']);
  });

  it('D · `apollo_discovery_taxonomy`: la de la reserva es SUPERCONJUNTO y deja de degradarse', () => {
    const reserva = {
      mode: 'macro_industry',
      macro_industry_key: 'health_pharma',
      macro_industry_display_name: 'Salud y Farma',
      requested_subindustries: ['Farmacéutica'],
    };
    const { metadata } = mergeAdoptedBatchMetadata({
      existingMetadata: { apollo_discovery_taxonomy: reserva },
      writerOwnedMetadata: {},
      passthroughMetadata: { apollo_discovery_taxonomy: { mode: 'macro_industry' } },
    });

    assert.deepEqual(metadata['apollo_discovery_taxonomy'], reserva);
  });

  it('E · clave DESCONOCIDA de paso a través ausente en lo existente ⇒ ADITIVA', () => {
    const { metadata, addedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { request_source: 'chat_wizard' },
      writerOwnedMetadata: {},
      passthroughMetadata: { apollo_discovery_modality: 'two_round_adaptive' },
    });

    assert.equal(metadata['apollo_discovery_modality'], 'two_round_adaptive');
    assert.deepEqual(addedKeys, ['apollo_discovery_modality']);
  });

  it('F · clave DESCONOCIDA de paso a través que COLISIONA ⇒ gana lo existente', () => {
    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { alguna_clave_futura: { v: 1 } },
      writerOwnedMetadata: {},
      passthroughMetadata: { alguna_clave_futura: { v: 2 } },
    });

    assert.deepEqual(metadata['alguna_clave_futura'], { v: 1 });
    assert.deepEqual(preservedKeys, ['alguna_clave_futura']);
  });

  it('G · `warning` sigue DISPUTADA: existe gratis y la reclama el escritor ⇒ gana lo existente', () => {
    assert.ok((STRUCTURED_SOURCE_BATCH_METADATA_KEYS as readonly string[]).includes('warning'));

    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { warning: 'Modo preview — ningún candidato aprobado.' },
      writerOwnedMetadata: { warning: 'Datos de prueba. No convertir a empresas reales.' },
      passthroughMetadata: {},
    });

    assert.equal(metadata['warning'], 'Modo preview — ningún candidato aprobado.');
    assert.deepEqual(preservedKeys, ['warning']);
  });

  it('el bloque gratuito y el del escritor CONVIVEN cuando no colisionan', () => {
    const { metadata } = mergeAdoptedBatchMetadata({
      existingMetadata: { discovery_layer: 'country_source', macro_industry_key: 'health_pharma' },
      writerOwnedMetadata: {
        generated_by: 'agent_1_candidate_writer',
        pipeline_summary: { requested: 3 },
      },
      passthroughMetadata: {},
    });

    assert.equal(metadata['discovery_layer'], 'country_source');
    assert.equal(metadata['macro_industry_key'], 'health_pharma');
    assert.equal(metadata['generated_by'], 'agent_1_candidate_writer');
    assert.deepEqual(metadata['pipeline_summary'], { requested: 3 });
  });

  it('el escritor tampoco pisa una clave gratuita que no es suya', () => {
    const { metadata, preservedKeys } = mergeAdoptedBatchMetadata({
      existingMetadata: { discovery_layer: 'country_source' },
      writerOwnedMetadata: {},
      passthroughMetadata: { discovery_layer: 'apollo_paid' },
    });

    assert.equal(metadata['discovery_layer'], 'country_source');
    assert.deepEqual(preservedKeys, ['discovery_layer']);
  });

  it('metadata entrante vacía o ausente ⇒ lo existente queda equivalente clave a clave', () => {
    const existing = { request_source: 'chat_wizard', subindustry_ids: ['sub-a'], nested: { a: [1, 2] } };

    for (const empty of [null, undefined, {}] as const) {
      const { metadata, preservedKeys, addedKeys, updatedOwnKeys } = mergeAdoptedBatchMetadata({
        existingMetadata: existing,
        writerOwnedMetadata: empty,
        passthroughMetadata: empty,
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
        writerOwnedMetadata: { generated_by: 'x' },
        passthroughMetadata: {},
      });
      assert.deepEqual(metadata, { generated_by: 'x' });
    }
  });
});

// ─── REVIEW-1 § 8 — los canales no se pueden recombinar antes de resolver ────

describe('CUT-2 REVIEW-1 § 8/§ 10 — la procedencia del VALOR no se pierde', () => {
  it('el módulo no acepta ya una lista paralela de claves «propias»', () => {
    const src = read('src/server/prospect-batches/adopted-batch-truth.ts');
    assert.equal(src.includes('contributorOwnedKeys'), false);
    assert.equal(src.includes('contributorOwnedMetadataKeys'), false);
    assert.equal(src.includes('incomingMetadata'), false);
    assert.ok(src.includes('writerOwnedMetadata'));
    assert.ok(src.includes('passthroughMetadata'));
  });

  it('el escritor tampoco los recombina antes de resolver dueño', () => {
    const writer = read('src/server/agents/prospecting-toolkit/candidate-writer.ts');
    // La adopción recibe los DOS canales por separado.
    assert.ok(writer.includes('writerOwnedMetadata: writerOwnedBatchMetadata'));
    assert.ok(writer.includes('passthroughMetadata: passthroughBatchMetadata'));
    // Y el objeto fusionado sólo se usa en la ruta de CREACIÓN.
    const adoption = writer.indexOf('const adoptedBatchTruth = resolveAdoptedBatchPatch({');
    const adoptionEnd = writer.indexOf('});', adoption);
    assert.ok(adoption > 0 && adoptionEnd > adoption);
    assert.equal(writer.slice(adoption, adoptionEnd).includes('batchMetadata,'), false);
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
    const afterFirst: ExistingAdoptedBatchRow = {
      ...existing,
      name: first.patch['name'] as string,
      metadata: first.metadata,
    };
    const second = resolveAdoptedBatchPatch({
      existingBatch: afterFirst,
      incoming: paidContribution({ target_count: 1, industry: 'other' }),
    });

    assert.deepEqual(Object.keys(first.patch).sort(), ['metadata', 'name']);
    assert.deepEqual(Object.keys(second.patch).sort(), ['metadata', 'name']);
    assert.equal(afterFirst.target_count, 10);
    assert.equal(afterFirst.industry, 'pharmaceuticals');
    assert.equal(second.patch['name'], first.patch['name']);
  });

  it('la metadata del wizard sobrevive a N adopciones (idempotente y convergente)', () => {
    let row = existingWizardBatch();
    for (let i = 0; i < 5; i += 1) {
      const { metadata } = resolveAdoptedBatchPatch({
        existingBatch: row,
        incoming: paidContribution({
          writerOwnedMetadata: {
            generated_by: 'agent_1_candidate_writer',
            pipeline_summary: { requested: i },
          },
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
  /**
   * 🔴 REANCLADO DOS VECES, y por la misma razón las dos.
   *
   * · AGENT1-LOCAL-CUT6-PARTIAL-ACTIVATION § 15 — afirmaba `false` en las DOS
   *   rutas; Apollo pasó a `true` en CUT-6.
   * · AGENT1-LOCAL-CUT9 § 17 — seguía afirmando `false` en Lusha; CUT-9 lo
   *   activa.
   *
   * Un trinquete que fija el VALOR de una decisión temporal impide arreglarla. Lo
   * que este corte de verdad promete —y lo único que se congela aquí— es que cada
   * superficie decide con SU PROPIA constante nombrada, en UN solo sitio literal, y
   * que ninguna deriva su postura de la otra. El valor vivo lo posee la suite del
   * corte que lo decide.
   */
  it('PARTIAL GAP: cada ruta se decide en su única constante nombrada', () => {
    const apollo = read('src/modules/prospect-batches/chat-wizard-execution/wizard-apollo-executor.ts');
    const apolloDecls = apollo.match(
      /export const WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
    );
    assert.equal(apolloDecls?.length, 1, 'Apollo decide en UN sitio literal');

    const lusha = read('src/server/prospect-batches/lusha-pending-review-limits.ts');
    const lushaDecls = lusha.match(
      /export const LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED = (?:true|false);/g,
    );
    assert.equal(lushaDecls?.length, 1, 'Lusha decide en UN sitio literal');

    // 🔴 Y son constantes DISTINTAS en módulos DISTINTOS: ninguna se DERIVA de la
    // otra, así que activar o apagar una no puede arrastrar a la otra.
    //
    // 🔴 Con los COMENTARIOS FUERA: los dos módulos NOMBRAN la constante ajena en
    // su prosa para explicar la asimetría, y leer el cuerpo crudo confundiría
    // «citarla» con «leerla».
    const noComments = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.ok(!noComments(apollo).includes('LUSHA_PENDING_REVIEW_PARTIAL_GAP_SUPPORTED'));
    assert.ok(!noComments(lusha).includes('WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED'));
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
