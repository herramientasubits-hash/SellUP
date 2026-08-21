/**
 * Tests — estados de carga del detalle de candidato
 * (AGENT2A-PROD-INCIDENT · incidente A, candidate detail).
 *
 * Incidente de Producción: al abrir un candidato, el drawer mostraba
 * «Candidato no disponible» / «No fue posible cargar el detalle del candidato.».
 *
 * El defecto de DIAGNÓSTICO: el cargador tenía UN solo estado (`notFound`) para
 * dos hechos distintos, y un `catch {}` vacío que descartaba el error.
 *
 *   · la lectura funcionó y el candidato ya salió de `pending_review`
 *     → informativo, esperado, nada que arreglar
 *   · la lectura FALLÓ
 *     → fallo real, accionable, y lo que hay que diagnosticar
 *
 * Los dos se leían EXACTAMENTE igual en pantalla y ninguno dejaba rastro, así que
 * la causa raíz no se podía sacar de Producción. Estos tests fijan la distinción.
 *
 * Casos cubiertos (§ 14 del brief):
 *   A. candidato en `pending_review` ⇒ carga y se ve
 *   B. candidato ausente (null) ⇒ estado tipado «no disponible», sin culpar a un fallo
 *   C. la lectura lanza ⇒ estado tipado de ERROR, distinto del anterior
 *   D. los dos estados NO comparten copy
 *   E. el rastro para diagnosticar lo emite el SERVIDOR, no el componente
 *   F. ninguno de los dos copys filtra stack, SQL, proveedor ni PII
 *   G. cambiar de candidato limpia el estado del anterior
 *
 * Antes del fix fallan B, C, E y G: los dos casos caían en el mismo `notFound`,
 * con el mismo copy, y el error se perdía en un `catch {}` vacío.
 *
 * El rastro NO se emite desde este componente a propósito: maneja teléfonos
 * revelados y tiene prohibido escribir en consola (PHONE-3D.4 / 3D.6B lo fijan
 * leyendo su código fuente). Vive en `getReviewableContactCandidateById`, que es
 * además el lado que queda en los logs de Producción.
 *
 * El server action está mockeado: 0 servidor, 0 DB, 0 proveedores, 0 créditos.
 * Datos 100 % ficticios. Requiere --experimental-test-module-mocks.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap ──────────────────────────────────────────────────────────

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
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import {
  CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY,
  CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY,
  CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY,
  CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY,
} from '../contact-candidate-detail-load-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

let getByIdImpl: () => Promise<PendingContactCandidate | null> = async () => null;
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>(() => getByIdImpl());

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: () => mockGetById(),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: { revealCandidatePhoneAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/phone-reveal-manual-recovery-actions', {
  namedExports: { recoverCandidatePhoneRevealNowAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/lusha-phone-fallback-actions', {
  namedExports: { revealCandidatePhoneViaLushaFallbackAction: async () => ({ ok: true }) },
});
mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    startPhoneRevealWaterfallAction: async () => ({ ok: true }),
    getPhoneRevealWaterfallAuditAction: async () => null,
  },
});
mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions', {
  namedExports: { startLegacyPhoneRevealWaterfallAction: async () => ({ ok: true }) },
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

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures (datos 100 % ficticios) ─────────────────────────────────────────

const FAKE_CANDIDATE_ID = 'cand-ficticio-1';
const FAKE_FULL_NAME = 'Contacto De Prueba';

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: FAKE_CANDIDATE_ID,
    full_name: FAKE_FULL_NAME,
    title: 'Cargo de prueba',
    email: 'ficticio@ejemplo.test',
    linkedin_url: null,
    source_contact_id: 'sc-ficticio',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-ficticio',
    created_at: '2026-08-01T00:00:00.000Z',
    phone_reveal_status: null,
    phone_reveal_last_checked_at: null,
    phone_reveal_requested_at: null,
    phone_reveal_recovery_id_present: false,
    phone_reveal_provider: null,
    company_name: 'Empresa Ficticia SAS',
    company_domain: 'empresa-ficticia.test',
    account_id: 'account-ficticio',
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

/** Lee un archivo del repo para las invariantes estáticas (sin importarlo). */
async function readSource(relativePath: string): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const { resolve } = await import('node:path');
  return await readFile(resolve(process.cwd(), relativePath), 'utf8');
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
  }
}

function seen(text: string): boolean {
  return screen.queryAllByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
    .length > 0;
}

// ── Captura de `console.error` (observabilidad) ───────────────────────────────

type ErrorCall = unknown[];
let errorCalls: ErrorCall[] = [];
let originalConsoleError: typeof console.error;

describe('AGENT2A-PROD-INCIDENT — estados de carga del detalle de candidato', () => {
  before(async () => {
    const rtl = await import('@testing-library/react');
    render = rtl.render;
    screen = rtl.screen;
    cleanup = rtl.cleanup;
    act = rtl.act;
    ContactCandidateDetailSheet = (await import('../contact-candidate-detail-sheet'))
      .ContactCandidateDetailSheet;
  });

  beforeEach(() => {
    mockGetById.mock.resetCalls();
    errorCalls = [];
    originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errorCalls.push(args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
    cleanup();
  });

  it('A. candidato en pending_review ⇒ carga y se ve', async () => {
    getByIdImpl = async () => makeCandidate();

    render(
      <ContactCandidateDetailSheet
        open
        candidateId={FAKE_CANDIDATE_ID}
        onClose={() => {}}
      />,
    );
    await settle();

    assert.ok(seen(FAKE_FULL_NAME), 'el candidato debe renderizarse');
    assert.equal(seen(CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY), false);
    assert.equal(seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY), false);
  });

  it('B. candidato ausente ⇒ estado tipado «no disponible»', async () => {
    getByIdImpl = async () => null;

    render(
      <ContactCandidateDetailSheet
        open
        candidateId={FAKE_CANDIDATE_ID}
        onClose={() => {}}
      />,
    );
    await settle();

    assert.ok(seen(CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY));
    assert.ok(seen(CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY));
    assert.equal(
      seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY),
      false,
      'una lectura correcta NO debe presentarse como fallo de carga',
    );
  });

  it('C. la lectura lanza ⇒ estado tipado de ERROR, distinto del ausente', async () => {
    getByIdImpl = async () => {
      throw new Error('getReviewableContactCandidateById: boom');
    };

    render(
      <ContactCandidateDetailSheet
        open
        candidateId={FAKE_CANDIDATE_ID}
        onClose={() => {}}
      />,
    );
    await settle();

    assert.ok(
      seen(CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY),
      'un fallo de lectura debe decir que NO se pudo cargar',
    );
    assert.ok(seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY));
    assert.equal(
      seen(CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY),
      false,
      'un fallo de lectura NO debe afirmar que el candidato salió de revisión',
    );
  });

  it('D. los dos estados no comparten copy', () => {
    assert.notEqual(
      CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY,
      CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY,
    );
    assert.notEqual(
      CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY,
      CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY,
    );
    // Solo el fallo real invita a reintentar.
    assert.ok(/intenta nuevamente/i.test(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY));
    assert.equal(/intenta nuevamente/i.test(CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY), false);
  });

  it('E. el rastro del fallo lo emite el SERVIDOR, no el componente', async () => {
    // El componente maneja teléfonos revelados y tiene prohibido escribir en
    // consola (PHONE-3D.4 / 3D.6B lo fijan leyendo su código fuente). Por eso el
    // rastro para diagnosticar vive en el server action, que es además el lado
    // que queda en los logs de Producción.
    getByIdImpl = async () => {
      throw new Error('getReviewableContactCandidateById: permission denied');
    };

    render(
      <ContactCandidateDetailSheet
        open
        candidateId={FAKE_CANDIDATE_ID}
        onClose={() => {}}
      />,
    );
    await settle();

    assert.equal(
      errorCalls.length,
      0,
      'el componente no debe escribir en consola: la prohibición es deliberada',
    );
    // Y aun sin imprimir nada, el fallo NO queda invisible para la operadora.
    assert.ok(seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY));

    // El rastro server-side: se comprueba sobre el código del action, igual que
    // el resto de invariantes estáticas de este módulo.
    const actionsCode = await readSource('src/modules/contact-enrichment/actions.ts');
    const logCall =
      /console\.error\(\s*'\[getReviewableContactCandidateById\] read_failed'[\s\S]{0,400}?\}\s*\);/.exec(
        actionsCode,
      );
    assert.ok(logCall, 'el fallo de lectura debe dejar rastro en el servidor');
    const logged = logCall[0];
    assert.ok(/candidateId/.test(logged), 'el id correlaciona el fallo');
    assert.ok(/error\.code/.test(logged), 'el código del error es lo que permite clasificarlo');
    // El rastro NO debe volcar la fila: la proyección lleva nombre, email y teléfono.
    for (const pii of ['data', 'full_name', 'email', 'phone']) {
      assert.equal(
        new RegExp(`\\b${pii}\\b`).test(logged),
        false,
        `el rastro no debe registrar «${pii}»: es PII o la fila entera`,
      );
    }
  });

  it('F. ningún copy filtra detalles internos', () => {
    for (const copy of [
      CANDIDATE_DETAIL_NOT_FOUND_TITLE_COPY,
      CANDIDATE_DETAIL_NOT_FOUND_BODY_COPY,
      CANDIDATE_DETAIL_LOAD_ERROR_TITLE_COPY,
      CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY,
    ]) {
      for (const leak of ['select ', 'PGRST', 'permission denied', 'supabase', 'apollo', 'lusha']) {
        assert.equal(
          copy.toLowerCase().includes(leak.toLowerCase()),
          false,
          `«${copy}» no debe contener «${leak}»`,
        );
      }
    }
  });

  it('G. cambiar de candidato limpia el estado del anterior', async () => {
    getByIdImpl = async () => {
      throw new Error('boom');
    };

    const { rerender } = render(
      <ContactCandidateDetailSheet
        open
        candidateId={FAKE_CANDIDATE_ID}
        onClose={() => {}}
      />,
    );
    await settle();
    assert.ok(seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY));

    // El siguiente candidato SÍ carga: el error del anterior no debe sobrevivir.
    getByIdImpl = async () => makeCandidate({ id: 'cand-ficticio-2' });
    await act(async () => {
      rerender(
        <ContactCandidateDetailSheet
          open
          candidateId="cand-ficticio-2"
          onClose={() => {}}
        />,
      );
    });
    await settle();

    assert.ok(seen(FAKE_FULL_NAME), 'el candidato nuevo debe renderizarse');
    assert.equal(
      seen(CANDIDATE_DETAIL_LOAD_ERROR_BODY_COPY),
      false,
      'el fallo del candidato anterior no debe arrastrarse',
    );
  });
});
