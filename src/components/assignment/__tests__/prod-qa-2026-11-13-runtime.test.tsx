/**
 * Hallazgos de las pruebas por rol en Prod (13-11):
 *  1. Rumbo en pausa: el panel sólo con «Cerrar» parecía vacío.
 *  2. «Ver como…»: «· tú» marcaba a la persona previsualizada, no a quien asigna.
 *  3. Tras asignar, la fila seguía con el responsable viejo hasta recargar.
 */
import '../../settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('next/navigation', { namedExports: { useRouter: () => ({ refresh() {}, push() {} }) } });

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let drawer: typeof import('../assign-owner-drawer');
let assignedNow: typeof import('../../prospects/assigned-now');
let panels: typeof import('../../prospect-batches/chat-wizard/wizard-execution-panels');

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  drawer = await import('../assign-owner-drawer');
  assignedNow = await import('../../prospects/assigned-now');
  panels = await import('../../prospect-batches/chat-wizard/wizard-execution-panels');
});
afterEach(() => cleanup());

const root = path.resolve(__dirname, '../../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const elkin = { id: 'u-elkin', full_name: 'Elkin Garcia', email: 'egarcia@ubits.co', is_self: true };
const hadde = { id: 'u-hadde', full_name: 'Hadde Ramírez', email: 'haramirez@ubits.co', is_self: false };

describe('1 · Rumbo en pausa', () => {
  it('dice que sigue en segundo plano, cuántas ya están y dónde seguirla', () => {
    assert.equal(panels.WIZARD_PAUSED_HEADING, 'La búsqueda sigue en segundo plano');
    assert.match(panels.describeWizardPausedRun(9), /^Ya hay 9 empresas en «Por revisar»\. .*Centro de procesos/);
    assert.match(panels.describeWizardPausedRun(1), /^Ya hay 1 empresa en/);
    assert.match(panels.describeWizardPausedRun(0), /^El resto lo termina el Centro de procesos/);
    assert.match(panels.describeWizardPausedRun(undefined), /^El resto lo termina/);
  });

  it('la rama de pausa pinta el aviso, no sólo «Cerrar»', () => {
    const src = read('src/components/prospect-batches/chat-wizard/wizard-execution-panels.tsx');
    const branch = src.slice(src.indexOf('data-testid="wizard-success-paused"'));
    assert.ok(branch.indexOf('WIZARD_PAUSED_HEADING') < branch.indexOf('Cerrar'));
    assert.ok(branch.includes('describeWizardPausedRun(candidateCount)'));
  });
});

describe('2 · «· tú» en Asignar a…', () => {
  function renderDrawer(currentUserId: string, onAssigned?: (a: { ids: string[]; user: { id: string } }) => void) {
    render(
      <drawer.AssignOwnerDrawer
        open
        onOpenChange={() => {}}
        kind="candidates"
        items={[{ id: 'c1', name: 'Grupo Bimbo', currentOwnerId: null }]}
        users={[hadde, elkin]}
        currentUserId={currentUserId}
        onAssign={async () => ({ success: true, assigned: 1, alreadyOwned: 0, skipped: 0, targetName: 'Hadde' })}
        onAssigned={onAssigned}
      />,
    );
  }

  it('🔴 con «Ver como…» (la pantalla trae a Hadde) «tú» es quien asigna de verdad', () => {
    renderDrawer('u-hadde');
    const marks = screen.getAllByText('· tú', { exact: false });
    assert.equal(marks.length, 1);
    assert.ok(marks[0].closest('span')?.parentElement?.textContent?.includes('Elkin Garcia'));
  });

  it('sin la marca del servidor se usa el id de la pantalla (como antes)', () => {
    render(
      <drawer.AssignOwnerDrawer
        open
        onOpenChange={() => {}}
        kind="candidates"
        items={[{ id: 'c1', name: 'Grupo Bimbo', currentOwnerId: null }]}
        users={[{ id: 'u-hadde', full_name: 'Hadde Ramírez', email: 'h@x' }]}
        currentUserId="u-hadde"
        onAssign={async () => ({ success: true, assigned: 1, alreadyOwned: 0, skipped: 0, targetName: 'Hadde' })}
      />,
    );
    assert.equal(screen.getAllByText('· tú', { exact: false }).length, 1);
  });

  it('listAssignableUsers marca a la persona real (actor), no a la previsualizada', () => {
    const src = read('src/modules/assignment/assignment.server.ts');
    assert.match(src, /is_self: user\.id === actor\.id/);
  });

  it('al asignar, avisa a la pantalla a quién y qué', async () => {
    const calls: Array<{ ids: string[]; user: { id: string } }> = [];
    renderDrawer('u-elkin', (a) => calls.push(a));
    fireEvent.click(screen.getByText('Hadde Ramírez'));
    const confirm = screen.getAllByRole('button').find((b) => /^Asignar/.test(b.textContent ?? '') && !b.hasAttribute('disabled'));
    assert.ok(confirm, 'hay botón de asignar');
    fireEvent.click(confirm!);
    await waitFor(() => assert.equal(calls.length, 1));
    assert.deepEqual(calls[0].ids, ['c1']);
    assert.equal(calls[0].user.id, 'u-hadde');
  });
});

describe('3 · la fila cambia de responsable al momento', () => {
  const rows = [
    { id: 'c1', responsible: { id: 'u-elkin', name: 'Elkin', isAssigned: false } },
    { id: 'c2', responsible: null },
  ];

  it('pinta lo recién asignado sin mutar las filas', () => {
    const marks = assignedNow.markAssigned(new Map(), ['c1'], hadde);
    const out = assignedNow.applyAssignedNow(rows, marks);
    assert.deepEqual(out[0].responsible, { id: 'u-hadde', name: 'Hadde Ramírez', isAssigned: true });
    assert.equal(out[1], rows[1]);
    assert.equal(rows[0].responsible?.id, 'u-elkin');
  });

  it('🔴 la segunda asignación se ve aunque la página aún traiga la primera', () => {
    // La base ya dice Hadde (primera asignación); se reasigna a Elkin.
    const afterFirst = [{ id: 'c1', responsible: { id: 'u-hadde', name: 'Hadde Ramírez', isAssigned: true } }];
    let marks = assignedNow.markAssigned(new Map(), ['c1'], hadde);
    marks = assignedNow.markAssigned(marks, ['c1'], elkin);
    assert.equal(assignedNow.applyAssignedNow(afterFirst, marks)[0].responsible?.name, 'Elkin Garcia');
  });

  it('cuando la base ya dice lo mismo, manda la fila del servidor', () => {
    const marks = assignedNow.markAssigned(new Map(), ['c1'], elkin);
    const out = assignedNow.applyAssignedNow(rows, marks);
    assert.equal(out[0], rows[0]);
  });

  it('la tabla de Por revisar lo usa al asignar', () => {
    const src = read('src/components/prospects/prospects-data-table-client.tsx');
    assert.match(src, /applyAssignedNow\(candidates as Row\[\], assignedNow\)/);
    assert.match(src, /setAssignedNow\(\(prev\) => markAssigned\(prev, ids, user\)\)/);
  });
});
