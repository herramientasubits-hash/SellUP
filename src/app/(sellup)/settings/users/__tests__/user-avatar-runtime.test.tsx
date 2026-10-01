/**
 * UserAvatar — contrato RUNTIME: una sola regla de iniciales para toda la
 * pantalla «Usuarios y acceso».
 */

import '../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let UserAvatar: (typeof import('../user-avatar'))['UserAvatar'];
let getUserInitials: (typeof import('../user-avatar'))['getUserInitials'];

const h = React.createElement;

before(async () => {
  ({ render, cleanup } = await import('@testing-library/react'));
  ({ UserAvatar, getUserInitials } = await import('../user-avatar'));
});

afterEach(() => {
  cleanup();
});

describe('getUserInitials', () => {
  it('toma la primera letra de las dos primeras palabras del nombre', () => {
    assert.equal(getUserInitials('Ana María Ruiz', 'ana@ubits.co'), 'AM');
  });

  it('con una sola palabra devuelve una sola inicial', () => {
    assert.equal(getUserInitials('ana', 'ana@ubits.co'), 'A');
  });

  it('ignora espacios de más alrededor y entre palabras', () => {
    assert.equal(getUserInitials('  bea   soto ', 'x@ubits.co'), 'BS');
  });

  it('sin nombre usa las dos primeras letras del correo', () => {
    assert.equal(getUserInitials(null, 'cam@ubits.co'), 'CA');
    assert.equal(getUserInitials('   ', 'cam@ubits.co'), 'CA');
    assert.equal(getUserInitials(undefined, 'cam@ubits.co'), 'CA');
  });
});

describe('UserAvatar', () => {
  it('pinta las iniciales dentro del Avatar del sistema', () => {
    // Arrange + Act
    const { container } = render(h(UserAvatar, { name: 'Ana Ruiz', email: 'ana@ubits.co' }));

    // Assert
    const avatar = container.querySelector('[data-slot="avatar"]');
    assert.ok(avatar, 'usa la pieza Avatar');
    assert.equal(avatar.querySelector('[data-slot="avatar-fallback"]')?.textContent, 'AR');
  });
});
