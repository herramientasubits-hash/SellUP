/**
 * Agente 2A — Apollo Phone Reveal: ref opaco en webhook_url (APOLLO-PHONE-ASYNC-21)
 *
 * Pruebas puras del helper que añade `?ref=<uuid>` al webhook_url preservando el
 * `token`, vía URL API (sin pre-encodear la URL completa). Sin red, sin env.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  appendOpaqueWebhookRef,
  extractOpaqueWebhookRef,
  WEBHOOK_REF_QUERY_PARAM,
} from '../apollo-webhook-ref';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const BASE = 'https://app.example.com/api/integrations/apollo/phone-reveal/webhook?token=secret-123';
const REF = '11111111-2222-4333-8444-555555555555';

describe('ASYNC-21 webhook-ref — appendOpaqueWebhookRef', () => {
  it('agrega ref preservando el token existente', () => {
    const url = new URL(appendOpaqueWebhookRef(BASE, REF));
    assert.equal(url.searchParams.get('token'), 'secret-123');
    assert.equal(url.searchParams.get('ref'), REF);
    assert.equal(WEBHOOK_REF_QUERY_PARAM, 'ref');
  });

  it('NO pre-percent-encodea la URL completa; sólo codifica el valor del query', () => {
    // Un ref con caracteres reservados se codifica SOLO como valor de query.
    const out = appendOpaqueWebhookRef(BASE, 'a b&c');
    // El path y el resto de la URL quedan intactos (sin doble-encoding).
    assert.ok(out.startsWith('https://app.example.com/api/integrations/apollo/phone-reveal/webhook?'));
    const url = new URL(out);
    // El valor se decodifica correctamente (fue encoded una sola vez).
    assert.equal(url.searchParams.get('ref'), 'a b&c');
    assert.equal(url.searchParams.get('token'), 'secret-123');
    // La forma serializada codifica espacio y & dentro del valor.
    assert.ok(/ref=a(%20|\+)b%26c/.test(out));
  });

  it('sobreescribe un ref previo (idempotente por intento)', () => {
    const first = appendOpaqueWebhookRef(BASE, 'old-ref');
    const second = appendOpaqueWebhookRef(first, REF);
    const url = new URL(second);
    assert.equal(url.searchParams.get('ref'), REF);
    assert.equal(url.searchParams.getAll('ref').length, 1);
  });

  it('ref vacío/whitespace → devuelve la URL original sin tocar', () => {
    assert.equal(appendOpaqueWebhookRef(BASE, ''), BASE);
    assert.equal(appendOpaqueWebhookRef(BASE, '   '), BASE);
    assert.equal(appendOpaqueWebhookRef(BASE, null), BASE);
  });

  it('URL inválida → devuelve la entrada sin romper (fail-safe)', () => {
    assert.equal(appendOpaqueWebhookRef('not a url', REF), 'not a url');
  });

  it('el ref opaco no contiene PII (es un UUID)', () => {
    const out = appendOpaqueWebhookRef(BASE, REF);
    for (const pii of ['@', 'linkedin', '+57', 'jane', 'doe']) {
      assert.equal(out.toLowerCase().includes(pii), false);
    }
  });
});

describe('ASYNC-21 webhook-ref — extractOpaqueWebhookRef', () => {
  it('extrae el ref de una URL construida', () => {
    const out = appendOpaqueWebhookRef(BASE, REF);
    assert.equal(extractOpaqueWebhookRef(out), REF);
  });

  it('sin ref → null', () => {
    assert.equal(extractOpaqueWebhookRef(BASE), null);
  });

  it('URL inválida → null', () => {
    assert.equal(extractOpaqueWebhookRef('nope'), null);
  });
});

describe('ASYNC-21 webhook-ref — guard estático del cliente', () => {
  const raw = readFileSync(
    join(REPO_ROOT, 'src/server/integrations/apollo-client.ts'),
    'utf8',
  );
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('startApolloPhoneReveal usa appendOpaqueWebhookRef', () => {
    assert.equal(/appendOpaqueWebhookRef/.test(code), true);
  });

  it('el ref sale del outbound transaction id (randomUUID), no de PII', () => {
    assert.equal(/const\s+webhookRef\s*=\s*outboundTransactionId/.test(code), true);
  });

  it('pasa webhookRef al interpreter de la respuesta', () => {
    assert.equal(/webhookRef\s*,/.test(code), true);
  });
});
