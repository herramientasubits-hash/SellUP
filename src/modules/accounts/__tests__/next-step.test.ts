/**
 * El «siguiente paso» de una empresa en la lista (dueña 18-10: el estado guardado
 * decía «Nueva» en casi todas). Sale de lo que pasó con cada agente.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ACCOUNT_NEXT_STEPS, ACCOUNT_NEXT_STEP_ORDER, resolveAccountNextStep, type AccountNextStepInput } from '../next-step';

const base: AccountNextStepInput = { archived: false, contactsTotal: 0, lastEnrichmentStatus: null, packs: [] };
const pack = (status: string, createdAt: string, outcome: string | null = null) => ({ status, createdAt, outcome });

describe('siguiente paso de una empresa', () => {
  it('sin contactos: el Agente 2 (buscar, buscando, revisar o reintentar)', () => {
    assert.equal(resolveAccountNextStep(base), 'find_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'enriching' }), 'finding_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'ready_for_review' }), 'review_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'failed' }), 'retry_contacts');
  });

  it('con contactos y sin preparación: el Agente 3; preparada: contactar', () => {
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 2 }), 'prepare_first_contact');
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 2, packs: [pack('needs_review', '2026-10-18T02:57:00Z')] }), 'review_and_contact');
    assert.equal(
      resolveAccountNextStep({ ...base, contactsTotal: 2, packs: [pack('needs_review', '2026-10-18T02:57:00Z'), pack('draft', '2026-10-18T02:57:00Z')] }),
      'make_first_contact',
    );
    // Las fallidas o descartadas no cuentan como preparadas.
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 1, packs: [pack('failed', '2026-10-18T01:19:00Z')] }), 'prepare_first_contact');
  });

  it('usada: registrar qué pasó, y después lo que toca según el resultado', () => {
    assert.equal(resolveAccountNextStep({ ...base, packs: [pack('used', '2026-10-18T03:00:00Z')] }), 'log_outcome');
    assert.equal(resolveAccountNextStep({ ...base, packs: [pack('used', '2026-10-18T03:00:00Z', 'interested')] }), 'book_meeting');
    assert.equal(resolveAccountNextStep({ ...base, packs: [pack('used', '2026-10-18T03:00:00Z', 'no_answer')] }), 'insist');
    assert.equal(resolveAccountNextStep({ ...base, packs: [pack('used', '2026-10-18T03:00:00Z', 'wrong_person')] }), 'find_decision_maker');
    // Una reunión agendada pesa más que un «no respondió» posterior en otro canal.
    assert.equal(
      resolveAccountNextStep({
        ...base,
        packs: [pack('used', '2026-10-18T03:00:00Z', 'meeting_booked'), pack('used', '2026-10-19T03:00:00Z', 'no_answer')],
      }),
      'hold_meeting',
    );
  });

  it('archivada manda; cada paso tiene nombre y lugar en el filtro', () => {
    assert.equal(resolveAccountNextStep({ ...base, archived: true, contactsTotal: 3 }), 'archived');
    for (const key of Object.keys(ACCOUNT_NEXT_STEPS)) assert.ok(ACCOUNT_NEXT_STEP_ORDER.includes(key as never), key);
  });
});
