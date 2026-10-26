/**
 * ThemaTabs + ui/tabs (Thema `navigation/ThemaTabs`, `ui/tabs`) — contrato
 * RUNTIME: una sola pieza de pestañas con dos niveles (`view` / `page`),
 * contador con tono, y una tira que navega idéntica a una que cambia de panel.
 */

import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let ThemaTabs: (typeof import('../thema-tabs'))['ThemaTabs'];
let TabsNav: (typeof import('../tabs-nav'))['TabsNav'];
let Tabs: (typeof import('../../ui/tabs'))['Tabs'];
let TabsList: (typeof import('../../ui/tabs'))['TabsList'];
let TabsTrigger: (typeof import('../../ui/tabs'))['TabsTrigger'];
let TabsContent: (typeof import('../../ui/tabs'))['TabsContent'];

const h = React.createElement;

const TABS = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'pendientes', label: 'Pendientes', badge: 4, badgeTone: 'warning' as const },
  { id: 'listos', label: 'Listos', badge: 0 },
];

const list = () => document.querySelector('[data-slot="tabs-list"]') as HTMLElement;
const badges = () =>
  Array.from(document.querySelectorAll('[data-slot="tabs-badge"]'), (node) => [
    node.textContent,
    node.getAttribute('data-tone'),
  ]);

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ ThemaTabs } = await import('../thema-tabs'));
  ({ TabsNav } = await import('../tabs-nav'));
  ({ Tabs, TabsList, TabsTrigger, TabsContent } = await import('../../ui/tabs'));
});

afterEach(() => {
  cleanup();
});

describe('ui/tabs — variantes de Thema', () => {
  function strip(variant?: 'view' | 'page' | 'default' | 'segmented'): React.ReactElement {
    return h(
      Tabs,
      { defaultValue: 'a' },
      h(TabsList, { variant }, h(TabsTrigger, { value: 'a' }, 'A'), h(TabsTrigger, { value: 'b' }, 'B')),
      h(TabsContent, { value: 'a' }, 'Panel A'),
      h(TabsContent, { value: 'b' }, 'Panel B'),
    );
  }

  it('sin variante es `view`: pista con la activa elevada', () => {
    render(strip());
    assert.equal(list().getAttribute('data-variant'), 'default');
    assert.match(list().className, /bg-tab-track/);
  });

  it('`page` y su nombre anterior `segmented` pintan lo mismo', () => {
    render(strip('page'));
    const page = list().className;
    assert.equal(list().getAttribute('data-variant'), 'segmented');
    cleanup();
    render(strip('segmented'));
    assert.equal(list().className, page);
  });

  it('`view` y su nombre anterior `default` pintan lo mismo', () => {
    render(strip('view'));
    const view = list().className;
    cleanup();
    render(strip('default'));
    assert.equal(list().className, view);
  });
});

describe('ThemaTabs — cambia de panel', () => {
  function Panels({ calls }: { calls: string[] }) {
    const [active, setActive] = React.useState('resumen');
    return h(
      ThemaTabs,
      {
        tabs: TABS,
        activeTabId: active,
        listLabel: 'Secciones',
        onTabChange: (id: string) => {
          calls.push(id);
          setActive(id);
        },
      },
      h(TabsContent, { value: 'resumen' }, 'Contenido del resumen'),
      h(TabsContent, { value: 'pendientes' }, 'Contenido pendiente'),
    );
  }

  it('es un tablist con nombre; pulsar una pestaña cambia el panel', () => {
    const calls: string[] = [];
    render(h(Panels, { calls }));
    assert.ok(screen.getByRole('tablist', { name: 'Secciones' }));
    assert.equal(screen.getByRole('tab', { name: 'Resumen' }).getAttribute('aria-selected'), 'true');
    assert.ok(screen.getByText('Contenido del resumen'));

    fireEvent.click(screen.getByRole('tab', { name: /Pendientes/ }));
    assert.deepEqual(calls, ['pendientes']);
    assert.ok(screen.getByText('Contenido pendiente'));
  });

  it('el contador lleva su tono y no se pinta en cero', () => {
    render(h(Panels, { calls: [] }));
    assert.deepEqual(badges(), [['4', 'warning']]);
    assert.match(
      (document.querySelector('[data-slot="tabs-badge"]') as HTMLElement).className,
      /bg-warning\/15 text-warning/,
    );
  });

  it('sin tono, el contador va sólido en el primario', () => {
    render(
      h(ThemaTabs, { tabs: [{ id: 'a', label: 'A', badge: 120 }], activeTabId: 'a', onTabChange: () => {} }),
    );
    assert.deepEqual(badges(), [['99+', 'primary']]);
  });

  it('reparte el ancho salvo que se pida ajustarla a sus rótulos', () => {
    render(h(ThemaTabs, { tabs: TABS, activeTabId: 'resumen', onTabChange: () => {} }));
    assert.match(list().className, /grid w-full/);
    assert.equal(list().style.gridTemplateColumns, 'repeat(3, minmax(0, 1fr))');
    cleanup();
    render(h(ThemaTabs, { tabs: TABS, activeTabId: 'resumen', onTabChange: () => {}, fitContent: true }));
    assert.match(list().className, /w-fit/);
    assert.equal(list().style.gridTemplateColumns, '');
  });
});

describe('ThemaTabs — navega (misma anatomía, otra semántica)', () => {
  it('son botones con aria-current, no un tablist', () => {
    const calls: string[] = [];
    render(
      h(ThemaTabs, {
        navigation: true,
        variant: 'page',
        fitContent: true,
        role: 'navigation',
        'aria-label': 'Vistas',
        tabs: TABS,
        activeTabId: 'pendientes',
        onTabChange: (id: string) => calls.push(id),
      }),
    );
    assert.equal(screen.queryByRole('tablist'), null);
    assert.equal(screen.queryByRole('tab'), null);
    const nav = screen.getByRole('navigation', { name: 'Vistas' });
    const current = Array.from(nav.querySelectorAll('button')).filter(
      (button) => button.getAttribute('aria-current') === 'page',
    );
    assert.deepEqual(current.map((button) => button.textContent), ['Pendientes4']);
    fireEvent.click(screen.getByRole('button', { name: 'Listos' }));
    assert.deepEqual(calls, ['listos']);
  });

  it('pinta con las mismas clases y atributos que una tira de paneles', () => {
    render(h(ThemaTabs, { variant: 'page', fitContent: true, tabs: TABS, activeTabId: 'resumen', onTabChange: () => {} }));
    const panelList = list().className;
    const panelTrigger = (document.querySelector('[data-slot="tabs-trigger"]') as HTMLElement).className;
    cleanup();

    render(h(TabsNav, { tabs: TABS, activeTabId: 'resumen', onTabChange: () => {} }));
    assert.equal(list().className, panelList);
    assert.equal(list().getAttribute('data-variant'), 'segmented');
    const trigger = document.querySelector('[data-slot="tabs-trigger"]') as HTMLElement;
    assert.equal(trigger.className, panelTrigger);
    assert.equal(trigger.hasAttribute('data-active'), true);
  });
});

describe('cambio suave entre pestañas', () => {
  it('la tira de paneles tiene UN indicador que se desliza, no una marca por pestaña', () => {
    render(h(ThemaTabs, { fitContent: true, tabs: TABS, activeTabId: 'resumen', onTabChange: () => {} }));
    const indicadores = list().querySelectorAll('[data-slot="tabs-indicator"]');
    assert.equal(indicadores.length, 1);
    assert.match((indicadores[0] as HTMLElement).className, /transition-\[left,top,width,height\]/);
    assert.match((indicadores[0] as HTMLElement).className, /motion-reduce:transition-none/);
    // La pestaña activa ya no pinta su propio fondo: lo pone el indicador.
    const activa = document.querySelector('[data-slot="tabs-trigger"][data-active]') as HTMLElement;
    assert.match(activa.className, /data-active:bg-transparent/);
  });

  it('el panel entra con el fundido de pestaña', () => {
    render(
      h(
        Tabs,
        { defaultValue: 'a' },
        h(TabsList, null, h(TabsTrigger, { value: 'a' }, 'A'), h(TabsTrigger, { value: 'b' }, 'B')),
        h(TabsContent, { value: 'a' }, 'Panel A'),
        h(TabsContent, { value: 'b' }, 'Panel B'),
      ),
    );
    assert.match(screen.getByText('Panel A').className, /animate-su-tab-in/);
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    assert.match(screen.getByText('Panel B').className, /animate-su-tab-in/);
  });

  it('la tira que navega mueve la marca al pulsar, sin esperar a la nueva ruta', () => {
    render(h(TabsNav, { tabs: TABS, activeTabId: 'resumen', onTabChange: () => {} }));
    assert.equal(list().querySelectorAll('[data-slot="tabs-indicator"]').length, 1);
    fireEvent.click(screen.getByRole('button', { name: 'Listos' }));
    const actual = Array.from(list().querySelectorAll('button'))
      .filter((b) => b.hasAttribute('data-active'))
      .map((b) => b.textContent);
    assert.deepEqual(actual, ['Listos']);
  });
});
