// /ai-usage — significado de los filtros Estado y Periodo.
//
// Estado: agent_runs y provider_usage_logs hablan vocabularios distintos
// (completed/failed/… frente a success/error/rate_limited/quota_exceeded). Antes
// el filtro «Completado» buscaba `completed` también en los logs y devolvía 0
// consultas y $0. Periodo: «mes actual» se calculaba con la zona del servidor
// (UTC), no con la de la operación (America/Bogota).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStatusKey,
  resolvePeriodStart,
  resolveStatusFilter,
} from '../usage-filter-semantics';

describe('resolveStatusFilter — un solo estado, los dos vocabularios', () => {
  it('sin estado no restringe nada', () => {
    assert.deepEqual(resolveStatusFilter(undefined), {
      runStatuses: null,
      logStatuses: null,
      logsByRunStatus: false,
    });
    assert.deepEqual(resolveStatusFilter(''), {
      runStatuses: null,
      logStatuses: null,
      logsByRunStatus: false,
    });
  });

  it('completed ↔ success', () => {
    const expected = { runStatuses: ['completed'], logStatuses: ['success'], logsByRunStatus: false };
    assert.deepEqual(resolveStatusFilter('completed'), expected);
    assert.deepEqual(resolveStatusFilter('success'), expected);
  });

  it('failed ↔ error | rate_limited | quota_exceeded', () => {
    const expected = {
      runStatuses: ['failed'],
      logStatuses: ['error', 'rate_limited', 'quota_exceeded'],
      logsByRunStatus: false,
    };
    assert.deepEqual(resolveStatusFilter('failed'), expected);
    assert.deepEqual(resolveStatusFilter('error'), expected);
  });

  it('un error concreto del proveedor filtra sólo ese error en los logs', () => {
    assert.deepEqual(resolveStatusFilter('rate_limited'), {
      runStatuses: ['failed'],
      logStatuses: ['rate_limited'],
      logsByRunStatus: false,
    });
    assert.deepEqual(resolveStatusFilter('quota_exceeded'), {
      runStatuses: ['failed'],
      logStatuses: ['quota_exceeded'],
      logsByRunStatus: false,
    });
  });

  it('un estado que sólo existe en ejecuciones filtra los logs por la ejecución', () => {
    for (const status of ['running', 'pending', 'cancelled']) {
      assert.deepEqual(resolveStatusFilter(status), {
        runStatuses: [status],
        logStatuses: null,
        logsByRunStatus: true,
      });
    }
  });

  it('un estado desconocido se aplica literal a los dos lados (compatibilidad)', () => {
    assert.deepEqual(resolveStatusFilter('raro'), {
      runStatuses: ['raro'],
      logStatuses: ['raro'],
      logsByRunStatus: false,
    });
  });
});

describe('canonicalStatusKey — opciones del filtro sin duplicados', () => {
  it('success se ofrece como completed y error como failed', () => {
    assert.equal(canonicalStatusKey('success'), 'completed');
    assert.equal(canonicalStatusKey('error'), 'failed');
    assert.equal(canonicalStatusKey('rate_limited'), 'rate_limited');
    assert.equal(canonicalStatusKey('running'), 'running');
  });
});

describe('resolvePeriodStart — límites en America/Bogota', () => {
  it('mes actual = día 1 a las 00:00 de Bogotá (05:00 UTC)', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    assert.equal(resolvePeriodStart('current_month', now), '2026-10-01T05:00:00.000Z');
  });

  it('el 1 de mes a las 21:00 de Bogotá (ya día 2 en UTC) sigue en el mes de Bogotá', () => {
    const now = new Date('2026-11-01T02:00:00Z'); // 31-oct 21:00 en Bogotá
    assert.equal(resolvePeriodStart('current_month', now), '2026-10-01T05:00:00.000Z');
  });

  it('el 1 de enero en Bogotá no cae en el año anterior', () => {
    const now = new Date('2027-01-01T06:00:00Z'); // 1-ene 01:00 en Bogotá
    assert.equal(resolvePeriodStart('current_month', now), '2027-01-01T05:00:00.000Z');
  });

  it('7d y 30d son ventanas móviles desde ahora', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    assert.equal(resolvePeriodStart('7d', now), '2026-10-06T15:00:00.000Z');
    assert.equal(resolvePeriodStart('30d', now), '2026-09-13T15:00:00.000Z');
  });

  it('todo / sin periodo no tiene límite inferior', () => {
    const now = new Date('2026-10-13T15:00:00Z');
    assert.equal(resolvePeriodStart('all', now), null);
    assert.equal(resolvePeriodStart(undefined, now), null);
  });
});
