/**
 * AGENT2A-REVEAL-PHONE-SLOTS + AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER — la regla ÚNICA que decide a
 * qué campo de HubSpot va un teléfono: cada número que HubSpot no tiene va al PRIMER campo vacío
 * de `phone` → `mobilephone` → `company_phone` → `telefono_alterno` (`company_phone` apagado por ahora).
 * Nunca se sobrescribe ni se reenvía un número que ya está.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUBSPOT_PHONE_SLOT_ORDER,
  HUBSPOT_PHONE_SLOT_WRITE_ENABLED,
  formatPhoneForHubSpotSlot,
  isHubSpotFillPropertyWritable,
  isSameHubSpotPhone,
  planRevealedPhonesForHubSpot,
} from '../contact-hubspot-sync-core';

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

  it('orden ESTRICTO: el tipo no cambia el campo (el primero va a `phone` aunque sea celular)', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [
          { phone: '+57 300 111 2222', type: 'mobile' },
          { phone: '+57 601 555 0000', type: 'work' },
        ],
        EMPTY,
      ),
      { phone: '+57 300 111 2222', mobilephone: '+57 601 555 0000' },
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

// ── AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER ──────────────────────────────────────────

const ALL_ON = { phone: true, mobilephone: true, company_phone: true, telefono_alterno: true } as const;
const ALL_EMPTY = { phone: null, mobilephone: null, company_phone: null, telefono_alterno: null };

describe('orden de campos de teléfono (AGENT2A-HUBSPOT-PHONE-SLOTS-ORDER)', () => {
  it('el orden es phone → mobilephone → company_phone → telefono_alterno', () => {
    assert.deepEqual([...HUBSPOT_PHONE_SLOT_ORDER], ['phone', 'mobilephone', 'company_phone', 'telefono_alterno']);
  });

  it('hoy se escriben `phone`, `mobilephone` y `telefono_alterno` (company_phone apagado)', () => {
    assert.deepEqual(HUBSPOT_PHONE_SLOT_WRITE_ENABLED, {
      phone: true,
      mobilephone: true,
      company_phone: false,
      telefono_alterno: true,
    });
    assert.equal(isHubSpotFillPropertyWritable('company_phone'), false);
    assert.equal(isHubSpotFillPropertyWritable('telefono_alterno'), true);
    assert.equal(isHubSpotFillPropertyWritable('phone'), true);
    assert.equal(isHubSpotFillPropertyWritable('hs_linkedin_url'), true);
  });

  it('config actual: phone y mobilephone llenos ⇒ el número salta company_phone (apagado) y va a telefono_alterno', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], {
        ...ALL_EMPTY,
        phone: '+57 601 555 0000',
        mobilephone: '+57 310 000 0000',
      }),
      { telefono_alterno: '+57 300 111 2222' },
    );
  });

  it('config actual: tres números en un contacto vacío ⇒ phone, mobilephone y telefono_alterno', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }, { phone: '+57 315 444 5555' }, { phone: '+57 320 999 8888' }],
        ALL_EMPTY,
      ),
      { phone: '+57 300 111 2222', mobilephone: '+57 315 444 5555', telefono_alterno: '+57 320 999 8888' },
    );
  });

  it('todos apagados salvo phone/mobilephone: llenos ⇒ nada viaja', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }],
        { ...ALL_EMPTY, phone: '+57 601 555 0000', mobilephone: '+57 310 000 0000' },
        { phone: true, mobilephone: true, company_phone: false, telefono_alterno: false },
      ),
      {},
    );
  });

  it('leídos: un número que HubSpot ya tiene en telefono_alterno / company_phone no se reenvía a `phone`', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { ...ALL_EMPTY, telefono_alterno: '3001112222' }),
      {},
    );
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], { ...ALL_EMPTY, company_phone: '300 111 2222' }),
      {},
    );
  });

  it('encendidos: con phone y mobilephone en uso, el número va a company_phone', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }],
        { ...ALL_EMPTY, phone: '+57 601 555 0000', mobilephone: '+57 310 000 0000' },
        ALL_ON,
      ),
      { company_phone: '+57 300 111 2222' },
    );
  });

  it('encendidos: con los tres primeros en uso, el número va a telefono_alterno (tal cual, tipo teléfono)', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }],
        { phone: '+57 601 555 0000', mobilephone: '+57 310 000 0000', company_phone: '+57 601 777 0000', telefono_alterno: '' },
        ALL_ON,
      ),
      { telefono_alterno: '+57 300 111 2222' },
    );
  });

  it('encendidos: cada número nuevo al siguiente campo vacío, saltando los que están en uso', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }, { phone: '+57 315 444 5555' }, { phone: '+57 320 999 8888' }],
        { phone: null, mobilephone: '+57 310 000 0000', company_phone: null, telefono_alterno: null },
        ALL_ON,
      ),
      { phone: '+57 300 111 2222', company_phone: '+57 315 444 5555', telefono_alterno: '+57 320 999 8888' },
    );
  });

  it('encendidos: los cuatro en uso ⇒ nada viaja (nunca se pisa)', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }],
        { phone: '1', mobilephone: '2', company_phone: '3', telefono_alterno: '4' },
        ALL_ON,
      ),
      {},
    );
  });

  it('encendidos pero SIN leer company_phone / telefono_alterno ⇒ no se escriben (no saber no autoriza)', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot(
        [{ phone: '+57 300 111 2222' }],
        { phone: '+57 601 555 0000', mobilephone: '+57 310 000 0000' },
        ALL_ON,
      ),
      {},
    );
  });
});

describe('formatPhoneForHubSpotSlot', () => {
  it('`telefono_alterno` es de tipo teléfono: viaja tal cual (ya no se fuerzan dígitos)', () => {
    assert.equal(formatPhoneForHubSpotSlot('telefono_alterno', '+57 (300) 111-2222'), '+57 (300) 111-2222');
  });
  it('los demás campos viajan tal cual', () => {
    assert.equal(formatPhoneForHubSpotSlot('phone', '+57 300 111 2222'), '+57 300 111 2222');
    assert.equal(formatPhoneForHubSpotSlot('company_phone', '+57 601 555 0000'), '+57 601 555 0000');
  });
  it('vacío no hay valor', () => {
    assert.equal(formatPhoneForHubSpotSlot('telefono_alterno', '   '), null);
  });
  it('un número que HubSpot guardó en `telefono_alterno` como dígitos cuenta como el mismo', () => {
    assert.deepEqual(
      planRevealedPhonesForHubSpot([{ phone: '+57 300 111 2222' }], {
        phone: null,
        mobilephone: null,
        company_phone: null,
        telefono_alterno: '573001112222',
      }),
      {},
    );
  });
});
