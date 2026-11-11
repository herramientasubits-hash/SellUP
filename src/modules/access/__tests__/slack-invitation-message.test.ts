import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSlackInvitationMessage, SLACK_INVITE_OUTCOME_COPY } from '../slack-invitation-message';

const BASE = {
  inviteeName: 'Carla Pía Gómez',
  inviterName: 'Elena García',
  roleName: 'Vendedor',
  loginUrl: 'https://sellup.example/login',
  waitsForLaunch: false,
};

function buttonUrl(blocks: ReadonlyArray<Record<string, unknown>>): string | undefined {
  const actions = blocks.find((b) => b.type === 'actions') as { elements: Array<{ url?: string; text: { text: string } }> } | undefined;
  return actions?.elements[0]?.url;
}

describe('invitación por Slack — el mensaje', () => {
  it('saluda por el nombre, dice quién invita y con qué rol, y trae el botón al login', () => {
    const msg = buildSlackInvitationMessage(BASE);
    assert.match(msg.text, /^Hola, Carla\. Elena García te invitó a SellUp como Vendedor/);
    assert.match(msg.text, /Entra con Google usando tu correo @ubits\.co/);
    assert.ok(msg.text.endsWith('https://sellup.example/login'));
    assert.equal(msg.text.includes('*'), false, 'el texto plano no lleva marcas de negrita');
    assert.equal(buttonUrl(msg.blocks), 'https://sellup.example/login');
  });

  it('si la puerta de lanzamiento todavía no la deja entrar, lo dice', () => {
    const msg = buildSlackInvitationMessage({ ...BASE, waitsForLaunch: true });
    assert.match(msg.text, /se abre el día del lanzamiento/);
  });

  it('sin nombre, sin rol y sin quién invita sigue siendo un mensaje completo', () => {
    const msg = buildSlackInvitationMessage({ ...BASE, inviteeName: null, inviterName: null, roleName: '  ' });
    assert.match(msg.text, /^Hola\. El equipo de UBITS te invitó a SellUp, la plataforma/);
  });

  it('cada resultado tiene su frase para quien invita', () => {
    for (const key of ['sent', 'not_in_slack', 'slack_not_connected', 'failed'] as const) {
      assert.ok(SLACK_INVITE_OUTCOME_COPY[key].length > 10);
    }
  });
});
