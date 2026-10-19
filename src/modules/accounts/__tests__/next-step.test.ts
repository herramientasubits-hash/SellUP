/**
 * El «siguiente paso» de una empresa en la lista (dueña 18-10): sólo los estados que
 * hoy existen de verdad; «La usé» todavía no cambia nada.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ACCOUNT_NEXT_STEPS, ACCOUNT_NEXT_STEP_ORDER, resolveAccountNextStep, type AccountNextStepInput } from '../next-step';

const base: AccountNextStepInput = {
  archived: false,
  contactsTotal: 0,
  lastEnrichmentStatus: null,
  firstContactInProgress: false,
  firstContactPrepared: false,
};

describe('siguiente paso de una empresa', () => {
  it('sin contactos: buscar, buscando (Agente 2 en curso) o revisar (ya buscó y nadie aprobó)', () => {
    assert.equal(resolveAccountNextStep(base), 'find_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'enriching' }), 'finding_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'ready_for_review' }), 'review_contacts');
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'completed' }), 'review_contacts');
    // Una corrida fallida no trae qué revisar: se vuelve a buscar.
    assert.equal(resolveAccountNextStep({ ...base, lastEnrichmentStatus: 'failed' }), 'find_contacts');
  });

  it('con contactos: preparar; el Agente 3 trabajando: preparando; ya preparó: hacer el primer contacto', () => {
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 2 }), 'prepare_first_contact');
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 2, firstContactInProgress: true }), 'preparing_first_contact');
    assert.equal(resolveAccountNextStep({ ...base, contactsTotal: 2, firstContactPrepared: true }), 'make_first_contact');
    // Rehaciendo una preparación, se ve que está trabajando.
    assert.equal(
      resolveAccountNextStep({ ...base, contactsTotal: 2, firstContactPrepared: true, firstContactInProgress: true }),
      'preparing_first_contact',
    );
  });

  it('archivada manda; cada paso tiene nombre y lugar en el filtro', () => {
    assert.equal(resolveAccountNextStep({ ...base, archived: true, contactsTotal: 3 }), 'archived');
    for (const key of Object.keys(ACCOUNT_NEXT_STEPS)) assert.ok(ACCOUNT_NEXT_STEP_ORDER.includes(key as never), key);
  });
});
