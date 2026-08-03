/**
 * wizard-run-provider-payload-static.test.ts — contrato de lo que el CLIENTE envía.
 *
 * A1-APOLLO-QA-CONTROL-SURFACE-1 · § 3, § 6, § 11 · casos 6, 7, 11 y 30.
 *
 * Estos son invariantes de CÓDIGO FUENTE, no de render: la garantía que interesa
 * es que el wizard no pueda enviar autoridad ni decisiones de servidor, y que la
 * elección de proveedor no sobreviva a una corrida. Un test de render puede pasar
 * mientras el archivo gana una línea que escribe la selección en `localStorage`;
 * un escaneo del fuente no.
 *
 * Se complementa con el schema real (`.strict()`), que es la defensa efectiva.
 *   LIVE_APOLLO_CALLS = 0 · APOLLO_CREDITS_USED = 0 · PRODUCTION_WRITES = 0
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { wizardExecutionRequestSchema } from '@/modules/prospect-batches/chat-wizard-execution/wizard-execution-schema';

const WIZARD_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  'utf8',
);

const SELECTOR_SOURCE = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/components/prospect-batches/chat-wizard/wizard-run-provider-selector.tsx',
  ),
  'utf8',
);

/**
 * Quita comentarios de línea y de bloque.
 *
 * Necesario porque los comentarios de estos archivos NOMBRAN a propósito lo que
 * está prohibido («nunca en localStorage, cookies…»), y un escaneo ingenuo
 * confundiría la documentación de la regla con su violación.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const WIZARD_CODE = stripComments(WIZARD_SOURCE);
const SELECTOR_CODE = stripComments(SELECTOR_SOURCE);

const VALID_REQUEST = {
  clientRequestId: '423e4567-e89b-12d3-a456-426614174003',
  countryCode: 'CO',
  industryId: '223e4567-e89b-12d3-a456-426614174001',
  subindustryIds: ['323e4567-e89b-12d3-a456-426614174002'],
  catalogVersion: 'v2024-01',
  additionalCriteriaRaw: null,
};

describe('§ 6 · caso 7 — el cliente sólo puede enviar la PETICIÓN', () => {
  it('el wizard envía requestedDiscoveryProvider', () => {
    assert.ok(
      WIZARD_SOURCE.includes('requestedDiscoveryProvider: requestedProvider'),
      'la solicitud debe llevar la petición del administrador',
    );
  });

  it('NUNCA envía decisiones ni autoridad del servidor', () => {
    // Se buscan como CAMPOS enviados (`nombre:`), no como palabras en comentarios:
    // los comentarios del archivo nombran a propósito lo que está prohibido.
    const forbiddenFields = [
      'resolvedDiscoveryProvider:',
      'providerResolutionReason:',
      'isAdmin:',
      'providerAuthorized:',
      'authority:',
      'overrideAllowed:',
    ];
    const actionCall = WIZARD_SOURCE.slice(
      WIZARD_SOURCE.indexOf('executeProspectWizardGenerationAction({'),
      WIZARD_SOURCE.indexOf('// § 10 — la fuente del indicador es el servidor'),
    );
    assert.ok(actionCall.length > 0, 'no se localizó la llamada a la acción');

    for (const field of forbiddenFields) {
      assert.ok(
        !actionCall.includes(field),
        `la solicitud no debe llevar "${field}" — pertenece al servidor`,
      );
    }
  });

  it('caso 11 — el schema rechaza cualquier campo de autoridad del cliente', () => {
    const forbidden = [
      { isAdmin: true },
      { providerAuthorized: true },
      { authority: 'admin' },
      { overrideAllowed: true },
      { resolvedDiscoveryProvider: 'apollo_organizations' },
      { providerResolutionReason: 'run_level_override_authorized' },
    ];
    for (const extra of forbidden) {
      const parsed = wizardExecutionRequestSchema.safeParse({
        ...VALID_REQUEST,
        requestedDiscoveryProvider: 'apollo_organizations',
        ...extra,
      });
      assert.equal(
        parsed.success,
        false,
        `el schema debe rechazar ${JSON.stringify(extra)}`,
      );
    }
  });

  it('el schema acepta exactamente la forma que el wizard envía', () => {
    const withRequest = wizardExecutionRequestSchema.safeParse({
      ...VALID_REQUEST,
      requestedDiscoveryProvider: 'apollo_organizations',
    });
    assert.equal(withRequest.success, true);

    // Y sin el campo: la forma de un wizard que nadie tocó (§ 3).
    const withoutRequest = wizardExecutionRequestSchema.safeParse(VALID_REQUEST);
    assert.equal(withoutRequest.success, true);
    assert.equal(
      withoutRequest.success && withoutRequest.data.requestedDiscoveryProvider,
      undefined,
    );
  });
});

describe('§ 3 · el campo se omite cuando nadie tocó el selector', () => {
  it('la petición viaja condicionada a que exista una selección explícita', () => {
    assert.ok(
      WIZARD_SOURCE.includes('...(requestedProvider !== undefined'),
      'el campo debe omitirse —no enviarse como "tavily"— cuando no hubo selección',
    );
  });

  it('el estado inicial de la selección es undefined', () => {
    assert.match(
      WIZARD_SOURCE,
      /useState<\s*WizardRunSelectableProvider \| undefined\s*>\(undefined\)/,
    );
  });
});

describe('§ 3 · caso 6 — una corrida nueva vuelve a Tavily', () => {
  it('la selección se limpia al acuñar un clientRequestId nuevo', () => {
    const mintBlock = WIZARD_SOURCE.slice(
      WIZARD_SOURCE.indexOf('if (!clientRequestIdRef.current) {'),
      WIZARD_SOURCE.indexOf("dispatch({ type: 'VALIDATION_SUCCEEDED' });"),
    );
    assert.ok(mintBlock.includes('clientRequestIdRef.current = crypto.randomUUID();'));
    assert.ok(
      mintBlock.includes('setRequestedProvider(undefined);'),
      'una corrida nueva debe volver al predeterminado',
    );
    assert.ok(mintBlock.includes('setRunResolvedProvider(null);'));
    assert.ok(mintBlock.includes('setTwoRoundOutcome(null);'));
  });

  it('la selección NO se persiste en ningún almacenamiento del navegador', () => {
    // § 3 prohíbe explícitamente localStorage, cookies, perfil y configuración
    // global: recordar Apollo entre corridas convertiría una prueba puntual en el
    // default silencioso del wizard.
    for (const sink of ['localStorage', 'sessionStorage', 'document.cookie', 'indexedDB']) {
      assert.ok(
        !WIZARD_CODE.includes(sink),
        `el wizard no debe tocar ${sink} para la selección de proveedor`,
      );
      assert.ok(!SELECTOR_CODE.includes(sink), `el selector no debe tocar ${sink}`);
    }
  });
});

describe('§ 2/§ 30 · el selector no lee flags ni env', () => {
  it('el componente no accede a process.env ni a variables NEXT_PUBLIC_', () => {
    assert.ok(!SELECTOR_CODE.includes('process.env'));
    assert.ok(!SELECTOR_CODE.includes('NEXT_PUBLIC_'));
  });

  it('el componente no importa helpers de feature flags', () => {
    assert.ok(!SELECTOR_CODE.includes('feature-flags'));
  });

  it('se autocensura cuando no hay capacidad, antes de renderizar nada', () => {
    assert.ok(
      SELECTOR_SOURCE.includes('if (!capability.canSelectDiscoveryProvider) return null;'),
    );
  });
});
