/**
 * Permission-aware sidebar navigation — unit tests for the pure visibility
 * helpers (`canAccessNavItem`, `getVisibleNavItems`).
 *
 * Verifies that admins keep every module while non-admin roles (seller_bd,
 * commercial_manager, commercial_lead) lose the admin-only modules (Uso de IA,
 * Configuración) and keep the operativa ones (Empresas, Contactos, Pipeline).
 *
 * Pure logic only — no DOM, no React render, no Supabase, no data mutation.
 * Uses the Node.js built-in test runner.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mainNavItems,
  canAccessNavItem,
  getVisibleNavItems,
  type NavAccessContext,
  type NavItem,
} from '@/config/navigation';

const adminCtx: NavAccessContext = { isAdmin: true, roleKey: 'admin' };
const sellerCtx: NavAccessContext = { isAdmin: false, roleKey: 'seller_bd' };
const managerCtx: NavAccessContext = { isAdmin: false, roleKey: 'commercial_manager' };
const leadCtx: NavAccessContext = { isAdmin: false, roleKey: 'commercial_lead' };

const hrefs = (items: readonly NavItem[]): string[] => items.map((i) => i.href);

describe('navigation visibility — canAccessNavItem', () => {
  it('treats an item with no explicit access as public (visible to everyone)', () => {
    const publicItem: NavItem = { title: 'X', href: '/x', icon: mainNavItems[0].icon };
    assert.equal(canAccessNavItem(publicItem, sellerCtx), true);
    assert.equal(canAccessNavItem(publicItem, adminCtx), true);
  });

  it('shows adminOnly items to admins only', () => {
    const adminItem: NavItem = {
      title: 'X',
      href: '/x',
      icon: mainNavItems[0].icon,
      access: 'adminOnly',
    };
    assert.equal(canAccessNavItem(adminItem, adminCtx), true);
    assert.equal(canAccessNavItem(adminItem, sellerCtx), false);
    assert.equal(canAccessNavItem(adminItem, managerCtx), false);
    assert.equal(canAccessNavItem(adminItem, leadCtx), false);
  });
});

describe('navigation visibility — getVisibleNavItems', () => {
  it('admin sees every module', () => {
    assert.deepEqual(hrefs(getVisibleNavItems(mainNavItems, adminCtx)), hrefs(mainNavItems));
  });

  it('seller_bd does NOT see Uso de IA nor Configuración', () => {
    const visible = hrefs(getVisibleNavItems(mainNavItems, sellerCtx));
    assert.ok(!visible.includes('/ai-usage'), 'Uso de IA must be hidden for seller_bd');
    assert.ok(!visible.includes('/settings'), 'Configuración must be hidden for seller_bd');
  });

  it('seller_bd keeps operativa modules (Empresas, Contactos, Pipeline)', () => {
    const visible = hrefs(getVisibleNavItems(mainNavItems, sellerCtx));
    assert.ok(visible.includes('/accounts'), 'Empresas must stay visible');
    assert.ok(visible.includes('/contacts'), 'Contactos must stay visible');
    assert.ok(visible.includes('/pipeline'), 'Pipeline must stay visible');
  });

  it('commercial_manager and commercial_lead match seller_bd today (admin-only Uso de IA while ENABLE_COMMERCIAL_SCOPE is off)', () => {
    const managerVisible = hrefs(getVisibleNavItems(mainNavItems, managerCtx));
    const leadVisible = hrefs(getVisibleNavItems(mainNavItems, leadCtx));
    for (const visible of [managerVisible, leadVisible]) {
      assert.ok(!visible.includes('/ai-usage'));
      assert.ok(!visible.includes('/settings'));
      assert.ok(visible.includes('/accounts'));
      assert.ok(visible.includes('/contacts'));
    }
  });

  it('does not mutate the source list', () => {
    const before = hrefs(mainNavItems);
    getVisibleNavItems(mainNavItems, sellerCtx);
    assert.deepEqual(hrefs(mainNavItems), before);
  });
});
