/**
 * Lista de usuarios (DataTable) — contrato RUNTIME de permisos y acciones.
 *
 * Lo que se protege:
 *   - 🔴 solo un administrador puede marcar filas y ver acciones (por fila o en lote);
 *   - 🔴 las acciones en lote dependen de la vista: no se «reactiva» a quien está activo;
 *   - la acción en lote pide confirmación y manda EXACTAMENTE los usuarios marcados.
 *
 * Sin red ni base de datos: las acciones de servidor están sustituidas por espías.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { InternalUser, OrganizationGroup, Role } from '@/modules/access/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let SelectableUsersList: (typeof import('../selectable-users-list'))['SelectableUsersList'];
type Mode = import('../selectable-users-list').SelectableListMode;

const h = React.createElement;

// ── Espías de las acciones de servidor ────────────────────────────────────────
// El especificador es RELATIVO: con los hooks ESM de CI, `mock.module('@/…')`
// se resuelve respecto a este fichero y falla antes de correr ninguna prueba.
const calls: { name: string; args: unknown[] }[] = [];
const ok = (name: string) => async (...args: unknown[]) => {
  calls.push({ name, args });
  return { success: true };
};

mock.module('../../../../../modules/access/actions', {
  namedExports: {
    bulkSuspend: ok('bulkSuspend'),
    bulkReactivate: ok('bulkReactivate'),
    bulkArchive: ok('bulkArchive'),
    bulkReject: ok('bulkReject'),
    bulkAssignGroup: ok('bulkAssignGroup'),
    approveUser: ok('approveUser'),
    rejectUser: ok('rejectUser'),
    suspendUser: ok('suspendUser'),
    reactivateUser: ok('reactivateUser'),
    changeUserRole: ok('changeUserRole'),
    changeUserManager: ok('changeUserManager'),
    changeUserGroup: ok('changeUserGroup'),
    archiveUser: ok('archiveUser'),
    activateFromRejected: ok('activateFromRejected'),
  },
});

const ROLES: Role[] = [
  { id: 'r-admin', key: 'admin', name: 'Administrador', description: '' },
  { id: 'r-sales', key: 'sales', name: 'Comercial', description: '' },
];

const GROUPS: OrganizationGroup[] = [
  {
    id: 'g-co',
    name: 'Colombia',
    description: null,
    parent_group_id: null,
    depth: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

function user(overrides: Partial<InternalUser> & Pick<InternalUser, 'id' | 'email'>): InternalUser {
  return {
    auth_user_id: `auth-${overrides.id}`,
    full_name: null,
    avatar_url: null,
    access_status: 'active',
    role_id: 'r-sales',
    role_key: 'sales',
    manager_id: null,
    group_id: null,
    requested_at: '2026-08-01T15:00:00Z',
    approved_at: '2026-08-02T15:00:00Z',
    rejected_at: null,
    suspended_at: null,
    archived_at: null,
    last_login_at: null,
    ...overrides,
  };
}

const ANA = user({ id: 'u-ana', email: 'ana@ubits.co', full_name: 'Ana Ruiz', group_id: 'g-co', role_key: 'admin' });
const BEA = user({ id: 'u-bea', email: 'bea@ubits.co', full_name: 'Bea Soto', manager_id: 'u-ana' });
const CAM = user({ id: 'u-cam', email: 'cam@ubits.co', full_name: 'Cam Díaz' });
const USERS = [ANA, BEA, CAM];

function renderList(options: { mode?: Mode; isAdmin?: boolean; users?: InternalUser[] } = {}) {
  const { mode = 'active', isAdmin = true, users = USERS } = options;
  return render(
    h(SelectableUsersList, {
      users,
      roles: ROLES,
      allUsers: USERS,
      activeUsers: USERS,
      groups: GROUPS,
      mode,
      isAdmin,
      title: 'Activos',
    }),
  );
}

function selectRow(name: string): void {
  fireEvent.click(screen.getByRole('checkbox', { name: `Seleccionar ${name}` }));
}

/** Los botones de la barra de selección (vive en un portal bajo `document.body`). */
function bulkBar(): HTMLElement {
  // El arrastre de columnas también anuncia por `role="status"`: la barra es
  // la que dice cuántos hay seleccionados.
  const bar = screen.getAllByRole('status').find((node) => /seleccionad[oa]s?/.test(node.textContent ?? ''));
  assert.ok(bar, 'la barra de selección debe estar a la vista');
  return bar;
}

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ SelectableUsersList } = await import('../selectable-users-list'));
});

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('Usuarios — la lista', () => {
  it('pinta a cada persona con nombre, correo, rol, grupo, jefe y estado', () => {
    renderList();

    const row = screen.getByText('Bea Soto').closest('tr');
    assert.ok(row);
    assert.ok(within(row).getByText('bea@ubits.co'));
    assert.ok(within(row).getByText('Comercial'));
    assert.ok(within(row).getByText('Sin grupo'));
    assert.ok(within(row).getByText('Ana Ruiz'));
    assert.ok(within(row).getByText('Activo'));
    assert.ok(within(row).getByText('Aprobado'));
  });

  it('las columnas se llaman en español', () => {
    renderList();

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');
    for (const label of ['Persona', 'Rol', 'Grupo', 'Jefe directo', 'Estado', 'Fecha']) {
      assert.ok(headers.some((text) => text.includes(label)), `falta la columna ${label}`);
    }
  });

  it('sin usuarios explica qué hacer en esa vista', () => {
    renderList({ mode: 'pending', users: [] });

    assert.ok(screen.getByText('No hay solicitudes por revisar'));
  });
});

describe('Usuarios — permisos', () => {
  it('🔴 quien no es administrador no puede marcar filas ni ve acciones', () => {
    renderList({ isAdmin: false });

    assert.equal(screen.queryAllByRole('checkbox').length, 0);
    assert.equal(screen.queryByLabelText('Acciones del usuario'), null);
    // La lista sí se lee.
    assert.ok(screen.getAllByText('Ana Ruiz').length > 0);
  });

  it('un administrador tiene casilla y menú de acciones en cada fila', () => {
    renderList();

    for (const person of ['Ana Ruiz', 'Bea Soto', 'Cam Díaz']) {
      assert.ok(screen.getByRole('checkbox', { name: `Seleccionar ${person}` }));
    }
    assert.equal(screen.getAllByLabelText('Acciones del usuario').length, USERS.length);
  });
});

describe('Usuarios — acciones en lote según la vista', () => {
  const EXPECTED: Record<Mode, string[]> = {
    all: ['Asignar grupo', 'Suspender'],
    active: ['Asignar grupo', 'Suspender'],
    suspended: ['Reactivar', 'Archivar'],
    rejected: ['Suspender', 'Archivar'],
    pending: ['Rechazar'],
  };

  for (const mode of Object.keys(EXPECTED) as Mode[]) {
    it(`🔴 vista «${mode}»: ${EXPECTED[mode].join(' + ')}`, () => {
      renderList({ mode });
      selectRow('Ana Ruiz');

      const labels = within(bulkBar())
        .getAllByRole('button')
        .map((button) => button.textContent?.trim() ?? '')
        .filter((label) => label.length > 0);

      for (const expected of EXPECTED[mode]) {
        assert.ok(labels.includes(expected), `falta «${expected}» en ${JSON.stringify(labels)}`);
      }
      const all = ['Asignar grupo', 'Suspender', 'Reactivar', 'Archivar', 'Rechazar'];
      for (const other of all.filter((label) => !EXPECTED[mode].includes(label))) {
        assert.ok(!labels.includes(other), `«${other}» no debe ofrecerse en la vista ${mode}`);
      }
    });
  }
});

describe('Usuarios — confirmar una acción en lote', () => {
  it('pide confirmación y no actúa hasta confirmarla', () => {
    renderList();
    selectRow('Ana Ruiz');
    selectRow('Cam Díaz');

    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Suspender' }));

    assert.ok(screen.getByText('Suspender 2 usuarios'));
    assert.equal(calls.length, 0);
  });

  it('🔴 al confirmar, manda exactamente los usuarios marcados', async () => {
    renderList();
    selectRow('Ana Ruiz');
    selectRow('Cam Díaz');
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Suspender' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspender' }));

    await waitFor(() => assert.equal(calls.length, 1));
    assert.equal(calls[0].name, 'bulkSuspend');
    assert.deepEqual([...(calls[0].args[0] as string[])].sort(), ['u-ana', 'u-cam']);
  });

  it('cancelar cierra la confirmación sin actuar', () => {
    renderList();
    selectRow('Bea Soto');
    fireEvent.click(within(bulkBar()).getByRole('button', { name: 'Suspender' }));

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));

    assert.equal(screen.queryByText('Suspender 1 usuario'), null);
    assert.equal(calls.length, 0);
  });
});
