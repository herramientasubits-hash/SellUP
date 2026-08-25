/**
 * Tests — AGENT1-CUT4-B1 § 6/§ 7/§ 14 (bloque STRUCTURED).
 *
 * El defecto que cierran: `structured-source-candidate-writer.ts` insertaba
 * candidatos con `status='needs_review'` dejando `prospect_candidates.record_origin`
 * en NULL. La cola de revisión limpia exige `record_origin='production'`
 * (`PENDING_REVIEW_RECORD_ORIGIN` y sus cuatro gates de acción), así que esas filas
 * quedaban VISIBLES y NO OPERABLES — ni aprobables ni descartables— por una columna
 * que el writer nunca escribía.
 *
 * Lo que NO se prueba aquí: que todo `needs_review` valga `production`. Se prueba
 * que la decisión la toma el CLASIFICADOR CANÓNICO y que el writer la PERSISTE.
 * Un marcador de smoke gana, y una corrida en seco no escribe nada.
 *
 * Todo con un doble de Supabase local. Sin red, sin Apollo, sin Lusha, sin HubSpot,
 * sin créditos, sin migraciones.
 *
 * Correr: node --import tsx --test <este archivo>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeStructuredSourceCandidatesPreview } from '../structured-source-candidate-writer';
import { CANDIDATE_RECORD_ORIGIN_METADATA_KEY } from '../candidate-record-origin';
import type { SourceDiscoveryCandidate } from '../../../source-catalog/source-discovery-types';
import { preM126Rpc } from '@/server/prospect-batches/__tests__/support/lusha-pre-m126-fenced-insert';

// ─── Doble de Supabase ─────────────────────────────────────────────────────

type Stats = {
  batchInserts: Array<Record<string, unknown>>;
  candidateInserts: Array<Record<string, unknown>>;
};

function freshStats(): Stats {
  return { batchInserts: [], candidateInserts: [] };
}

function makeFakeSupabase(stats: Stats): SupabaseClient {
  let batchSeq = 0;
  return {
    // La 126 SIN aplicar se declara como lo hace la BASE (PGRST202). Omitir `rpc`
    // modelaría un cliente no soportado, y eso degrada CERRADO.
    rpc: preM126Rpc,
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          insert(row: Record<string, unknown>) {
            stats.batchInserts.push({ ...row });
            return {
              select: () => ({
                single: async () => ({ data: { id: `batch-${++batchSeq}` }, error: null }),
              }),
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
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

// ─── Candidato sintético mínimo ─────────────────────────────────────────────
// taxId = null a propósito: sin tax_ids el índice de novedad corta temprano y el
// doble no tiene que simular esa lectura.

function syntheticCandidate(
  name: string,
  metadata: Record<string, unknown> = {},
): SourceDiscoveryCandidate {
  return {
    name,
    taxId: null,
    countryCode: 'CO',
    sourcePrimary: 'public_source',
    metadata,
    reviewFlags: [],
  };
}

const CLEAN_RUN = {
  dryRun: false as boolean,
  country: 'Colombia',
  countryCode: 'CO',
  sourceKey: 'co_siis_discovery',
  sourceProvider: 'public_source',
  batchSource: 'agent_1',
  dataset: 'co_siis_discovery',
  initiatedBy: 'agent_1' as const,
};

function recordOriginMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const meta = row.metadata as Record<string, unknown>;
  return meta[CANDIDATE_RECORD_ORIGIN_METADATA_KEY] as Record<string, unknown>;
}

// ─── B1.1 — corrida limpia de producción ───────────────────────────────────

describe('CUT4-B1 § 6(A) — corrida estructurada limpia', () => {
  it('el candidato persiste record_origin=production, no un NULL por omisión', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Limpia Uno')],
    });

    assert.equal(report.errors.length, 0);
    assert.equal(stats.candidateInserts.length, 1);
    const row = stats.candidateInserts[0];
    assert.equal(
      row.record_origin,
      'production',
      'el clasificador canónico dice production para esta fila; el writer tiene que persistirlo',
    );
    assert.notEqual(row.record_origin, undefined);
    assert.notEqual(row.record_origin, null);
  });

  it('la derivación canónica viaja en la metadata, auditable sin reejecutar', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Limpia Dos')],
    });

    const block = recordOriginMetadata(stats.candidateInserts[0]);
    assert.ok(block, 'el bloque canónico de procedencia tiene que existir');
    assert.equal(block.record_origin, 'production');
    assert.equal(block.classification_source, 'writer');
    assert.equal(block.is_clean_production, true);
    assert.equal(block.decided_by, 'canonical_writer');
    const derivation = block.derivation as Record<string, unknown>;
    assert.equal(derivation.matched_rule, 'production_status');
  });

  it('no escribe la columna classification_source: su dueño actual no cambia', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Limpia Tres')],
    });

    assert.ok(!('classification_source' in stats.candidateInserts[0]));
    assert.ok(!('classification_confidence' in stats.candidateInserts[0]));
  });
});

// ─── B1.2 — marcadores de no-producción ────────────────────────────────────

describe('CUT4-B1 § 7 — ningún smoke/QA se asciende a production', () => {
  it('uiSmokeTest=true ⇒ smoke_test, jamás production', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      uiSmokeTest: true,
      candidates: [syntheticCandidate('Empresa Smoke UI')],
    });

    const row = stats.candidateInserts[0];
    assert.notEqual(row.record_origin, 'production');
    assert.equal(row.record_origin, 'smoke_test');
  });

  it('un caller no puede apagar el smoke del writer con su propia metadata', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      uiSmokeTest: true,
      // Intento de sobrescribir el marcador: el writer lo aplica DESPUÉS.
      metadata: { smoke_test: false },
      candidates: [syntheticCandidate('Empresa Smoke Terca')],
    });

    assert.notEqual(stats.candidateInserts[0].record_origin, 'production');
    assert.equal(stats.candidateInserts[0].record_origin, 'smoke_test');
  });

  it('un marcador de QA en la metadata del lote ⇒ qa, jamás production', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      metadata: { qa_only: true },
      candidates: [syntheticCandidate('Empresa QA')],
    });

    assert.notEqual(stats.candidateInserts[0].record_origin, 'production');
    assert.equal(stats.candidateInserts[0].record_origin, 'qa');
  });

  it('source_primary=smoke_script (marcador a nivel de CANDIDATO) ⇒ smoke_test', async () => {
    // La metadata del candidato pasa por una allowlist CERRADA de tres claves
    // (`sanitizeStructuredDiscoveryProvenance`), así que un marcador arbitrario no
    // puede viajar por ahí. El vector real a nivel de fila es `source_primary`.
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      sourceProvider: 'smoke_script',
      candidates: [syntheticCandidate('Empresa Smoke Candidato')],
    });

    const row = stats.candidateInserts[0];
    assert.equal(row.source_primary, 'smoke_script');
    assert.notEqual(row.record_origin, 'production');
    assert.equal(row.record_origin, 'smoke_test');
  });

  it('preview_mode NO es un marcador de no-producción: es una política de revisión', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      previewMode: true,
      candidates: [syntheticCandidate('Empresa Preview')],
    });

    // Si preview_mode vetara, TODA la capa gratuita quedaría fuera de la cola
    // limpia — el defecto contrario al que este corte cierra.
    assert.equal(stats.candidateInserts[0].record_origin, 'production');
  });
});

// ─── B1.3 — corrida en seco ────────────────────────────────────────────────

describe('CUT4-B1 § 7 — corrida en seco', () => {
  it('no inserta nada, así que no puede etiquetar un production falso', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      dryRun: true,
      candidates: [syntheticCandidate('Empresa Seca')],
    });

    assert.equal(report.dryRun, true);
    assert.equal(stats.batchInserts.length, 0, 'la corrida en seco no crea lote');
    assert.equal(stats.candidateInserts.length, 0, 'la corrida en seco no inserta candidatos');
  });
});

// ─── B1.4 — nada más cambia ────────────────────────────────────────────────

describe('CUT4-B1 § 10/§ 14 — el resto de la fila queda intacto', () => {
  it('metadata no relacionada sobrevive byte a byte y el bloque canónico es aditivo', async () => {
    const stats = freshStats();
    // El centinela usa las TRES claves que la frontera de procedencia sí deja
    // pasar: es la metadata ajena REAL que este writer persiste, no una inventada.
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [
        syntheticCandidate('Empresa Centinela', {
          discovery_layer: 'country_source_prepaid',
          macro_industry_key: 'health_pharma',
          website_available: false,
        }),
      ],
    });

    const meta = stats.candidateInserts[0].metadata as Record<string, unknown>;
    assert.equal(meta.discovery_layer, 'country_source_prepaid', 'el centinela ajeno no se toca');
    assert.equal(meta.macro_industry_key, 'health_pharma');
    assert.equal(meta.website_available, false);
    // Las claves canónicas del writer siguen ahí.
    assert.equal(meta.writer_version, '0.2.0');
    assert.equal(meta.dataset, 'co_siis_discovery');
    assert.equal(meta.preview_mode, true);
    assert.equal(meta.human_review_required, true);
    assert.equal(meta.notes, 'Tamaño no confirmado — validar manualmente');
    assert.ok(meta.enrichment);
    assert.ok(meta[CANDIDATE_RECORD_ORIGIN_METADATA_KEY]);
  });

  it('status, review_status, duplicate_status y source_primary no cambian', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Estado')],
    });

    const row = stats.candidateInserts[0];
    assert.equal(row.status, 'needs_review');
    assert.equal(row.review_status, 'needs_manual_review');
    assert.equal(row.source_primary, 'public_source');
    assert.equal(row.duplicate_status, 'unchecked');
  });

  it('el lote sigue creándose con la MISMA metadata: sin claves nuevas', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Lote')],
    });

    const batchMeta = stats.batchInserts[0].metadata as Record<string, unknown>;
    assert.equal(batchMeta.ui_smoke_test, false);
    assert.equal(batchMeta.preview_mode, true);
    assert.ok(
      !('smoke_test' in batchMeta),
      'la traducción a vocabulario canónico vive en la ENTRADA del clasificador, no en la fila del lote',
    );
    assert.ok(!('record_origin' in stats.batchInserts[0]));
  });

  it('una sola puerta de persistencia: un candidato ⇒ exactamente un insert', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Puerta Unica')],
    });

    assert.equal(stats.candidateInserts.length, 1, 'no hay un segundo insert');
    assert.equal(stats.batchInserts.length, 1);
  });

  it('la carga vallada recibe la fila AUMENTADA — la valla no ve una fila sin procedencia', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      ...CLEAN_RUN,
      candidates: [syntheticCandidate('Empresa Vallada')],
    });

    // El doble sólo expone `prospect_candidates.insert`, que es exactamente la
    // puerta por la que `runFencedPersistence` cae cuando la capacidad está
    // ausente. Que la fila registrada lleve la procedencia prueba que viaja en el
    // MISMO payload que la persistencia vallada escribe.
    const row = stats.candidateInserts[0];
    assert.equal(row.record_origin, 'production');
    assert.ok(row.batch_id, 'la fila vallada sigue ligada a su lote');
  });
});
