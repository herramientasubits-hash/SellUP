/**
 * Tests — el drawer del CONTACTO oficial SIEMPRE sale del estado de carga
 * (AGENT2A-P0-R2 · incidente A, contact detail).
 *
 * Incidente de QA (2026-08-13): al abrir un contacto, el drawer se quedaba en
 * «Cargando contacto...» con el spinner girando indefinidamente.
 *
 * La causa NO era la lectura. Era que el drawer sólo sabía pintar un estado —«no
 * hay contacto»— y lo usaba para tres hechos distintos. `loadData` no tenía
 * `catch`, y el render era `loading || !contact ? spinner`. Como el `finally` sí
 * bajaba `loading`, un fallo dejaba `contact` en `null`: la condición `!contact`
 * reponía el spinner y ya no quedaba nada que lo quitara. Un contacto
 * simplemente no encontrado caía en el mismo agujero, por el `if (!c) return`.
 *
 * Casos cubiertos (§ 13.B del brief):
 *   A. lectura correcta                    ⇒ sale de la carga y muestra el contacto
 *   B. contacto no encontrado (`null`)     ⇒ sale de la carga con estado «no disponible»
 *   C. la lectura RECHAZA                  ⇒ sale de la carga con estado de fallo + reintento
 *   D. «no encontrado» y «falló» NO son el mismo texto
 *   E. el contexto (auditoría/cuenta) que falla NO tumba el detalle
 *   F. el copy de fallo no filtra stack, SQL, proveedor ni PII
 *
 * Antes del fix, B, C, D y E fallan: el spinner se queda puesto.
 *
 * Los server actions están mockeados: 0 servidor, 0 DB, 0 proveedor, 0 créditos,
 * 0 HubSpot. Datos 100 % ficticios.
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que el resto de tests de UI del módulo) ─────

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

defineGlobal('window', dom.window);
defineGlobal('document', dom.window.document);
defineGlobal('navigator', dom.window.navigator);
defineGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function copyWindowPropsToGlobal(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  const source = dom.window as unknown as Record<string, unknown>;
  for (const prop of Object.getOwnPropertyNames(dom.window)) {
    if (prop in target) continue;
    const descriptor = Object.getOwnPropertyDescriptor(source, prop);
    if (descriptor) Object.defineProperty(target, prop, descriptor);
  }
}

copyWindowPropsToGlobal();

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? ResizeObserverStub;

if (!dom.window.matchMedia) {
  (dom.window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (
    query: string,
  ) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
(globalThis as unknown as { matchMedia: unknown }).matchMedia = dom.window.matchMedia;

for (const proto of [dom.window.HTMLElement.prototype, dom.window.Element.prototype]) {
  const p = proto as unknown as Record<string, unknown>;
  if (typeof p.hasPointerCapture !== 'function') p.hasPointerCapture = () => false;
  if (typeof p.setPointerCapture !== 'function') p.setPointerCapture = () => {};
  if (typeof p.releasePointerCapture !== 'function') p.releasePointerCapture = () => {};
  if (typeof p.scrollIntoView !== 'function') p.scrollIntoView = () => {};
}

// ── Imports dependientes del entorno DOM ─────────────────────────────────────

import * as React from 'react';
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTACT_DETAIL_LOADING_TITLE_COPY,
  CONTACT_DETAIL_NOT_FOUND_TITLE_COPY,
  CONTACT_DETAIL_NOT_FOUND_BODY_COPY,
  CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY,
  CONTACT_DETAIL_LOAD_ERROR_BODY_COPY,
  CONTACT_DETAIL_RETRY_COPY,
} from '../contact-detail-load-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Datos ficticios ──────────────────────────────────────────────────────────

const FAKE_CONTACT_ID = '00000000-0000-4000-8000-00000000c0a1';
const FAKE_ACCOUNT_ID = '00000000-0000-4000-8000-00000000acc1';
const FAKE_CONTACT_NAME = 'Persona Ficticia De Prueba';

const FAKE_CONTACT = {
  id: FAKE_CONTACT_ID,
  account_id: FAKE_ACCOUNT_ID,
  full_name: FAKE_CONTACT_NAME,
  job_title: 'Cargo Ficticio',
  email: null,
  phone: null,
  mobile_phone: null,
  linkedin_url: null,
  contact_status: 'active',
  role_in_account: null,
  is_primary: false,
  source: 'manual',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// ── Mocks de boundary ────────────────────────────────────────────────────────

type ContactImpl = () => Promise<unknown>;

/** Implementación intercambiable: `node:test` no tiene `mockImplementation`. */
let getContactByIdImpl: ContactImpl = async () => FAKE_CONTACT;
let getContactAuditImpl: ContactImpl = async () => [];
let getAccountByIdImpl: ContactImpl = async () => null;

mock.module('@/modules/contacts/actions', {
  namedExports: {
    getContactById: () => getContactByIdImpl(),
    getContactAudit: () => getContactAuditImpl(),
  },
});

mock.module('@/modules/accounts/actions', {
  namedExports: {
    getAccountById: () => getAccountByIdImpl(),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  },
});

mock.module('sonner', {
  namedExports: {
    toast: { success: () => {}, warning: () => {}, error: () => {}, info: () => {} },
  },
});

let ContactDetailSheet: (typeof import('../contact-detail-sheet'))['ContactDetailSheet'];

/** Deja que la microtask del action y los efectos se asienten. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }
}

function isStillLoading(): boolean {
  return (
    screen.queryAllByText(new RegExp(CONTACT_DETAIL_LOADING_TITLE_COPY, 'i')).length > 0
  );
}

function renderSheet(): void {
  render(
    React.createElement(ContactDetailSheet, {
      contactId: FAKE_CONTACT_ID,
      open: true,
      onClose: () => {},
    }),
  );
}

describe('AGENT2A-P0-R2 — el drawer del contacto siempre se asienta', () => {
  before(async () => {
    const rtl = await import('@testing-library/react');
    render = rtl.render;
    screen = rtl.screen;
    cleanup = rtl.cleanup;
    act = rtl.act;
    ContactDetailSheet = (await import('../contact-detail-sheet')).ContactDetailSheet;
  });

  beforeEach(() => {
    getContactByIdImpl = async () => FAKE_CONTACT;
    getContactAuditImpl = async () => [];
    getAccountByIdImpl = async () => null;
  });

  afterEach(() => {
    cleanup();
  });

  it('A. lectura correcta ⇒ sale de la carga y muestra el contacto', async () => {
    renderSheet();
    await settle();

    assert.equal(isStillLoading(), false, 'el spinner debe haberse ido');
    assert.ok(
      screen.queryAllByText(new RegExp(FAKE_CONTACT_NAME, 'i')).length > 0,
      'el nombre del contacto debe estar en pantalla',
    );
  });

  it('B. contacto no encontrado ⇒ sale de la carga con estado «no disponible»', async () => {
    // La lectura FUNCIONA y no devuelve fila. Antes del fix, el `if (!c) return`
    // dejaba `contact` en null y el render volvía al spinner para siempre.
    getContactByIdImpl = async () => null;

    renderSheet();
    await settle();

    assert.equal(isStillLoading(), false, 'un contacto ausente NO puede quedarse cargando');
    assert.ok(
      screen.queryAllByText(new RegExp(CONTACT_DETAIL_NOT_FOUND_TITLE_COPY, 'i')).length > 0,
      'debe declarar que el contacto no está disponible',
    );
    assert.ok(
      screen.queryAllByText(new RegExp(CONTACT_DETAIL_NOT_FOUND_BODY_COPY, 'i')).length > 0,
    );
  });

  it('C. la lectura RECHAZA ⇒ sale de la carga con estado de fallo y reintento', async () => {
    getContactByIdImpl = async () => {
      throw new Error('getContactById: fallo ficticio de lectura');
    };

    renderSheet();
    await settle();

    assert.equal(isStillLoading(), false, 'un fallo NO puede quedarse cargando');
    assert.ok(
      screen.queryAllByText(new RegExp(CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY, 'i')).length > 0,
      'debe declarar que la carga falló',
    );
    assert.ok(
      screen.queryAllByText(new RegExp(CONTACT_DETAIL_RETRY_COPY, 'i')).length > 0,
      'un fallo sí ofrece reintentar',
    );
  });

  it('D. «no encontrado» y «falló» NO se leen igual', async () => {
    // El defecto de diagnóstico que 4O-H3-B-R1 ya cerró en el drawer de CANDIDATO:
    // dos hechos distintos no pueden compartir pantalla.
    assert.notEqual(
      CONTACT_DETAIL_NOT_FOUND_TITLE_COPY,
      CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY,
    );
    assert.notEqual(
      CONTACT_DETAIL_NOT_FOUND_BODY_COPY,
      CONTACT_DETAIL_LOAD_ERROR_BODY_COPY,
    );

    // Y «no encontrado» no ofrece reintentar: insistir no va a traer el contacto.
    getContactByIdImpl = async () => null;
    renderSheet();
    await settle();
    assert.equal(
      screen.queryAllByText(new RegExp(`^${CONTACT_DETAIL_RETRY_COPY}$`, 'i')).length,
      0,
      'no-encontrado no debe ofrecer reintento',
    );
  });

  it('E. un contexto que falla NO tumba el detalle del contacto', async () => {
    // Auditoría y cuenta son COMPLEMENTARIOS. Que fallen no justifica esconder el
    // contacto que ya se leyó bien.
    getContactAuditImpl = async () => {
      throw new Error('getContactAudit: fallo ficticio');
    };
    getAccountByIdImpl = async () => {
      throw new Error('getAccountById: fallo ficticio');
    };

    renderSheet();
    await settle();

    assert.equal(isStillLoading(), false);
    assert.ok(
      screen.queryAllByText(new RegExp(FAKE_CONTACT_NAME, 'i')).length > 0,
      'el contacto sigue visible aunque su contexto falle',
    );
    assert.equal(
      screen.queryAllByText(new RegExp(CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY, 'i')).length,
      0,
      'un contexto que falla no es «no se pudo cargar el contacto»',
    );
  });

  it('F. el copy de fallo no filtra stack, SQL, proveedor ni PII', () => {
    const texts = [
      CONTACT_DETAIL_NOT_FOUND_TITLE_COPY,
      CONTACT_DETAIL_NOT_FOUND_BODY_COPY,
      CONTACT_DETAIL_LOAD_ERROR_TITLE_COPY,
      CONTACT_DETAIL_LOAD_ERROR_BODY_COPY,
    ];
    const forbidden = [
      /select\s/i,
      /supabase/i,
      /postgres/i,
      /apollo/i,
      /lusha/i,
      /hubspot/i,
      /\bat\s+\w+\s+\(/,
      /PGRST/i,
      /@/,
      /https?:\/\//i,
    ];
    for (const text of texts) {
      for (const pattern of forbidden) {
        assert.ok(
          !pattern.test(text),
          `el copy «${text}» no debe coincidir con ${pattern}`,
        );
      }
    }
  });
});
