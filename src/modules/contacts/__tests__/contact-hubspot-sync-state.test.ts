/**
 * AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC — Task A1: comparar el PAR de teléfonos salientes,
 * no un valor colapsado.
 *
 * `resolveOutboundHubSpotPhone` colapsa `mobile_phone`/`phone` en un solo valor con prioridad
 * (móvil gana). Usar ESE valor colapsado para decidir si hay que marcar `stale` deja invisible
 * un cambio en el campo sin prioridad (`phone`) mientras el otro no se mueva.
 * `haveOutboundHubSpotPhonesChanged` compara los DOS campos de forma independiente para esa
 * decisión; `resolveOutboundHubSpotPhone` sigue intacta y se sigue usando para decidir QUÉ
 * enviar y para clasificar `phone_changed` vs `phone_removed`.
 *
 * Sin red, sin DB, sin reloj propio: puro y testeable en aislamiento.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  haveOutboundHubSpotPhonesChanged,
  markContactHubSpotSyncStaleForPhoneChange,
  readHubSpotSyncState,
} from '../contact-hubspot-sync-state';

describe('haveOutboundHubSpotPhonesChanged — compara el PAR, no un valor colapsado', () => {
  it('detecta un cambio en `phone` aunque `mobile_phone` no haya cambiado', () => {
    const previous = { phone: null, mobile_phone: '+57 300 000 0000' };
    const next = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    // ANTES de esta corrección, resolveOutboundHubSpotPhone(previous) === resolveOutboundHubSpotPhone(next)
    // porque el móvil (con prioridad) es idéntico en los dos — el número nuevo en `phone` sería invisible.
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), true);
  });

  it('detecta un cambio en `mobile_phone` aunque `phone` no haya cambiado', () => {
    const previous = { phone: '+57 1 555 0000', mobile_phone: null };
    const next = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), true);
  });

  it('sin cambios en ninguno de los dos campos, no hay cambio', () => {
    const source = { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' };
    assert.equal(haveOutboundHubSpotPhonesChanged(source, { ...source }), false);
  });

  it('trata espacios en blanco y cadena vacía como ausencia, igual que antes', () => {
    const previous = { phone: '  ', mobile_phone: null };
    const next = { phone: '', mobile_phone: undefined };
    assert.equal(haveOutboundHubSpotPhonesChanged(previous, next), false);
  });
});

describe('markContactHubSpotSyncStaleForPhoneChange — con la comparación por par', () => {
  it('marca pendiente cuando sólo cambia el campo `phone` (antes era invisible)', () => {
    const metadata = {
      hubspot_sync: { status: 'synced', method: 'auto', hubspot_contact_id: 'hs-1' },
    };
    // Confirma que el fixture de metadata sí sobrevive a `readHubSpotSyncState` y ejerce el
    // camino REAL de la función bajo prueba, no un `no_durable_state` temprano.
    assert.notEqual(readHubSpotSyncState(metadata), null);

    const decision = markContactHubSpotSyncStaleForPhoneChange({
      metadata,
      hubspotContactId: 'hs-1',
      previous: { phone: null, mobile_phone: '+57 300 000 0000' },
      next: { phone: '+57 1 555 0000', mobile_phone: '+57 300 000 0000' },
      nowIso: '2026-08-27T00:00:00.000Z',
      source: 'user_edit',
    });
    assert.equal(decision.marked, true);
  });
});
