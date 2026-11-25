import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  accessPathForStatus,
  accessScreenRedirect,
  normalizeAccessStatus,
} from '../access-status-routes';

test('cada estado aterriza en su pantalla; activo va a la app', () => {
  assert.equal(accessPathForStatus('active'), '/pipeline');
  assert.equal(accessPathForStatus('pending_approval'), '/access-pending');
  assert.equal(accessPathForStatus('rejected'), '/access-rejected');
  assert.equal(accessPathForStatus('suspended'), '/access-suspended');
  assert.equal(accessPathForStatus('archived'), '/access-archived');
});

test('sin fila o estado desconocido = pendiente', () => {
  assert.equal(normalizeAccessStatus(null), 'pending_approval');
  assert.equal(normalizeAccessStatus(undefined), 'pending_approval');
  assert.equal(normalizeAccessStatus('toString'), 'pending_approval');
  assert.equal(accessPathForStatus('raro'), '/access-pending');
});

test('pantalla «inactivo» guardada en el navegador de alguien ya activo lo manda a la app', () => {
  assert.equal(accessScreenRedirect('suspended', 'active'), '/pipeline');
  assert.equal(accessScreenRedirect('pending_approval', 'active'), '/pipeline');
  assert.equal(accessScreenRedirect('rejected', 'active'), '/pipeline');
  assert.equal(accessScreenRedirect('archived', 'active'), '/pipeline');
});

test('la pantalla se pinta sólo si coincide con el estado real', () => {
  assert.equal(accessScreenRedirect('suspended', 'suspended'), null);
  assert.equal(accessScreenRedirect('archived', 'archived'), null);
  assert.equal(accessScreenRedirect('pending_approval', null), null);
  assert.equal(accessScreenRedirect('suspended', 'archived'), '/access-archived');
  assert.equal(accessScreenRedirect('archived', 'pending_approval'), '/access-pending');
});

test('las cuatro pantallas /access-* usan el guardia con su estado', () => {
  const screens: Array<[string, string]> = [
    ['access-pending', 'pending_approval'],
    ['access-rejected', 'rejected'],
    ['access-suspended', 'suspended'],
    ['access-archived', 'archived'],
  ];
  for (const [dir, status] of screens) {
    const src = readFileSync(`src/app/${dir}/page.tsx`, 'utf8');
    assert.ok(
      src.includes(`requireAccessScreen('${status}')`),
      `${dir} debe revisar el estado real con requireAccessScreen('${status}')`,
    );
  }
});
