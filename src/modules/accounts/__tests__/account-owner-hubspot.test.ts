// ACCOUNT-OWNER-HUBSPOT-NOTICE-1 — aviso «En HubSpot esta empresa es de…» y lectura del dueño guardado.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildHubSpotOwnerSnapshot,
  describeOwnerVsHubSpot,
  ownerVsHubSpotCopy,
  readHubSpotOwnerSnapshot,
} from '../account-owner-hubspot';

const NOW = '2026-10-22T12:00:00.000Z';
const meta = (owner: { email: string | null; user: string | null }) => ({
  otra_cosa: 1,
  hubspot_owner: buildHubSpotOwnerSnapshot({
    hubspotOwnerId: '81219852',
    hubspotOwnerEmail: owner.email,
    hubspotOwnerUserId: owner.user,
    nowIso: NOW,
  }),
});

describe('describeOwnerVsHubSpot', () => {
  it('Grupo LALA: responsable brcastro, en HubSpot mvelez (usuario de SellUp)', () => {
    const notice = describeOwnerVsHubSpot({ ownerId: 'brcastro', metadata: meta({ email: 'mvelez@ubits.co', user: 'mvelez' }) });
    assert.deepEqual(notice, { kind: 'other_sellup_user', hubspotOwnerEmail: 'mvelez@ubits.co', readAt: NOW });
    assert.equal(ownerVsHubSpotCopy(notice!).title, 'En HubSpot esta empresa es de mvelez@ubits.co');
    assert.match(ownerVsHubSpotCopy(notice!).description, /cámbialo desde «Acciones»/);
  });

  it('dueño de HubSpot sin usuario en SellUp (buzón genérico)', () => {
    const notice = describeOwnerVsHubSpot({ ownerId: 'brcastro', metadata: meta({ email: 'salesmexico@ubits.co', user: null }) });
    assert.equal(notice?.kind, 'not_in_sellup');
    assert.match(ownerVsHubSpotCopy(notice!).description, /no tiene usuario activo en SellUp/);
  });

  it('sin aviso si coinciden, si HubSpot no tiene dueño o si nunca se leyó', () => {
    assert.equal(describeOwnerVsHubSpot({ ownerId: 'mvelez', metadata: meta({ email: 'mvelez@ubits.co', user: 'mvelez' }) }), null);
    assert.equal(describeOwnerVsHubSpot({ ownerId: 'brcastro', metadata: meta({ email: null, user: null }) }), null);
    assert.equal(describeOwnerVsHubSpot({ ownerId: 'brcastro', metadata: {} }), null);
    assert.equal(describeOwnerVsHubSpot({ ownerId: 'brcastro', metadata: null }), null);
  });

  it('una lectura mal formada no rompe ni avisa', () => {
    assert.equal(readHubSpotOwnerSnapshot({ hubspot_owner: 'x' }), null);
    assert.equal(readHubSpotOwnerSnapshot({ hubspot_owner: { email: 'a@b.co' } }), null);
    assert.equal(readHubSpotOwnerSnapshot({ hubspot_owner: { email: ' A@B.CO ', read_at: NOW } })?.email, 'a@b.co');
  });
});

describe('sincronización con HubSpot (código)', () => {
  const source = readFileSync(join(__dirname, '..', 'hubspot-company-profile-sync.server.ts'), 'utf8');
  it('guarda el dueño de HubSpot aunque no haya nada que completar, salvo empresas libres', () => {
    assert.match(source, /if \(columns\.length === 0 && !profile\)/);
    assert.match(source, /hubspot_owner: hubspotOwner/);
    assert.match(source, /input\.ignoreHubSpotOwner !== true/);
  });
  it('guarda de dónde salió el responsable sólo cuando esta sincronización lo eligió', () => {
    assert.match(source, /ownerSource \? \{ owner_origin: \{ source: ownerSource, decided_at: input\.nowIso \} \} : \{\}/);
  });
  it('no agrega cambios de responsable (mismos owner_id que antes de este cambio)', () => {
    assert.equal(source.match(/owner_id:/g)?.length, 3);
  });
});

describe('script de relleno (código)', () => {
  const script = readFileSync(join(__dirname, '..', '..', '..', '..', 'scripts', 'accounts', 'backfill-hubspot-owner-snapshot.ts'), 'utf8');
  it('simula por defecto y exige dos banderas para escribir', () => {
    assert.match(script, /--confirm-hubspot-owner-snapshot/);
    assert.match(script, /if \(APPLY && !CONFIRMED\)/);
  });
  it('sólo escribe metadatos', () => {
    assert.equal(script.match(/\.update\(/g)?.length, 1);
    assert.match(script, /update\(\{ metadata \}\)/);
  });
});
