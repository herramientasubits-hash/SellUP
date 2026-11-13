/** El menú del avatar ofrece «Ver como otro rol…» sólo a quien está autorizado. */
import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh() {}, push() {} }) } });
mock.module('../../../modules/access/role-preview-actions', {
  namedExports: {
    getRolePreviewOptions: async () => [],
    startRolePreview: async () => ({ ok: true }),
    stopRolePreview: async () => ({ ok: true }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let menu: typeof import('../account-menu');

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  menu = await import('../account-menu');
});
afterEach(() => cleanup());

const user = { name: 'Elkin Garcia', email: 'egarcia@ubits.co' };
const open = () => fireEvent.click(screen.getByRole('button', { name: /Cuenta de Elkin Garcia/ }));

describe('AccountMenu — «Ver como…»', () => {
  it('sin permiso: no aparece', async () => {
    render(<menu.AccountMenu user={user} roleLabel="Administrador" rolePreview={{ allowed: false, active: null }} />);
    open();
    assert.equal(screen.queryByText('Ver como otro rol…'), null);
  });

  it('autorizado: aparece; mirando como otra persona, también «Volver a Administrador» y la píldora lo dice', async () => {
    render(
      <menu.AccountMenu
        user={user}
        roleLabel="Líder comercial"
        rolePreview={{ allowed: true, active: { roleKey: 'commercial_lead', asName: 'Carla Pía' } }}
      />,
    );
    open();
    assert.ok(await screen.findByText('Ver como otro rol…'));
    assert.ok(screen.getByText('Volver a Administrador'));
    assert.ok(screen.getByText('Líder comercial · como Carla Pía'));
  });
});
