/**
 * Tests — el duplicado deja de ser un callejón sin salida
 * (AGENT2A-PHONE-REVEAL-4O-H3-B-R1 · § 17 durabilidad de la decisión humana).
 *
 * El defecto que fijan estos tests: H3-B sólo ofrecía «Agregar información al contacto
 * existente» en el instante posterior a detectar el duplicado. La oferta viajaba en el resultado
 * de la aprobación y vivía en estado local del drawer, así que cerrar el panel la perdía para
 * siempre. Al reabrir, el candidato ya era `duplicate` y NADIE volvía a calcular nada — y el
 * detalle, que filtraba `pending_review`, ni siquiera podía cargarlo.
 *
 * Es decir: la decisión humana era TRANSITORIA. H3-B no está funcional si la acción sólo existe
 * en los segundos siguientes a la detección.
 *
 * Casos cubiertos:
 *   A. un candidato `duplicate` CARGA en el detalle (antes: imposible, salía «no disponible»)
 *   B. se presenta como duplicado, no como una aprobación pendiente más
 *   C. reabierto en frío (sin aprobación previa en esta sesión) el CTA de fusión SIGUE ahí
 *   D. identidad sólo por nombre ⇒ NO hay CTA, y se dice por qué en lenguaje de producto
 *   E. señales exactas ambiguas ⇒ NO hay CTA
 *   F. la oferta se relee del SERVIDOR por candidato; no se hereda del anterior
 *   G. el CTA duradero ejecuta la fusión contra el contacto que confirmó el servidor
 *   H. nada de internals en pantalla: ni uuid, ni nombres de columna, ni RPC
 *
 * Antes del fix fallan A, B, C, D, E, F y G.
 *
 * Server actions mockeados: 0 servidor, 0 DB, 0 proveedores, 0 créditos, 0 escrituras.
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

// ── Imports dependientes del entorno DOM ──────────────────────────────────────

import * as React from 'react';
import { describe, it, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let fireEvent: (typeof import('@testing-library/react'))['fireEvent'];
let waitFor: (typeof import('@testing-library/react'))['waitFor'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

// ── Mocks de boundary ─────────────────────────────────────────────────────────

const EXISTING_CONTACT_ID = '11111111-1111-4111-8111-111111111111';

type MergeOffer =
  | { offered: true; contactId: string; signal: 'email' | 'linkedin' }
  | { offered: false; reason: string };

const mockGetById = mock.fn<() => Promise<PendingContactCandidate | null>>();
const mockGetOffer = mock.fn<(candidateId: string) => Promise<MergeOffer | null>>();
const mockMerge = mock.fn<
  (candidateId: string, contactId: string) => Promise<{ ok: boolean; message?: string; error?: string }>
>();

mock.module('@/modules/contact-enrichment/actions', {
  namedExports: {
    getReviewableContactCandidateById: (...args: unknown[]) => mockGetById(...(args as [])),
    getDuplicateCandidateMergeOffer: (...args: [string]) => mockGetOffer(...args),
    approveContactCandidate: async () => ({ ok: true }),
    mergeContactCandidateIntoExistingContactAction: (...args: [string, string]) =>
      mockMerge(...args),
    discardContactCandidate: async () => ({ ok: true }),
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDuplicateCandidate(
  overrides: Partial<PendingContactCandidate> = {},
): PendingContactCandidate {
  return {
    id: 'cand-h3b-r1-001',
    full_name: 'Carolina Herrera',
    title: 'VP de Ventas',
    email: 'carolina@empresa.com',
    linkedin_url: null,
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    // El estado que la detección ya escribió. Esto es un candidato REABIERTO EN FRÍO: en esta
    // sesión nadie pulsó «Aprobar», así que no hay ningún estado local que pueda estar
    // sosteniendo la oferta. Si el CTA aparece, es porque es DURADERO.
    status: 'duplicate',
    duplicate_status: 'exact_duplicate',
    confidence: 0.8,
    enrichment_metadata: {},
    enrichment_run_id: 'run-001',
    created_at: '2026-08-12T00:00:00.000Z',
    phone_reveal_status: null,
    company_name: 'Empresa SAS',
    company_domain: 'empresa.com',
    account_id: 'acc-001',
    hubspot_company_id: null,
    ...overrides,
  };
}

/** Abre el drawer en frío sobre un candidato y espera a que pinte. */
async function openCandidate(
  candidate: PendingContactCandidate,
  offer: MergeOffer | null,
): Promise<void> {
  mockGetById.mock.mockImplementation(async () => candidate);
  mockGetOffer.mock.mockImplementation(async () => offer);
  render(<ContactCandidateDetailSheet candidateId={candidate.id} open onClose={() => {}} />);
  await waitFor(() => {
    if (screen.getAllByText(candidate.full_name).length === 0) {
      throw new Error('candidate not rendered yet');
    }
  });
}

const MERGE_CTA = /^Agregar información al contacto existente$/i;

function mergeCtaCount(): number {
  return screen.queryAllByRole('button', { name: MERGE_CTA }).length;
}

before(async () => {
  ({ render, screen, fireEvent, waitFor, cleanup } = await import('@testing-library/react'));
  ({ ContactCandidateDetailSheet } = await import('../contact-candidate-detail-sheet'));
});

beforeEach(() => {
  mockGetById.mock.resetCalls();
  mockGetOffer.mock.resetCalls();
  mockMerge.mock.resetCalls();
  cleanup();
});

after(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════
// A/B — un duplicado se puede ABRIR, y se ve como duplicado
// ═══════════════════════════════════════════════════════════════

describe('A/B — el detalle carga un candidato `duplicate`', () => {
  it('A carga y muestra los datos del candidato duplicado', async () => {
    const candidate = makeDuplicateCandidate();
    await openCandidate(candidate, { offered: false, reason: 'name_only_match' });

    // Antes de R1 el detalle filtraba `pending_review`: esto salía como «no disponible».
    assert.ok(screen.getAllByText(candidate.full_name).length > 0);
    assert.equal(
      screen.queryAllByText(/No se pudo cargar el candidato|Candidato no disponible/i).length,
      0,
      'un duplicado no es un candidato ausente ni un fallo de lectura',
    );
  });

  it('B se presenta como «Duplicado» y NO ofrece la barra de aprobación normal', async () => {
    await openCandidate(makeDuplicateCandidate(), { offered: false, reason: 'name_only_match' });

    assert.ok(
      screen.queryAllByText(/^Duplicado$/).length > 0,
      'el estado real debe estar visible',
    );
    assert.equal(
      screen.queryAllByText(/^Por revisar$/).length,
      0,
      'un duplicado no puede presentarse como si siguiera pendiente de aprobación',
    );
    assert.equal(
      screen.queryAllByRole('button', { name: /^Aprobar candidato$/i }).length,
      0,
      'su veredicto ya está tomado: aprobar de nuevo no es una acción válida',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// C — DURABILIDAD: reabierto en frío, el CTA sigue disponible
// ═══════════════════════════════════════════════════════════════

describe('C — la decisión humana es DURADERA', () => {
  it('C1 reabierto en frío con identidad exacta por email ⇒ el CTA de fusión SIGUE disponible', async () => {
    await openCandidate(makeDuplicateCandidate(), {
      offered: true,
      contactId: EXISTING_CONTACT_ID,
      signal: 'email',
    });

    await waitFor(() => {
      if (mergeCtaCount() === 0) throw new Error('merge CTA not rendered yet');
    });

    assert.ok(
      screen.queryAllByText(/Este candidato coincide con un contacto existente/i).length > 0,
      'debe explicarse en lenguaje de producto',
    );
    assert.ok(
      screen.queryAllByText(/mismo correo electrónico/i).length > 0,
      'la señal exacta se dice sin exponer internals',
    );
  });

  it('C2 identidad exacta por LinkedIn ⇒ CTA disponible, con su propia señal', async () => {
    await openCandidate(makeDuplicateCandidate({ email: null, linkedin_url: 'https://linkedin.com/in/x' }), {
      offered: true,
      contactId: EXISTING_CONTACT_ID,
      signal: 'linkedin',
    });

    await waitFor(() => {
      if (mergeCtaCount() === 0) throw new Error('merge CTA not rendered yet');
    });
    assert.ok(screen.queryAllByText(/mismo perfil de LinkedIn/i).length > 0);
  });

  it('C3 la oferta se pide al SERVIDOR para este candidato, no se asume', async () => {
    const candidate = makeDuplicateCandidate();
    await openCandidate(candidate, {
      offered: true,
      contactId: EXISTING_CONTACT_ID,
      signal: 'email',
    });

    await waitFor(() => {
      if (mockGetOffer.mock.callCount() === 0) throw new Error('offer not requested yet');
    });
    assert.equal(mockGetOffer.mock.calls[0]?.arguments[0], candidate.id);
  });
});

// ═══════════════════════════════════════════════════════════════
// D/E — sin identidad confiable NO hay CTA (nada de fuzzy merge)
// ═══════════════════════════════════════════════════════════════

describe('D/E — identidad no confiable ⇒ ninguna fusión ofrecida', () => {
  for (const reason of [
    'name_only_match',
    'ambiguous_email_match',
    'ambiguous_linkedin_match',
    'recorded_match_mismatch',
    'no_recorded_match',
  ]) {
    it(`D/E ${reason} ⇒ candidato visible como duplicado, pero SIN CTA de fusión`, async () => {
      await openCandidate(makeDuplicateCandidate(), { offered: false, reason });

      // Sigue siendo auditable y reabrible…
      assert.ok(screen.queryAllByText(/^Duplicado$/).length > 0);
      // …pero no se ofrece asociar nada.
      assert.equal(mergeCtaCount(), 0, 'sin identidad exacta NO se ofrece fusionar');
      assert.ok(
        screen.queryAllByText(/No podemos confirmar que sea la misma persona/i).length > 0,
        'el motivo se dice con seguridad, sin culpar al usuario ni exponer internals',
      );
    });
  }

  it('E2 si la lectura de la oferta FALLA, el estado seguro es NO ofrecer', async () => {
    const candidate = makeDuplicateCandidate();
    mockGetById.mock.mockImplementation(async () => candidate);
    mockGetOffer.mock.mockImplementation(async () => {
      throw new Error('read failed');
    });
    render(<ContactCandidateDetailSheet candidateId={candidate.id} open onClose={() => {}} />);
    await waitFor(() => {
      if (screen.getAllByText(candidate.full_name).length === 0) {
        throw new Error('candidate not rendered yet');
      }
    });

    assert.equal(mergeCtaCount(), 0, 'un fallo nunca puede AMPLIAR lo que se ofrece');
  });
});

// ═══════════════════════════════════════════════════════════════
// G — el CTA duradero ejecuta la fusión que el servidor confirmó
// ═══════════════════════════════════════════════════════════════

describe('G — la acción duradera fusiona contra el contacto confirmado', () => {
  it('G1 pulsar el CTA llama a la acción con el candidato y el contacto del servidor', async () => {
    const candidate = makeDuplicateCandidate();
    mockMerge.mock.mockImplementation(async () => ({ ok: true, message: 'Listo.' }));
    await openCandidate(candidate, {
      offered: true,
      contactId: EXISTING_CONTACT_ID,
      signal: 'email',
    });
    await waitFor(() => {
      if (mergeCtaCount() === 0) throw new Error('merge CTA not rendered yet');
    });

    fireEvent.click(screen.getAllByRole('button', { name: MERGE_CTA })[0]);

    await waitFor(() => {
      if (mockMerge.mock.callCount() === 0) throw new Error('merge not called yet');
    });
    assert.deepEqual(mockMerge.mock.calls[0]?.arguments, [candidate.id, EXISTING_CONTACT_ID]);
  });
});

// ═══════════════════════════════════════════════════════════════
// H — la superficie del duplicado no filtra internals
// ═══════════════════════════════════════════════════════════════

describe('H — sin internals en pantalla', () => {
  it('H1 no se muestran uuids, nombres de columna ni la RPC', async () => {
    await openCandidate(makeDuplicateCandidate(), {
      offered: true,
      contactId: EXISTING_CONTACT_ID,
      signal: 'email',
    });
    await waitFor(() => {
      if (mergeCtaCount() === 0) throw new Error('merge CTA not rendered yet');
    });

    const text = document.body.textContent ?? '';
    for (const forbidden of [
      EXISTING_CONTACT_ID,
      'matched_contacts_id',
      'dedupe_key',
      'merge_candidate_into_existing_contact',
      'approve_contact_candidate_with_phones',
      'contact_enrichment_candidates',
    ]) {
      assert.equal(
        text.includes(forbidden),
        false,
        `la UI no debe exponer «${forbidden}»`,
      );
    }
  });
});
