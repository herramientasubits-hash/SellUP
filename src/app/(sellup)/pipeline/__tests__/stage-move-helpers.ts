/**
 * Ayudas de prueba del flujo «Mover de etapa» (`StageMoveDialog`), que comparten
 * la barra de acciones y el tablero.
 */
import assert from 'node:assert/strict';

type RTL = typeof import('@testing-library/react');

/** El diálogo de mover de etapa (es un `ModalShell`: rol `dialog`). */
export async function findMoveDialog(rtl: RTL): Promise<HTMLElement> {
  const dialog = await rtl.screen.findByRole('dialog');
  assert.ok(rtl.within(dialog).getByRole('radiogroup', { name: 'Contexto de la etapa' }));
  return dialog;
}

/** Una tarjeta de opción del diálogo, por el principio de su texto. */
export function moveOption(rtl: RTL, dialog: HTMLElement, label: string): HTMLButtonElement {
  const option = rtl
    .within(dialog)
    .getAllByRole('radio')
    .find((candidate) => candidate.textContent?.startsWith(label));
  assert.ok(option, `falta la opción «${label}»`);
  return option as HTMLButtonElement;
}

/** El botón principal del pie (no las tarjetas). */
export function movePrimary(dialog: HTMLElement): HTMLButtonElement {
  const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([role="radio"])')).find((candidate) =>
    /^Mov(er|iendo)/.test(candidate.textContent?.trim() ?? ''),
  );
  assert.ok(button, 'falta el botón principal');
  return button;
}

/** Elige «Moverla sin acción» y escribe el motivo; devuelve el botón principal. */
export function chooseMoveWithoutAction(rtl: RTL, dialog: HTMLElement, reason = 'Ya no responde correos'): HTMLButtonElement {
  rtl.fireEvent.click(moveOption(rtl, dialog, 'Moverla sin acción'));
  rtl.fireEvent.change(rtl.within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: reason } });
  return movePrimary(dialog);
}
