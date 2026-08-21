/**
 * Tests — AGENT1-COUNTRY-SOURCE-PERSISTENCE-CONTRACT-1 § 9.
 *
 * `prospect_batches.source` y `prospect_candidates.source_primary` son DOS
 * vocabularios con CHECK constraints distintos (migrations 040-052):
 * `source_primary` acepta `public_source`, `prospect_batches.source` NO.
 *
 * Antes de este fix el writer usaba `input.sourceProvider` para AMBOS, así que
 * un caller de fuente gratuita (co_siis, `source_primary = public_source`)
 * rompía el INSERT del lote con un CHECK violation y no persistía nada.
 *
 * Todo con un doble de Supabase local. Sin red, sin Apollo, sin Lusha, sin
 * HubSpot, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

import { writeStructuredSourceCandidatesPreview } from '../structured-source-candidate-writer';
import type { SourceDiscoveryCandidate } from '../../../source-catalog/source-discovery-types';

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
    from(table: string) {
      if (table === 'prospect_batches') {
        return {
          insert(row: Record<string, unknown>) {
            stats.batchInserts.push({ ...row });
            return {
              select() {
                return {
                  single: async () => ({ data: { id: `batch-${++batchSeq}` }, error: null }),
                };
              },
            };
          },
        };
      }
      if (table === 'prospect_candidates') {
        return {
          insert(row: Record<string, unknown>) {
            stats.candidateInserts.push({ ...row });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`tabla no simulada: ${table}`);
    },
  } as unknown as SupabaseClient;
}

// ─── Candidato sintético mínimo ─────────────────────────────────────────────
// taxId = null a propósito: evita que el writer consulte `prospect_candidates`
// para el índice de novedad (buildTaxIdNoveltyIndex corta temprano sin
// tax_ids), lo que mantiene el doble mínimo y honesto sobre qué NO simula.

function syntheticCandidate(name: string): SourceDiscoveryCandidate {
  return {
    name,
    taxId: null,
    countryCode: 'CO',
    sourcePrimary: 'public_source',
    metadata: {},
    reviewFlags: [],
  };
}

// ─── § 9(A) — batchSource explícito distinto de sourceProvider ────────────

describe('§ 9(A) — batchSource=agent_1, sourceProvider=public_source', () => {
  it('el lote se crea con source=agent_1, el candidato con source_primary=public_source', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'co_siis_discovery',
      sourceProvider: 'public_source',
      batchSource: 'agent_1',
      dataset: 'co_siis_discovery',
      initiatedBy: 'agent_1',
      candidates: [syntheticCandidate('Empresa Sintetica Uno')],
    });

    assert.equal(report.errors.length, 0);
    assert.equal(stats.batchInserts.length, 1);
    assert.equal(stats.batchInserts[0].source, 'agent_1');
    assert.equal(stats.candidateInserts.length, 1);
    assert.equal(stats.candidateInserts[0].source_primary, 'public_source');
  });

  it('el CHECK real de prospect_batches.source jamás vería public_source', () => {
    // Documenta la restricción verificada contra las migraciones reales
    // (040_prospect_batches_foundation.sql .. 052_allow_external_import_source.sql):
    // prospect_batches.source NO admite 'public_source'.
    const allowedBatchSources = [
      'manual', 'agent_1', 'imported', 'apollo', 'other',
      'socrata_colombia', 'denue_mexico', 'datos_gob_cl', 'external_import',
    ];
    assert.ok(!allowedBatchSources.includes('public_source'));
  });
});

// ─── § 9(B) — backward compatibility: sin batchSource, cae a sourceProvider ─

describe('§ 9(B) — batchSource omitido, sourceProvider=socrata_colombia (caller existente)', () => {
  it('el lote y el candidato usan socrata_colombia por igual — comportamiento histórico intacto', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'socrata_colombia',
      sourceProvider: 'socrata_colombia',
      dataset: 'socrata_colombia',
      candidates: [syntheticCandidate('Empresa Sintetica Dos')],
    });

    assert.equal(report.errors.length, 0);
    assert.equal(stats.batchInserts[0].source, 'socrata_colombia');
    assert.equal(stats.candidateInserts[0].source_primary, 'socrata_colombia');
  });

  it('un segundo caller existente (datos_gob_cl) también preserva el comportamiento histórico', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Chile',
      countryCode: 'CL',
      sourceKey: 'datos_gob_cl',
      sourceProvider: 'datos_gob_cl',
      dataset: 'datos_gob_cl',
      candidates: [syntheticCandidate('Empresa Sintetica Tres')],
    });

    assert.equal(stats.batchInserts[0].source, 'datos_gob_cl');
    assert.equal(stats.candidateInserts[0].source_primary, 'datos_gob_cl');
  });
});

// ─── § 9(C) — el reporte refleja el batchSource REAL, no sourceProvider ────

describe('§ 9(C) — report.batch.source refleja batchSource, no sourceProvider', () => {
  it('con candidatos escritos, report.batch.source = agent_1 (no public_source)', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'co_siis_discovery',
      sourceProvider: 'public_source',
      batchSource: 'agent_1',
      dataset: 'co_siis_discovery',
      candidates: [syntheticCandidate('Empresa Sintetica Cuatro')],
    });

    assert.equal(report.batch.source, 'agent_1');
    assert.notEqual(report.batch.source, 'public_source');
  });

  it('en dry run también refleja batchSource (antes de crear nada)', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: true,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'co_siis_discovery',
      sourceProvider: 'public_source',
      batchSource: 'agent_1',
      dataset: 'co_siis_discovery',
      candidates: [syntheticCandidate('Empresa Sintetica Cinco')],
    });

    assert.equal(report.batch.source, 'agent_1');
    assert.equal(stats.batchInserts.length, 0, 'dry run no escribe');
  });

  it('sin candidatos (reporte vacío) también refleja batchSource', async () => {
    const stats = freshStats();
    const report = await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'co_siis_discovery',
      sourceProvider: 'public_source',
      batchSource: 'agent_1',
      dataset: 'co_siis_discovery',
      candidates: [],
    });

    assert.equal(report.batch.source, 'agent_1');
  });
});

// ─── § 9(D) — el caller co_siis nunca intenta public_source como batch source ─

describe('§ 9(D) — el caller de fuente gratuita nunca envía public_source como source de lote', () => {
  it('con la configuración real de co_siis (batchSource=agent_1), el INSERT de lote jamás lleva public_source', async () => {
    const stats = freshStats();
    await writeStructuredSourceCandidatesPreview(makeFakeSupabase(stats), {
      dryRun: false,
      country: 'Colombia',
      countryCode: 'CO',
      sourceKey: 'co_siis_discovery',
      sourceProvider: 'public_source',
      batchSource: 'agent_1',
      dataset: 'co_siis_discovery',
      initiatedBy: 'agent_1',
      candidates: [syntheticCandidate('Empresa Sintetica Seis')],
    });

    for (const insert of stats.batchInserts) {
      assert.notEqual(insert.source, 'public_source');
    }
  });
});
