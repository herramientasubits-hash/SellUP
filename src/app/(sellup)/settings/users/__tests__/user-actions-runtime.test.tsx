/**
 * Acciones por usuario (menú de la fila) — contrato RUNTIME.
 *
 * Lo que se protege:
 *   - 🔴 cada estado ofrece SOLO sus acciones (no se «reactiva» a quien está activo);
 *   - 🔴 confirmar dispara la acción de servidor correcta sobre ESA persona;
 *   - nada se ejecuta hasta confirmar;
 *   - si la acción falla, el diálogo sigue abierto y dice por qué.
 *
 * Sin red ni base de datos: las acciones de servidor están sustituidas por espías.
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AccessStatus, InternalUser, Role } from '@/modules/access/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let UserActions: (typeof import('../user-actions'))['UserActions'];

const h = React.createElement;

const calls: { name: string; args: unknown[] }[] = [];
let nextResult: { success: boolean; error?: string } = { success: true };
const spy = (name: string) => async (...args: unknown[]) => {
  calls.push({ name, args });
  return nextResult;
};

// Especificador RELATIVO: con los hooks ESM de CI, `mock.module('@/…')` falla.
mock.module('../../../../../modules/access/actions', {
  namedExports: {
    approveUser: spy('approveUser'),
    rejectUser: spy('rejectUser'),
    suspendUser: spy('suspendUser'),
    reactivateUser: spy('reactivateUser'),
    changeUserRole: spy('changeUserRole'),
    changeUserManager: spy('changeUserManager'),
    changeUserGroup: spy('changeUserGroup'),
    archiveUser: spy('archiveUser'),
    activateFromRejected: spy('activateFromRejected'),
  },
});

const ROLES: Role[] = [{ id: 'r-sales', key: 'sales', name: 'Comercial', description: '' }];

function user(status: AccessStatus): InternalUser {
  return {
    id: 'u-bea',
    auth_user_id: 'auth-u-bea',
    email: 'bea@ubits.co',
    full_name: 'Bea Soto',
    avatar_url: null,
    access_status: status,
    role_id: 'r-sales',
    role_key: 'sales',
    manager_id: null,
    group_id: null,
    requested_at: '2026-08-01T15:00:00Z',
    approved_at: null,
    rejected_at: null,
    suspended_at: null,
    archived_at: null,
    last_login_at: null,
  };
}

function openMenu(status: AccessStatus): string[] {
  render(h(UserActions, { user: user(status), roles: ROLES, activeUsers: [], groups: [] }));
  fireEvent.click(screen.getByRole('button', { name: 'Acciones de Bea Soto' }));
  return screen.getAllByRole('menuitem').map((item) => item.textContent?.trim() ?? '');
}

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ UserActions } = await import('../user-actions'));
});

beforeEach(() => {
  calls.length = 0;
  nextResult = { success: true };
});

afterEach(() => {
  cleanup();
});

describe('Acciones por usuario — qué se ofrece en cada estado', () => {
  const EXPECTED: Partial<Record<AccessStatus, string[]>> = {
    pending_approval: ['Aprobar y asignar rol', 'Rechazar solicitud'],
    active: ['Cambiar rol', 'Cambiar jefe directo', 'Asignar grupo', 'Suspender acceso'],
    suspended: ['Reactivar acceso', 'Archivar usuario'],
    rejected: ['Activar y asignar rol', 'Suspender acceso', 'Archivar usuario'],
  };

  for (const status of Object.keys(EXPECTED) as AccessStatus[]) {
    it(`🔴 «${status}»: ${EXPECTED[status]!.join(' · ')}`, () => {
      assert.deepEqual(openMenu(status), EXPECTED[status]);
    });
  }

  it('🔴 un usuario archivado no tiene menú de acciones', () => {
    render(h(UserActions, { user: user('archived'), roles: ROLES, activeUsers: [], groups: [] }));

    assert.equal(screen.queryByRole('button', { name: /^Acciones de / }), null);
  });
});

describe('Acciones por usuario — confirmar', () => {
  it('abrir la confirmación no ejecuta nada', () => {
    openMenu('active');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Suspender acceso' }));

    assert.ok(screen.getByRole('alertdialog'));
    assert.equal(calls.length, 0);
  });

  it('🔴 confirmar «Suspender» suspende a esa persona y a nadie más', async () => {
    openMenu('active');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Suspender acceso' }));

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Suspender' }));

    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { name: 'suspendUser', args: ['u-bea'] });
  });

  it('🔴 confirmar «Reactivar» reactiva a esa persona', async () => {
    openMenu('suspended');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reactivar acceso' }));

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reactivar' }));

    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0], { name: 'reactivateUser', args: ['u-bea'] });
  });

  it('si la acción falla, el diálogo sigue abierto y dice por qué', async () => {
    nextResult = { success: false, error: 'No tienes permiso para archivar.' };
    openMenu('suspended');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archivar usuario' }));

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Archivar' }));

    await waitFor(() => assert.ok(screen.getByText('No tienes permiso para archivar.')));
    assert.ok(screen.getByRole('alertdialog'), 'el diálogo no se cierra');
    assert.equal(calls[0].name, 'archiveUser');
  });
});
