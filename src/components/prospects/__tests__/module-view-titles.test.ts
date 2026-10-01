/**
 * Los módulos «Empresas» y «Contactos» ya no llevan pestañas de página: el
 * título dice la vista en la que estás (los mismos rótulos del menú lateral) y
 * las migas, el módulo. Las rutas no cambian.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { EMPRESAS_TAB_DESCRIPTIONS, EMPRESAS_VIEW_TITLES, empresasViewCrumbs } from '../empresas-module-copy';
import {
  CONTACTOS_TAB_DESCRIPTIONS,
  CONTACTOS_VIEW_TITLES,
  contactosViewCrumbs,
} from '../../contacts/contacts-module-copy';
import { buildSidebarNav } from '../../layout/sidebar-nav';

const NAV = buildSidebarNav({ isAdmin: false, roleKey: 'seller_bd' });
const viewLabels = (href: string) => NAV.find((root) => root.href === href)?.children?.map((child) => child.label);

describe('Empresas — el título dice la vista', () => {
  it('los títulos son los rótulos del menú lateral', () => {
    assert.deepEqual(EMPRESAS_VIEW_TITLES, {
      empresas: 'Empresas',
      prospectos: 'Por revisar',
      descartadas: 'Descartadas',
    });
    assert.deepEqual(viewLabels('/accounts'), Object.values(EMPRESAS_VIEW_TITLES));
  });

  it('las migas: «Empresas › Por revisar»; la vista raíz no lleva', () => {
    assert.equal(empresasViewCrumbs('empresas'), null);
    assert.deepEqual(empresasViewCrumbs('prospectos'), [{ label: 'Empresas', href: '/accounts' }, 'Por revisar']);
    assert.deepEqual(empresasViewCrumbs('descartadas'), [{ label: 'Empresas', href: '/accounts' }, 'Descartadas']);
  });

  it('cada vista conserva su descripción', () => {
    assert.deepEqual(Object.keys(EMPRESAS_TAB_DESCRIPTIONS), Object.keys(EMPRESAS_VIEW_TITLES));
  });
});

describe('Contactos — el título dice la vista', () => {
  it('«Contactos» y «Por revisar» como en el menú; los duplicados, aparte', () => {
    assert.deepEqual(CONTACTOS_VIEW_TITLES, {
      approved: 'Contactos',
      candidates: 'Por revisar',
      duplicates: 'Duplicados',
    });
    assert.deepEqual(viewLabels('/contacts'), ['Contactos', 'Por revisar']);
  });

  it('las migas: «Contactos › Por revisar» y «Contactos › Duplicados»', () => {
    assert.equal(contactosViewCrumbs('approved'), null);
    assert.deepEqual(contactosViewCrumbs('candidates'), [{ label: 'Contactos', href: '/contacts' }, 'Por revisar']);
    assert.deepEqual(contactosViewCrumbs('duplicates'), [{ label: 'Contactos', href: '/contacts' }, 'Duplicados']);
  });

  it('cada vista conserva su descripción', () => {
    assert.deepEqual(Object.keys(CONTACTOS_TAB_DESCRIPTIONS), Object.keys(CONTACTOS_VIEW_TITLES));
  });
});

describe('Las pestañas de módulo ya no existen', () => {
  it('sus componentes se borraron', () => {
    const navigation = join(process.cwd(), 'src', 'components', 'navigation');
    assert.equal(existsSync(join(navigation, 'module-tabs-nav.tsx')), false);
    assert.equal(existsSync(join(navigation, 'contacts-module-tabs-nav.tsx')), false);
  });
});
