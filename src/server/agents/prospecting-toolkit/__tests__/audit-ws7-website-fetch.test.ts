/**
 * AUDIT-A1-WS7 (16-10) — descarga de páginas (`fetchSafePageHtml` / `verifyWebsite`):
 *
 *   · el cuerpo se lee por trozos y se corta en el tope (antes: `arrayBuffer()` de
 *     la página entera y recorte después);
 *   · https sin vuelta atrás: un fallo de conexión/TLS se reintenta UNA vez por
 *     http (con la misma validación anti-SSRF); un timeout o un DNS inexistente no;
 *   · un redirect explícito a http se respeta (antes se subía a https en cada salto
 *     y un sitio sólo-http entraba en bucle);
 *   · el charset sale del Content-Type o del <meta charset>; sin declaración, UTF-8
 *     y, si los bytes no son UTF-8 válido, windows-1252.
 *
 * Sin red: `fetch` global sustituido durante cada prueba.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decodeHtmlBytes, fetchSafePageHtml, readBodyLimited } from '../website-verifier';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function htmlResponse(body: BodyInit, contentType = 'text/html; charset=utf-8', status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

describe('readBodyLimited', () => {
  it('deja de leer al llegar al tope y cancela el resto', async () => {
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(1024).fill(65));
      },
      cancel() {
        cancelled = true;
      },
    });
    const bytes = await readBodyLimited(new Response(stream), 5000);
    assert.equal(bytes.byteLength, 5000);
    assert.ok(pulled < 20, `trozos leídos: ${pulled}`);
    assert.equal(cancelled, true);
  });
});

describe('decodeHtmlBytes', () => {
  const latin1 = Uint8Array.from([...'<title>Compa'].map((c) => c.charCodeAt(0)).concat([0xf1, ...[...'ía</title>'].map((c) => c.charCodeAt(0) & 0xff)]));

  it('usa el charset del Content-Type', () => {
    assert.match(decodeHtmlBytes(latin1, 'text/html; charset=ISO-8859-1'), /Compañ/);
  });

  it('usa el <meta charset> si el header no lo trae', () => {
    const withMeta = Uint8Array.from([...new TextEncoder().encode('<meta charset="windows-1252">'), ...latin1]);
    assert.match(decodeHtmlBytes(withMeta, 'text/html'), /Compañ/);
  });

  it('sin declaración: UTF-8, y windows-1252 si los bytes no son UTF-8', () => {
    assert.match(decodeHtmlBytes(new TextEncoder().encode('<title>Compañía</title>'), 'text/html'), /Compañía/);
    assert.match(decodeHtmlBytes(latin1, 'text/html'), /Compañ/);
  });

  it('un carácter UTF-8 cortado por el tope no hace caer a windows-1252', () => {
    const bytes = new TextEncoder().encode('Compañía ñ');
    const cut = bytes.subarray(0, bytes.byteLength - 1);
    assert.match(decodeHtmlBytes(cut, 'text/html'), /^Compañía /);
  });
});

describe('fetchSafePageHtml — protocolo y redirects', () => {
  it('fallo TLS en https ⇒ un reintento por http', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      if (url.startsWith('https://')) {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
      }
      return htmlResponse('<title>Municipio</title>');
    }) as typeof fetch;
    const page = await fetchSafePageHtml('municipio.gob.pe');
    assert.deepEqual(urls, ['https://municipio.gob.pe/', 'http://municipio.gob.pe/']);
    assert.equal(page.httpStatus, 200);
    assert.match(page.html ?? '', /Municipio/);
    assert.equal(page.finalUrl, 'http://municipio.gob.pe/');
  });

  it('DNS inexistente no se reintenta por http', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as typeof fetch;
    const page = await fetchSafePageHtml('no-existe.example');
    assert.equal(urls.length, 1);
    assert.equal(page.error, 'fetch_error');
  });

  it('un redirect explícito a http se respeta (sin bucle)', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      if (url === 'https://solohttp.com/') {
        return new Response(null, { status: 301, headers: { location: 'http://solohttp.com/inicio' } });
      }
      return htmlResponse('<title>Solo HTTP</title>');
    }) as typeof fetch;
    const page = await fetchSafePageHtml('solohttp.com');
    assert.deepEqual(urls, ['https://solohttp.com/', 'http://solohttp.com/inicio']);
    assert.equal(page.httpStatus, 200);
    assert.equal(page.redirected, true);
  });

  it('un redirect a un host privado sigue bloqueado', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })) as typeof fetch;
    const page = await fetchSafePageHtml('empresa.com');
    assert.match(page.error ?? '', /blocked_redirect_blocked_private_or_local_host/);
  });

  it('el reintento por http tampoco puede ir a un host privado', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(url);
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as typeof fetch;
    const page = await fetchSafePageHtml('https://localhost/');
    assert.equal(urls.length, 0);
    assert.match(page.error ?? '', /blocked_url/);
  });

  it('respeta el tope de bytes en la página final', async () => {
    globalThis.fetch = (async () => htmlResponse('<title>X</title>' + 'a'.repeat(200_000))) as typeof fetch;
    const page = await fetchSafePageHtml('grande.com', 8000, 1000);
    assert.equal(page.html?.length, 1000);
  });
});
