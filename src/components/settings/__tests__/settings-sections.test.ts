/**
 * Secciones de Configuración — quién ve qué y a qué sección pertenece una ruta.
 * De esta lista salen el resumen y la navegación lateral: si aquí se cuela una
 * sección que quien mira no puede abrir, se le pinta un enlace que redirige.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_SECTIONS,
  getVisibleSettingsSections,
  resolveSettingsSectionId,
} from '../settings-sections';

describe('getVisibleSettingsSections — permisos', () => {
  it('un administrador ve las ocho secciones', () => {
    const sections = getVisibleSettingsSections({ isAdmin: true, isActive: true });

    assert.equal(sections.length, 8);
    assert.deepEqual(sections, [...SETTINGS_SECTIONS]);
  });

  it('🔴 quien no es administrador solo ve las secciones personales', () => {
    const ids = getVisibleSettingsSections({ isAdmin: false, isActive: true }).map((s) => s.id);

    assert.deepEqual(ids, ['activity', 'my-drive']);
  });

  it('🔴 sin acceso activo no se lista ninguna sección', () => {
    assert.deepEqual(getVisibleSettingsSections({ isAdmin: false, isActive: false }), []);
  });

  it('las secciones administrativas son las que redirigen a quien no es admin', () => {
    const adminOnly = SETTINGS_SECTIONS.filter((s) => s.access === 'admin').map((s) => s.id);

    assert.deepEqual(adminOnly, [
      'users',
      'providers',
      'automations',
      'integrations',
      'prospecting',
      'source-catalog',
    ]);
  });
});

describe('resolveSettingsSectionId — en qué sección está una ruta', () => {
  it('la ruta de la sección y sus subrutas son de esa sección', () => {
    assert.equal(resolveSettingsSectionId('/settings/users'), 'users');
    assert.equal(resolveSettingsSectionId('/settings/integrations/hubspot'), 'integrations');
    assert.equal(resolveSettingsSectionId('/settings/source-catalog/socrata-batches/abc'), 'source-catalog');
  });

  it('las vistas antiguas de presupuesto y uso pertenecen a Proveedores y consumo', () => {
    assert.equal(resolveSettingsSectionId('/settings/budget-credits'), 'providers');
    assert.equal(resolveSettingsSectionId('/settings/budget-credits/rules'), 'providers');
    assert.equal(resolveSettingsSectionId('/settings/usage'), 'providers');
  });

  it('el resumen y una ruta sin sección no marcan ninguna', () => {
    assert.equal(resolveSettingsSectionId('/settings'), null);
    assert.equal(resolveSettingsSectionId('/settings/system-status'), null);
  });

  it('un prefijo parecido no cuenta como la sección', () => {
    assert.equal(resolveSettingsSectionId('/settings/users-archive'), null);
  });
});
