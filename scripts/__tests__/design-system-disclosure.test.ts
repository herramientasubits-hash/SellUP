/**
 * Regla `desplegable-de-golpe` (check-design-system): lo que se abre o se
 * despliega tiene que animar, como en flux-ui. Casos fijos para cada detector:
 * dispara con el patrón que aparece de golpe y calla con Collapsible.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findDisclosureIssues } from '../design-system-disclosure.mjs';

const rules = (text: string) => findDisclosureIssues(text).map((issue) => issue.rule);

describe('desplegable-de-golpe', () => {
  it('marca el contenido que se monta junto a su aria-expanded', () => {
    const text = [
      '<button aria-expanded={open} onClick={toggle}>Ver</button>',
      '{open && (',
      '  <div>contenido</div>',
      ')}',
    ].join('\n');
    assert.deepEqual(findDisclosureIssues(text).map(({ line, rule }) => [line, rule]), [[2, 'desplegable-de-golpe']]);
  });

  it('también con la negación y con hidden={…}', () => {
    const text = [
      '<Button aria-expanded={!isCollapsed} />',
      '{!isCollapsed && <Footer />}',
      '<ul hidden={isCollapsed} />',
    ].join('\n');
    assert.deepEqual(rules(text), ['desplegable-de-golpe', 'desplegable-de-golpe']);
  });

  it('no marca un && que no es el del disparador', () => {
    const text = ['<button aria-expanded={open} />', '{loading && <Spinner />}'].join('\n');
    assert.deepEqual(rules(text), []);
  });

  it('calla con Collapsible: Base UI pone aria-expanded y el panel anima', () => {
    const text = [
      '<Collapsible open={open} onOpenChange={setOpen}>',
      '  <CollapsibleTrigger>Ver</CollapsibleTrigger>',
      '  <CollapsibleContent><div>contenido</div></CollapsibleContent>',
      '</Collapsible>',
    ].join('\n');
    assert.deepEqual(rules(text), []);
  });
});

describe('flecha-que-salta', () => {
  it('marca el ternario que cambia de flecha', () => {
    assert.deepEqual(rules('{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}'), [
      'flecha-que-salta',
    ]);
    assert.deepEqual(rules('{expanded ? <ChevronDown /> : <ChevronRight />}'), ['flecha-que-salta']);
  });

  it('marca la flecha que se esconde con group-aria-expanded', () => {
    assert.deepEqual(rules('<ChevronDown className="group-aria-expanded/trigger:hidden" />'), ['flecha-que-salta']);
  });

  it('calla con una sola flecha que gira', () => {
    assert.deepEqual(rules('<ChevronDown className={cn("transition-transform duration-200", open && "rotate-180")} />'), []);
  });
});

describe('details-a-mano', () => {
  it('marca un <details> en JSX', () => {
    assert.deepEqual(rules('<details className="group"><summary>Ver</summary></details>'), ['details-a-mano']);
  });

  it('no lo cuenta dentro de un comentario', () => {
    assert.deepEqual(rules(' * Sustituye al `<details>` a mano.'), []);
    assert.deepEqual(rules('{/* antes era un <details> */}'), []);
  });
});
