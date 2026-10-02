/**
 * RunResultSnapshot — contrato RUNTIME tras pasar a `ChatCardView` (tarjetas `rows`).
 *
 * Lo que fija: que los rótulos, las CIFRAS y sus unidades de facturación siguen en
 * pantalla tal cual (créditos de búsqueda, créditos de completion, total, motivo de
 * corte), que cada bloque es una tarjeta de datos del chat y que los desenlaces sin
 * candidatos o sin proveedor son avisos, no alertas en vivo.
 */

import { JSDOM } from 'jsdom';

// ── jsdom bootstrap (node:test no trae DOM) ───────────────────────────────────
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


import * as React from 'react';
import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanyCandidate, ContactEnrichmentRunResult } from '@/modules/contact-enrichment/types';
import type {
  ApolloEnrichmentUiResult,
  LushaEnrichmentUiResult,
} from '../contact-enrichment-chat-types';

let render: (typeof import('@testing-library/react'))['render'];
let screen: (typeof import('@testing-library/react'))['screen'];
let cleanup: (typeof import('@testing-library/react'))['cleanup'];
let RunResultSnapshot: (typeof import('../contact-enrichment-chat-result'))['RunResultSnapshot'];

before(async () => {
  ({ render, screen, cleanup } = await import('@testing-library/react'));
  ({ RunResultSnapshot } = await import('../contact-enrichment-chat-result'));
});

afterEach(() => {
  cleanup();
});

const RUN: ContactEnrichmentRunResult = {
  runId: 'run-123',
  agentRunId: 'agent-run-123',
  status: 'ready_to_enrich',
  candidatesCount: 0,
};

const COMPANY = {
  name: 'Acme SAS',
  domain: 'acme.co',
  country: 'CO',
  source: 'sellup',
  sellupAccountId: 'acc-1',
} as unknown as CompanyCandidate;

function apolloResult(overrides: Partial<ApolloEnrichmentUiResult> = {}): ApolloEnrichmentUiResult {
  return {
    status: 'ready_for_review',
    candidatesCreated: 3,
    duplicatesSkipped: 1,
    possibleDuplicates: 2,
    totalCandidates: 3,
    rawResultsCount: 12,
    rejectedByRelevance: 7,
    noReviewableContactsFound: false,
    completionAttempted: 4,
    actionableContactsCount: 3,
    noActionableContactsFound: false,
    providerStatus: 'success',
    estimatedCostUsd: 0,
    costGuardrail: {
      phone_completion_enabled: false,
      estimated_credits_before_completion: 4,
      max_credits_per_run: 10,
      guardrail_blocked: true,
      actual_credits_email: 4,
      actual_credits_phone: 0,
      actual_credits_total: 4,
      blocked_profiles_count: 1,
    },
    searchGuardrail: {
      max_search_attempts: 3,
      max_results_per_attempt: 10,
      max_results_per_run: 30,
      estimated_search_credits: 0,
      blocked_by_search_budget: false,
      stopped_early_reason: 'target_reviewable_reached',
    },
    ...overrides,
  };
}

function valueOf(testId: string): string {
  return screen.getByTestId(testId).textContent ?? '';
}

describe('RunResultSnapshot · resultado de Apollo', () => {
  it('pinta el run, el resultado y los créditos como tarjetas de datos del chat', () => {
    render(<RunResultSnapshot runResult={RUN} candidate={COMPANY} apolloResult={apolloResult()} provider="apollo" />);

    assert.ok(screen.getByText('Run creado'));
    assert.ok(screen.getByText('Listo para revisión', { selector: '[data-slot="badge"], span, div' }));
    for (const id of ['run-result-run', 'apollo-result', 'apollo-completion-credits', 'apollo-search']) {
      assert.equal(screen.getByTestId(id).getAttribute('data-kind'), 'rows', id);
    }
    assert.equal(valueOf('run-result-run-value-company'), 'Acme SAS');
    assert.equal(valueOf('run-result-run-value-candidates'), '3');
    assert.equal(valueOf('run-result-run-value-run-id'), 'run-123');
  });

  it('conserva al pie de la letra las cifras del resultado', () => {
    render(<RunResultSnapshot runResult={RUN} candidate={COMPANY} apolloResult={apolloResult()} provider="apollo" />);

    assert.ok(screen.getByText('Resultado de Apollo'));
    assert.equal(valueOf('apollo-result-value-found'), '12');
    assert.equal(valueOf('apollo-result-value-filtered'), '7');
    assert.equal(valueOf('apollo-result-value-completion-attempted'), '4');
    assert.equal(valueOf('apollo-result-value-actionable'), '3');
    assert.equal(valueOf('apollo-result-value-ready'), '3');
    assert.equal(valueOf('apollo-result-value-duplicates'), '1');
    assert.equal(valueOf('apollo-result-value-possible-duplicates'), '2');
    assert.equal(valueOf('apollo-result-value-final-status'), 'Listo para revisión');
    for (const label of [
      'Perfiles encontrados',
      'Filtrados por relevancia/calidad',
      'Intentos de completar datos',
      'Candidatos con datos accionables',
      'Candidatos listos para revisión',
      'Duplicados omitidos',
      'Posibles duplicados',
      'Estado final',
    ]) {
      assert.ok(screen.getByText(label), label);
    }
  });

  it('conserva las cifras y las unidades de facturación', () => {
    render(<RunResultSnapshot runResult={RUN} candidate={COMPANY} apolloResult={apolloResult()} provider="apollo" />);

    assert.ok(screen.getByText('Créditos de completion'));
    assert.equal(valueOf('apollo-completion-credits-value-email'), '4');
    assert.equal(valueOf('apollo-completion-credits-value-phone-reveal'), 'no ejecutado');
    assert.equal(valueOf('apollo-completion-credits-value-total'), '4 créditos');
    assert.match(
      screen.getByTestId('apollo-completion-credits-row-total').textContent ?? '',
      /Guardrail activado — algunos perfiles no se completaron para no superar el límite de 10 créditos\./,
    );
    // People Search no cobra créditos: «sin costo», nunca «0 créditos».
    assert.equal(valueOf('apollo-search-value-credits'), 'sin costo');
    assert.equal(valueOf('apollo-search-value-evaluated'), '12');
    assert.equal(valueOf('apollo-search-value-stop-reason'), 'objetivo alcanzado');
  });

  it('con completion de teléfono muestra sus créditos y, sin intentos ni gasto, lo dice', () => {
    render(
      <RunResultSnapshot
        runResult={RUN}
        candidate={COMPANY}
        provider="apollo"
        apolloResult={apolloResult({
          completionAttempted: 0,
          costGuardrail: {
            phone_completion_enabled: true,
            estimated_credits_before_completion: 0,
            max_credits_per_run: 10,
            guardrail_blocked: false,
            actual_credits_email: 0,
            actual_credits_phone: 0,
            actual_credits_total: 0,
            blocked_profiles_count: 0,
          },
          searchGuardrail: {
            max_search_attempts: 3,
            max_results_per_attempt: 10,
            max_results_per_run: 30,
            estimated_search_credits: 2,
            blocked_by_search_budget: true,
            stopped_early_reason: 'search_budget_reached',
          },
        })}
      />,
    );

    assert.equal(valueOf('apollo-completion-credits-value-phone'), '0');
    assert.equal(valueOf('apollo-completion-credits-value-total'), 'sin créditos de completion');
    assert.equal(valueOf('apollo-search-value-credits'), '2 créditos');
    assert.equal(valueOf('apollo-search-value-stop-reason'), 'límite de resultados alcanzado');
    assert.match(
      screen.getByTestId('apollo-search-row-credits').textContent ?? '',
      /Búsqueda detenida al alcanzar el límite de 30 resultados\./,
    );
  });

  it('sin candidatos revisables, el vacío es un aviso con la opción de crear el contacto a mano', () => {
    let created = 0;
    render(
      <RunResultSnapshot
        runResult={RUN}
        candidate={COMPANY}
        provider="apollo"
        apolloResult={apolloResult({ candidatesCreated: 0, noReviewableContactsFound: true })}
        onCreateManualContact={() => {
          created += 1;
        }}
      />,
    );

    const button = screen.getByRole('button', { name: /Crear contacto manualmente/ });
    assert.equal(button.closest('[data-slot="alert"]')?.getAttribute('role'), 'note');
    button.click();
    assert.equal(created, 1);
    assert.equal(document.querySelectorAll('[role="alert"]').length, 0);
  });

  it('si Apollo no se ejecutó, lo dice y no pinta cifras', () => {
    render(
      <RunResultSnapshot
        runResult={RUN}
        candidate={COMPANY}
        provider="apollo"
        apolloResult={apolloResult({ providerStatus: 'error', error: undefined })}
      />,
    );

    assert.ok(screen.getByText('Apollo no pudo ejecutarse. No se crearon candidatos.'));
    assert.equal(screen.queryByTestId('apollo-result'), null);
  });
});

describe('RunResultSnapshot · Lusha', () => {
  const lushaBase: LushaEnrichmentUiResult = {
    status: 'no_reviewable_candidate',
    candidatesCreated: 0,
    duplicatesSkipped: 0,
    rawResultsCount: 5,
    creditsUsed: 2,
    providerStatus: 'success',
    noReviewableContactsFound: true,
  };

  it('sin credenciales: «Run no ejecutado», su estado y el motivo, sin cifras de proveedor', () => {
    render(
      <RunResultSnapshot
        runResult={RUN}
        candidate={COMPANY}
        provider="lusha"
        lushaResult={{ ...lushaBase, status: 'missing_api_key', providerStatus: 'skipped' }}
      />,
    );

    assert.ok(screen.getByText('Run no ejecutado'));
    assert.ok(screen.getByText('Sin credenciales'));
    assert.match(document.body.textContent ?? '', /No se ejecutó el proveedor y no se crearon candidatos\./);
    assert.equal(screen.queryByTestId('lusha-empty-metrics'), null);
  });

  it('ejecutó y filtró todo: conserva resultados brutos, créditos usados y el reveal no ejecutado', () => {
    render(<RunResultSnapshot runResult={RUN} candidate={COMPANY} provider="lusha" lushaResult={lushaBase} />);

    assert.equal(valueOf('lusha-empty-metrics-value-raw'), '5');
    assert.equal(valueOf('lusha-empty-metrics-value-credits'), '2');
    assert.equal(valueOf('lusha-empty-metrics-value-phone-reveal'), 'no ejecutado');
  });
});

describe('RunResultSnapshot · contactos existentes', () => {
  it('muestra el total para deduplicación incluso en 0 y los incompletos solo si los hay', () => {
    render(
      <RunResultSnapshot
        runResult={{
          ...RUN,
          existingContactsSnapshot: {
            sellup: { status: 'ok', count: 2 },
            hubspot: { status: 'skipped', reason: 'sin company id' },
            combined: {
              totalExistingContacts: 2,
              incompleteContacts: { missingEmail: 1, missingPhone: 0, missingLinkedin: 2 },
            },
          } as unknown as ContactEnrichmentRunResult['existingContactsSnapshot'],
        }}
        candidate={COMPANY}
        provider="apollo"
      />,
    );

    assert.equal(valueOf('run-result-existing-value-sellup'), '2');
    assert.equal(valueOf('run-result-existing-value-hubspot'), 'omitido — sin company id');
    assert.equal(valueOf('run-result-existing-value-total'), '2');
    assert.equal(valueOf('run-result-incomplete-value-missing-email'), '1');
    assert.equal(valueOf('run-result-incomplete-value-missing-linkedin'), '2');
    assert.equal(screen.queryByTestId('run-result-incomplete-value-missing-phone'), null);
  });
});
