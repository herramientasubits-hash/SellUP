// Agente 2A — Prueba de CABLEADO real (Task D2): `sellup_created` en el payload de creación.
// (AGENT2A-HUBSPOT-CONTACT-APPROVAL-AUTOSYNC)
//
// D1 probó `ensureHubSpotSellUpCreatedProperty` aislado (fetchImpl inyectado). D2 lo conecta
// dentro de `createHubSpotContact` / `createHubSpotCompany`, que NO reciben fetch inyectado:
// llaman al `fetch` global y resuelven el token vía un cliente REAL de `@supabase/supabase-js`
// (`admin.rpc('get_vault_secret_decrypted', ...)`), que a su vez hace HTTP contra
// `{SUPABASE_URL}/rest/v1/rpc/get_vault_secret_decrypted` usando el `fetch` global.
//
// Por eso el único mock de este archivo es `globalThis.fetch`, enrutado por URL — el MISMO
// patrón que ya usa `src/server/services/__tests__/hubspot-connection.test.ts` para probar el
// mismo tipo de flujo (Vault vía Supabase + llamada real a HubSpot). No hace falta
// `mock.module('@supabase/supabase-js', ...)` ni `--experimental-test-module-mocks`: el cliente
// de Supabase real se deja correr sin tocar, sólo se intercepta el transporte HTTP.
//
// Nunca toca una Vault real, un Supabase real, ni la API real de HubSpot. Cualquier URL no
// enrutada explícitamente lanza, para que una fuga de red real falle el test de forma ruidosa.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetHubSpotPropertyEnsureCacheForTests } from '../hubspot-property-ensure-cache';

type ContactModule = typeof import('../hubspot-contact-sync');
type CompanyModule = typeof import('../hubspot-company-create');

let createHubSpotContact: ContactModule['createHubSpotContact'];
let createHubSpotCompany: CompanyModule['createHubSpotCompany'];

const FAKE_TOKEN = 'hubspot-test-token-wiring-abcd1234567890';
const SUPABASE_URL = 'https://fake-local-project.supabase.co';
const RPC_DECRYPTED = '/rest/v1/rpc/get_vault_secret_decrypted';
const HUBSPOT_ORIGIN = 'https://api.hubapi.com';

let origFetch: typeof globalThis.fetch | null = null;
let prevUrl: string | undefined;
let prevKey: string | undefined;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RouteConfig {
  /** Estado HTTP del GET de verificación de `sellup_created`. 200 = ya existe; 404 = falta. */
  propertyCheckStatus: number;
  /** Sólo importa cuando propertyCheckStatus === 404: si el POST de creación de esquema falla. */
  propertyCreateFails?: boolean;
  /** Captura el cuerpo enviado al POST de creación real del contacto/empresa. */
  onCreatePost: (properties: Record<string, unknown>) => void;
  createId: string;
}

/**
 * Instala un `fetch` global enrutado por URL para un tipo de objeto ('contacts' | 'companies').
 * Cubre: la RPC de Vault (token), el GET/POST de verificación de esquema de D1, el GET de
 * metadata de propiedades de companies (sólo lo toca `createHubSpotCompany`), y el POST real de
 * creación del objeto. Cualquier otra URL lanza.
 */
function installFetch(objectType: 'contacts' | 'companies', cfg: RouteConfig): void {
  if (!origFetch) origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    const method = init?.method ?? 'GET';

    if (u.includes(RPC_DECRYPTED)) {
      return jsonResponse(FAKE_TOKEN);
    }

    const propertyCheckUrl = `${HUBSPOT_ORIGIN}/crm/v3/properties/${objectType}/sellup_created`;
    if (u === propertyCheckUrl && method === 'GET') {
      return jsonResponse(
        cfg.propertyCheckStatus === 200 ? { name: 'sellup_created' } : {},
        cfg.propertyCheckStatus,
      );
    }

    const propertySchemaUrl = `${HUBSPOT_ORIGIN}/crm/v3/properties/${objectType}`;
    if (u === propertySchemaUrl && method === 'POST') {
      return cfg.propertyCreateFails
        ? jsonResponse({ message: 'missing schema scope' }, 403)
        : jsonResponse({ name: 'sellup_created' }, 201);
    }
    // createHubSpotCompany también hace un GET (sin método POST) a esta MISMA ruta para leer
    // metadata de propiedades existentes — distinto del check de D1 porque ese usa la ruta CON
    // el nombre de la propiedad al final (`.../companies/sellup_created`).
    if (u === propertySchemaUrl && method === 'GET') {
      return jsonResponse({ results: [] });
    }

    const createObjectUrl = `${HUBSPOT_ORIGIN}/crm/v3/objects/${objectType}`;
    if (u === createObjectUrl && method === 'POST') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      cfg.onCreatePost((body.properties ?? {}) as Record<string, unknown>);
      return jsonResponse({ id: cfg.createId }, 201);
    }

    throw new Error(`Unexpected fetch to a non-mocked URL in wiring test: ${method} ${u}`);
  }) as typeof globalThis.fetch;
}

before(async () => {
  prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // `hubspot-contact-sync.ts` lee estas dos env vars en constantes de MÓDULO (evaluadas al
  // importar), así que deben quedar fijadas ANTES del primer `import(...)`.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key-not-real';

  const contactMod = await import('../hubspot-contact-sync');
  createHubSpotContact = contactMod.createHubSpotContact;
  const companyMod = await import('../hubspot-company-create');
  createHubSpotCompany = companyMod.createHubSpotCompany;
});

after(() => {
  if (prevUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
  if (prevKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
});

beforeEach(() => {
  // El caché de `ensureHubSpotSellUpCreatedPropertyCached` es estado module-level compartido
  // por TODO este archivo de test (varios casos, mismo `objectType` en algunos). Sin resetear,
  // el segundo caso de 'contacts' encontraría el caché ya poblado por el primero y el GET de
  // verificación jamás se repetiría, invalidando el escenario de fallo.
  resetHubSpotPropertyEnsureCacheForTests();
});

afterEach(() => {
  if (origFetch) {
    globalThis.fetch = origFetch;
    origFetch = null;
  }
});

describe('createHubSpotContact / createHubSpotCompany — cablean sellup_created (Task D2)', () => {
  it('createHubSpotContact: éxito del ensure (GET 200) -> sellup_created:"true" en el POST real', async () => {
    let captured: Record<string, unknown> | undefined;
    installFetch('contacts', {
      propertyCheckStatus: 200,
      onCreatePost: (props) => {
        captured = props;
      },
      createId: 'hs-contact-ok',
    });

    const result = await createHubSpotContact({
      email: 'wiring-success@example.com',
      firstname: null,
      lastname: null,
      jobtitle: null,
      phone: null,
      mobilePhone: null,
    });

    assert.ok('id' in result, `expected success, got ${JSON.stringify(result)}`);
    assert.equal((result as { id: string }).id, 'hs-contact-ok');
    assert.ok(captured, 'the create POST should have been called');
    assert.equal(captured!.sellup_created, 'true');
  });

  it('createHubSpotContact: fallo del ensure (GET 500) -> el contacto se crea igual, sin sellup_created', async () => {
    let captured: Record<string, unknown> | undefined;
    installFetch('contacts', {
      propertyCheckStatus: 500,
      onCreatePost: (props) => {
        captured = props;
      },
      createId: 'hs-contact-degraded',
    });

    const result = await createHubSpotContact({
      email: 'wiring-degraded@example.com',
      firstname: null,
      lastname: null,
      jobtitle: null,
      phone: null,
      mobilePhone: null,
    });

    assert.ok('id' in result, `un ensure fallido NUNCA debe bloquear la creación, got ${JSON.stringify(result)}`);
    assert.equal((result as { id: string }).id, 'hs-contact-degraded');
    assert.ok(captured, 'the create POST should have been called');
    assert.equal('sellup_created' in captured!, false, 'sellup_created debe estar AUSENTE, no en false');
  });

  it('createHubSpotCompany: éxito del ensure (GET 200) -> sellup_created:"true" en el POST real', async () => {
    let captured: Record<string, unknown> | undefined;
    installFetch('companies', {
      propertyCheckStatus: 200,
      onCreatePost: (props) => {
        captured = props;
      },
      createId: 'hs-company-ok',
    });

    const result = await createHubSpotCompany({ name: 'Acme Wiring Test Inc' });

    assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result)}`);
    assert.ok(captured, 'the create POST should have been called');
    assert.equal(captured!.sellup_created, 'true');
    // Cruce con el payload que el propio resultado audita, no sólo con lo capturado en fetch.
    assert.equal((result as { properties_sent: Record<string, unknown> }).properties_sent.sellup_created, 'true');
  });

  it('createHubSpotCompany: fallo del ensure (POST de esquema 403) -> la empresa se crea igual, sin sellup_created', async () => {
    let captured: Record<string, unknown> | undefined;
    installFetch('companies', {
      propertyCheckStatus: 404,
      propertyCreateFails: true,
      onCreatePost: (props) => {
        captured = props;
      },
      createId: 'hs-company-degraded',
    });

    const result = await createHubSpotCompany({ name: 'Acme Degraded Test Inc' });

    assert.equal(result.ok, true, `un ensure fallido NUNCA debe bloquear la creación, got ${JSON.stringify(result)}`);
    assert.ok(captured, 'the create POST should have been called');
    assert.equal('sellup_created' in captured!, false, 'sellup_created debe estar AUSENTE, no en false');
    assert.equal(
      'sellup_created' in (result as { properties_sent: Record<string, unknown> }).properties_sent,
      false,
    );
  });
});
