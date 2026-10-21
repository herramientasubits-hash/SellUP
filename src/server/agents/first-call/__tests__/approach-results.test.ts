/**
 * Auditoría del Agente 3 (21-10) — cerrar el ciclo: «La usé» bien guardado, el tablero
 * por enfoque, canal y país, y el redactor recomendando lo que funcionó. Sin red.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVEN_MIN_USES,
  buildApproachResultsDashboard,
  learnableCandidates,
  mapApproachResultRow,
  wantsLearnedApproach,
  pickProvenApproach,
  provenApproachNote,
  type ApproachResultRow,
} from '../approach-results';
import type { FirstContactApproach, FirstContactOutcome } from '../approaches';
import { buildFirstCallOutcome } from '@/modules/speech/first-call-outcome';

function used(approach: FirstContactApproach, outcome: FirstContactOutcome, extra: Partial<ApproachResultRow> = {}): ApproachResultRow {
  return { channel: 'call', countryCode: 'CO', mainApproach: 'problem', status: 'used', usedApproach: approach, outcome, ...extra };
}

function times(n: number, row: ApproachResultRow): ApproachResultRow[] {
  return Array.from({ length: n }, () => row);
}

const CANDIDATES: FirstContactApproach[] = ['problem', 'insight', 'value_first', 'permission', 'who_decides'];

describe('lo que funcionó — leer las filas', () => {
  it('lee canal, enfoque, resultado y país; sin versión usada guardada, cuenta la principal', () => {
    const row = mapApproachResultRow({ channel: 'email', status: 'used', approach: 'insight', outcome: { result: 'interested', at: 'x' }, accounts: { country_code: 'co' } })!;
    assert.deepEqual(row, { channel: 'email', countryCode: 'CO', mainApproach: 'insight', status: 'used', usedApproach: 'insight', outcome: 'interested' });
    const chosen = mapApproachResultRow({ channel: 'call', status: 'used', approach: 'problem', outcome: { result: 'meeting_booked', approach: 'permission' }, accounts: [{ country_code: 'MX' }] })!;
    assert.equal(chosen.usedApproach, 'permission');
    assert.equal(chosen.countryCode, 'MX');
    assert.equal(mapApproachResultRow({ channel: 'fax' }), null);
    // Lo que trae la lectura del servidor: sólo dos campos del resultado.
    const flat = mapApproachResultRow({ channel: 'call', status: 'used', approach: 'problem', outcome_result: 'not_now', outcome_approach: 'insight', accounts: { country_code: 'CL' } })!;
    assert.equal(flat.outcome, 'not_now');
    assert.equal(flat.usedApproach, 'insight');
    const unused = mapApproachResultRow({ channel: 'call', status: 'draft', approach: 'problem', outcome: null, accounts: null })!;
    assert.equal(unused.outcome, null);
    assert.equal(unused.usedApproach, null);
  });
});

describe('lo que funcionó — el tablero', () => {
  it('cuenta preparadas, usadas y resultados; «No es la persona» no baja la tasa del enfoque', () => {
    const rows: ApproachResultRow[] = [
      used('permission', 'meeting_booked'),
      used('permission', 'not_now'),
      used('permission', 'wrong_person'),
      { channel: 'email', countryCode: 'MX', mainApproach: 'insight', status: 'draft', usedApproach: null, outcome: null },
      { channel: 'email', countryCode: 'MX', mainApproach: 'insight', status: 'failed', usedApproach: null, outcome: null },
    ];
    const board = buildApproachResultsDashboard(rows, (c) => (c === 'CO' ? 'Colombia' : 'México'));
    assert.equal(board.total.prepared, 4);
    assert.equal(board.total.used, 3);
    assert.equal(board.total.outcomes.meeting_booked, 1);
    assert.equal(board.total.positiveRate, 1 / 2);
    const permission = board.byApproach.find((g) => g.key === 'permission')!;
    assert.equal(permission.label, 'Directo y con permiso');
    assert.equal(permission.stats.withOutcome, 3);
    assert.equal(board.byApproach.find((g) => g.key === 'insight')!.stats.prepared, 1, 'lo no usado cuenta por su principal');
    assert.deepEqual(board.byCountry.map((g) => g.label), ['Colombia', 'México']);
    assert.deepEqual(board.byChannel.map((g) => g.key), ['call', 'email']);
    assert.equal(buildApproachResultsDashboard([]).total.positiveRate, null);
  });
});

describe('lo que funcionó — qué recomienda el redactor', () => {
  it('con datos suficientes en ese país y canal, recomienda el que más abrió conversación', () => {
    const rows = [...times(4, used('permission', 'meeting_booked')), ...times(2, used('permission', 'no_answer')), ...times(6, used('problem', 'no_answer'))];
    const proven = pickProvenApproach({ rows, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' })!;
    assert.deepEqual(proven, { approach: 'permission', uses: 6, positives: 4, scope: 'country' });
    assert.match(provenApproachNote(proven, 'call', 'Colombia'), /en Colombia por llamada: «Directo y con permiso» .* en 4 de 6/);
  });

  it('con menos de 5 usos o 1 positiva no aprende (es suerte)', () => {
    const few = times(PROVEN_MIN_USES - 1, used('permission', 'meeting_booked'));
    assert.equal(pickProvenApproach({ rows: few, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' }), null);
    const onePositive = [used('insight', 'interested'), ...times(5, used('insight', 'no_answer'))];
    assert.equal(pickProvenApproach({ rows: onePositive, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' }), null);
  });

  it('si el del manual funciona igual o mejor, se queda el del manual', () => {
    const rows = [...times(3, used('permission', 'meeting_booked')), ...times(3, used('permission', 'not_now')), ...times(4, used('problem', 'interested')), ...times(2, used('problem', 'not_now'))];
    assert.equal(pickProvenApproach({ rows, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' }), null);
  });

  it('sin datos en ese país, usa los del canal en todos los países', () => {
    const rows = times(6, used('insight', 'meeting_booked', { countryCode: 'MX' }));
    const proven = pickProvenApproach({ rows, countryCode: 'CL', channel: 'call', candidates: CANDIDATES, manual: 'problem' })!;
    assert.equal(proven.scope, 'region');
    assert.match(provenApproachNote(proven, 'call', 'Chile'), /en todos los países/);
  });

  it('no mira otro canal ni un enfoque que hoy no aplica («evento» sin noticia)', () => {
    const otherChannel = times(6, used('insight', 'meeting_booked', { channel: 'email' }));
    assert.equal(pickProvenApproach({ rows: otherChannel, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' }), null);
    const trigger = times(6, used('trigger', 'meeting_booked'));
    assert.equal(pickProvenApproach({ rows: trigger, countryCode: 'CO', channel: 'call', candidates: CANDIDATES, manual: 'problem' }), null);
  });
});

describe('«La usé» bien guardado', () => {
  const NOW = '2026-10-21T15:00:00.000Z';
  it('con la versión principal guarda su enfoque (antes quedaba vacío) y si se editó', () => {
    const out = buildFirstCallOutcome({ previous: null, outcome: 'interested', approach: null, mainApproach: 'insight', edited: true, nowIso: NOW });
    assert.deepEqual(out, { result: 'interested', at: NOW, approach: 'insight', edited: true });
  });

  it('cambiar el resultado conserva la versión usada y deja el anterior en el historial', () => {
    const first = buildFirstCallOutcome({ previous: null, outcome: 'interested', approach: 'permission', mainApproach: 'insight', edited: false, nowIso: '2026-10-20T10:00:00.000Z' });
    const second = buildFirstCallOutcome({ previous: first, outcome: 'meeting_booked', approach: undefined, mainApproach: 'insight', edited: false, nowIso: NOW });
    assert.equal(second.result, 'meeting_booked');
    assert.equal(second.approach, 'permission');
    assert.deepEqual(second.history, [{ result: 'interested', at: '2026-10-20T10:00:00.000Z' }]);
    let last = second;
    for (let i = 0; i < 15; i += 1) last = buildFirstCallOutcome({ previous: last, outcome: 'not_now', approach: null, mainApproach: 'insight', edited: false, nowIso: NOW });
    assert.equal(last.history!.length, 10);
  });

  it('un enfoque que no existe no se guarda', () => {
    const out = buildFirstCallOutcome({ previous: { approach: 'inventado' }, outcome: 'no_answer', approach: 'otro' as FirstContactApproach, mainApproach: 'x', edited: false, nowIso: NOW });
    assert.equal(out.approach, null);
  });
});

describe('lo que funcionó — cuándo se mira', () => {
  it('sólo si el vendedor deja elegir, hay decisor y no es Perú (si no, ni se lee)', () => {
    assert.equal(wantsLearnedApproach({ approaches: [], contactIds: ['c1'] }, 'CO'), true);
    assert.equal(wantsLearnedApproach({ approaches: ['insight'], contactIds: ['c1'] }, 'CO'), false);
    assert.equal(wantsLearnedApproach({ approaches: [], contactIds: [] }, 'CO'), false);
    assert.equal(wantsLearnedApproach({ approaches: [], contactIds: ['c1'] }, 'pe'), false);
  });

  it('con una noticia fresca el evento manda; con decisor no compite «¿Quién decide?»', () => {
    assert.deepEqual(learnableCandidates('trigger', ['trigger', 'problem', 'insight']), []);
    assert.deepEqual(learnableCandidates('problem', ['problem', 'insight', 'who_decides']), ['problem', 'insight']);
    const rows = times(6, used('who_decides', 'meeting_booked'));
    assert.equal(
      pickProvenApproach({ rows, countryCode: 'CO', channel: 'call', candidates: learnableCandidates('problem', CANDIDATES), manual: 'problem' }),
      null,
    );
  });

  it('el tablero avisa si la lectura llegó al tope', () => {
    assert.equal(buildApproachResultsDashboard([], undefined, true).truncated, true);
  });
});
