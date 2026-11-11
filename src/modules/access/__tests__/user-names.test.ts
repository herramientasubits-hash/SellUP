import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayUserName, loadUserNames, type UserNamesClient } from '../user-names';

function fakeClient(rows: Array<{ id: string; full_name: string | null; email: string | null }>, fail = false): UserNamesClient & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    asked,
    from: () => ({
      select: () => ({
        in: (_c: 'id', values: readonly string[]) => {
          asked.push([...values]);
          return Promise.resolve(fail ? { data: null, error: new Error('x') } : { data: rows.filter((r) => values.includes(r.id)), error: null });
        },
      }),
    }),
  };
}

test('nombre visible: nombre completo o el correo sin dominio', () => {
  assert.equal(displayUserName({ full_name: ' Ana Pérez ', email: 'ana@ubits.co' }), 'Ana Pérez');
  assert.equal(displayUserName({ full_name: null, email: 'carla.pia@ubits.co' }), 'carla.pia');
  assert.equal(displayUserName({ full_name: '', email: null }), null);
});

test('una sola lectura, sin repetir ids ni nulos', async () => {
  const client = fakeClient([{ id: 'u1', full_name: 'Ana', email: null }]);
  const names = await loadUserNames(client, ['u1', null, 'u1', undefined, 'u2']);
  assert.deepEqual(client.asked, [['u1', 'u2']]);
  assert.equal(names.get('u1'), 'Ana');
  assert.equal(names.has('u2'), false);
});

test('sin ids no lee; si la lectura falla devuelve vacío', async () => {
  const client = fakeClient([]);
  assert.equal((await loadUserNames(client, [null])).size, 0);
  assert.deepEqual(client.asked, []);
  assert.equal((await loadUserNames(fakeClient([], true), ['u1'])).size, 0);
});
