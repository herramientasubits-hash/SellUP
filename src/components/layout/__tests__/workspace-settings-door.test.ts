/**
 * El guardián de la puerta de Configuración.
 *
 * Configuración ya no es un módulo del menú lateral: el menú de la marca es su
 * ÚNICA entrada. Así que cada sección de `SETTINGS_SECTIONS` tiene que salir
 * en algún grupo de ese menú para quien puede verla — también una sección
 * nueva que nadie se acordó de agrupar («Más ajustes»).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSidebarNav, buildWorkspaceSettingsGroups, resolveActiveSidebarNode } from '../sidebar-nav';
import { SETTINGS_SECTIONS, getVisibleSettingsSections } from '../../settings/settings-sections';

const ADMIN = { isAdmin: true, roleKey: 'admin' };
const MEMBER = { isAdmin: false, roleKey: 'seller_bd' };

const itemsOf = (navAccess: typeof ADMIN) =>
  buildWorkspaceSettingsGroups(navAccess).flatMap((group) => group.items);

describe('Menú de la marca — cada sección de Configuración tiene puerta', () => {
  it('a un administrador le ofrece TODAS las secciones, cada una una sola vez', () => {
    const ids = itemsOf(ADMIN).map((item) => item.id);

    assert.deepEqual([...ids].sort(), SETTINGS_SECTIONS.map((section) => section.id).sort());
    assert.equal(new Set(ids).size, ids.length, 'ninguna sección repetida en dos grupos');
  });

  it('cada puerta lleva a la ruta de su sección', () => {
    for (const item of itemsOf(ADMIN)) {
      const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === item.id);
      assert.equal(item.href, section?.href);
      assert.equal(item.label, section?.title);
    }
  });

  it('hoy los grupos son Equipo, Datos e IA y Conexiones; ninguno vacío', () => {
    const groups = buildWorkspaceSettingsGroups(ADMIN);
    assert.deepEqual(groups.map((group) => group.label), ['Equipo', 'Datos e IA', 'Conexiones']);
    assert.ok(groups.every((group) => group.items.length > 0));
  });

  it('🔴 quien no administra solo recibe las secciones que puede abrir', () => {
    const visible = getVisibleSettingsSections({ isAdmin: false, isActive: true }).map((section) => section.id);

    assert.deepEqual(itemsOf(MEMBER).map((item) => item.id).sort(), [...visible].sort());
    assert.deepEqual(buildWorkspaceSettingsGroups(MEMBER).map((group) => group.label), ['Equipo', 'Conexiones']);
  });

  it('el Catálogo de fuentes no está entre los ajustes: es un módulo', () => {
    assert.equal(itemsOf(ADMIN).some((item) => item.href.includes('source-catalog')), false);
  });
});

describe('Menú lateral — Configuración no es un módulo', () => {
  it('no lista Configuración ni sus secciones, para nadie', () => {
    for (const navAccess of [ADMIN, MEMBER]) {
      const nav = buildSidebarNav(navAccess);
      const hrefs = nav.flatMap((root) => [root.href, ...(root.children ?? []).map((child) => child.href)]);
      assert.equal(hrefs.some((href) => href.startsWith('/settings')), false);
    }
  });

  it('dentro de /settings/** ningún ítem queda marcado', () => {
    const nav = buildSidebarNav(ADMIN);
    for (const pathname of ['/settings', '/settings/users', '/settings/integrations/hubspot']) {
      assert.deepEqual(resolveActiveSidebarNode(nav, pathname, new URLSearchParams()), {
        rootId: null,
        childId: null,
      });
    }
  });

  it('el Catálogo de fuentes es un módulo de quien administra, marcado en sus subrutas', () => {
    const nav = buildSidebarNav(ADMIN);
    assert.ok(nav.some((root) => root.href === '/source-catalog' && root.label === 'Catálogo de fuentes'));
    assert.equal(
      resolveActiveSidebarNode(nav, '/source-catalog/co_siis', new URLSearchParams()).rootId,
      '/source-catalog',
    );
    assert.equal(buildSidebarNav(MEMBER).some((root) => root.href === '/source-catalog'), false);
  });

  it('las vistas de Empresas y Contactos siguen en el menú: es su única navegación', () => {
    const nav = buildSidebarNav(MEMBER);
    assert.deepEqual(
      nav.find((root) => root.href === '/accounts')?.children?.map((child) => child.label),
      ['Empresas', 'Por revisar', 'Descartadas'],
    );
    assert.deepEqual(
      nav.find((root) => root.href === '/contacts')?.children?.map((child) => child.label),
      ['Contactos', 'Por revisar', 'Contactos rechazados'],
    );
  });
});
