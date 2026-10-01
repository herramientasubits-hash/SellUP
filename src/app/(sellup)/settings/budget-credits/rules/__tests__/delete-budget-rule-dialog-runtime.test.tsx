/**
 * Borrar una regla de presupuesto — contrato RUNTIME de la confirmación.
 *
 * Lo que se protege: el borrado se dispara SOLO al confirmar. Ni abrir la
 * pregunta ni cancelarla borran nada, y un fallo se muestra sin cerrar.
 *
 * La segunda parte lee el código de la pantalla: comprueba que el único camino
 * hacia `deleteBudgetRule` pasa por esa confirmación.
 */

import '../../../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let DeleteBudgetRuleDialog: (typeof import('../delete-budget-rule-dialog'))['DeleteBudgetRuleDialog'];

const h = React.createElement;

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ DeleteBudgetRuleDialog } = await import('../delete-budget-rule-dialog'));
});

afterEach(() => {
  cleanup();
});

const RULE = {
  id: 'rule-1',
  providerDisplayName: 'Apollo',
  scopeLabel: 'Global',
} as BudgetRuleRow;

interface HarnessProps {
  log: string[];
  /** Lo que devuelve el borrado simulado. */
  outcome?: { success: boolean; error?: string };
}

/** La misma coreografía que la pantalla: abrir pregunta, borrar al confirmar, cerrar si sale bien. */
function Harness({ log, outcome = { success: true } }: HarnessProps) {
  const [pending, setPending] = React.useState<BudgetRuleRow | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  return h(
    React.Fragment,
    null,
    h('button', { type: 'button', onClick: () => setPending(RULE) }, 'Abrir pregunta'),
    h(DeleteBudgetRuleDialog, {
      rule: pending,
      deleting: false,
      error,
      onConfirm: (rule: BudgetRuleRow) => {
        log.push(`delete:${rule.id}`);
        if (!outcome.success) {
          setError(outcome.error ?? 'falló');
          return;
        }
        setPending(null);
      },
      onCancel: () => {
        log.push('cancel');
        setPending(null);
      },
    }),
  );
}

describe('DeleteBudgetRuleDialog — el borrado solo sale al confirmar', () => {
  it('cerrado no pinta nada', () => {
    render(h(Harness, { log: [] }));
    assert.equal(screen.queryByText('¿Eliminar esta regla?'), null);
  });

  it('abrir la pregunta no borra', () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pregunta' }));

    assert.ok(screen.getByText('¿Eliminar esta regla?'));
    assert.ok(screen.getByText('Apollo'), 'dice de qué proveedor es la regla');
    assert.deepEqual(log, []);
  });

  it('cancelar no borra y cierra', async () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pregunta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => assert.equal(screen.queryByText('¿Eliminar esta regla?'), null));
    assert.deepEqual(log, ['cancel']);
  });

  it('confirmar borra esa regla, una sola vez', async () => {
    const log: string[] = [];
    render(h(Harness, { log }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pregunta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));

    assert.deepEqual(log, ['delete:rule-1']);
    await waitFor(() => assert.equal(screen.queryByText('¿Eliminar esta regla?'), null));
  });

  it('si el borrado falla, se dice por qué y la pregunta sigue abierta', () => {
    const log: string[] = [];
    render(h(Harness, { log, outcome: { success: false, error: 'No autorizado' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pregunta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar regla' }));

    assert.ok(screen.getByText('No autorizado'));
    assert.ok(screen.getByText('¿Eliminar esta regla?'));
  });

  it('mientras borra, no se puede confirmar otra vez ni cancelar', () => {
    render(
      h(DeleteBudgetRuleDialog, {
        rule: RULE,
        deleting: true,
        error: null,
        onConfirm: () => assert.fail('no debe confirmar dos veces'),
        onCancel: () => undefined,
      }),
    );
    const confirm = screen.getByRole('button', { name: /Eliminar regla/ }) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: 'Cancelar' }) as HTMLButtonElement;
    assert.equal(confirm.disabled, true);
    assert.equal(cancel.disabled, true);
  });
});

describe('Pantalla de reglas — el único camino al borrado es la confirmación', () => {
  const dir = join(import.meta.dirname, '..');
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const client = stripComments(readFileSync(join(dir, 'budget-rules-client.tsx'), 'utf8'));
  const table = stripComments(readFileSync(join(dir, 'budget-rules-table.tsx'), 'utf8'));

  it('la pantalla llama a deleteBudgetRule en un solo sitio: handleArchive', () => {
    const calls = client.match(/deleteBudgetRule\(/g) ?? [];
    assert.equal(calls.length, 1);
    const handler = client.slice(client.indexOf('async function handleArchive('));
    assert.match(handler.slice(0, handler.indexOf('\n  }\n')), /await deleteBudgetRule\(rule\.id\)/);
  });

  it('handleArchive solo se entrega a la confirmación, nunca a la tabla', () => {
    const uses = client.match(/handleArchive\b(?!\()/g) ?? [];
    assert.equal(uses.length, 1, 'handleArchive se referencia una vez fuera de su definición');
    assert.match(client, /<DeleteBudgetRuleDialog[\s\S]*?onConfirm=\{handleArchive\}/);
    assert.match(client, /onArchive=\{\(rule\) => \{ setArchiveError\(null\); setConfirmArchive\(rule\); \}\}/);
  });

  it('la tabla no importa ni llama acciones de servidor', () => {
    assert.doesNotMatch(table, /rule-actions/);
    assert.doesNotMatch(table, /deleteBudgetRule/);
  });
});
