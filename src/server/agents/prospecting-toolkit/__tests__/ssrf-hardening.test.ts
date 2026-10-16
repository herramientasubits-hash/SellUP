/**
 * SSRF-HARDENING-1 (16-10) — `fetchSafePageHtml` decide por la DIRECCIÓN, no por
 * el texto del host, y resuelve el DNS antes de cada salto.
 *
 * Casos que pasaban antes (revisión de código del Agente 3, PR #735):
 *   · `[::ffff:127.0.0.1]` → la URL lo normaliza a `[::ffff:7f00:1]`;
 *   · `[::ffff:169.254.169.254]` → `[::ffff:a9fe:a9fe]` (metadatos de la nube);
 *   · `[::]` y la ULA `fd00::/8`;
 *   · un nombre DNS público que resuelve a una IP privada (también tras un redirect).
 *
 * Sin red: `fetch` global sustituido y el resolvedor DNS inyectado.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isBlockedHostname, isBlockedIpAddress, parseIpv6 } from '../ip-safety';
import { fetchSafePageHtml, type HostLookup } from '../website-verifier';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

/** Un fetch que registra cada URL pedida y responde una página simple. */
function recordingFetch(urls: string[], respond?: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return respond ? respond(url) : htmlResponse('<title>Empresa</title><p>ok</p>');
  }) as typeof fetch;
}

const publicLookup: HostLookup = async () => ['93.184.216.34'];

describe('ip-safety · direcciones', () => {
  it('bloquea IPv4 no enrutables y deja pasar las públicas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.10', '203.0.113.5']) {
      assert.equal(isBlockedIpAddress(ip), true, ip);
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '200.1.2.3']) {
      assert.equal(isBlockedIpAddress(ip), false, ip);
    }
  });

  it('bloquea IPv6 internas, incluida la IPv4 mapeada o embebida', () => {
    for (const ip of [
      '::',
      '::1',
      '::ffff:7f00:1',
      '::ffff:127.0.0.1',
      '::ffff:a9fe:a9fe',
      '::127.0.0.1',
      '64:ff9b::a9fe:a9fe',
      '2002:7f00:1::',
      '2001:0:4136:e378::1',
      '2001:db8::1',
      'fd00::1',
      'fc12:3456::1',
      'fe80::1%eth0',
      'fec0::1',
      'ff02::1',
    ]) {
      assert.equal(isBlockedIpAddress(ip), true, ip);
    }
    for (const ip of ['2800:3f0:4002:803::200e', '2606:4700::6810:85e5', '::ffff:8.8.8.8', '64:ff9b::808:808']) {
      assert.equal(isBlockedIpAddress(ip), false, ip);
    }
  });

  it('expande bien las formas abreviadas', () => {
    assert.deepEqual(parseIpv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    assert.deepEqual(parseIpv6('1:2:3:4:5:6:7:8'), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(parseIpv6('1::2::3'), null);
    assert.equal(parseIpv6('1:2:3'), null);
  });

  it('bloquea nombres internos y de una sola etiqueta, pero no dominios normales', () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'metadata.google.internal', 'router.home.arpa', 'intranet', '[::ffff:7f00:1]', '[::]']) {
      assert.equal(isBlockedHostname(host), true, host);
    }
    for (const host of ['ubits.co', 'www.empresa.com.co', 'gob.pe', '[2800:3f0:4002:803::200e]']) {
      assert.equal(isBlockedHostname(host), false, host);
    }
  });
});

describe('fetchSafePageHtml · anti-SSRF', () => {
  it('no descarga IPv6 que esconde una IPv4 interna, ni [::], ni ULA', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls);
    for (const target of [
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/latest/meta-data',
      'http://[::]/',
      'http://[fd00::1]/',
      'http://2130706433/',
      'http://0x7f.1/',
    ]) {
      const result = await fetchSafePageHtml(target, 1_000, 50_000, { lookupHost: publicLookup });
      assert.match(result.error ?? '', /^blocked_url:/, target);
      assert.equal(result.html, null, target);
    }
    assert.deepEqual(urls, [], 'ninguna petición salió');
  });

  it('no descarga un nombre público que resuelve a una IP interna', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls);
    const lookup: HostLookup = async () => ['93.184.216.34', '169.254.169.254'];
    const result = await fetchSafePageHtml('https://trampa.example.com', 1_000, 50_000, { lookupHost: lookup });
    assert.equal(result.error, 'blocked_url:private_resolution');
    assert.deepEqual(urls, []);
  });

  it('un redirect hacia un nombre que resuelve a una IP interna se corta en ese salto', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls, (url) =>
      url.startsWith('https://empresa.example.com')
        ? htmlResponse('', 302, { location: 'https://interno.example.net/admin' })
        : htmlResponse('<p>no debería llegar</p>'),
    );
    const lookup: HostLookup = async (host) => (host === 'interno.example.net' ? ['10.0.0.5'] : ['93.184.216.34']);
    const result = await fetchSafePageHtml('https://empresa.example.com', 1_000, 50_000, { lookupHost: lookup });
    assert.equal(result.error, 'blocked_redirect_private_resolution');
    assert.deepEqual(urls, ['https://empresa.example.com/']);
  });

  it('un redirect hacia una IPv6 mapeada interna se corta sin resolver nada', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls, (url) =>
      url.startsWith('https://empresa.example.com')
        ? htmlResponse('', 301, { location: 'http://[::ffff:7f00:1]/' })
        : htmlResponse('<p>no debería llegar</p>'),
    );
    const result = await fetchSafePageHtml('https://empresa.example.com', 1_000, 50_000, { lookupHost: publicLookup });
    assert.match(result.error ?? '', /^blocked_redirect_blocked_private_or_local_host/);
    assert.equal(urls.length, 1);
  });

  it('un sitio normal sigue descargando', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls);
    const result = await fetchSafePageHtml('empresa.example.com', 1_000, 50_000, { lookupHost: publicLookup });
    assert.equal(result.error, null);
    assert.match(result.html ?? '', /Empresa/);
    assert.deepEqual(urls, ['https://empresa.example.com/']);
  });

  it('si el DNS falla o tarda, no se bloquea: la descarga falla o sigue como siempre', async () => {
    const urls: string[] = [];
    globalThis.fetch = recordingFetch(urls);
    const failing: HostLookup = async () => {
      throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    };
    const result = await fetchSafePageHtml('https://empresa.example.com', 1_000, 50_000, { lookupHost: failing });
    assert.equal(result.error, null);
    assert.equal(urls.length, 1);
  });
});
