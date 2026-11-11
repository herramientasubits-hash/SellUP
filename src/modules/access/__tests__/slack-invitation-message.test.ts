import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSlackAccessActivatedMessage,
  buildSlackInvitationMessage,
  SLACK_INVITE_OUTCOME_COPY,
  summarizeActivationNotices,
} from '../slack-invitation-message';

const BASE = {
  inviteeName: 'Carla Pía Gómez',
  inviterName: 'Elena García',
  roleName: 'Vendedor',
  loginUrl: 'https://sellup.example/login',
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

describe('aviso por Slack al activar el acceso', () => {
  it('dice quién lo activó, que ya puede entrar y trae el botón al login', () => {
    const msg = buildSlackAccessActivatedMessage({
      inviteeName: 'Carla Pía Gómez',
      activatorName: 'Elena García',
      loginUrl: 'https://sellup.example/login',
    });
    assert.match(msg.text, /^Hola, Carla\. Elena García activó tu acceso a SellUp/);
    assert.match(msg.text, /Ya puedes entrar con Google usando tu correo @ubits\.co/);
    assert.ok(msg.text.endsWith('https://sellup.example/login'));
    assert.equal(msg.text.includes('*'), false);
    assert.equal(buttonUrl(msg.blocks), 'https://sellup.example/login');
  });

  it('sin nombres sigue siendo un mensaje completo', () => {
    const msg = buildSlackAccessActivatedMessage({ inviteeName: null, activatorName: ' ', loginUrl: 'https://x/login' });
    assert.match(msg.text, /^Hola\. El equipo de UBITS activó tu acceso a SellUp/);
  });

  it('resumen para quien activa: todos avisados, algunos sí, ninguno, nadie', () => {
    assert.equal(summarizeActivationNotices([]), null);
    assert.deepEqual(summarizeActivationNotices(['sent']), {
      tone: 'success',
      title: 'Acceso activado',
      description: 'Le avisamos por Slack que ya puede entrar.',
    });
    assert.equal(summarizeActivationNotices(['sent', 'sent'])?.title, 'Activaste 2 accesos');
    assert.match(summarizeActivationNotices(['sent', 'not_in_slack', 'sent'])?.description ?? '', /a 2 de 3/);
    assert.equal(summarizeActivationNotices(['sent', 'failed'])?.tone, 'warning');
    assert.match(summarizeActivationNotices(['not_in_slack'])?.description ?? '', /No encontramos su correo/);
    assert.match(summarizeActivationNotices(['slack_not_connected', 'slack_not_connected'])?.description ?? '', /Slack no está conectado/);
  });
});
