/**
 * Tests de runtime — pasos de la revisión humana DENTRO del drawer del candidato.
 *
 * Thema no apila un modal sobre un drawer. Estas pruebas fijan cómo quedó la
 * revisión tras retirar los `<Dialog>` del panel:
 *
 *   1 — el override de identidad es un PASO del drawer (0 diálogos apilados) y
 *       «Cancelar» vuelve a la barra normal descartando lo escrito;
 *   2 — el motivo de rechazo también es un paso del drawer;
 *   3 — los avisos informativos son `role="note"`, no alertas en vivo;
 *   4 — la decisión sobre un duplicado es un diálogo de ALERTA (exige respuesta).
 *
 * Todo mockeado: 0 red, 0 base, 0 proveedores.
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
    contactId?: string;
    mergeOffer?: { offered: true; contactId: string; signal: 'email' | 'linkedin' };
  }>
>();
const mockDiscard = mock.fn<() => Promise<{ ok: boolean }>>();
const mockMerge = mock.fn<() => Promise<{ ok: boolean }>>();
const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockRouterRefresh = mock.fn<() => void>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) =>
      mockGetById(...(args as [])),
    approveContactCandidate: (...args: [string, { acknowledged: boolean; reason: string }?]) =>
      mockApprove(...args),
    discardContactCandidate: (...args: unknown[]) => mockDiscard(...(args as [])),
    getDuplicateCandidateMergeOffer: async () => null,
    mergeContactCandidateIntoExistingContactAction: (...args: unknown[]) =>
      mockMerge(...(args as [])),
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
    source_contact_id: null,
    phone: null,
    source: 'lusha',
    status: 'pending_review',
    duplicate_status: 'unchecked',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-001',
    created_at: '2026-07-08T00:00:00.000Z',
    phone_reveal_status: null,
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
  mockMerge.mock.resetCalls();
  mockGetById.mock.resetCalls();
  mockRouterRefresh.mock.resetCalls();
});

after(() => {
  cleanup();
});

const OVERRIDE_CTA = /Revisar y aprobar de todas formas/i;
const OVERRIDE_PLACEHOLDER = /Describe brevemente qué verificaste/i;

function mismatchCandidate(): PendingContactCandidate {
  return makeCandidate({
    enrichment_metadata: { person_identity: identityEvidence('mismatch') },
  });
}

describe('1 — el override de identidad es un paso del drawer, no un modal encima', () => {
  it('1a abre dentro del panel: 1 solo diálogo (el drawer) y 0 diálogos de alerta', async () => {
    await renderWithCandidate(mismatchCandidate());
    fireEvent.click(screen.getByRole('button', { name: OVERRIDE_CTA }));

    const heading = await waitFor(() => screen.getByText('Revisar discrepancia de identidad'));
    const dialogs = screen.queryAllByRole('dialog');
    assert.equal(dialogs.length, 1, 'no puede apilarse un segundo diálogo sobre el drawer');
    assert.equal(screen.queryAllByRole('alertdialog').length, 0);
    assert.ok(dialogs[0].contains(heading), 'el paso vive DENTRO del drawer');
    assert.ok(dialogs[0].contains(screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER)));

    cleanup();
  });

  it('1b la barra del pie cambia a Cancelar / Aprobar de todas formas', async () => {
    await renderWithCandidate(mismatchCandidate());
    fireEvent.click(screen.getByRole('button', { name: OVERRIDE_CTA }));
    await waitFor(() => screen.getByRole('button', { name: /^Aprobar de todas formas$/i }));

    assert.ok(screen.getByRole('button', { name: 'Cancelar' }));
    assert.equal(screen.queryByRole('button', { name: OVERRIDE_CTA }), null);
    assert.equal(screen.queryByRole('button', { name: 'Rechazar' }), null);

    cleanup();
  });

  it('1c el motivo lleva su etiqueta enlazada al campo', async () => {
    await renderWithCandidate(mismatchCandidate());
    fireEvent.click(screen.getByRole('button', { name: OVERRIDE_CTA }));
    await waitFor(() => screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER));

    assert.equal(
      screen.getByLabelText('Motivo de aprobación'),
      screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER),
    );

    cleanup();
  });

  it('1d «Cancelar» vuelve a la barra normal, descarta lo escrito y no aprueba', async () => {
    await renderWithCandidate(mismatchCandidate());
    fireEvent.click(screen.getByRole('button', { name: OVERRIDE_CTA }));
    await waitFor(() => screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER), {
      target: { value: 'Revisé LinkedIn.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => screen.getByRole('button', { name: OVERRIDE_CTA }));
    assert.equal(screen.queryByText('Revisar discrepancia de identidad'), null);
    assert.equal(mockApprove.mock.callCount(), 0);

    fireEvent.click(screen.getByRole('button', { name: OVERRIDE_CTA }));
    const textarea = (await waitFor(() =>
      screen.getByPlaceholderText(OVERRIDE_PLACEHOLDER),
    )) as HTMLTextAreaElement;
    assert.equal(textarea.value, '', 'el motivo anterior no puede quedar pre-cargado');
    assert.equal(
      screen.getByRole('button', { name: /^Aprobar de todas formas$/i }).hasAttribute('disabled'),
      true,
      'ni la casilla marcada',
    );

    cleanup();
  });
});

describe('2 — el motivo de rechazo es un paso del drawer', () => {
  it('2a «Rechazar» abre el motivo dentro del panel y no llama a ninguna acción', async () => {
    await renderWithCandidate(makeCandidate());
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));

    const heading = await waitFor(() => screen.getByText('Motivo de rechazo'));
    const dialogs = screen.queryAllByRole('dialog');
    assert.equal(dialogs.length, 1);
    assert.ok(dialogs[0].contains(heading));
    assert.ok(screen.getByRole('button', { name: /Confirmar rechazo/i }));
    assert.equal(mockDiscard.mock.callCount(), 0, 'abrir el paso no rechaza');

    cleanup();
  });
});

describe('3 — los avisos informativos no son alertas en vivo', () => {
  it('3a un candidato normal muestra «Revisión humana» como nota, con 0 role="alert"', async () => {
    await renderWithCandidate(makeCandidate());

    const note = screen.getByText('Revisión humana').closest('[data-slot="alert"]');
    assert.ok(note, 'el aviso usa la pieza Alert del sistema');
    assert.equal(note?.getAttribute('role'), 'note');
    assert.equal(document.querySelectorAll('[role="alert"]').length, 0);

    cleanup();
  });

  it('3b sin cuenta ni HubSpot, el aviso lo dice y «Aprobar» queda apagado', async () => {
    await renderWithCandidate(makeCandidate({ account_id: null, hubspot_company_id: null }));

    assert.ok(screen.getByText('Sin cuenta SellUp asociada'));
    assert.equal(
      screen.getByRole('button', { name: /^Aprobar candidato$/i }).hasAttribute('disabled'),
      true,
    );
    assert.equal(document.querySelectorAll('[role="alert"]').length, 0);

    cleanup();
  });
});

describe('4 — la decisión sobre un duplicado exige respuesta', () => {
  it('4a con oferta del servidor se abre un diálogo de ALERTA con las dos decisiones', async () => {
    mockApprove.mock.mockImplementation(async () => ({
      ok: false,
      duplicate: true,
      contactId: 'contact-001',
      mergeOffer: { offered: true, contactId: 'contact-001', signal: 'email' },
    }));
    const { onClose } = await renderWithCandidate(makeCandidate());
    fireEvent.click(screen.getByRole('button', { name: /^Aprobar candidato$/i }));

    const alertDialog = await waitFor(() => screen.getByRole('alertdialog'));
    assert.match(alertDialog.textContent ?? '', /Candidato duplicado/);
    assert.match(alertDialog.textContent ?? '', /con el mismo correo electrónico\./);
    assert.ok(screen.getByRole('button', { name: 'Descartar como duplicado' }));
    assert.ok(
      screen.getByRole('button', { name: 'Agregar información al contacto existente' }),
    );
    assert.equal(onClose.mock.callCount(), 0);
    assert.equal(mockMerge.mock.callCount(), 0, 'detectar el duplicado NUNCA fusiona solo');

    cleanup();
  });
});
