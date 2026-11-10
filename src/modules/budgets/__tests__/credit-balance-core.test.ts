import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRuleCreditBalance,
  carryForward,
  closedPeriodsForRollover,
  sumAdjustments,
  type CreditAdjustment,
} from '../credit-balance-core';
import { configuredLimitMessage } from '../configured-limit-gate';

const NOV = '2026-11-01T00:00:00.000Z';
const DEC = '2026-12-01T00:00:00.000Z';

describe('sumAdjustments', () => {
  const adjustments: CreditAdjustment[] = [
    { periodStart: NOV, kind: 'top_up', credits: 500, beneficiaryUserId: null },
    { periodStart: NOV, kind: 'grant', credits: 200, beneficiaryUserId: 'ana' },
    { periodStart: NOV, kind: 'grant', credits: 300, beneficiaryUserId: 'luis' },
    { periodStart: DEC, kind: 'top_up', credits: 999, beneficiaryUserId: null },
  ];

  it('suma la recarga para todos y lo aprobado sólo para quien lo pidió', () => {
    assert.deepEqual(sumAdjustments(adjustments, NOV, 'ana'), { topUps: 500, grantsForUser: 200, grantsTotal: 500 });
  });

  it('una persona sin aprobación no recibe lo aprobado a otra', () => {
    assert.equal(sumAdjustments(adjustments, NOV, 'pedro').grantsForUser, 0);
  });

  it('sólo cuenta el período pedido', () => {
    assert.equal(sumAdjustments(adjustments, DEC, null).topUps, 999);
  });

  it('ignora cifras rotas o negativas', () => {
    const broken: CreditAdjustment[] = [{ periodStart: NOV, kind: 'top_up', credits: Number.NaN, beneficiaryUserId: null }];
    assert.equal(sumAdjustments(broken, NOV, null).topUps, 0);
  });
});

describe('closedPeriodsForRollover', () => {
  it('en noviembre de 2026 no hay períodos cerrados: la reserva empieza en cero', () => {
    assert.deepEqual(closedPeriodsForRollover('monthly', new Date('2026-11-10T12:00:00Z'), '2025-01-01T00:00:00Z'), []);
  });

  it('en febrero de 2027 cuentan noviembre, diciembre y enero', () => {
    const periods = closedPeriodsForRollover('monthly', new Date('2027-02-15T00:00:00Z'), '2025-01-01T00:00:00Z');
    assert.deepEqual(
      periods.map((p) => p.start.toISOString().slice(0, 7)),
      ['2026-11', '2026-12', '2027-01'],
    );
  });

  it('una regla creada después de noviembre empieza a acumular desde su mes', () => {
    const periods = closedPeriodsForRollover('monthly', new Date('2027-02-15T00:00:00Z'), '2026-12-20T00:00:00Z');
    assert.deepEqual(periods.map((p) => p.start.toISOString().slice(0, 7)), ['2026-12', '2027-01']);
  });

  it('las reglas trimestrales acumulan por trimestre', () => {
    const periods = closedPeriodsForRollover('quarterly', new Date('2027-04-02T00:00:00Z'), null);
    assert.deepEqual(periods.map((p) => p.start.toISOString().slice(0, 7)), ['2026-10', '2027-01']);
  });
});

describe('carryForward', () => {
  it('lo que sobra se acumula mes a mes', () => {
    // límite 1.000: nov gasta 600 (sobran 400), dic gasta 900 con 400 de reserva (sobran 500)
    assert.equal(carryForward(1000, [{ added: 0, consumed: 600 }, { added: 0, consumed: 900 }]), 500);
  });

  it('las recargas y aprobaciones de un mes también pasan si no se usan', () => {
    assert.equal(carryForward(1000, [{ added: 300, consumed: 1000 }]), 300);
  });

  it('un mes que se pasó del tope deja la reserva en cero, nunca negativa', () => {
    assert.equal(carryForward(1000, [{ added: 0, consumed: 200 }, { added: 0, consumed: 5000 }]), 0);
  });
});

describe('buildRuleCreditBalance', () => {
  it('el tope de hoy es límite + recargas + lo aprobado + reserva', () => {
    const balance = buildRuleCreditBalance({ base: 23130, topUps: 500, grantsForUser: 200, carriedIn: 1000 });
    assert.equal(balance.effective, 24830);
  });
});

describe('configuredLimitMessage con aprobación', () => {
  const blocked = { status: 'blocked' as const, reason: 'rule' as const, availableCredits: 0 };

  it('cuenta a quién se le pidieron los créditos', () => {
    const message = configuredLimitMessage('apollo', {
      ...blocked,
      approval: { status: 'requested', approverNames: ['Ana', 'Luis'] },
    });
    assert.match(message, /Le pedimos más créditos a Ana, Luis/);
  });

  it('si ya había una solicitud, no promete una nueva', () => {
    const message = configuredLimitMessage('apollo', {
      ...blocked,
      approval: { status: 'already_pending', approverNames: ['Ana'] },
    });
    assert.match(message, /Ya hay una solicitud de más créditos esperando a Ana/);
  });

  it('sin solicitud el mensaje es el de siempre', () => {
    assert.equal(
      configuredLimitMessage('lusha', blocked),
      'Llegaste al límite de créditos de Lusha que fijó un administrador en Configuración (quedan 0 créditos).',
    );
  });
});
