/**
 * AGENT3-FIRST-CONTACT-2 — el asistente del primer contacto (puro): opciones,
 * selección de decisores, resumen, pedido a la API y cobertura «lo que falta».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BEST_PRODUCT,
  NO_DECISION_MAKER,
  buildCoverage,
  buildFirstContactRequestBody,
  channelOptions,
  decisionMakerOptions,
  estimatedDuration,
  missingSelection,
  normalizeDecisionMakerSelection,
  normalizeProductSelection,
  productKeysFrom,
  preparationsCount,
  productOptions,
  summaryText,
} from '../first-contact-wizard';

const CONTACTS = [
  { id: 'c1', name: 'Fabián Martínez', title: 'Learning Leader' },
  { id: 'c2', name: 'Laura Gómez', title: 'Vicepresidenta de Talento' },
];

function pack(id: string, contactId: string | null, channel: 'call' | 'whatsapp' | 'email' | 'linkedin', status: string, createdAt = '2026-10-17T01:00:00Z') {
  return { id, contactId, channel, status: status as 'draft', createdAt, targetName: contactId ? 'Antiguo' : null, targetTitle: null };
}

describe('opciones del asistente', () => {
  it('decisores con su cargo y la opción «Sin decisor» al final', () => {
    const options = decisionMakerOptions(CONTACTS);
    assert.deepEqual(options.map((o) => o.value), ['c1', 'c2', NO_DECISION_MAKER]);
    assert.equal(options[0].description, 'Learning Leader');
  });

  it('canales y productos con descripción; productos en el orden del menú con su familia', () => {
    assert.equal(channelOptions().length, 4);
    const products = productOptions();
    assert.equal(products[0].value, BEST_PRODUCT, '«El que mejor conecte» es una opción más, la primera');
    assert.equal(products[1].label, 'AI Insights');
    assert.match(products[1].description ?? '', /^Selección · /);
    assert.ok(products.some((p) => p.label === 'Evaluaciones 360' && p.description?.startsWith('Desempeño y cultura')));
  });

  it('«El que mejor conecte» excluye a los demás productos y al revés', () => {
    assert.deepEqual(normalizeProductSelection(['desempeno_360'], ['desempeno_360', BEST_PRODUCT]), [BEST_PRODUCT]);
    assert.deepEqual(normalizeProductSelection([BEST_PRODUCT], [BEST_PRODUCT, 'desempeno_pdi']), ['desempeno_pdi']);
    assert.deepEqual(productKeysFrom([BEST_PRODUCT]), []);
  });

  it('«Sin decisor» excluye a los demás y al revés', () => {
    assert.deepEqual(normalizeDecisionMakerSelection(['c1'], ['c1', NO_DECISION_MAKER]), [NO_DECISION_MAKER]);
    assert.deepEqual(normalizeDecisionMakerSelection([NO_DECISION_MAKER], [NO_DECISION_MAKER, 'c2']), ['c2']);
    assert.deepEqual(normalizeDecisionMakerSelection([], ['a', 'b', 'c', 'd', 'e', 'f']).length, 5);
  });
});

describe('resumen y pedido', () => {
  it('cuenta una preparación por decisor y canal (sin decisor cuenta como uno)', () => {
    assert.equal(preparationsCount({ contactIds: ['c1', 'c2'], channels: ['call', 'email', 'linkedin'] }), 6);
    assert.equal(preparationsCount({ contactIds: [], channels: ['whatsapp'] }), 1);
  });

  it('el resumen dice si investiga o reusa, a quién, por dónde y cuánto tarda', () => {
    const text = summaryText(
      { contactIds: ['c1', 'c2'], channels: ['call', 'whatsapp'], goals: ['book_meeting'], productKeys: ['desempeno_360'] },
      CONTACTS,
      true,
    );
    assert.match(text, /Primero investigo la empresa/);
    assert.match(text, /4 preparaciones: Fabián Martínez \(Learning Leader\) y Laura Gómez \(Vicepresidenta de Talento\), por Llamada y WhatsApp/);
    assert.match(text, /Productos: Evaluaciones 360/);
    const several = summaryText(
      { contactIds: ['c1'], channels: ['call'], goals: ['validate_owner', 'book_meeting'], productKeys: [] },
      CONTACTS,
      false,
    );
    assert.match(several, /Objetivos: conseguir una reunión y saber quién decide/);
    assert.match(summaryText({ contactIds: [], channels: ['email'], goals: ['validate_owner'], productKeys: [] }, CONTACTS, false), /investigación vigente/);
    assert.equal(estimatedDuration({ contactIds: [] }, false), 'menos de un minuto');
    assert.equal(estimatedDuration({ contactIds: ['a', 'b', 'c'] }, true), 'unos 2 minutos');
  });

  it('el pedido lleva las listas y limpia el motivo', () => {
    const body = buildFirstContactRequestBody({
      accountId: 'acc',
      selection: { contactIds: ['c1'], channels: ['call', 'email'], goals: ['book_meeting'], productKeys: [] },
      refreshResearch: false,
      regenerateFromPackId: 'p1',
      regenerationReason: '   ',
    });
    assert.deepEqual(body.channels, ['call', 'email']);
    assert.deepEqual(body.goals, ['book_meeting']);
    assert.equal(body.regenerationReason, null);
    assert.equal(body.regenerateFromPackId, 'p1');
  });
});

describe('cobertura: lo hecho y lo que falta', () => {
  it('cada decisor × canal muestra la preparación más reciente que cuenta', () => {
    const coverage = buildCoverage(
      [
        pack('p1', 'c1', 'call', 'used', '2026-10-15T00:00:00Z'),
        pack('p2', 'c1', 'call', 'draft', '2026-10-16T00:00:00Z'),
        pack('p3', 'c1', 'email', 'discarded'),
        pack('p4', 'c9', 'linkedin', 'needs_review'),
        pack('p5', null, 'whatsapp', 'draft'),
      ],
      CONTACTS,
    );
    const c1 = coverage.find((r) => r.contactId === 'c1')!;
    assert.equal(c1.cells.call?.id, 'p2');
    assert.equal(c1.cells.email, null, 'una descartada no cuenta');
    assert.ok(coverage.some((r) => r.contactId === 'c9' && r.name === 'Antiguo'), 'un decisor que ya no está activo sigue visible');
    assert.ok(coverage.some((r) => r.contactId === null && r.cells.whatsapp?.id === 'p5'));
  });

  it('«Preparar lo que falta» propone los decisores y canales sin preparar', () => {
    const coverage = buildCoverage([pack('p1', 'c1', 'call', 'draft'), pack('p2', 'c1', 'email', 'draft')], CONTACTS);
    assert.deepEqual(missingSelection(coverage, ['call', 'email']), { contactIds: ['c2'], channels: ['call', 'email'] });
    const full = buildCoverage(
      [pack('a', 'c1', 'call', 'draft'), pack('b', 'c2', 'call', 'used')],
      CONTACTS,
    );
    assert.equal(missingSelection(full, ['call']), null);
  });
});
