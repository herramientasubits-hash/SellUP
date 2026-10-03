/**
 * Pipeline · «Mover de etapa» (`StageMoveDialog`) — contrato RUNTIME: mover nunca
 * es a ciegas. El diálogo pide el contexto de la etapa (que lo haga la IA, ya se
 * hizo por fuera —subir contactos, HubSpot (pronto), pegar lo que pasó— o mover
 * sin acción con un motivo), el botón principal dice qué va a pasar y espera a
 * que la opción esté completa, solo al confirmar se mueve (una vez) y si falla
 * no se cierra. La barra de acciones y el tablero usan este mismo componente.
 */

import '../../../../components/settings/__tests__/jsdom-bootstrap';

import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import type { PipelineStatus } from '@/modules/accounts/types';
import { findMoveDialog, moveOption, movePrimary } from './stage-move-helpers';

let rtl: typeof import('@testing-library/react');
let StageMoveDialog: (typeof import('../pipeline-stage-move'))['StageMoveDialog'];

type Props = React.ComponentProps<(typeof import('../pipeline-stage-move'))['StageMoveDialog']>;
type Context = import('../pipeline-stage-move').StageMoveContext;

const h = React.createElement;

before(async () => {
  rtl = await import('@testing-library/react');
  ({ StageMoveDialog } = await import('../pipeline-stage-move'));
});

afterEach(() => {
  rtl.cleanup();
});

async function renderDialog(props: Partial<Props> & { toStatus?: PipelineStatus } = {}) {
  const confirmed: Context[] = [];
  const log = { cancel: 0 };
  rtl.render(
    h(StageMoveDialog, {
      accountName: 'Globex',
      toStatus: 'ready_for_research',
      onConfirm: async (context: Context) => {
        confirmed.push(context);
        return { success: true as const };
      },
      onCancel: () => (log.cancel += 1),
      canUseAi: true,
      canUploadContacts: true,
      ...props,
    }),
  );
  const dialog = await findMoveDialog(rtl);
  return { dialog, confirmed, log };
}

const type = (dialog: HTMLElement, name: string, value: string) =>
  rtl.fireEvent.change(rtl.within(dialog).getByRole('textbox', { name }), { target: { value } });

describe('Mover de etapa — la pregunta y sus opciones', () => {
  it('dice a qué etapa se mueve y pregunta por el contexto, con las opciones en orden', async () => {
    const { dialog } = await renderDialog();
    assert.ok(rtl.within(dialog).getByText('Mover Globex a «Lista para investigar»'));
    assert.ok(rtl.within(dialog).getByText('¿Cómo le damos a SellUp el contexto de esta etapa?'));
    const top = rtl.within(rtl.within(dialog).getByRole('radiogroup', { name: 'Contexto de la etapa' }))
      .getAllByRole('radio')
      .map((radio) => radio.textContent);
    assert.equal(top.length, 3);
    assert.match(top[0] ?? '', /^Que lo haga la IA/);
    assert.match(top[1] ?? '', /^Ya lo hice por fuera/);
    assert.match(top[2] ?? '', /^Moverla sin acción.*No recomendado/);
  });

  it('sin opción elegida, el botón principal dice «Mover» y está apagado', async () => {
    const { dialog } = await renderDialog();
    assert.equal(movePrimary(dialog).textContent, 'Mover');
    assert.equal(movePrimary(dialog).disabled, true);
  });
});

describe('Mover de etapa — que lo haga la IA', () => {
  it('a una etapa «Próximamente», la opción sale apagada con su motivo', async () => {
    const { dialog } = await renderDialog({ toStatus: 'ready_for_outreach' });
    const ai = moveOption(rtl, dialog, 'Que lo haga la IA');
    assert.equal(ai.disabled, true);
    assert.match(ai.textContent ?? '', /El agente de esta etapa llega pronto/);
    assert.doesNotMatch(ai.textContent ?? '', /Recomendada/);
  });

  it('a una etapa con agente (enriquecimiento) es la recomendada y abre el agente', async () => {
    const { dialog, confirmed } = await renderDialog({ toStatus: 'new' });
    const ai = moveOption(rtl, dialog, 'Que lo haga la IA');
    assert.equal(ai.disabled, false);
    assert.match(ai.textContent ?? '', /Recomendada/);
    assert.match(ai.textContent ?? '', /agente 2A en el panel lateral/);

    rtl.fireEvent.click(ai);
    assert.equal(movePrimary(dialog).textContent, 'Mover y abrir el agente');
    assert.equal(movePrimary(dialog).disabled, false);
    rtl.fireEvent.click(movePrimary(dialog));
    await rtl.waitFor(() => assert.deepEqual(confirmed, [{ kind: 'ai' }]));
  });

  it('si quien monta el diálogo no puede abrir el agente, lo dice', async () => {
    const { dialog } = await renderDialog({ toStatus: 'new', canUseAi: false });
    const ai = moveOption(rtl, dialog, 'Que lo haga la IA');
    assert.equal(ai.disabled, true);
    assert.match(ai.textContent ?? '', /No se puede abrir el agente desde aquí/);
  });
});

describe('Mover de etapa — ya lo hice por fuera', () => {
  it('elegirla despliega las tres maneras; HubSpot sale apagado con su motivo', async () => {
    const { dialog } = await renderDialog();
    assert.ok(rtl.within(dialog).queryByRole('radiogroup', { name: 'Qué hiciste por fuera' }) === null);
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Ya lo hice por fuera'));

    const sub = rtl.within(rtl.within(dialog).getByRole('radiogroup', { name: 'Qué hiciste por fuera' })).getAllByRole('radio');
    assert.deepEqual(
      sub.map((radio) => [radio.textContent?.split(/(?=[A-Z][a-zé]+ el|Abre|Pronto|Notas)/)[0], (radio as HTMLButtonElement).disabled]),
      [
        ['Subir los contactos', false],
        ['Ya están en HubSpot: sincronizarlos', true],
        ['Pegar la información', false],
      ],
    );
    assert.match(sub[1].textContent ?? '', /Pronto: traer los contactos desde HubSpot/);
    // Sin elegir la manera, todavía no se puede mover.
    assert.equal(movePrimary(dialog).disabled, true);
  });

  it('«Subir los contactos» mueve y abre el alta de contactos', async () => {
    const { dialog, confirmed } = await renderDialog();
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Ya lo hice por fuera'));
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Subir los contactos'));
    assert.equal(movePrimary(dialog).textContent, 'Mover y subir los contactos');
    rtl.fireEvent.click(movePrimary(dialog));
    await rtl.waitFor(() => assert.deepEqual(confirmed, [{ kind: 'contacts' }]));
  });

  it('si no se pueden subir contactos desde aquí, la opción sale apagada', async () => {
    const { dialog } = await renderDialog({ canUploadContacts: false });
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Ya lo hice por fuera'));
    const contacts = moveOption(rtl, dialog, 'Subir los contactos');
    assert.equal(contacts.disabled, true);
    assert.match(contacts.textContent ?? '', /No se pueden subir contactos desde aquí/);
  });

  it('«Pegar la información» guarda en las notas: lo dice y espera al menos 10 caracteres', async () => {
    const { dialog, confirmed } = await renderDialog();
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Ya lo hice por fuera'));
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Pegar la información'));
    assert.ok(rtl.within(dialog).getByText(/Lo guardamos en las notas de la empresa/));
    assert.equal(movePrimary(dialog).textContent, 'Mover y guardar');
    assert.equal(movePrimary(dialog).disabled, true);

    type(dialog, 'Lo que pasó en esta etapa', 'corto');
    assert.ok(rtl.within(dialog).getByText('Escribe al menos 10 caracteres.'));
    assert.equal(movePrimary(dialog).disabled, true);

    type(dialog, 'Lo que pasó en esta etapa', 'Reunión con Luisa: quieren liderazgo.');
    assert.equal(movePrimary(dialog).disabled, false);
    rtl.fireEvent.click(movePrimary(dialog));
    await rtl.waitFor(() =>
      assert.deepEqual(confirmed, [{ kind: 'paste', text: 'Reunión con Luisa: quieren liderazgo.' }]),
    );
  });
});

describe('Mover de etapa — moverla sin acción', () => {
  it('exige un motivo de al menos 10 caracteres y lo entrega para guardarlo', async () => {
    const { dialog, confirmed } = await renderDialog();
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Moverla sin acción'));
    assert.equal(movePrimary(dialog).textContent, 'Mover sin acción');
    assert.equal(movePrimary(dialog).disabled, true);
    assert.ok(rtl.within(dialog).getByText(/se guarda en las notas de la empresa/));

    type(dialog, 'Motivo', 'no sé');
    assert.equal(movePrimary(dialog).disabled, true);
    type(dialog, 'Motivo', 'Ya no responde correos');
    rtl.fireEvent.click(movePrimary(dialog));
    await rtl.waitFor(() => assert.deepEqual(confirmed, [{ kind: 'none', reason: 'Ya no responde correos' }]));
  });
});

describe('Mover de etapa — confirmar, fallar y cancelar', () => {
  it('confirmar llama UNA vez aunque se pulse dos veces mientras guarda', async () => {
    let calls = 0;
    let release: (value: { success: true }) => void = () => {};
    const { dialog } = await renderDialog({
      onConfirm: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Moverla sin acción'));
    type(dialog, 'Motivo', 'Ya no responde correos');
    rtl.fireEvent.click(movePrimary(dialog));
    await rtl.waitFor(() => assert.equal(movePrimary(dialog).textContent, 'Moviendo…'));
    rtl.fireEvent.click(movePrimary(dialog));
    assert.equal(calls, 1);
    await rtl.act(async () => release({ success: true }));
  });

  it('si guardar falla, no se cierra y dice el motivo', async () => {
    const { dialog, log } = await renderDialog({
      onConfirm: async () => ({ success: false, error: 'No se pudo guardar el contexto.' }),
    });
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Moverla sin acción'));
    type(dialog, 'Motivo', 'Ya no responde correos');
    rtl.fireEvent.click(movePrimary(dialog));
    assert.equal((await rtl.within(dialog).findByRole('alert')).textContent, 'No se pudo guardar el contexto.');
    assert.ok(rtl.screen.getByRole('dialog'));
    assert.equal(log.cancel, 0);
  });

  it('cancelar no mueve', async () => {
    const { dialog, confirmed, log } = await renderDialog();
    rtl.fireEvent.click(moveOption(rtl, dialog, 'Que lo haga la IA'));
    rtl.fireEvent.click(rtl.within(dialog).getByRole('button', { name: 'Cancelar' }));
    assert.equal(log.cancel, 1);
    assert.deepEqual(confirmed, []);
  });

  it('cerrado no pinta nada', () => {
    rtl.render(
      h(StageMoveDialog, {
        accountName: null,
        toStatus: null,
        onConfirm: async () => ({ success: true as const }),
        onCancel: () => {},
      }),
    );
    assert.ok(rtl.screen.queryByRole('dialog') === null);
  });
});

describe('Mover de etapa — un solo flujo', () => {
  it('la barra de acciones y el tablero montan este mismo diálogo (y ningún ConfirmDialog de etapa)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = join(process.cwd(), 'src/app/(sellup)/pipeline');
    for (const file of ['pipeline-board.tsx', 'pipeline-screen-actions.tsx']) {
      const source = readFileSync(join(dir, file), 'utf8');
      assert.match(source, /<StageMoveDialog\b/, file);
      assert.doesNotMatch(source, /ConfirmDialog/, file);
    }
  });
});
