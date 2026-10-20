import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESOLVE_COMPANY_NETWORK_COPY,
  RESOLVE_COMPANY_PATH,
  RESOLVE_COMPANY_SESSION_COPY,
  RESOLVE_COMPANY_TIMEOUT_COPY,
  resolveCompanyViaRoute,
} from '../resolve-company-client';

function jsonResponse(body: unknown, init: { redirected?: boolean; url?: string } = {}): Response {
  const response = new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  Object.defineProperty(response, 'redirected', { value: init.redirected ?? false });
  Object.defineProperty(response, 'url', { value: init.url ?? `http://local${RESOLVE_COMPANY_PATH}` });
  return response;
}

describe('identificar la empresa por ruta, con tiempo límite', () => {
  it('manda lo escrito por POST a la ruta y devuelve lo que contesta', async () => {
    let sent: { url: string; init?: RequestInit } | null = null;
    const result = await resolveCompanyViaRoute(
      { companyName: 'Herradura Tequila' },
      {
        fetchImpl: async (url, init) => {
          sent = { url, init };
          return jsonResponse({ success: true, data: { candidates: [], skippedHubSpot: false } });
        },
      },
    );
    assert.equal(result.success, true);
    assert.equal(sent!.url, RESOLVE_COMPANY_PATH);
    assert.equal(sent!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(sent!.init?.body)), { companyName: 'Herradura Tequila' });
  });

  it('si no hay respuesta a tiempo corta la espera y lo dice (nunca gira para siempre)', async () => {
    const result = await resolveCompanyViaRoute(
      { companyName: 'X' },
      {
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      },
    );
    assert.deepEqual(result, { success: false, error: RESOLVE_COMPANY_TIMEOUT_COPY });
  });

  it('red caída, respuesta ilegible o sesión cerrada: error claro, sin lanzar', async () => {
    assert.deepEqual(
      await resolveCompanyViaRoute({ companyName: 'X' }, { fetchImpl: async () => { throw new TypeError('Failed to fetch'); } }),
      { success: false, error: RESOLVE_COMPANY_NETWORK_COPY },
    );
    assert.deepEqual(
      await resolveCompanyViaRoute({ companyName: 'X' }, { fetchImpl: async () => new Response('<html>', { status: 502 }) }),
      { success: false, error: RESOLVE_COMPANY_NETWORK_COPY },
    );
    assert.deepEqual(
      await resolveCompanyViaRoute({ companyName: 'X' }, { fetchImpl: async () => jsonResponse({}, { redirected: true, url: 'http://local/login?next=/accounts' }) }),
      { success: false, error: RESOLVE_COMPANY_SESSION_COPY },
    );
  });

  it('la ruta exige sesión activa y sólo lee (no crea ni llama a proveedores)', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/contact-enrichment/resolve-company/route.ts'), 'utf8');
    assert.match(route, /activeInternalUserIdForRoute\(\)/);
    assert.match(route, /status: 401/);
    assert.equal(/apollo|lusha|insert\(|update\(/i.test(route.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  });

  it('el asistente, el selector de Rumbo y el diálogo de reasignar ya no usan la acción del servidor', () => {
    for (const file of [
      'src/components/contact-enrichment/contact-enrichment-chat-wizard.tsx',
      'src/components/first-call/first-contact-company-picker.tsx',
      'src/components/contact-enrichment/contact-candidate-company-reassign-dialog.tsx',
    ]) {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      assert.equal(src.includes('resolveContactEnrichmentCompanyAction('), false, file);
      assert.ok(src.includes('resolveCompanyViaRoute('), file);
    }
  });
});
