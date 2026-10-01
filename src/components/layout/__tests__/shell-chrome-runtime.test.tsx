/**
 * Cabecera y menú lateral del shell (Thema `app-shell`) — contrato RUNTIME:
 * las migas de la pantalla llegan a la cabecera, las notificaciones se abren
 * en un popover, el tema se cambia desde el menú de la marca y el menú lateral
 * despliega las vistas de cada sección respetando permisos.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

let currentPath = '/accounts';
let currentSearch = '';
const pushed: string[] = [];
const readIds: string[] = [];
let markAllCalls = 0;
let signOutCalls = 0;

const NOTIFICATIONS = [
  {
    id: 'n1',
    notification_type: 'user_pending_approval',
    title: 'Nueva solicitud de acceso',
    message: 'Ana pide entrar a SellUp.',
    action_label: 'Revisar',
    action_url: '/settings/users',
    entity_type: null,
    entity_id: null,
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'n2',
    notification_type: 'info',
    title: 'Búsqueda terminada',
    message: 'Tu lote de Perú está listo.',
    action_label: null,
    action_url: null,
    entity_type: null,
    entity_id: null,
    is_read: true,
    read_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  },
];

mock.module('next/navigation', {
  namedExports: {
    usePathname: () => currentPath,
    useSearchParams: () => new URLSearchParams(currentSearch),
    useRouter: () => ({
      push: (href: string) => pushed.push(href),
      replace: () => {},
      refresh: () => {},
      prefetch: () => {},
    }),
  },
});

// Especificadores RELATIVOS: con los hooks ESM de CI, `mock.module('@/…')`
// se resuelve respecto a este archivo.
mock.module('../../../modules/notifications/actions', {
  namedExports: {
    getMyNotifications: async (filter: string) =>
      filter === 'unread' ? NOTIFICATIONS.filter((n) => !n.is_read) : NOTIFICATIONS,
    markNotificationAsRead: async (id: string) => {
      readIds.push(id);
    },
    markAllMyNotificationsAsRead: async () => {
      markAllCalls += 1;
    },
  },
});

mock.module('../../../modules/accounts/actions', {
  namedExports: { getAccountsList: async () => [] },
});
mock.module('../../../modules/contacts/actions', {
  namedExports: { getAllContacts: async () => [] },
});

mock.module('../../../lib/supabase/client', {
  namedExports: {
    createClient: () => ({
      auth: {
        signOut: async () => {
          signOutCalls += 1;
        },
      },
    }),
  },
});

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let within: (typeof import('@testing-library/react'))['within'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let AppHeader: (typeof import('../app-header'))['AppHeader'];
let AppSidebar: (typeof import('../app-sidebar'))['AppSidebar'];
let PageHeader: (typeof import('../../shared/page-header'))['PageHeader'];
let Breadcrumbs: (typeof import('../../navigation/breadcrumbs'))['Breadcrumbs'];
let TooltipProvider: (typeof import('../../ui/tooltip'))['TooltipProvider'];
let ThemeProvider: (typeof import('../../theme/theme-provider'))['ThemeProvider'];

const h = React.createElement;

const ADMIN = { isAdmin: true, roleKey: 'admin' };
const MEMBER = { isAdmin: false, roleKey: 'vendedor' };
const USER = {
  id: 'u1',
  email: 'laura@ubits.co',
  user_metadata: { full_name: 'Laura Fernández' },
} as unknown as import('@supabase/supabase-js').User;

function shell(children?: React.ReactNode, navAccess = ADMIN): React.ReactElement {
  return h(
    TooltipProvider,
    null,
    h(AppHeader, { user: USER, initialUnreadCount: 3, navAccess }),
    h('main', null, children),
  );
}

function route(): HTMLElement {
  return document.querySelector('[data-slot="shell-route"]') as HTMLElement;
}

before(async () => {
  ({ render, screen, within, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ AppHeader } = await import('../app-header'));
  ({ AppSidebar } = await import('../app-sidebar'));
  ({ PageHeader } = await import('../../shared/page-header'));
  ({ Breadcrumbs } = await import('../../navigation/breadcrumbs'));
  ({ TooltipProvider } = await import('../../ui/tooltip'));
  ({ ThemeProvider } = await import('../../theme/theme-provider'));
  // next-themes consulta la preferencia del sistema.
  (window as unknown as Record<string, unknown>).matchMedia ??= () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
});

beforeEach(() => {
  currentPath = '/accounts';
  currentSearch = '';
  pushed.length = 0;
  readIds.length = 0;
  markAllCalls = 0;
  signOutCalls = 0;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark', 'light');
});

describe('Cabecera — la ruta y las migas publicadas', () => {
  it('sin migas publicadas pinta «SellUp › sección»', () => {
    render(shell());
    assert.equal(route().textContent, 'SellUpEmpresas');
    assert.equal(within(route()).getByText('Empresas').getAttribute('aria-current'), 'page');
  });

  it('las migas de la pantalla llegan a la cabecera y no se quedan sobre el título', () => {
    currentPath = '/accounts/42';
    render(
      shell(
        h(PageHeader, {
          title: 'Acme S.A.',
          breadcrumbs: h(Breadcrumbs, {
            items: [{ label: 'Empresas', href: '/accounts' }, 'Acme S.A.'],
          }),
        }),
      ),
    );

    const crumbs = within(route()).getByRole('navigation', { name: 'Breadcrumb' });
    assert.equal(within(crumbs).getByRole('link', { name: 'Empresas' }).getAttribute('href'), '/accounts');
    assert.equal(within(crumbs).getByText('Acme S.A.').getAttribute('aria-current'), 'page');
    // La sección no se repite: la pantalla ya empieza sus migas por ella.
    assert.equal(route().textContent, 'SellUpEmpresasAcme S.A.');
    // Y bajo la cabecera, en la página, no queda otro renglón de migas.
    assert.equal(screen.getByRole('main').querySelector('[data-slot="breadcrumbs"]'), null);
  });

  it('si las migas no empiezan por la sección, la cabecera la antepone como enlace', () => {
    currentPath = '/settings/integrations/hubspot';
    render(
      shell(
        h(PageHeader, {
          title: 'HubSpot',
          breadcrumbs: h(Breadcrumbs, {
            items: [{ label: 'Integraciones comerciales', href: '/settings/integrations' }, 'HubSpot'],
          }),
        }),
      ),
    );

    assert.equal(route().textContent, 'SellUpConfiguraciónIntegraciones comercialesHubSpot');
    const section = within(route()).getByRole('link', { name: 'Configuración' });
    assert.equal(section.getAttribute('href'), '/settings');
    assert.equal(section.getAttribute('aria-current'), null);
  });

  it('al salir la pantalla, la cabecera vuelve a su ruta fija', () => {
    const view = render(
      shell(h(PageHeader, { title: 'Acme', breadcrumbs: h(Breadcrumbs, { items: ['Empresas', 'Acme'] }) })),
    );
    assert.equal(route().textContent, 'SellUpEmpresasAcme');
    view.rerender(shell());
    assert.equal(route().textContent, 'SellUpEmpresas');
  });

  it('fuera del shell, PageHeader conserva sus migas sobre el título', () => {
    render(h(PageHeader, { title: 'Acme', breadcrumbs: h(Breadcrumbs, { items: ['Empresas', 'Acme'] }) }));
    assert.ok(screen.getByRole('navigation', { name: 'Breadcrumb' }));
  });

  it('el tema ya no es un botón suelto de la cabecera', () => {
    render(shell());
    assert.equal(screen.queryByRole('button', { name: 'Cambiar tema' }), null);
  });
});

describe('Cabecera — notificaciones en popover', () => {
  async function openBell(): Promise<HTMLElement> {
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones: 3 sin leer' }));
    await waitFor(() => assert.ok(screen.getByText('Nueva solicitud de acceso')));
    return screen.getByRole('dialog', { name: 'Notificaciones' });
  }

  it('abre un popover (no un drawer) con la lista y «N nuevas»', async () => {
    render(shell());
    const panel = await openBell();
    assert.equal(document.querySelector('[data-slot="sheet-content"]'), null);
    assert.equal(
      panel.querySelector('[data-slot="notification-unread-count"]')?.textContent,
      '1 nueva',
    );
    assert.equal(within(panel).queryByText('Búsqueda terminada'), null);
  });

  it('«Ver todas» trae también las leídas', async () => {
    render(shell());
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole('button', { name: 'Ver todas las notificaciones' }));
    await waitFor(() => assert.ok(within(panel).getByText('Búsqueda terminada')));
    assert.ok(within(panel).getByRole('button', { name: 'Ver solo las nuevas' }));
  });

  it('pulsar un aviso lo marca leído, navega y cierra', async () => {
    render(shell());
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole('button', { name: /Nueva solicitud de acceso/ }));
    await waitFor(() => assert.deepEqual(pushed, ['/settings/users']));
    assert.deepEqual(readIds, ['n1']);
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Notificaciones' }), null));
  });

  it('«Marcar leídas» las marca todas y quita el recuento', async () => {
    render(shell());
    const panel = await openBell();
    fireEvent.click(within(panel).getByRole('button', { name: 'Marcar leídas' }));
    await waitFor(() => assert.equal(markAllCalls, 1));
    await waitFor(() =>
      assert.equal(panel.querySelector('[data-slot="notification-unread-count"]'), null),
    );
    assert.ok(screen.getByRole('button', { name: 'Notificaciones' }));
  });
});

describe('Cabecera — cuenta', () => {
  it('el chip dice quién eres y como quién miras; el menú solo ofrece salir', async () => {
    render(shell());
    const chip = screen.getByRole('button', { name: /Cuenta de Laura Fernández/ });
    assert.match(chip.textContent ?? '', /Administrador/);
    fireEvent.click(chip);
    const menu = await screen.findByRole('menu');
    assert.ok(within(menu).getByText('laura@ubits.co'));
    assert.deepEqual(
      within(menu).getAllByRole('menuitem').map((item) => item.textContent),
      ['Cerrar sesión'],
    );
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Cerrar sesión' }));
    await waitFor(() => assert.equal(signOutCalls, 1));
    await waitFor(() => assert.deepEqual(pushed, ['/login']));
  });
});

function sidebar(navAccess = ADMIN): React.ReactElement {
  return h(
    ThemeProvider,
    { attribute: 'class', defaultTheme: 'light', enableSystem: true },
    h(TooltipProvider, null, h(AppSidebar, { navAccess })),
  );
}

describe('Menú lateral — secciones plegables', () => {
  it('la sección en la que estás llega abierta y marca la vista actual', () => {
    currentSearch = 'tab=prospectos&view=descartadas';
    render(sidebar());
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    const group = within(nav).getByRole('group', { name: 'Empresas' });
    assert.deepEqual(
      within(group).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')]),
      [
        ['Empresas', '/accounts?tab=empresas'],
        ['Por revisar', '/accounts?tab=prospectos'],
        ['Descartadas', '/accounts?tab=prospectos&view=descartadas'],
      ],
    );
    assert.equal(within(group).getByRole('link', { name: 'Descartadas' }).getAttribute('aria-current'), 'page');
    assert.equal(within(group).getByRole('link', { name: 'Por revisar' }).getAttribute('aria-current'), null);
  });

  it('sin parámetro en la URL, la vista actual es la primera del módulo', () => {
    render(sidebar());
    const group = screen.getByRole('group', { name: 'Empresas' });
    assert.equal(within(group).getByRole('link', { name: 'Empresas' }).getAttribute('aria-current'), 'page');
  });

  it('una sección se despliega y se pliega desde su cabecera', () => {
    render(sidebar());
    const head = screen.getByRole('button', { name: 'Contactos' });
    assert.equal(head.getAttribute('aria-expanded'), 'false');
    assert.equal(screen.queryByRole('group', { name: 'Contactos' }), null);

    fireEvent.click(head);
    assert.equal(head.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(
      within(screen.getByRole('group', { name: 'Contactos' }))
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
      ['/contacts?tab=approved', '/contacts?tab=candidates'],
    );

    fireEvent.click(head);
    assert.equal(screen.queryByRole('group', { name: 'Contactos' }), null);
  });

  it('Configuración despliega sus ocho secciones a un administrador', () => {
    currentPath = '/settings/budget-credits';
    render(sidebar());
    const group = screen.getByRole('group', { name: 'Configuración' });
    const links = within(group).getAllByRole('link');
    assert.equal(links.length, 8);
    // Una ruta sin entrada propia marca la sección a la que pertenece.
    assert.equal(
      within(group).getByRole('link', { name: 'Proveedores y consumo' }).getAttribute('aria-current'),
      'page',
    );
  });

  it('quien no administra no ve Configuración ni Uso de IA', () => {
    render(sidebar(MEMBER));
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    assert.equal(within(nav).queryByRole('button', { name: 'Configuración' }), null);
    assert.equal(within(nav).queryByRole('link', { name: 'Uso de IA y costos' }), null);
    assert.ok(within(nav).getByRole('link', { name: 'Pipeline SellUp' }));
  });
});

describe('Menú lateral — contraído', () => {
  beforeEach(() => {
    window.localStorage.setItem('sellup-sidebar-collapsed', 'true');
  });

  it('cada sección con vistas muestra su submenú desde el icono', async () => {
    const { SidebarProvider } = await import('../sidebar-context');
    render(h(SidebarProvider, null, sidebar()));
    const rail = screen.getByRole('navigation', { name: 'Navegación compacta' });
    const trigger = within(rail).getByRole('button', { name: 'Empresas' });
    assert.equal(trigger.getAttribute('aria-current'), 'page');

    fireEvent.click(trigger);
    const menu = await screen.findByRole('menu');
    assert.deepEqual(
      within(menu).getAllByRole('menuitem').map((item) => [item.textContent, item.getAttribute('href')]),
      [
        ['Empresas', '/accounts?tab=empresas'],
        ['Por revisar', '/accounts?tab=prospectos'],
        ['Descartadas', '/accounts?tab=prospectos&view=descartadas'],
      ],
    );
    assert.equal(within(menu).getByRole('menuitem', { name: 'Empresas' }).getAttribute('aria-current'), 'page');
  });

  it('una sección sin vistas navega directo desde su icono', async () => {
    const { SidebarProvider } = await import('../sidebar-context');
    render(h(SidebarProvider, null, sidebar()));
    const rail = screen.getByRole('navigation', { name: 'Navegación compacta' });
    assert.equal(within(rail).getByRole('link', { name: 'Pipeline SellUp' }).getAttribute('href'), '/pipeline');
  });
});

describe('Menú de la marca (WorkspaceMenu)', () => {
  async function openWorkspaceMenu(navAccess = ADMIN): Promise<HTMLElement> {
    render(sidebar(navAccess));
    fireEvent.click(screen.getByRole('button', { name: 'SellUp: tema y configuración' }));
    return screen.findByRole('menu');
  }

  it('cambia el tema desde ahí', async () => {
    const menu = await openWorkspaceMenu();
    const options = within(menu).getAllByRole('menuitemradio');
    assert.deepEqual(options.map((o) => o.textContent), ['Claro', 'Oscuro', 'Como el sistema']);
    assert.equal(within(menu).getByRole('menuitemradio', { name: 'Claro' }).getAttribute('aria-checked'), 'true');
    assert.equal(document.documentElement.classList.contains('dark'), false);

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Oscuro' }));
    await waitFor(() => assert.equal(document.documentElement.classList.contains('dark'), true));
    // El menú sigue abierto y marca la nueva elección.
    assert.equal(within(menu).getByRole('menuitemradio', { name: 'Oscuro' }).getAttribute('aria-checked'), 'true');
  });

  it('agrupa la configuración y ofrece la puerta a toda ella', async () => {
    const menu = await openWorkspaceMenu();
    assert.deepEqual(
      within(menu).getAllByRole('menuitem').map((item) => item.textContent),
      ['Equipo', 'Datos e IA', 'Conexiones', 'Toda la configuración'],
    );
    assert.equal(
      within(menu).getByRole('menuitem', { name: 'Toda la configuración' }).getAttribute('href'),
      '/settings',
    );
  });

  it('a quien no administra solo le ofrece lo que puede abrir', async () => {
    const menu = await openWorkspaceMenu(MEMBER);
    assert.deepEqual(
      within(menu).getAllByRole('menuitem').map((item) => item.textContent),
      ['Equipo', 'Conexiones'],
    );
  });
});
