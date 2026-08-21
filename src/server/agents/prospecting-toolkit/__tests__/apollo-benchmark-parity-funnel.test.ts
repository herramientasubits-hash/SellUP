/**
 * AGENT1-APOLLO-BENCHMARK-PARITY-CUT-1 · P1-3 — el embudo de Apollo, con los
 * mismos nombres de negocio que el de Lusha y sin un solo número fabricado.
 *
 * Offline y determinista. 0 créditos, 0 proveedores, 0 base de datos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildApolloBenchmarkFunnelMetadata,
  APOLLO_BENCHMARK_FUNNEL_FIELDS,
  APOLLO_FUNNEL_SEAM_PROVIDER_SEEN_HIT,
  APOLLO_FUNNEL_SEAM_HISTORICAL_KNOWN,
  APOLLO_FUNNEL_SEAM_ACCEPTED_FOR_TARGET,
  APOLLO_FUNNEL_PRECISION_REJECTED_BASIS,
} from '../apollo-benchmark-funnel';

const OBSERVABLE_TODAY = {
  paidRaw: 20,
  unique: 17,
  duplicate: 3,
  precisionRejected: 6,
} as const;

const CUT1_SHAPE = {
  ...OBSERVABLE_TODAY,
  providerSeenHit: null,
  historicalKnown: null,
  acceptedForTarget: null,
};

describe('P1-3 · los siete campos existen y ninguno se inventa', () => {
  it('los nombres son exactamente los del embudo acordado', () => {
    assert.deepEqual(
      [...APOLLO_BENCHMARK_FUNNEL_FIELDS],
      [
        'paid_raw',
        'unique',
        'provider_seen_hit',
        'historical_known',
        'duplicate',
        'precision_rejected',
        'accepted_for_target',
      ],
    );
  });

  it('lo observable se publica con su cifra', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE);
    assert.equal(funnel['paid_raw'], 20);
    assert.equal(funnel['unique'], 17);
    assert.equal(funnel['duplicate'], 3);
    assert.equal(funnel['precision_rejected'], 6);
  });

  it('🔴 lo que no se puede medir va en null, JAMÁS en 0', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE);

    for (const field of ['provider_seen_hit', 'historical_known', 'accepted_for_target']) {
      assert.equal(funnel[field], null, `${field} tiene que ser null`);
      assert.notEqual(funnel[field], 0, `${field} nunca puede fabricarse como 0`);
    }
  });

  it('un 0 GENUINO se distingue de un null', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata({
      ...CUT1_SHAPE,
      precisionRejected: 0,
    });
    assert.equal(funnel['precision_rejected'], 0, 'medido y salió cero');
    assert.ok(!(funnel['fields_missing'] as string[]).includes('precision_rejected'));
  });
});

describe('P1-3 · las costuras que faltan se NOMBRAN', () => {
  it('`fields_missing` lista exactamente los tres campos no medibles hoy', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE);
    assert.deepEqual(funnel['fields_missing'], [
      'provider_seen_hit',
      'historical_known',
      'accepted_for_target',
    ]);
  });

  it('cada null lleva la costura exacta que falta', () => {
    const seams = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE)[
      'missing_correlation_seams'
    ] as Record<string, string>;

    assert.equal(seams['provider_seen_hit'], APOLLO_FUNNEL_SEAM_PROVIDER_SEEN_HIT);
    assert.equal(seams['historical_known'], APOLLO_FUNNEL_SEAM_HISTORICAL_KNOWN);
    assert.equal(seams['accepted_for_target'], APOLLO_FUNNEL_SEAM_ACCEPTED_FOR_TARGET);
  });

  it('`field_sources` distingue observado, derivado y ausente', () => {
    const sources = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE)['field_sources'] as Record<
      string,
      string
    >;

    assert.equal(sources['paid_raw'], 'observed');
    assert.equal(sources['unique'], 'observed');
    assert.equal(sources['duplicate'], 'observed');
    assert.equal(sources['precision_rejected'], 'derived');
    assert.equal(sources['provider_seen_hit'], 'missing');
    assert.equal(sources['historical_known'], 'missing');
    assert.equal(sources['accepted_for_target'], 'missing');
  });

  it('una costura resuelta deja de estar ausente sin tocar el constructor', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata({
      ...CUT1_SHAPE,
      providerSeenHit: 4,
    });
    assert.equal(funnel['provider_seen_hit'], 4);
    assert.deepEqual(funnel['fields_missing'], ['historical_known', 'accepted_for_target']);
    assert.equal(
      (funnel['missing_correlation_seams'] as Record<string, string>)['provider_seen_hit'],
      undefined,
    );
  });
});

describe('P1-3 · `accepted_for_target` no admite una segunda definición', () => {
  it('en este corte SIEMPRE es null en la ruta Apollo', () => {
    // 🔴 La tentación era publicar `filteredMapped.length` bajo este nombre. Sería
    // «lo que pasó el gate de ESTA consulta», no «lo que satisfizo el objetivo»,
    // y dos definiciones del mismo campo hacen incomparables los dos embudos.
    const funnel = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE);
    assert.equal(funnel['accepted_for_target'], null);
    assert.notEqual(funnel['accepted_for_target'], funnel['unique']);
    assert.notEqual(funnel['accepted_for_target'], funnel['paid_raw']);
  });
});

describe('P1-3 · `precision_rejected` declara su población', () => {
  it('cuando existe, dice sobre qué se contó', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata(CUT1_SHAPE);
    assert.equal(funnel['precision_rejected_basis'], APOLLO_FUNNEL_PRECISION_REJECTED_BASIS);
    assert.ok(
      String(funnel['precision_rejected_basis']).includes('collected_after_local_filters'),
      'la etiqueta impide restarlo de `paid_raw` sin darse cuenta',
    );
  });

  it('cuando no se midió, no hay población que declarar', () => {
    const funnel = buildApolloBenchmarkFunnelMetadata({ ...CUT1_SHAPE, precisionRejected: null });
    assert.equal(funnel['precision_rejected'], null);
    assert.equal(funnel['precision_rejected_basis'], null);
  });
});
