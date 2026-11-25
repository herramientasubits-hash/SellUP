// TABLEROS-1 — Dimensiones y fuentes de los tableros: tamaño, seniority,
// completitud, estado de una solicitud, procedencia y vocabulario de fuentes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIZE_UNKNOWN,
  completenessOf,
  contactRequestStateOf,
  filledHubspotPropertiesOf,
  hubspotFilledDataOf,
  seniorityLabel,
  sizeBandOf,
  sizeBandRank,
} from '../dashboard-dimensions';
import {
  contactOriginOf,
  dashboardSourceLabel,
  normalizeDashboardSource,
  sortSourceKeys,
  sourcePassesFilter,
} from '../dashboard-sources';

describe('sizeBandOf — tamaño (el segmento queda para después)', () => {
  it('manda el número de empleados', () => {
    assert.equal(sizeBandOf(150, '1-10 empleados'), '51-200 empleados');
    assert.equal(sizeBandOf(7000, null), '5,001+ empleados');
  });

  it('sin número, lee el tamaño escrito en sus formas comunes', () => {
    assert.equal(sizeBandOf(null, '201-500 empleados'), '201-500 empleados');
    assert.equal(sizeBandOf(null, '1,001-5,000 empleados'), '1,001-5,000 empleados');
    assert.equal(sizeBandOf(null, '51-200'), '51-200 empleados');
    assert.equal(sizeBandOf(null, '5001+'), '5,001+ empleados');
  });

  it('lo que no se entiende es «Sin dato» y va al final', () => {
    assert.equal(sizeBandOf(null, 'grande'), SIZE_UNKNOWN);
    assert.equal(sizeBandOf(0, ''), SIZE_UNKNOWN);
    assert.ok(sizeBandRank(SIZE_UNKNOWN) > sizeBandRank('5,001+ empleados'));
  });
});

describe('seniorityLabel', () => {
  it('traduce las claves conocidas y deja las demás como vienen', () => {
    assert.equal(seniorityLabel('c_suite'), 'C-level');
    assert.equal(seniorityLabel('Manager'), 'Manager');
    assert.equal(seniorityLabel('Gerente regional'), 'Gerente regional');
    assert.equal(seniorityLabel(null), 'Sin dato');
  });
});

describe('completenessOf — completo es correo, teléfono y LinkedIn', () => {
  it('dice exactamente qué falta', () => {
    assert.equal(completenessOf({ hasEmail: true, hasPhone: true, hasLinkedin: true }), 'full');
    assert.equal(completenessOf({ hasEmail: true, hasPhone: false, hasLinkedin: true }), 'missing_phone');
    assert.equal(completenessOf({ hasEmail: false, hasPhone: true, hasLinkedin: true }), 'missing_email');
    assert.equal(completenessOf({ hasEmail: true, hasPhone: true, hasLinkedin: false }), 'missing_linkedin');
    assert.equal(completenessOf({ hasEmail: true, hasPhone: false, hasLinkedin: false }), 'missing_linkedin_phone');
    assert.equal(completenessOf({ hasEmail: false, hasPhone: false, hasLinkedin: true }), 'missing_several');
  });
});

describe('contactRequestStateOf — sólo lo aprobado es «enriquecida»', () => {
  it('un contacto aprobado basta, aunque haya otros pendientes', () => {
    assert.equal(
      contactRequestStateOf({ runStatuses: ['completed'], candidateStatuses: ['pending_review', 'approved'] }),
      'enriched',
    );
  });

  it('con candidatos sin aprobar: por revisar o revisada sin aprobar', () => {
    assert.equal(contactRequestStateOf({ runStatuses: ['ready_for_review'], candidateStatuses: ['pending_review'] }), 'pending_review');
    assert.equal(contactRequestStateOf({ runStatuses: ['completed'], candidateStatuses: ['discarded', 'duplicate'] }), 'reviewed_none');
  });

  it('sin candidatos: en proceso, fallida o sin resultados (un intento reemplazado no cuenta)', () => {
    assert.equal(contactRequestStateOf({ runStatuses: ['superseded', 'enriching'], candidateStatuses: [] }), 'in_progress');
    assert.equal(contactRequestStateOf({ runStatuses: ['failed', 'superseded'], candidateStatuses: [] }), 'failed');
    assert.equal(contactRequestStateOf({ runStatuses: ['failed', 'completed'], candidateStatuses: [] }), 'no_results');
  });
});

describe('datos que SellUp completó en HubSpot', () => {
  it('sólo cuenta lo que HubSpot aceptó (`filled`)', () => {
    assert.deepEqual(
      filledHubspotPropertiesOf({
        fill_empty: { outcome: 'filled', properties: ['phone', 'hs_linkedin_url'], error: null },
        email_fill: { outcome: 'filled', error: null },
      }),
      ['phone', 'hs_linkedin_url', 'email'],
    );
    assert.deepEqual(filledHubspotPropertiesOf({ fill_empty: { outcome: 'failed', properties: ['phone'] } }), []);
    assert.deepEqual(filledHubspotPropertiesOf(null), []);
    assert.deepEqual(filledHubspotPropertiesOf('basura'), []);
  });

  it('agrupa las propiedades por dato: dos teléfonos son «Teléfono» una vez', () => {
    assert.deepEqual(hubspotFilledDataOf(['phone', 'mobilephone', 'firstname', 'desconocida']), ['Teléfono', 'Nombre']);
  });
});

describe('fuentes', () => {
  it('normaliza: vacío es «Sin fuente», desconocido es «Otra», prueba no cuenta', () => {
    assert.equal(normalizeDashboardSource(' HubSpot '), 'hubspot');
    assert.equal(normalizeDashboardSource(null), 'unknown');
    assert.equal(normalizeDashboardSource('fuente_nueva'), 'other');
    assert.equal(normalizeDashboardSource('mock'), null);
  });

  it('sin fuentes elegidas pasan todas; con fuentes, sólo esas', () => {
    assert.equal(sourcePassesFilter('lusha', []), true);
    assert.equal(sourcePassesFilter('lusha', ['hubspot']), false);
    assert.equal(sourcePassesFilter('hubspot', ['hubspot', 'apollo']), true);
  });

  it('ordena como la UI y etiqueta la serie agrupada', () => {
    assert.deepEqual(sortSourceKeys(['lusha', 'hubspot', 'apollo', 'lusha']), ['hubspot', 'apollo', 'lusha']);
    assert.equal(dashboardSourceLabel('grouped'), 'Fuentes elegidas');
    assert.equal(dashboardSourceLabel('socrata_colombia'), 'Datos abiertos Colombia');
  });

  it('procedencia: «ya estaba en HubSpot» si vino de HubSpot o coincidió con uno', () => {
    assert.equal(contactOriginOf({ source: 'hubspot', matchedHubspotContactId: null }), 'hubspot_existing');
    assert.equal(contactOriginOf({ source: 'apollo', matchedHubspotContactId: '901' }), 'hubspot_existing');
    assert.equal(contactOriginOf({ source: 'lusha', matchedHubspotContactId: ' ' }), 'new');
  });
});
