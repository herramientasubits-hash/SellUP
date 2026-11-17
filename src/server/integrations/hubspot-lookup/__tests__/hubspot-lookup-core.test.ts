/**
 * Consulta de HubSpot desde SellUp — núcleo puro (sin red ni Supabase).
 * Lo que responde HubSpot → lo que pinta SellUp, y dónde está el registro en SellUp.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUBSPOT_ACTIVITY_MAX_ITEMS,
  associationIds,
  buildLookupSearchBody,
  decideSellUpPresence,
  htmlToPlainText,
  isHubSpotObjectId,
  lifecycleLabel,
  mapHubSpotActivity,
  mapHubSpotCompany,
  mapHubSpotContact,
  normalizeLookupQuery,
  ownerDisplayName,
  sortAndTrimActivity,
  type HubSpotActivityItem,
} from '../hubspot-lookup-core';

describe('ids y búsqueda', () => {
  it('sólo acepta ids de HubSpot numéricos', () => {
    assert.equal(isHubSpotObjectId('7324164638'), true);
    assert.equal(isHubSpotObjectId('abc'), false);
    assert.equal(isHubSpotObjectId('12;DROP'), false);
    assert.equal(isHubSpotObjectId(''), false);
    assert.equal(isHubSpotObjectId(123), false);
  });

  it('no busca con menos de 3 letras y recorta lo escrito', () => {
    assert.equal(normalizeLookupQuery('ar'), null);
    assert.equal(normalizeLookupQuery('   '), null);
    assert.equal(normalizeLookupQuery(42), null);
    assert.equal(normalizeLookupQuery('  arcor   chile '), 'arcor chile');
    assert.equal(normalizeLookupQuery('x'.repeat(300))?.length, 120);
  });

  it('la búsqueda pide pocas filas, las propiedades y lo más reciente primero', () => {
    const body = buildLookupSearchBody('arcor', ['name', 'domain']);
    assert.equal(body.query, 'arcor');
    assert.equal(body.limit, 6);
    assert.deepEqual(body.properties, ['name', 'domain']);
    assert.equal(body.sorts[0].direction, 'DESCENDING');
  });
});

describe('empresa', () => {
  it('traduce la ficha de HubSpot (país de UBITS, macro industria, NIT, etapa)', () => {
    const c = mapHubSpotCompany('7324164638', {
      name: ' ARCOR Chile ',
      domain: 'www.arcor.cl',
      pais: 'Chile',
      country: 'Argentina',
      industriaespecifica: 'Consumo Masivo',
      numberofemployees: '1000',
      identificaci_n_fiscal: '96.123.456-7',
      hubspot_owner_id: '55',
      lifecyclestage: 'customer',
      num_associated_contacts: '3',
    });
    assert.equal(c.name, 'ARCOR Chile');
    assert.equal(c.domain, 'arcor.cl');
    assert.equal(c.website, 'https://arcor.cl');
    assert.equal(c.country, 'Chile');
    assert.equal(c.industry, 'Consumo Masivo');
    assert.equal(c.employees, '1000');
    assert.equal(c.taxId, '96.123.456-7');
    assert.equal(c.ownerId, '55');
    assert.equal(c.lifecycle, 'Cliente');
    assert.equal(c.contactsCount, 3);
  });

  it('sin nombre usa el dominio; un sitio sin protocolo se vuelve enlace', () => {
    const c = mapHubSpotCompany('1', { website: 'acme.co/inicio' });
    assert.equal(c.name, 'acme.co');
    assert.equal(c.website, 'https://acme.co/inicio');
  });

  it('una etapa propia del portal se muestra tal cual', () => {
    assert.equal(lifecycleLabel('opportunity'), 'Oportunidad');
    assert.equal(lifecycleLabel('1234567'), '1234567');
    assert.equal(lifecycleLabel(''), null);
  });
});

describe('contacto', () => {
  it('arma el nombre y normaliza el correo', () => {
    const c = mapHubSpotContact('9', {
      firstname: 'Ana',
      lastname: 'Acosta',
      email: 'Ana@Acme.CO',
      jobtitle: 'Gerente de Talento',
      associatedcompanyid: '7324164638',
    });
    assert.equal(c.fullName, 'Ana Acosta');
    assert.equal(c.email, 'ana@acme.co');
    assert.equal(c.companyId, '7324164638');
  });

  it('sin nombre usa el correo, y una empresa inválida no se toma', () => {
    const c = mapHubSpotContact('9', { email: 'x@y.co', associatedcompanyid: 'n/a' });
    assert.equal(c.fullName, 'x@y.co');
    assert.equal(c.companyId, null);
  });
});

describe('actividad', () => {
  it('el HTML de HubSpot se vuelve texto plano recortado', () => {
    assert.equal(htmlToPlainText('<p>Hola&nbsp;<b>equipo</b></p><p>Segunda&amp;línea</p>'), 'Hola equipo\nSegunda&línea');
    assert.equal(htmlToPlainText('<script>alert(1)</script>ok'), 'ok');
    assert.equal(htmlToPlainText('   '), null);
    const long = htmlToPlainText('a'.repeat(1000), 50);
    assert.equal(long?.length, 50);
    assert.ok(long?.endsWith('…'));
  });

  it('una llamada dice dirección y duración', () => {
    const item = mapHubSpotActivity('call', '1', {
      hs_timestamp: '2026-11-10T15:00:00Z',
      hs_call_title: 'Llamada de descubrimiento',
      hs_call_direction: 'OUTBOUND',
      hs_call_duration: '300000',
      hubspot_owner_id: '55',
    });
    assert.equal(item.title, 'Llamada de descubrimiento');
    assert.deepEqual(item.details, ['Saliente', '5 min']);
    assert.equal(item.ownerId, '55');
  });

  it('un negocio muestra su etapa con nombre y su monto', () => {
    const item = mapHubSpotActivity(
      'deal',
      '2',
      { dealname: 'Licencias 2027', dealstage: 'stage-1', amount: '15000000', deal_currency_code: 'cop', createdate: '2026-10-01T00:00:00Z' },
      new Map([['stage-1', 'Propuesta']]),
    );
    assert.equal(item.title, 'Licencias 2027');
    assert.equal(item.details[0], 'Etapa: Propuesta');
    assert.match(item.details[1], /15.000.000 COP/);
  });

  it('tareas y reuniones traen su estado en español', () => {
    assert.deepEqual(mapHubSpotActivity('task', '3', { hs_task_status: 'COMPLETED' }).details, ['Completada']);
    assert.deepEqual(mapHubSpotActivity('meeting', '4', { hs_meeting_outcome: 'NO_SHOW' }).details, ['No asistió']);
  });

  it('ordena lo más reciente primero, sin repetidas, y acepta fechas en milisegundos', () => {
    const base = (id: string, occurredAt: string | null): HubSpotActivityItem => ({
      id,
      kind: 'note',
      title: 'Nota',
      body: null,
      details: [],
      occurredAt,
      ownerId: null,
    });
    const sorted = sortAndTrimActivity([
      base('1', '2026-01-01T00:00:00Z'),
      base('2', String(Date.parse('2026-06-01T00:00:00Z'))),
      base('1', '2026-01-01T00:00:00Z'),
      base('3', null),
    ]);
    assert.deepEqual(sorted.map((i) => i.id), ['2', '1', '3']);
    assert.equal(sorted[0].occurredAt, '2026-06-01T00:00:00.000Z');
    assert.equal(sorted[2].occurredAt, null);
  });

  it('recorta al máximo', () => {
    const many = Array.from({ length: HUBSPOT_ACTIVITY_MAX_ITEMS + 10 }, (_, i) =>
      mapHubSpotActivity('note', String(i + 1), { hs_timestamp: new Date(2026, 0, i + 1).toISOString() }),
    );
    assert.equal(sortAndTrimActivity(many).length, HUBSPOT_ACTIVITY_MAX_ITEMS);
  });

  it('lee ids de asociaciones v4 y v3, sin repetidos ni basura', () => {
    assert.deepEqual(associationIds({ results: [{ toObjectId: 11 }, { toObjectId: '11' }, { id: '12' }, { id: 'x' }] }), ['11', '12']);
    assert.deepEqual(associationIds(null), []);
    assert.deepEqual(associationIds({ results: 'nope' }), []);
  });

  it('nombre del dueño de HubSpot: nombre, si no el correo', () => {
    assert.equal(ownerDisplayName({ firstName: 'Carla', lastName: 'Reyes' }), 'Carla Reyes');
    assert.equal(ownerDisplayName({ email: 'cleiva@ubits.co' }), 'cleiva@ubits.co');
    assert.equal(ownerDisplayName(null), null);
  });
});

describe('presencia en SellUp', () => {
  const row = (id: string, owner: string) => ({ id, owner_id: owner, created_by: owner, owner_name: `Persona ${owner}` });

  it('no está: se consulta y se puede traer', () => {
    assert.deepEqual(decideSellUpPresence([], () => true), { status: 'none' });
  });

  it('está y quien mira la puede abrir: se abre la de SellUp', () => {
    assert.deepEqual(
      decideSellUpPresence([row('a', 'u1'), row('b', 'u2')], (r) => r.owner_id === 'u2'),
      { status: 'visible', id: 'b' },
    );
  });

  it('está pero la lleva otra persona: se dice quién (no se duplica)', () => {
    assert.deepEqual(decideSellUpPresence([row('a', 'u1')], () => false), { status: 'other_owner', ownerName: 'Persona u1' });
  });
});

describe('enlaces de HubSpot', () => {
  it('sólo http(s): otro esquema no se vuelve enlace', async () => {
    const { cleanWebUrl } = await import('../hubspot-lookup-core');
    assert.equal(cleanWebUrl('linkedin.com/in/ana'), 'https://linkedin.com/in/ana');
    assert.equal(cleanWebUrl('http://acme.co'), 'http://acme.co');
    assert.equal(cleanWebUrl('javascript:alert(1)'), null);
    assert.equal(cleanWebUrl('  '), null);
    assert.equal(mapHubSpotContact('1', { hs_linkedin_url: 'javascript:alert(1)' }).linkedinUrl, null);
  });
});
