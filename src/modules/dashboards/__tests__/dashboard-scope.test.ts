// TABLEROS-1 — A quién mira un tablero. 🔴 Regla del dueño (25-11): el BD sólo ve
// lo suyo; el líder, a su gente; el admin, a todos. Los filtros sólo achican.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDashboardAudience, type DashboardAudienceInput, type DirectoryUser } from '../dashboard-scope';

const ANA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CARLA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OTRO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const USERS: DirectoryUser[] = [
  { id: ANA, name: 'Ana', email: 'ana@ubits.co', groupId: 'g-co' },
  { id: BETO, name: 'Beto', email: 'beto@ubits.co', groupId: 'g-co-bog' },
  { id: CARLA, name: 'Carla', email: 'carla@ubits.co', groupId: 'g-mx' },
];
const GROUPS = [
  { id: 'g-co', name: 'Colombia', parentGroupId: null, depth: 0 },
  { id: 'g-co-bog', name: 'Bogotá', parentGroupId: 'g-co', depth: 1 },
  { id: 'g-mx', name: 'México', parentGroupId: null, depth: 0 },
];

function input(overrides: Partial<DashboardAudienceInput>): DashboardAudienceInput {
  return {
    kind: 'admin',
    currentUserId: ANA,
    allowedUserIds: [],
    users: USERS,
    groups: GROUPS,
    requestedTeams: [],
    requestedPeople: [],
    ...overrides,
  };
}

describe('resolveDashboardAudience', () => {
  it('🔴 BD: sólo él, aunque pida a otra persona o a un equipo por la URL', () => {
    const audience = resolveDashboardAudience(
      input({
        kind: 'self',
        currentUserId: BETO,
        users: [],
        requestedPeople: [ANA, CARLA],
        requestedTeams: ['g-co'],
        self: USERS[1],
      }),
    );
    assert.deepEqual(audience.queryUserIds, [BETO]);
    assert.deepEqual(audience.people.map((person) => person.id), [BETO]);
    assert.deepEqual(audience.ignoredPeople, [ANA, CARLA]);
    assert.deepEqual(audience.ignoredTeams, ['g-co']);
  });

  it('admin sin filtros: consultas sin límite y todos en la tabla', () => {
    const audience = resolveDashboardAudience(input({}));
    assert.equal(audience.queryUserIds, null);
    assert.equal(audience.people.length, 3);
  });

  it('un equipo abarca sus subequipos', () => {
    const audience = resolveDashboardAudience(input({ requestedTeams: ['g-co'] }));
    assert.deepEqual(audience.queryUserIds?.sort(), [ANA, BETO].sort());
    assert.equal(audience.people.find((person) => person.id === BETO)?.groupName, 'Bogotá');
  });

  it('equipo y personas se cruzan (personas dentro de los equipos)', () => {
    const audience = resolveDashboardAudience(input({ requestedTeams: ['g-co'], requestedPeople: [BETO, CARLA] }));
    assert.deepEqual(audience.queryUserIds, [BETO]);
  });

  it('🔴 líder: nunca ve a alguien fuera de su gente, ni pegando su id', () => {
    const audience = resolveDashboardAudience(
      input({ kind: 'team', allowedUserIds: [ANA, BETO], users: USERS.slice(0, 2), requestedPeople: [CARLA] }),
    );
    assert.deepEqual(audience.queryUserIds, [], 'pidió sólo a alguien de fuera: no se lee nada');
    assert.deepEqual(audience.people, []);
    assert.deepEqual(audience.ignoredPeople, [CARLA]);
  });

  it('líder sin filtros: consultas limitadas a su gente (también inactivos de su alcance)', () => {
    const audience = resolveDashboardAudience(
      input({ kind: 'team', allowedUserIds: [ANA, BETO, OTRO], users: USERS.slice(0, 2) }),
    );
    assert.deepEqual(audience.queryUserIds, [ANA, BETO, OTRO]);
    assert.deepEqual(audience.people.map((person) => person.id), [ANA, BETO], 'la tabla sólo lista a los activos');
  });

  it('un equipo inexistente se ignora y, si era lo único pedido, no se muestra a nadie', () => {
    const audience = resolveDashboardAudience(input({ requestedTeams: ['no-existe'] }));
    assert.deepEqual(audience.queryUserIds, []);
    assert.deepEqual(audience.ignoredTeams, ['no-existe']);
  });
});
