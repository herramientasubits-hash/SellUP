/**
 * Tests — Person Identity Mismatch Override UI Contract Gate (Agente 2A · 17B.4W.8A)
 *
 * Prueba el contrato de UI del diálogo de override de discrepancia de identidad
 * (17B.4W.8) con render real de React (jsdom + @testing-library/react). NO toca
 * el servidor, NO llama proveedores, NO escribe en DB — todo mockeado.
 *
 * Requiere --experimental-test-module-mocks (mock.module) para interceptar
 * `@/modules/contact-enrichment/actions`, `next/navigation` y `sonner` antes de
 * importar el componente bajo prueba.
 *
 * Secciones:
 *   1 — CTA mismatch vs. CTA normal (consistent / insufficient_evidence / legacy)
 *   2 — Abrir diálogo al hacer click en la CTA de mismatch
 *   3 — Confirmar deshabilitado sin acknowledgement
 *   4 — Confirmar deshabilitado con motivo en blanco
 *   5 — Envío válido → payload exacto a approveContactCandidate
 *   6 — Resultado de servidor IDENTITY_MISMATCH_REQUIRES_REVIEW
 *   7 — Resultado de servidor IDENTITY_OVERRIDE_REASON_REQUIRED
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (el repo no tiene un entorno de componentes React previo) ──
// node:test no trae un "testEnvironment" como Jest; construimos uno mínimo
// copiando las globals de una ventana jsdom real antes de cargar React/RTL.

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});

function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

// window/document/navigator primero (configurables) para que la copia masiva
// de abajo los detecte como "ya presentes" y no choque con el getter propio
// que jsdom define para `window.window` (self-reference de solo lectura).
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

// Polyfills que jsdom no implementa y que primitivas de base-ui (Dialog/Sheet)
// consultan al montar/enfocar overlays.
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

// ── Imports que dependen del entorno DOM ──────────────────────────────────────
// `@testing-library/dom` calcula `screen` como una constante de módulo leyendo
// `typeof document` EN EL MOMENTO DEL IMPORT. Con TypeScript/esbuild los
// `import` estáticos de ESM se transpilan preservando su posición al compilar
// a CJS, pero el runtime de JSX automático (`jsx-runtime`) y otros imports
// estáticos podrían resolverse antes que el bootstrap si se declaran arriba.
// Por seguridad, todo lo que dependa de `document` (`@testing-library/react`
// y el propio componente bajo prueba) se importa dinámicamente en `before()`,
// después de que el bootstrap de jsdom ya corrió de forma síncrona arriba.

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type {
  PendingContactCandidate,
  LushaPersonIdentityEvidenceV1,
} from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary: server actions, router, toast ──────────────────────────
// Solo se mockean los límites exactos necesarios. Nada de red, nada de DB.

const mockApprove = mock.fn<
  (
    candidateId: string,
    identityOverride?: { acknowledged: boolean; reason: string },
  ) => Promise<{
    ok: boolean;
    message?: string;
    error?: string;
    duplicate?: boolean;
    code?: 'IDENTITY_MISMATCH_REQUIRES_REVIEW' | 'IDENTITY_OVERRIDE_REASON_REQUIRED';
  }>
>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockRouterRefresh = mock.fn<() => void>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getPendingContactCandidateById: (...args: unknown[]) =>
      mockGetById(...(args as [])),
    approveContactCandidate: (...args: [string, { acknowledged: boolean; reason: string }?]) =>
      mockApprove(...args),
    discardContactCandidate: (...args: unknown[]) => mockDiscard(...(args as [])),
  },
});

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ refresh: mockRouterRefresh, push: () => {}, replace: () => {} }),
  },
});

mock.module('sonner', {
  namedExports: {
    toast: {
      success: () => {},
      warning: () => {},
      error: () => {},
      info: () => {},
    },
  },
});

let ContactCandidateDetailSheet: (typeof import('../contact-candidate-detail-sheet'))['ContactCandidateDetailSheet'];

// ── Fixtures ───────────────────────────────────────────────────────────────────

function identityEvidence(
  identity_consistency: LushaPersonIdentityEvidenceV1['identity_consistency'],
): LushaPersonIdentityEvidenceV1 {
  return {
    prospect_contact_id: 'cid-A',
    prospect_full_name: 'Carolina Herrera',
    prospect_linkedin_url: null,
    enrich_contact_id: 'cid-A',
    enrich_full_name: 'Carol Herrera',
    enrich_linkedin_url: null,
    id_consistency: 'match',
    name_consistency: 'mismatch',
    identity_consistency,
  };
}

function makeCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-001',
    full_name: 'Carolina Herrera',
    title: 'VP de Ventas',
    email: 'carolina@empresa.com',
    linkedin_url: null,
    phone: null,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-001',
    created_at: '2026-07-08T00:00:00.000Z',
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acc-001',
    hubspot_company_id: null,
    ...overrides,
  };
}

async function renderWithCandidate(candidate: PendingContactCandidate) {
  mockGetById.mock.mockImplementation(async () => candidate);
  const onClose = mock.fn<() => void>();
  render(
    <ContactCandidateDetailSheet candidateId={candidate.id} open onClose={onClose} />,
  );
  // Espera a que resuelva el fetch async y pinte el nombre del candidato.
  // Usa getAllByText: en candidatos `mismatch` el nombre puede repetirse (título
  // + "Persona encontrada" en la tarjeta de consistencia de identidad).
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
  return { onClose };
}

// ── Setup/Teardown ─────────────────────────────────────────────────────────────

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockApprove.mock.resetCalls();
  mockDiscard.mock.resetCalls();
  mockGetById.mock.resetCalls();
  mockRouterRefresh.mock.resetCalls();
});

after(() => {
  cleanup();
});

// ── 1 — CTA mismatch vs. CTA normal ────────────────────────────────────────────

describe('1 — CTA de aprobación según identity_consistency', () => {
  it('1a mismatch → "Revisar y aprobar de todas formas" visible, sin CTA normal ejecutable', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);

    const overrideCta = screen.getByRole('button', {
      name: /Revisar y aprobar de todas formas/i,
    });
    assert.ok(overrideCta);

    const normalCtas = screen.queryAllByRole('button', { name: /^Aprobar candidato$/i });
    assert.equal(normalCtas.length, 0);

    cleanup();
  });

  it('1b consistent → CTA normal "Aprobar candidato", sin CTA de override', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('consistent') },
    });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
    assert.equal(
      screen.queryByRole('button', { name: /Revisar y aprobar de todas formas/i }),
      null,
    );

    cleanup();
  });

  it('1c insufficient_evidence → CTA normal "Aprobar candidato", sin CTA de override', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('insufficient_evidence') },
    });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
    assert.equal(
      screen.queryByRole('button', { name: /Revisar y aprobar de todas formas/i }),
      null,
    );

    cleanup();
  });

  it('1d legacy (sin person_identity) → CTA normal "Aprobar candidato", sin CTA de override', async () => {
    const candidate = makeCandidate({ enrichment_metadata: {} });
    await renderWithCandidate(candidate);

    assert.ok(screen.getByRole('button', { name: /^Aprobar candidato$/i }));
    assert.equal(
      screen.queryByRole('button', { name: /Revisar y aprobar de todas formas/i }),
      null,
    );

    cleanup();
  });
});

// ── 2 — Abrir diálogo ───────────────────────────────────────────────────────────

describe('2 — Click en CTA de mismatch abre el diálogo de override', () => {
  it('2a click abre diálogo con título, checkbox, textarea y botón de confirmar', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);

    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));

    await waitFor(() => screen.getByRole('dialog'));
    assert.ok(screen.getByText('Revisar discrepancia de identidad'));
    assert.ok(screen.getByRole('checkbox'));
    assert.ok(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i));
    assert.ok(screen.getByRole('button', { name: /^Aprobar de todas formas$/i }));

    cleanup();
  });
});

// ── 3 — Acknowledgement requerido ──────────────────────────────────────────────

describe('3 — Confirmar deshabilitado sin acknowledgement', () => {
  it('3a checkbox sin marcar + motivo válido → confirmar deshabilitado', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.change(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i), {
      target: { value: 'Revisé LinkedIn.' },
    });

    const confirmBtn = screen.getByRole('button', { name: /^Aprobar de todas formas$/i });
    assert.equal(confirmBtn.hasAttribute('disabled'), true);

    cleanup();
  });
});

// ── 4 — Motivo en blanco ────────────────────────────────────────────────────────

describe('4 — Confirmar deshabilitado con motivo en blanco', () => {
  it('4a acknowledgement=true + motivo solo espacios → confirmar deshabilitado', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i), {
      target: { value: '   ' },
    });

    const confirmBtn = screen.getByRole('button', { name: /^Aprobar de todas formas$/i });
    assert.equal(confirmBtn.hasAttribute('disabled'), true);

    cleanup();
  });

  it('4b acknowledgement=true + motivo no vacío → confirmar habilitado', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i), {
      target: { value: 'Revisé LinkedIn y la información de la empresa.' },
    });

    const confirmBtn = screen.getByRole('button', { name: /^Aprobar de todas formas$/i });
    assert.equal(confirmBtn.hasAttribute('disabled'), false);

    cleanup();
  });
});

// ── 5 — Envío válido → payload exacto ──────────────────────────────────────────

describe('5 — Envío válido llama approveContactCandidate con el payload de override', () => {
  it('5a payload contiene candidateId + {acknowledged:true, reason: valor crudo del textarea}', async () => {
    mockApprove.mock.mockImplementation(async () => ({ ok: true, message: 'Contacto aprobado.' }));
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));

    fireEvent.click(screen.getByRole('checkbox'));
    const rawReason = '  Revisé LinkedIn y la información de la empresa.  ';
    fireEvent.change(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i), {
      target: { value: rawReason },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Aprobar de todas formas$/i }));

    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    const call = mockApprove.mock.calls[0];
    assert.equal(call.arguments[0], candidate.id);
    assert.deepEqual(call.arguments[1], {
      acknowledged: true,
      reason: rawReason.trim(),
    });

    cleanup();
  });

  it('5b no se realiza ninguna llamada de aprobación sin payload de override (sin click de confirmar)', async () => {
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    await renderWithCandidate(candidate);
    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));

    assert.equal(mockApprove.mock.callCount(), 0);

    cleanup();
  });
});

// ── 6 — Resultado de servidor: mismatch requiere revisión ─────────────────────

describe('6 — IDENTITY_MISMATCH_REQUIRES_REVIEW muestra feedback veraz', () => {
  it('6a candidato consistent en pantalla pero servidor responde mismatch (estado obsoleto) → abre diálogo, sin éxito', async () => {
    mockApprove.mock.mockImplementation(async () => ({
      ok: false,
      code: 'IDENTITY_MISMATCH_REQUIRES_REVIEW',
      error: 'Este candidato requiere revisar la discrepancia de identidad antes de aprobar.',
    }));
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('consistent') },
    });
    const { onClose } = await renderWithCandidate(candidate);

    fireEvent.click(screen.getByRole('button', { name: /^Aprobar candidato$/i }));

    await waitFor(() => screen.getByRole('dialog'));
    assert.ok(screen.getByText('Revisar discrepancia de identidad'));
    assert.equal(onClose.mock.callCount(), 0);
    assert.equal(mockRouterRefresh.mock.callCount(), 0);

    cleanup();
  });
});

// ── 7 — Resultado de servidor: motivo de override requerido ────────────────────

describe('7 — IDENTITY_OVERRIDE_REASON_REQUIRED mantiene el diálogo con validación veraz', () => {
  it('7a servidor rechaza el override → diálogo permanece abierto con mensaje de validación, sin éxito', async () => {
    mockApprove.mock.mockImplementation(async () => ({
      ok: false,
      code: 'IDENTITY_OVERRIDE_REASON_REQUIRED',
      error: 'Debes confirmar que revisaste la discrepancia e indicar un motivo.',
    }));
    const candidate = makeCandidate({
      enrichment_metadata: { person_identity: identityEvidence('mismatch') },
    });
    const { onClose } = await renderWithCandidate(candidate);

    fireEvent.click(screen.getByRole('button', { name: /Revisar y aprobar de todas formas/i }));
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(/Describe brevemente qué verificaste/i), {
      target: { value: 'Motivo válido.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Aprobar de todas formas$/i }));

    await waitFor(() => assert.equal(mockApprove.mock.callCount(), 1));
    await waitFor(() =>
      screen.getByText('Debes confirmar que revisaste la discrepancia e indicar un motivo.'),
    );
    assert.ok(screen.getByRole('dialog'));
    assert.equal(onClose.mock.callCount(), 0);
    assert.equal(mockRouterRefresh.mock.callCount(), 0);

    cleanup();
  });
});
