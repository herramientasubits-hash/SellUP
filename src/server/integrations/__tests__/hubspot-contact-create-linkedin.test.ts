// AGENT2A-HUBSPOT-LINKEDIN-ON-CREATE — el LinkedIn viaja al CREAR un contacto en HubSpot.
//
// Antes sólo viajaba cuando el contacto YA existía (completar vacíos), así que todo contacto
// creado por SellUp llegaba al CRM sin LinkedIn. Estos tests fijan el cuerpo del POST y el
// reintento sin LinkedIn ante un 400, para que un LinkedIn rechazado nunca bloquee la creación.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHubSpotContactCreateBody,
  postHubSpotContactCreateWithLinkedinFallback,
} from '../hubspot-contact-sync';
import type { HubSpotContactCreateInput } from '@/modules/contacts/contact-hubspot-sync-core';

function makeInput(overrides: Partial<HubSpotContactCreateInput> = {}): HubSpotContactCreateInput {
  return {
    email: 'juan@empresa.com',
    firstname: 'Juan Camilo',
    lastname: 'Herrera Niño',
    jobtitle: 'Gerente de Talento',
    phone: null,
    mobilePhone: null,
    linkedinUrl: 'https://www.linkedin.com/in/juancamiloherrerani%C3%B1o',
    ...overrides,
  };
}

test('el cuerpo de creación lleva hs_linkedin_url tal cual (ñ codificada incluida)', () => {
  const body = buildHubSpotContactCreateBody(makeInput(), true);
  assert.equal(body.hs_linkedin_url, 'https://www.linkedin.com/in/juancamiloherrerani%C3%B1o');
  assert.equal(body.sellup_created, 'true');
  assert.equal(body.email, 'juan@empresa.com');
});

test('sin LinkedIn no se manda la propiedad (nunca cadena vacía)', () => {
  const body = buildHubSpotContactCreateBody(makeInput({ linkedinUrl: null }), false);
  assert.equal('hs_linkedin_url' in body, false);
  assert.equal('sellup_created' in body, false);
  assert.equal('phone' in body, false);
});

function res(status: number): Response {
  return new Response(JSON.stringify({ id: 'hs-1' }), { status });
}

test('un 400 con LinkedIn reintenta UNA vez sin LinkedIn', async () => {
  const calls: Record<string, string>[] = [];
  const response = await postHubSpotContactCreateWithLinkedinFallback(
    buildHubSpotContactCreateBody(makeInput(), true),
    async (body) => {
      calls.push(body);
      return calls.length === 1 ? res(400) : res(201);
    },
  );
  assert.equal(response.status, 201);
  assert.equal(calls.length, 2);
  assert.equal('hs_linkedin_url' in calls[0], true);
  assert.equal('hs_linkedin_url' in calls[1], false);
  assert.equal(calls[1].email, 'juan@empresa.com');
});

test('éxito a la primera: una sola llamada, con LinkedIn', async () => {
  const calls: Record<string, string>[] = [];
  await postHubSpotContactCreateWithLinkedinFallback(
    buildHubSpotContactCreateBody(makeInput(), true),
    async (body) => {
      calls.push(body);
      return res(201);
    },
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hs_linkedin_url, 'https://www.linkedin.com/in/juancamiloherrerani%C3%B1o');
});

test('un 400 SIN LinkedIn no reintenta; otros errores tampoco', async () => {
  let n = 0;
  const r1 = await postHubSpotContactCreateWithLinkedinFallback(
    buildHubSpotContactCreateBody(makeInput({ linkedinUrl: null }), true),
    async () => {
      n += 1;
      return res(400);
    },
  );
  assert.equal(r1.status, 400);
  assert.equal(n, 1);

  n = 0;
  const r2 = await postHubSpotContactCreateWithLinkedinFallback(
    buildHubSpotContactCreateBody(makeInput(), true),
    async () => {
      n += 1;
      return res(409);
    },
  );
  assert.equal(r2.status, 409);
  assert.equal(n, 1);
});
