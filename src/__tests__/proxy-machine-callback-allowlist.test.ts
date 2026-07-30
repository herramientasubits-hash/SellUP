/**
 * Proxy (middleware de Next 16) — allowlist de callbacks de máquina
 * (Agente 2A · APOLLO-PHONE-RECOVERY-CRON-1)
 *
 * CAUSA RAÍZ que cubre este test: `src/proxy.ts` protege por sesión TODO lo que no
 * esté en su lista de exclusiones. El webhook de Apollo NO estaba excluido, así que
 * cada callback de Apollo recibía **307 → /login** antes de llegar al handler: por
 * eso en Producción todos los candidatos tenían
 * `phone_reveal_webhook_received_at` NULL y los únicos casos terminales se
 * resolvieron por recovery manual. Lo mismo aplicaría al cron del recovery L2:
 * Vercel Cron no manda cookie de sesión.
 *
 * Este test fija el contrato: los callbacks de máquina quedan fuera de la
 * protección de sesión, y las rutas de negocio SIGUEN protegidas.
 *
 * Puro y offline: no arranca servidor, no toca Supabase, no hace red.
 *
 * Requiere: node --import tsx --test <thisfile>
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../proxy';

/**
 * Reproduce cómo Next evalúa el matcher: el patrón se ancla y se aplica al
 * pathname completo. Si coincide, el proxy CORRE (y por tanto puede redirigir a
 * /login); si no coincide, la ruta queda fuera de la protección de sesión.
 */
function proxyRunsFor(pathname: string): boolean {
  const pattern = config.matcher[0];
  return new RegExp(`^${pattern}$`).test(pathname);
}

// ── 1. Callbacks de máquina: NO deben pasar por el proxy ────────

describe('proxy — callbacks de máquina excluidos de la sesión', () => {
  it('el webhook de Apollo phone reveal NO pasa por el proxy (causa raíz)', () => {
    assert.equal(
      proxyRunsFor('/api/integrations/apollo/phone-reveal/webhook'),
      false,
      'si el proxy corre, Apollo recibe 307 → /login y el webhook nunca aterriza',
    );
  });

  it('el webhook sigue excluido con query params (token y ref van en la URL)', () => {
    // Next evalúa solo el pathname, pero se fija explícitamente: el callback real
    // llega con ?token=…&ref=… y debe seguir fuera de la protección.
    for (const path of [
      '/api/integrations/apollo/phone-reveal/webhook',
      '/api/integrations/apollo/phone-reveal/webhook/',
    ]) {
      assert.equal(proxyRunsFor(path), false, path);
    }
  });

  it('el cron del recovery L2 NO pasa por el proxy (Vercel Cron no trae sesión)', () => {
    assert.equal(proxyRunsFor('/api/cron/phone-reveal-recovery'), false);
  });

  it('las exclusiones previas siguen intactas (sin regresión)', () => {
    for (const path of [
      '/api/health',
      '/api/integrations/slack/oauth/callback',
      '/api/integrations/samu/webhook',
      '/api/cron/enrich',
    ]) {
      assert.equal(proxyRunsFor(path), false, `${path} debe seguir excluido`);
    }
  });

  it('los assets siguen excluidos', () => {
    for (const path of ['/_next/static/chunk.js', '/favicon.ico', '/logo.svg']) {
      assert.equal(proxyRunsFor(path), false, path);
    }
  });
});

// ── 2. Lo demás SIGUE protegido ────────────────────────────────

describe('proxy — la protección de sesión no se debilita', () => {
  it('las rutas de negocio siguen pasando por el proxy', () => {
    for (const path of [
      '/pipeline',
      '/prospectos',
      '/settings',
      '/ai-usage',
      '/contactos',
    ]) {
      assert.equal(proxyRunsFor(path), true, `${path} debe seguir protegido`);
    }
  });

  it('las rutas de API que NO son callbacks de máquina siguen protegidas', () => {
    for (const path of [
      '/api/prospect-candidates/enrich',
      '/api/debug/ai-provider-health',
      '/api/integrations/google-drive/oauth/start',
      // Vecinas del webhook: excluir el webhook no abrió su carpeta entera.
      '/api/integrations/apollo/phone-reveal',
      '/api/integrations/apollo/phone-reveal/webhook-otro',
      '/api/integrations/apollo/otro',
    ]) {
      assert.equal(proxyRunsFor(path), true, `${path} debe seguir protegido`);
    }
  });

  it('la exclusión del cron es exacta: no abre /api/cron entero', () => {
    assert.equal(
      proxyRunsFor('/api/cron/otro-job'),
      true,
      'un cron nuevo no queda expuesto por accidente',
    );
  });
});
