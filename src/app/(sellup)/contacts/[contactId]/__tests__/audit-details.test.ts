/**
 * describeContactAuditDetails — el detalle de un evento, en palabras.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { describeContactAuditDetails } from '../audit-details';

describe('describeContactAuditDetails', () => {
  it('sin detalle no dice nada', () => {
    assert.equal(describeContactAuditDetails('contact_updated', {}), null);
    assert.equal(describeContactAuditDetails('contact_updated', null), null);
  });

  it('un cambio de estado se lee con los nombres de los estados', () => {
    const text = describeContactAuditDetails('contact_status_changed', {
      from: 'active',
      to: 'left_company',
    });

    assert.equal(text, 'De «Activo» a «Salió de la empresa»');
  });

  it('un cambio de rol se lee con los nombres de los roles', () => {
    const text = describeContactAuditDetails('contact_role_changed', {
      from: null,
      to: 'decision_maker',
    });

    assert.equal(text, 'De «sin definir» a «Decisor»');
  });

  it('distingue ganar y perder la marca de contacto principal', () => {
    assert.equal(
      describeContactAuditDetails('contact_primary_changed', { is_primary: true }),
      'Ahora es el contacto principal de la empresa',
    );
    assert.equal(
      describeContactAuditDetails('contact_primary_changed', { is_primary: false }),
      'Dejó de ser el contacto principal',
    );
  });

  it('una sincronización se resume sin enseñar identificadores', () => {
    const text = describeContactAuditDetails('contact_updated', {
      hubspot_sync: { mode: 'create', hubspot_contact_id: '99887766' },
    });

    assert.equal(text, 'Se envió a HubSpot');
  });

  it('un detalle técnico sin traducción no se enseña', () => {
    assert.equal(describeContactAuditDetails('contact_updated', { changed_fields: ['x'] }), null);
  });
});
