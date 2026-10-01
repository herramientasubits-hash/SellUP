/**
 * «Catálogo de fuentes» como módulo: su ruta propia, quién lo ve y a dónde van
 * los enlaces antiguos de `/settings/source-catalog/**`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SOURCE_CATALOG_BATCHES_ROUTE,
  SOURCE_CATALOG_ROUTE,
  getVisibleNavItems,
  legacySourceCatalogRedirect,
  mainNavItems,
} from '../navigation';

const APP = join(process.cwd(), 'src', 'app', '(sellup)');

describe('Catálogo de fuentes — módulo del menú', () => {
  it('tiene ítem propio, con icono, antes de Configuración', () => {
    const titles = mainNavItems.map((item) => item.title);
    assert.ok(titles.indexOf('Catálogo de fuentes') >= 0);
    assert.ok(titles.indexOf('Catálogo de fuentes') < titles.indexOf('Configuración'));
    const item = mainNavItems.find((candidate) => candidate.href === SOURCE_CATALOG_ROUTE);
    assert.ok(item?.icon);
  });

  it('🔴 lo ve quien ya lo veía en Configuración: solo quien administra', () => {
    const admin = getVisibleNavItems(mainNavItems, { isAdmin: true, roleKey: 'admin' }).map((item) => item.href);
    const seller = getVisibleNavItems(mainNavItems, { isAdmin: false, roleKey: 'seller_bd' }).map((item) => item.href);
    assert.ok(admin.includes('/source-catalog'));
    assert.equal(seller.includes('/source-catalog'), false);
  });
});

describe('Rutas antiguas /settings/source-catalog/** — redirigen al módulo', () => {
  it('la lista, el detalle de una fuente y los lotes', () => {
    assert.equal(legacySourceCatalogRedirect(undefined), '/source-catalog');
    assert.equal(legacySourceCatalogRedirect([]), '/source-catalog');
    assert.equal(legacySourceCatalogRedirect(['pe_migo_api']), '/source-catalog/pe_migo_api');
    assert.equal(legacySourceCatalogRedirect(['socrata-batches']), SOURCE_CATALOG_BATCHES_ROUTE);
    assert.equal(
      legacySourceCatalogRedirect(['socrata-batches', 'abc-123']),
      '/source-catalog/socrata-batches/abc-123',
    );
  });

  it('conserva los parámetros y escapa los tramos', () => {
    assert.equal(
      legacySourceCatalogRedirect(['co siis'], { tab: 'historial', id: ['1', '2'], vacio: undefined }),
      '/source-catalog/co%20siis?tab=historial&id=1&id=2',
    );
  });

  it('las páginas del módulo viven en /source-catalog y la ruta vieja es solo la redirección', () => {
    for (const page of ['page.tsx', '[sourceKey]/page.tsx', 'socrata-batches/page.tsx', 'socrata-batches/[batchId]/page.tsx']) {
      assert.ok(existsSync(join(APP, 'source-catalog', page)), `falta source-catalog/${page}`);
      assert.equal(existsSync(join(APP, 'settings', 'source-catalog', page)), false);
    }
    const legacy = readFileSync(join(APP, 'settings', 'source-catalog', '[[...path]]', 'page.tsx'), 'utf8');
    assert.match(legacy, /redirect\(legacySourceCatalogRedirect\(path, query\)\)/);
  });

  it('ningún enlace del módulo apunta ya a la ruta vieja', () => {
    for (const file of [
      'source-detail-drawer.tsx',
      '[sourceKey]/page.tsx',
      'socrata-batches/page.tsx',
      'socrata-batches/[batchId]/page.tsx',
      'socrata-batches/socrata-batches-table.tsx',
      'socrata-batches/create-socrata-batch-button.tsx',
    ]) {
      const source = readFileSync(join(APP, 'source-catalog', file), 'utf8');
      assert.equal(source.includes('/settings/source-catalog'), false, file);
    }
  });

  it('las pantallas del módulo no usan el marco de Configuración', () => {
    for (const file of ['page.tsx', 'source-catalog-client.tsx', 'socrata-batches/page.tsx', '[sourceKey]/page.tsx']) {
      const source = readFileSync(join(APP, 'source-catalog', file), 'utf8');
      assert.equal(/SettingsPage|settingsBreadcrumbs|SettingsNav/.test(source), false, file);
    }
  });
});
