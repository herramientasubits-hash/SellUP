/**
 * Primitivos de ui (Button, Badge, EmptyState, Input) — contrato RUNTIME de las variantes de Thema.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);
function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}
copyWindowPropsToGlobal();

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let Button: (typeof import('../button'))['Button'];
let Badge: (typeof import('../badge'))['Badge'];
let EmptyState: (typeof import('../empty-state'))['EmptyState'];
let Input: (typeof import('../input'))['Input'];
let Inbox: (typeof import('@/icons'))['Inbox'];
let Search: (typeof import('@/icons'))['Search'];

const h = React.createElement;

function hasAll(element: Element, classes: readonly string[]): string[] {
  return classes.filter((name) => !element.classList.contains(name));
}

before(async () => {
  ({ render, screen, fireEvent, cleanup } = await import('@testing-library/react'));
  ({ Button } = await import('../button'));
  ({ Badge } = await import('../badge'));
  ({ EmptyState } = await import('../empty-state'));
  ({ Search } = await import('@/icons'));
  ({ Input } = await import('../input'));
  ({ Inbox } = await import('@/icons'));
});

afterEach(() => {
  cleanup();
});

describe('Button', () => {
  it('sin props declara data-variant y data-size por defecto', () => {
    render(h(Button, null, 'Guardar'));

    const button = screen.getByRole('button', { name: 'Guardar' });
    assert.equal(button.getAttribute('data-slot'), 'button');
    assert.equal(button.getAttribute('data-variant'), 'default');
    assert.equal(button.getAttribute('data-size'), 'default');
    // Alto de botón de flux-ui: 36px.
    assert.deepEqual(hasAll(button, ['bg-primary', 'h-9']), []);
  });

  const VARIANTS = [
    ['destructive-solid', ['bg-destructive', 'text-destructive-foreground']],
    ['success', ['bg-success', 'text-primary-foreground']],
    ['warning', ['bg-warning', 'text-primary-foreground']],
  ] as const;
  for (const [variant, classes] of VARIANTS) {
    it(`variant="${variant}" se refleja en data-variant y pinta su sólido`, () => {
      render(h(Button, { variant }, 'Confirmar'));

      const button = screen.getByRole('button');
      assert.equal(button.getAttribute('data-variant'), variant);
      assert.deepEqual(hasAll(button, classes), []);
    });
  }

  it('el destructivo normal es un tinte, no el rojo sólido', () => {
    render(h(Button, { variant: 'destructive' }, 'Eliminar'));

    const button = screen.getByRole('button');
    assert.ok(button.classList.contains('bg-destructive/10'));
    assert.equal(button.classList.contains('bg-destructive'), false);
  });

  const SIZES = [
    ['xs', ['h-6', 'px-2', 'text-xs']],
    ['icon-xs', ['size-6']],
  ] as const;
  for (const [size, classes] of SIZES) {
    it(`size="${size}" se refleja en data-size y en su alto`, () => {
      render(h(Button, { size, 'aria-label': 'Acción' }));

      const button = screen.getByRole('button');
      assert.equal(button.getAttribute('data-size'), size);
      assert.deepEqual(hasAll(button, classes), []);
      assert.equal(button.classList.contains('h-9'), false);
    });
  }

  it('llama onClick y disabled lo impide', () => {
    let clicks = 0;
    const { rerender } = render(h(Button, { onClick: () => clicks++ }, 'Guardar'));
    fireEvent.click(screen.getByRole('button'));
    assert.equal(clicks, 1);

    rerender(h(Button, { onClick: () => clicks++, disabled: true }, 'Guardar'));
    fireEvent.click(screen.getByRole('button'));

    assert.equal(clicks, 1);
  });

  it('asChild viste al hijo con la variante en vez de anidar un botón', () => {
    render(h(Button, { asChild: true, variant: 'success', size: 'xs' }, h('a', { href: '/x' }, 'Ir')));

    const link = screen.getByRole('link', { name: 'Ir' });
    assert.equal(screen.queryByRole('button'), null);
    assert.equal(link.getAttribute('data-variant'), 'success');
    assert.equal(link.getAttribute('data-size'), 'xs');
  });

  it('pasa la ref al <button>', () => {
    const ref = React.createRef<HTMLButtonElement>();

    render(h(Button, { ref }, 'Guardar'));

    assert.equal(ref.current, screen.getByRole('button'));
  });
});

describe('Badge', () => {
  const VARIANTS = [
    // Los «-light» de la Badge de flux-ui: tinte al 10 % y texto oscuro del mismo color.
    ['positive', ['bg-success/10', 'text-success-foreground']],
    ['warning', ['bg-warning/10', 'text-warning-foreground']],
    ['negative', ['bg-destructive/10', 'text-destructive']],
    ['info', ['bg-info/10', 'text-info-foreground']],
    ['neutral', ['bg-secondary', 'text-secondary-foreground']],
    ['brand', ['bg-primary/10', 'text-primary']],
  ] as const;
  for (const [variant, classes] of VARIANTS) {
    it(`variant="${variant}" pinta su tinte semántico`, () => {
      render(h(Badge, { variant }, 'Estado'));

      const badge = screen.getByText('Estado');
      assert.equal(badge.tagName, 'SPAN');
      assert.deepEqual(hasAll(badge, classes), []);
    });
  }

  it('sin variante es el sólido primario', () => {
    render(h(Badge, null, 'Nuevo'));

    assert.deepEqual(hasAll(screen.getByText('Nuevo'), ['bg-primary', 'text-primary-foreground']), []);
  });

  it('conserva el className de quien lo usa', () => {
    render(h(Badge, { variant: 'info', className: 'tabular-nums' }, '12'));

    assert.deepEqual(hasAll(screen.getByText('12'), ['tabular-nums', 'text-info-foreground']), []);
  });
});

describe('EmptyState', () => {
  it('pinta el título como h3 y la descripción', () => {
    render(h(EmptyState, { title: 'No hay prospectos', description: 'Genera un lote para empezar.' }));

    assert.ok(screen.getByRole('heading', { level: 3, name: 'No hay prospectos' }));
    assert.ok(screen.getByText('Genera un lote para empezar.'));
  });

  it('como el Empty de UBITS: sin marco, con 48px de aire', () => {
    const { container } = render(h(EmptyState, { title: 'Vacío' }));

    const root = container.firstElementChild as HTMLElement;
    assert.equal(root.dataset.slot, 'empty');
    assert.equal(root.classList.contains('border-dashed'), false);
    assert.ok(root.classList.contains('p-12'));
  });

  it('variant="plain" va más compacto, dentro de su superficie', () => {
    const { container } = render(h(EmptyState, { title: 'Vacío', variant: 'plain' }));

    const root = container.firstElementChild as HTMLElement;
    assert.deepEqual(hasAll(root, ['px-6', 'py-8']), []);
  });

  it('el ícono de la pantalla se vuelve su ilustración de vidrio', () => {
    const { container } = render(h(EmptyState, { title: 'Vacío', icon: Search }));

    assert.ok(container.querySelector('img[src="/iconos-glass/glass-search@1x.png"]'));
  });

  it('pinta la acción que recibe', () => {
    let clicks = 0;
    render(
      h(EmptyState, {
        title: 'Vacío',
        action: h('button', { type: 'button', onClick: () => clicks++ }, 'Generar con IA'),
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Generar con IA' }));

    assert.equal(clicks, 1);
  });

  it('pinta el icono solo cuando lo recibe', () => {
    const { container, rerender } = render(h(EmptyState, { title: 'Vacío' }));
    assert.equal(container.querySelector('svg, img'), null);

    // Inbox tiene su ilustración de vidrio: sale la imagen, no el trazo.
    rerender(h(EmptyState, { title: 'Vacío', icon: Inbox }));

    assert.ok(container.querySelector('img[src="/iconos-glass/glass-folder@1x.png"]'));
  });
});

describe('Input', () => {
  it('por defecto declara data-size="default" y mide 40px', () => {
    render(h(Input, { 'aria-label': 'Buscar' }));

    const input = screen.getByRole('textbox', { name: 'Buscar' });
    assert.equal(input.getAttribute('data-size'), 'default');
    assert.ok(input.classList.contains('h-10'));
  });

  it('inputSize="sm" se refleja en data-size="sm" y mide 32px', () => {
    render(h(Input, { 'aria-label': 'Buscar', inputSize: 'sm' }));

    const input = screen.getByRole('textbox');
    assert.equal(input.getAttribute('data-size'), 'sm');
    assert.ok(input.classList.contains('h-8'));
    assert.equal(input.classList.contains('h-10'), false);
  });

  it('inputSize no se filtra al DOM como atributo', () => {
    render(h(Input, { 'aria-label': 'Buscar', inputSize: 'sm' }));

    assert.equal(screen.getByRole('textbox').hasAttribute('inputsize'), false);
  });

  it('el className de quien lo usa gana al padding del tamaño', () => {
    render(h(Input, { 'aria-label': 'Buscar', className: 'pl-8' }));

    assert.ok(screen.getByRole('textbox').classList.contains('pl-8'));
  });

  it('avisa del cambio de valor', () => {
    const values: string[] = [];
    render(
      h(Input, {
        'aria-label': 'Buscar',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => values.push(event.target.value),
      }),
    );

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'acme' } });

    assert.deepEqual(values, ['acme']);
  });
});
