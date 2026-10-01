/**
 * Agregar usuarios a un grupo — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - solo se ofrecen personas que NO están ya en el grupo;
 *   - 🔴 al asignar se mandan EXACTAMENTE las personas marcadas, a ese grupo;
 *   - sin nadie marcado no se puede asignar;
 *   - el buscador filtra la lista sin perder lo ya marcado.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { InternalUser, OrganizationGroup } from '@/modules/access/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let AssignUsersToGroupDialog: (typeof import('../assign-users-to-group-dialog'))['AssignUsersToGroupDialog'];

const h = React.createElement;

const calls: { groupId: string; userIds: string[] }[] = [];

// Especificador RELATIVO: con los hooks ESM de CI, `mock.module('@/…')` falla.
mock.module('../../../../../modules/access/actions', {
  namedExports: {
    assignUsersToGroup: async (groupId: string, userIds: string[]) => {
      calls.push({ groupId, userIds });
      return { success: true };
    },
  },
});

const GROUP: OrganizationGroup = {
  id: 'g-co',
  name: 'Colombia',
  description: null,
  parent_group_id: null,
  depth: 0,
  created_by: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function user(id: string, name: string, groupId: string | null = null): InternalUser {
  return {
    id,
    auth_user_id: `auth-${id}`,
    email: `${id}@ubits.co`,
    full_name: name,
    avatar_url: null,
    access_status: 'active',
    role_id: null,
    role_key: null,
    manager_id: null,
    group_id: groupId,
    requested_at: '2026-08-01T15:00:00Z',
    approved_at: '2026-08-02T15:00:00Z',
    rejected_at: null,
    suspended_at: null,
    archived_at: null,
    last_login_at: null,
  };
}

const NAMES = ['Ana Ruiz', 'Bea Soto', 'Cam Díaz', 'Dan Gil', 'Eva Mora', 'Fer Paz', 'Gil Ríos'];
const OUTSIDE = NAMES.map((name, index) => user(`u${index}`, name));
const INSIDE = user('u-in', 'Zoe Dentro', 'g-co');

function renderDialog(users: InternalUser[] = [...OUTSIDE, INSIDE]) {
  return render(
    h(AssignUsersToGroupDialog, {
      group: GROUP,
      allGroups: [GROUP],
      activeUsers: users,
      open: true,
      onClose: () => {},
    }),
  );
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ AssignUsersToGroupDialog } = await import('../assign-users-to-group-dialog'));
});

beforeEach(() => {
  calls.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('Agregar usuarios a un grupo', () => {
  it('no ofrece a quien ya está en el grupo', () => {
    renderDialog();

    assert.ok(screen.getByText('Ana Ruiz'));
    assert.equal(screen.queryByText('Zoe Dentro'), null);
  });

  it('sin nadie marcado no se puede asignar', () => {
    renderDialog();

    const assign = screen.getByRole('button', { name: 'Asignar' }) as HTMLButtonElement;
    assert.equal(assign.disabled, true);
  });

  it('🔴 manda exactamente las personas marcadas, al grupo abierto', async () => {
    renderDialog();
    // Una por la fila y otra por su casilla: las dos marcan.
    fireEvent.click(screen.getByText('Ana Ruiz'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar a Cam Díaz' }));

    fireEvent.click(screen.getByRole('button', { name: 'Asignar (2)' }));

    await waitFor(() => assert.equal(calls.length, 1));
    assert.equal(calls[0].groupId, 'g-co');
    assert.deepEqual([...calls[0].userIds].sort(), ['u0', 'u2']);
  });

  it('pulsar otra vez una persona marcada la desmarca', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Ana Ruiz'));
    fireEvent.click(screen.getByText('Ana Ruiz'));

    assert.ok(screen.getByRole('button', { name: 'Asignar' }));
  });

  it('el buscador filtra por nombre o correo y conserva lo marcado', () => {
    renderDialog();
    fireEvent.click(screen.getByText('Ana Ruiz'));

    fireEvent.change(screen.getByLabelText('Buscar usuario por nombre o correo'), {
      target: { value: 'bea' },
    });

    assert.ok(screen.getByText('Bea Soto'));
    assert.equal(screen.queryByText('Ana Ruiz'), null);
    assert.ok(screen.getByRole('button', { name: 'Asignar (1)' }));
  });

  it('si la búsqueda no encuentra a nadie, lo dice', () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText('Buscar usuario por nombre o correo'), {
      target: { value: 'zzz' },
    });

    assert.ok(screen.getByText('Nadie coincide con tu búsqueda'));
  });

  it('con pocas personas no hace falta buscador', () => {
    renderDialog(OUTSIDE.slice(0, 3));

    assert.equal(screen.queryByLabelText('Buscar usuario por nombre o correo'), null);
  });
});
