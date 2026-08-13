/**
 * Tests — sincronización del drawer y trazabilidad de proveedor
 * (Agente 2A · AGENT2A-PHONE-REVEAL-UI-STATE-1)
 *
 * Incidente que motiva el hito (Production): el caso YA estaba terminal en base
 * (`phone_reveal_status = no_phone_found`, `phone_reveal_provider = apollo`,
 * `webhook_received_at = completed_at`) y el drawer seguía mostrando
 * "Revelación en proceso" con el aviso «Apollo aún está procesando el resultado».
 * El backend, el webhook y el recovery funcionaron bien: el defecto era de UI.
 *
 * Casos cubiertos aquí (§ 12 del brief):
 *   A. drawer obsoleto tras el webhook → reabrir muestra el estado terminal
 *   B. el estado terminal del servidor gana sobre el aviso local
 *   C. cambiar de candidato no arrastra avisos del anterior
 *   D. refresco al recuperar el foco / la visibilidad (0 proveedores)
 *   E. debounce: varias señales seguidas no producen una ráfaga
 *   F. agotado el presupuesto: sin spinner infinito, con copy honesto
 *   G. actualizar desde la base: 0 llamadas a proveedor, 0 créditos, 0 escrituras
 *   H. proveedores separados: fuente del candidato ≠ proveedor de revelación
 *   I. sin intento de revelación no se muestra proveedor (no se infiere)
 *   K. flag OFF: one-click Apollo, CTA manual de Lusha tras `no_phone_found`
 *   L. flag ON: modal del waterfall, sin CTA manual separado de Lusha
 *
 * Los server actions están mockeados: no toca servidor, DB, Apollo, Lusha ni
 * HubSpot. Todos los datos son ficticios. Timers falsos donde hace falta.
 *
 * Requiere --experimental-test-module-mocks (mock.module).
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (mismo patrón que los tests 3D.4 / L3 / live-refresh) ─────

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

/**
 * `visibilityState` es de solo lectura en jsdom: se redefine para poder simular
 * "la pestaña volvió a estar visible" sin tocar la implementación del hook.
 */
let visibilityStateValue: 'visible' | 'hidden' = 'visible';
Object.defineProperty(dom.window.document, 'visibilityState', {
  configurable: true,
  get: () => visibilityStateValue,
});

// ── Imports dependientes del entorno DOM ─────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import {
  PHONE_REVEAL_LIVE_REFRESH_COPY,
  PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS,
} from '../phone-reveal-live-refresh-core';
import {
  PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY,
  PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS,
} from '../phone-reveal-drawer-sync-core';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let act: (typeof import('@testing-library/react'))['act'];

// ── Mocks de boundary ────────────────────────────────────────────────────────

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockReveal = mock.fn<(input: unknown) => Promise<unknown>>();
const mockRecoverNow = mock.fn<(input: unknown) => Promise<unknown>>();
const mockLushaFallback = mock.fn<(input: unknown) => Promise<unknown>>();
const mockStartWaterfall = mock.fn<(input: unknown) => Promise<unknown>>();
const mockStartLegacyWaterfall = mock.fn<(input: unknown) => Promise<unknown>>();
const mockGetWaterfallAudit = mock.fn<(input: unknown) => Promise<unknown>>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    approveContactCandidate: async () => ({ ok: true }),
    discardContactCandidate: async () => ({ ok: true }),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-actions', {
  namedExports: {
    revealCandidatePhoneAction: (...args: unknown[]) => mockReveal(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-manual-recovery-actions', {
  namedExports: {
    recoverCandidatePhoneRevealNowAction: (...args: unknown[]) =>
      mockRecoverNow(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/lusha-phone-fallback-actions', {
  namedExports: {
    runLushaPhoneFallbackRevealAction: (...args: unknown[]) =>
      mockLushaFallback(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-actions', {
  namedExports: {
    startPhoneRevealWaterfallAction: (...args: unknown[]) =>
      mockStartWaterfall(...(args as [unknown])),
    getPhoneRevealWaterfallAuditAction: (...args: unknown[]) =>
      mockGetWaterfallAudit(...(args as [unknown])),
  },
});

mock.module('@/modules/contact-enrichment/phone-reveal-waterfall-legacy-actions', {
  namedExports: {
    startLegacyPhoneRevealWaterfallAction: (...args: unknown[]) =>
      mockStartLegacyWaterfall(...(args as [unknown])),
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

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures (datos 100 % ficticios) ─────────────────────────────────────────

const FAKE_PHONE = '+570000000000';
const STILL_PENDING_NOTICE_FRAGMENT = 'Apollo aún está procesando el resultado';
const IN_FLIGHT_BADGE = 'Revelación en proceso';

function agoIso(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-sync',
    full_name: 'Contacto De Prueba',
    title: 'Cargo de prueba',
    email: 'ficticio@ejemplo.test',
    linkedin_url: null,
    source_contact_id: 'sc-1',
    phone: null,
    source: 'apollo',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-sync',
    created_at: '2026-07-30T11:00:00.000Z',
    phone_reveal_status: 'requested',
    // 600 s ⇒ la ventana del CTA manual L3 (2 min) ya está abierta.
    phone_reveal_requested_at: agoIso(600),
    phone_reveal_recovery_id_present: true,
    company_name: 'Empresa De Prueba',
    company_domain: 'ejemplo.test',
    account_id: 'acct-1',
    hubspot_company_id: null,
    ...overrides,
  };
}

function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

interface SheetProps {
  candidateId?: string;
  open?: boolean;
  phoneRevealEnabled?: boolean;
  phoneRevealAuthorized?: boolean;
  lushaPhoneFallbackEnabled?: boolean;
  lushaPhoneFallbackAuthorized?: boolean;
  phoneRevealWaterfallEnabled?: boolean;
  phoneRevealWaterfallAuthorized?: boolean;
}

function sheet(props: SheetProps = {}) {
  return (
    <ContactCandidateDetailSheet
      candidateId={props.candidateId ?? 'cand-sync'}
      open={props.open ?? true}
      onClose={() => {}}
      phoneRevealEnabled={props.phoneRevealEnabled ?? true}
      phoneRevealAuthorized={props.phoneRevealAuthorized ?? true}
      lushaPhoneFallbackEnabled={props.lushaPhoneFallbackEnabled ?? false}
      lushaPhoneFallbackAuthorized={props.lushaPhoneFallbackAuthorized ?? false}
      phoneRevealWaterfallEnabled={props.phoneRevealWaterfallEnabled ?? false}
      phoneRevealWaterfallAuthorized={props.phoneRevealWaterfallAuthorized ?? false}
    />
  );
}

async function mountWith(candidate: PendingContactCandidate, props: SheetProps = {}) {
  mockGetById.mock.mockImplementation(async () => candidate);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(sheet({ candidateId: candidate.id, ...props }));
  });
  await flush();
  assert.ok(bodyText().includes(candidate.full_name), 'el candidato debe estar cargado');
  return result;
}

/** Cuántas veces se llamó a algún proveedor / acción de gasto. */
function providerCallCount(): number {
  return (
    mockReveal.mock.callCount() +
    mockRecoverNow.mock.callCount() +
    mockLushaFallback.mock.callCount() +
    mockStartWaterfall.mock.callCount() +
    mockStartLegacyWaterfall.mock.callCount()
  );
}

// ── Setup/Teardown ──────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, cleanup, act } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  cleanup();
  visibilityStateValue = 'visible';
  for (const m of [
    mockGetById,
    mockReveal,
    mockRecoverNow,
    mockLushaFallback,
    mockStartWaterfall,
    mockStartLegacyWaterfall,
    mockGetWaterfallAudit,
  ]) {
    m.mock.resetCalls();
  }
  mockGetWaterfallAudit.mock.mockImplementation(async () => null);
  mockRecoverNow.mock.mockImplementation(async () => ({
    status: 'still_pending',
    retryAfterSeconds: null,
  }));
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// A. Drawer obsoleto tras el webhook
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · A — drawer obsoleto tras el webhook', () => {
  it('reabrir el candidato muestra el estado terminal persistido', async () => {
    // Render inicial: en vuelo. El usuario pulsa la revisión manual y Apollo
    // responde "todavía procesando", así que queda el aviso local.
    const { unmount } = await mountWith(makeCandidate());
    await act(async () => {
      screen.getByRole('button', { name: 'Revisar resultado ahora' }).click();
    });
    await flush();
    assert.ok(
      bodyText().includes(STILL_PENDING_NOTICE_FRAGMENT),
      'el aviso de espera debe estar visible antes del webhook',
    );

    // El webhook aterriza DESPUÉS y cierra el caso en base.
    unmount();
    const terminal = makeCandidate({ phone_reveal_status: 'no_phone_found' });
    await mountWith(terminal);

    const text = bodyText();
    assert.ok(
      text.includes('Teléfono no disponible tras consultar Apollo'),
      'debe mostrarse el resultado terminal',
    );
    assert.ok(
      !text.includes(STILL_PENDING_NOTICE_FRAGMENT),
      'el aviso de espera NO debe sobrevivir al remount',
    );
    assert.ok(!text.includes(IN_FLIGHT_BADGE), 'el spinner en vuelo debe desaparecer');
  });
});

// ═══════════════════════════════════════════════════════════════
// B. El estado terminal del servidor gana sobre el aviso local
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · B — el estado terminal prevalece', () => {
  for (const status of ['revealed', 'no_phone_found', 'error'] as const) {
    it(`limpia el aviso local cuando el servidor pasa a ${status}`, async () => {
      let current = makeCandidate();
      mockGetById.mock.mockImplementation(async () => current);
      await act(async () => {
        render(sheet());
      });
      await flush();

      // Se fija el aviso local de espera con la revisión manual.
      await act(async () => {
        screen.getByRole('button', { name: 'Revisar resultado ahora' }).click();
      });
      await flush();
      assert.ok(bodyText().includes(STILL_PENDING_NOTICE_FRAGMENT));

      // El servidor ya tiene el desenlace: el siguiente refetch lo trae.
      current = makeCandidate({
        phone_reveal_status: status,
        ...(status === 'revealed'
          ? {
              phone: FAKE_PHONE,
              enrichment_metadata: {
                phone: { number: FAKE_PHONE, type: 'mobile', source: 'apollo_reveal' },
              },
            }
          : {}),
      });
      // Volver a la pestaña provoca UNA lectura (§ 7) — sin timers ni proveedores.
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.Event('focus'));
      });
      await flush();

      const text = bodyText();
      assert.ok(
        !text.includes(STILL_PENDING_NOTICE_FRAGMENT),
        `el aviso debe limpiarse en ${status}`,
      );
      assert.ok(!text.includes(IN_FLIGHT_BADGE), `sin spinner en ${status}`);
      if (status === 'revealed') {
        assert.ok(text.includes(FAKE_PHONE), 'debe mostrar el teléfono revelado');
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// C. Cambio de candidato
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · C — cambio de candidato', () => {
  it('ningún aviso del candidato A aparece en el candidato B', async () => {
    const candidateA = makeCandidate({ id: 'cand-A', full_name: 'Candidato A Ficticio' });
    const candidateB = makeCandidate({
      id: 'cand-B',
      full_name: 'Candidato B Ficticio',
      phone_reveal_status: 'no_phone_found',
    });

    mockGetById.mock.mockImplementation(async (...args: unknown[]) =>
      args[0] === 'cand-B' ? candidateB : candidateA,
    );

    const { rerender } = render(sheet({ candidateId: 'cand-A' }));
    await flush();
    await act(async () => {
      screen.getByRole('button', { name: 'Revisar resultado ahora' }).click();
    });
    await flush();
    assert.ok(bodyText().includes(STILL_PENDING_NOTICE_FRAGMENT), 'aviso fijado en A');

    // El drawer NO se desmonta: sólo cambia el candidato. Antes, el estado local
    // sobrevivía porque la limpieza sólo corría en la rama `!open`.
    await act(async () => {
      rerender(sheet({ candidateId: 'cand-B' }));
    });
    await flush();

    const text = bodyText();
    assert.ok(text.includes('Candidato B Ficticio'), 'debe mostrar B');
    assert.ok(
      !text.includes(STILL_PENDING_NOTICE_FRAGMENT),
      'el aviso de A NO puede aparecer sobre B',
    );
    assert.ok(!text.includes(IN_FLIGHT_BADGE), 'B es terminal: sin spinner');
  });
});

// ═══════════════════════════════════════════════════════════════
// D + E. Refresco por foco / visibilidad, y su debounce
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · D — refresco por foco y visibilidad', () => {
  it('recuperar el foco relee el candidato exactamente una vez, sin proveedores', async () => {
    await mountWith(makeCandidate());
    const before = mockGetById.mock.callCount();

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event('focus'));
    });
    await flush();

    assert.equal(mockGetById.mock.callCount(), before + 1, '1 lectura de la base');
    assert.equal(providerCallCount(), 0, '0 llamadas a Apollo/Lusha');
  });

  it('volver a `visible` relee el candidato', async () => {
    await mountWith(makeCandidate());
    const before = mockGetById.mock.callCount();

    visibilityStateValue = 'visible';
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    await flush();

    assert.equal(mockGetById.mock.callCount(), before + 1);
    assert.equal(providerCallCount(), 0);
  });

  it('OCULTAR la pestaña no dispara ninguna lectura', async () => {
    await mountWith(makeCandidate());
    const before = mockGetById.mock.callCount();

    visibilityStateValue = 'hidden';
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    await flush();

    assert.equal(mockGetById.mock.callCount(), before, 'ocultar no es "el usuario volvió"');
  });

  it('con el drawer cerrado no se refresca nada', async () => {
    mockGetById.mock.mockImplementation(async () => makeCandidate());
    await act(async () => {
      render(sheet({ open: false }));
    });
    await flush();
    const before = mockGetById.mock.callCount();

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
    });
    await flush();

    assert.equal(mockGetById.mock.callCount(), before);
    assert.equal(providerCallCount(), 0);
  });
});

describe('UI-STATE-1 · E — debounce de las señales de ventana', () => {
  it('varias señales consecutivas producen UNA sola lectura', async () => {
    await mountWith(makeCandidate());
    const before = mockGetById.mock.callCount();

    // Cambiar de pestaña suele emitir `focus` y `visibilitychange` casi a la vez;
    // sin la ventana mínima cada una abriría su propia lectura.
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
      dom.window.dispatchEvent(new dom.window.Event('focus'));
    });
    await flush();

    assert.equal(
      mockGetById.mock.callCount(),
      before + 1,
      'cinco señales seguidas ⇒ una sola lectura',
    );
    assert.equal(providerCallCount(), 0);
  });

  it('la ventana mínima es positiva (no hay refresco libre)', () => {
    assert.ok(PHONE_REVEAL_WINDOW_REFRESH_MIN_INTERVAL_MS > 0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. Agotamiento del refresco automático
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · F — presupuesto agotado', () => {
  it('sustituye el copy de "actualizando" por el de agotado, sin spinner infinito', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      await mountWith(makeCandidate());
      assert.ok(
        bodyText().includes(PHONE_REVEAL_LIVE_REFRESH_COPY),
        'mientras el refresco vive, debe decirlo',
      );

      // Cada refetch programa el SIGUIENTE de forma asíncrona, así que un único
      // `tick` grande sólo dispararía el primero: hay que avanzar paso a paso hasta
      // que la cadena se detenga sola. Que el bucle termine por sí mismo es, además,
      // la prueba de que no hay polling infinito.
      const stepMs = PHONE_REVEAL_LIVE_REFRESH_MAX_DURATION_MS;
      const maxSteps = 40;
      let steps = 0;
      let previous = -1;
      while (steps < maxSteps && mockGetById.mock.callCount() !== previous) {
        previous = mockGetById.mock.callCount();
        await act(async () => {
          mock.timers.tick(stepMs);
          await Promise.resolve();
          await Promise.resolve();
          await Promise.resolve();
        });
        await flush();
        steps += 1;
      }
      assert.ok(steps < maxSteps, 'el refresco no puede ser un bucle infinito');

      const text = bodyText();
      assert.ok(
        !text.includes(PHONE_REVEAL_LIVE_REFRESH_COPY),
        'ya NO puede afirmar que está actualizando automáticamente',
      );
      assert.ok(
        text.includes(PHONE_REVEAL_LIVE_REFRESH_EXHAUSTED_COPY),
        'debe aparecer el copy honesto de agotamiento',
      );
      // El caso sigue abierto, así que el badge de "en proceso" sigue siendo cierto;
      // lo que ya no se afirma es que SellUp lo esté revisando.
      assert.equal(providerCallCount(), 0, 'agotarse no dispara ningún proveedor');
    } finally {
      mock.timers.reset();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// G. Actualizar desde la base
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · G — actualizar desde SellUp', () => {
  it('lee la base y NO llama a ningún proveedor', async () => {
    await mountWith(makeCandidate());
    const before = mockGetById.mock.callCount();

    await act(async () => {
      screen.getByRole('button', { name: 'Actualizar desde SellUp' }).click();
    });
    await flush();

    assert.equal(mockGetById.mock.callCount(), before + 1, '1 lectura de la base');
    assert.equal(providerCallCount(), 0, '0 proveedores, 0 créditos, 0 escrituras');
    assert.equal(
      mockRecoverNow.mock.callCount(),
      0,
      'NO es "Revisar resultado ahora": no hay recovery Apollo',
    );
  });

  it('su copy deja claro que no consulta proveedores', async () => {
    await mountWith(makeCandidate());
    assert.match(bodyText(), /No consulta a Apollo ni a Lusha y no consume créditos/);
  });

  it('es un control DISTINTO del de revisión manual', async () => {
    await mountWith(makeCandidate());
    // Los dos contratos coexisten y se distinguen: leer la base vs. consultar a
    // Apollo el resultado ya solicitado.
    assert.ok(screen.getByRole('button', { name: 'Actualizar desde SellUp' }));
    assert.ok(screen.getByRole('button', { name: 'Revisar resultado ahora' }));
  });
});

// ═══════════════════════════════════════════════════════════════
// H + I. Etiquetas de proveedor
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · H — fuente del candidato ≠ proveedor de revelación', () => {
  it('candidato Lusha revelado por Apollo muestra los dos ejes por separado', async () => {
    await mountWith(
      makeCandidate({
        source: 'lusha',
        source_contact_id: 'v1.token-ficticio',
        phone_reveal_status: 'no_phone_found',
        phone_reveal_provider: 'apollo',
      }),
    );

    const text = bodyText();
    assert.ok(text.includes('Fuente del candidato'), 'la etiqueta debe desambiguar la fuente');
    assert.ok(!/(^|[^a-z])Fuente:/i.test(text), 'ya no debe existir un «Fuente» pelado');
    assert.ok(text.includes('Proveedor de revelación'), 'debe declarar quién reveló');
    // El orden importa para la lectura: «Fuente del candidato: Lusha» y
    // «Proveedor de revelación: Apollo» tienen que convivir sin contradecirse.
    // `bodyText()` concatena label y valor sin separador propio, así que el
    // separador es opcional en el patrón.
    assert.match(text, /Fuente del candidato[:\s]*Lusha/);
    assert.match(text, /Proveedor de revelación[:\s]*Apollo/);
  });

  it('candidato Lusha revelado por Lusha también lo dice explícitamente', async () => {
    await mountWith(
      makeCandidate({
        source: 'lusha',
        source_contact_id: 'v1.token-ficticio',
        phone: FAKE_PHONE,
        phone_reveal_status: 'revealed',
        phone_reveal_provider: 'lusha',
        enrichment_metadata: {
          phone: { number: FAKE_PHONE, type: 'mobile', source: 'lusha_reveal' },
        },
      }),
    );
    assert.match(bodyText(), /Proveedor de revelación[:\s]*Lusha/);
  });
});

describe('UI-STATE-1 · I — sin intento de revelación', () => {
  it('no muestra proveedor de revelación y NO lo infiere de la fuente', async () => {
    await mountWith(
      makeCandidate({
        source: 'lusha',
        source_contact_id: 'v1.token-ficticio',
        phone_reveal_status: null,
        phone_reveal_provider: null,
      }),
    );

    const text = bodyText();
    assert.ok(text.includes('Fuente del candidato'), 'la fuente sí se muestra');
    assert.ok(
      !text.includes('Proveedor de revelación'),
      'sin intento no puede haber proveedor de revelación',
    );
  });

  it('un código de proveedor desconocido no se muestra crudo', async () => {
    await mountWith(makeCandidate({ phone_reveal_provider: 'proveedor_futuro' }));
    const text = bodyText();
    assert.ok(!text.includes('proveedor_futuro'), 'fail-closed: se omite, no se muestra crudo');
    assert.ok(!text.includes('Proveedor de revelación'));
  });
});

describe('UI-STATE-1 · § 8.3 — copy de consistencia de identidad', () => {
  it('no atribuye la identidad a un proveedor concreto', async () => {
    await mountWith(makeCandidate({ source: 'apollo' }));
    const text = bodyText();
    assert.ok(text.includes('Consistencia de identidad'));
    assert.match(
      text,
      /Compara la identidad del candidato encontrado por la fuente original con la identidad devuelta durante el enriquecimiento/,
    );
    assert.ok(
      !text.includes('la persona encontrada en Lusha'),
      'el copy anterior nombraba a Lusha incluso para candidatos Apollo',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// K + L. Comportamiento por flag
// ═══════════════════════════════════════════════════════════════

describe('UI-STATE-1 · K — waterfall OFF', () => {
  it('conserva el one-click de Apollo (sin modal)', async () => {
    mockReveal.mock.mockImplementation(async () => ({ status: 'requested' }));
    await mountWith(makeCandidate({ phone_reveal_status: null }), {
      phoneRevealWaterfallEnabled: false,
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Revelar teléfono' }).click();
    });
    await flush();

    assert.equal(mockReveal.mock.callCount(), 1, 'one-click: llama directo al reveal');
    assert.equal(mockStartWaterfall.mock.callCount(), 0, 'sin waterfall');
  });

  it('mantiene el CTA manual de Lusha tras un no_phone_found de Apollo', async () => {
    // Con el waterfall apagado esta salida histórica se CONSERVA: es la única forma
    // de llegar a Lusha, y retirarla ahora dejaría a esos candidatos sin ruta.
    await mountWith(
      makeCandidate({
        source: 'lusha',
        source_contact_id: 'v1.token-ficticio',
        phone_reveal_status: 'no_phone_found',
        phone_reveal_provider: 'apollo',
      }),
      {
        phoneRevealWaterfallEnabled: false,
        lushaPhoneFallbackEnabled: true,
        lushaPhoneFallbackAuthorized: true,
      },
    );
    assert.ok(
      bodyText().includes('Lusha'),
      'el CTA manual de Lusha sigue ofreciéndose con el flag OFF',
    );
  });
});

describe('UI-STATE-1 · L — waterfall ON', () => {
  // AGENT2A-PHONE-WATERFALL-4D: el modal desapareció. El botón EJECUTA en un clic, y
  // lo que ya no puede pasar es que el clic dispare una acción DISTINTA del START del
  // reveal (la corrida la abre el servidor dentro de esa misma acción).
  it('el botón ejecuta el START del reveal en un clic, sin acción intermedia', async () => {
    await mountWith(makeCandidate({ phone_reveal_status: null }), {
      phoneRevealWaterfallEnabled: true,
      phoneRevealWaterfallAuthorized: true,
    });

    // Antes del clic no se ha llamado a nada: abrir el drawer no gasta.
    assert.equal(mockReveal.mock.callCount(), 0);

    await act(async () => {
      screen.getByRole('button', { name: 'Revelar teléfono' }).click();
    });
    await flush();

    assert.equal(mockReveal.mock.callCount(), 1, 'un clic, una corrida');
    assert.equal(
      screen.queryByRole('button', { name: 'Confirmar y revelar' }),
      null,
      'no existe ninguna superficie de confirmación',
    );
    assert.equal(
      mockStartWaterfall.mock.callCount(),
      0,
      'el cliente no abre la corrida por su cuenta: lo hace el servidor en el START',
    );
  });

  it('no ofrece un CTA manual separado de Lusha', async () => {
    // La 2ª pata es automática y server-side: un botón manual reintroduciría el
    // segundo clic que el waterfall elimina, y permitiría gastar créditos Lusha
    // fuera de la corrida que los contabiliza.
    await mountWith(
      makeCandidate({
        source: 'lusha',
        source_contact_id: 'v1.token-ficticio',
        phone_reveal_status: 'no_phone_found',
        phone_reveal_provider: 'apollo',
      }),
      {
        phoneRevealWaterfallEnabled: true,
        phoneRevealWaterfallAuthorized: true,
        lushaPhoneFallbackEnabled: true,
        lushaPhoneFallbackAuthorized: true,
      },
    );
    assert.equal(
      screen.queryByRole('button', { name: /Revelar teléfono con Lusha/ }),
      null,
      'sin botón manual separado de Lusha',
    );
  });
});
