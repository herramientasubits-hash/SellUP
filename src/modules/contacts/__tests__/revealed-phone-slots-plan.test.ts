/**
 * AGENT2A-REVEAL-PHONE-SLOTS — la regla ÚNICA que decide a qué campo de HubSpot va un teléfono
 * revelado: primero `phone`; si ya tiene OTRO número, `mobilephone`; sin números y con dos
 * revelados, uno a cada campo. Nunca se sobrescribe ni se reenvía un número que ya está.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isSameHubSpotPhone, planRevealedPhonesForHubSpot } from '../contact-hubspot-sync-core';

const EMPTY = { phone: null, mobilephone: null };

describe('planRevealedPhonesForHubSpot', () => {
  it('`phone` vacío ⇒ el revelado va a `phone`', () => {
    assert.deepEqual(planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], EMPTY), {
      phone: '+57 300 111 2222',
    });
  });

  it('`phone` con otro número ⇒ el revelado va a `mobilephone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { phone: '+57 601 555 0000', mobilephone: null }),
      { mobilephone: '+57 300 111 2222' },
    );
  });

  it('`phone` con el MISMO número (con o sin indicativo) ⇒ nada', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { phone: '300-111-2222', mobilephone: null }),
      {},
    );
  });

  it('el número ya está en `mobilephone` ⇒ no se copia a `phone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { phone: null, mobilephone: '3001112222' }),
      {},
    );
  });

  it('`phone` vacío y `mobilephone` con otro ⇒ el revelado va a `phone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { phone: '', mobilephone: '+57 310 000 0000' }),
      { phone: '+57 300 111 2222' },
    );
  });

  it('los dos campos llenos con otros números ⇒ nada (nunca se pisa)', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], {
        phone: '+57 601 555 0000',
        mobilephone: '+57 310 000 0000',
      }),
      {},
    );
  });

  it('sin números en HubSpot y dos revelados ⇒ uno a cada campo, en orden', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }, { phone: '+57 601 555 0000' }], EMPTY),
      { phone: '+57 300 111 2222', mobilephone: '+57 601 555 0000' },
    );
  });

  it('dos revelados y sólo el primero es celular ⇒ el celular va a `mobilephone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [
          { phone: '+57 300 111 2222', type: 'mobile' },
          { phone: '+57 601 555 0000', type: 'work' },
        ],
        EMPTY,
      ),
      { phone: '+57 601 555 0000', mobilephone: '+57 300 111 2222' },
    );
  });

  it('`phone` con otro número y dos revelados ⇒ sólo el primero nuevo va a `mobilephone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }, { phone: '+57 315 444 5555' }], {
        phone: '+57 601 555 0000',
        mobilephone: null,
      }),
      { mobilephone: '+57 300 111 2222' },
    );
  });

  it('el revelado repetido en la lista cuenta una sola vez', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }, { phone: '3001112222' }], EMPTY),
      { phone: '+57 300 111 2222' },
    );
  });

  it('vacíos y espacios no viajan', () => {
    assert.deepEqual(planRevealedPhonesForHubSpot([{ phone: '  ' }], EMPTY), {});
  });
});

describe('isSameHubSpotPhone', () => {
  it('tolera indicativo y formato', () => {
    assert.equal(isSameHubSpotPhone('+57 (300) 111-2222', '3001112222'), true);
  });
  it('números distintos no coinciden', () => {
    assert.equal(isSameHubSpotPhone('+57 300 111 2222', '+57 300 111 2223'), false);
  });
  it('una extensión corta no coincide con un número completo', () => {
    assert.equal(isSameHubSpotPhone('2222', '+57 300 111 2222'), false);
  });
});
