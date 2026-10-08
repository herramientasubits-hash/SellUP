/**
 * Tests — «Contactos rechazados» (AGENT2A-CONTACTOS-RECHAZADOS).
 *
 * Un candidato rechazado en la revisión (`status = 'discarded'`) desaparecía de la UI: ninguna
 * vista volvía a mirar ese estado. Estos tests fijan la vista nueva:
 *   A. el menú de Contactos la ofrece como «Contactos rechazados» (`?tab=rejected`)
 *   B. la tabla se anuncia como «Contactos rechazados» y su vacío es el propio
 *   C. cada fila muestra el motivo del rechazo y el estado «Rechazado»
 *   D. es de sólo consulta: el nombre no abre el panel de revisión
 *   E. ruteo y lectura: `?tab=rejected` → cola `rejected` → `status = 'discarded'`
 *
 * 0 servidor, 0 DB, 0 proveedor, 0 créditos. Datos 100 % ficticios.
 * Requiere --experimental-test-module-mocks (mock.module).
 */


import { JSDOM } from 'jsdom';

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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT_CANDIDATES_QUEUE_COPY } from '../contact-candidates-queue-copy';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];

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

let ContactCandidatesDataTableClient: (typeof import('../contact-candidates-data-table-client'))['ContactCandidatesDataTableClient'];
import type { PendingContactCandidate } from '@/modules/contact-enrichment/types';
import { buildSidebarNav } from '@/components/layout/sidebar-nav';
let rejectionInfo: (typeof import('../contact-candidates-data-table-client'))['rejectionInfo'];

const REJECTED = CONTACT_CANDIDATES_QUEUE_COPY.rejected;

function makeRejected(overrides: Partial<PendingContactCandidate> = {}): PendingContactCandidate {
  return {
    id: 'cand-rej-1',
    full_name: 'Persona Ficticia Rechazada',
    title: 'Analista',
    email: 'ficticia@ejemplo.test',
    linkedin_url: null,
    source_contact_id: null,
    phone: null,
    source: 'apollo',
    status: 'discarded',
    duplicate_status: 'no_match',
    confidence: 0.5,
    enrichment_metadata: {
      review: {
        status: 'discarded',
        reason: 'Cargo no relevante',
        reviewed_at: '2026-10-01T15:00:00.000Z',
        reviewed_by: 'user-1',
      },
    },
    enrichment_run_id: null,
    created_at: '2026-09-30T10:00:00.000Z',
    phone_reveal_status: null,
    phone_reveal_last_checked_at: null,
    phone_reveal_requested_at: null,
    phone_reveal_recovery_id_present: false,
    phone_reveal_provider: null,
    company_name: 'Empresa Ficticia',
    company_domain: 'ejemplo.test',
    account_id: null,
    hubspot_company_id: null,
    ...overrides,
  } as PendingContactCandidate;
}

function textPresent(text: string): boolean {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return screen.queryAllByText(new RegExp(escaped, 'i')).length > 0;
}

describe('AGENT2A-CONTACTOS-RECHAZADOS — vista de contactos rechazados', () => {
  before(async () => {
    const rtl = await import('@testing-library/react');
    render = rtl.render;
    screen = rtl.screen;
    cleanup = rtl.cleanup;
    const mod = await import('../contact-candidates-data-table-client');
    ContactCandidatesDataTableClient = mod.ContactCandidatesDataTableClient;
    rejectionInfo = mod.rejectionInfo;
  });

  afterEach(() => {
    cleanup();
  });

  it('A. el menú de Contactos ofrece «Contactos rechazados» en ?tab=rejected', () => {
    const contacts = buildSidebarNav({ isAdmin: false } as Parameters<typeof buildSidebarNav>[0]).find(
      (root) => root.href === '/contacts',
    );
    const rejected = contacts?.children?.find((child) => child.label === 'Contactos rechazados');
    assert.ok(rejected, 'el menú debe listar «Contactos rechazados»');
    assert.equal(rejected!.href, '/contacts?tab=rejected');
  });

  it('B. la tabla se titula «Contactos rechazados» y su vacío es el propio', () => {
    render(React.createElement(ContactCandidatesDataTableClient, { candidates: [], queue: 'rejected' }));
    assert.equal(REJECTED.title, 'Contactos rechazados');
    assert.ok(textPresent(REJECTED.title));
    assert.ok(textPresent(REJECTED.emptyTitle));
    assert.equal(textPresent('No hay candidatos por revisar.'), false);
    assert.equal(REJECTED.showEnrichmentCta, false);
  });

  it('C. misma tabla que «Por revisar»: mismas columnas, estado «Rechazado»', () => {
    render(
      React.createElement(ContactCandidatesDataTableClient, {
        candidates: [makeRejected()],
        queue: 'rejected',
      }),
    );
    assert.ok(textPresent('Persona Ficticia Rechazada'));
    assert.ok(textPresent('Rechazado'));
    // El nombre abre el mismo panel que en «Por revisar».
    assert.equal(screen.queryAllByRole('button', { name: 'Persona Ficticia Rechazada' }).length, 1);
  });

  it('C2. rejectionInfo lee motivo y fecha con guardas', () => {
    assert.deepEqual(rejectionInfo(makeRejected()), {
      reason: 'Cargo no relevante',
      reviewedAt: '2026-10-01T15:00:00.000Z',
    });
    assert.deepEqual(rejectionInfo(makeRejected({ enrichment_metadata: {} })), {
      reason: null,
      reviewedAt: null,
    });
    assert.deepEqual(
      rejectionInfo(makeRejected({ enrichment_metadata: { review: { reason: '   ' } } })),
      { reason: null, reviewedAt: null },
    );
  });

  it('D. la barra sólo ofrece «Enviar a revisar»; sin «Crear contacto» ni «Buscar contactos con IA»', () => {
    const root = join(process.cwd(), 'src/components/contact-enrichment');
    const table = readFileSync(join(root, 'contact-candidates-data-table-client.tsx'), 'utf8');
    // En la cola de rechazados la ÚNICA acción de la barra es enviar a revisar.
    assert.match(
      table,
      /isRejectedQueue \? \[\s*\{\s*id: 'send-to-review',\s*label: SEND_TO_REVIEW_LABEL,[\s\S]{0,200}\},\s*\] :/,
    );
    const sheet = readFileSync(join(root, 'contact-candidate-detail-sheet.tsx'), 'utf8');
    // El panel de un rechazado pinta RejectedCandidateActions en lugar de Aprobar/Rechazar.
    assert.match(sheet, /candidate && isRejectedVariant \? \(\s*<RejectedCandidateActions/);
    const panel = readFileSync(join(root, 'contact-candidates-panel.tsx'), 'utf8');
    assert.match(panel, /actions=\{queue === 'rejected' \? undefined : <ContactsScreenActions/);
  });

  it('E. ?tab=rejected → cola rejected → status discarded', () => {
    const root = join(process.cwd(), 'src');
    const page = readFileSync(join(root, 'app/(sellup)/contacts/page.tsx'), 'utf8');
    assert.match(page, /tab === 'rejected'[\s\S]{0,200}queue="rejected"/);

    const actions = readFileSync(join(root, 'modules/contact-enrichment/actions.ts'), 'utf8');
    assert.match(
      actions,
      /getRejectedContactCandidates\([\s\S]{0,600}\.eq\('status',\s*'discarded'\)/,
    );
  });
});
