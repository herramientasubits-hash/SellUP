/**
 * Q3F-5BB.3F — Static source guards for the final review UX polish.
 *
 * Proven as source-text assertions (no DOM):
 *   1. The blocked "La configuración ya fue validada" composer is hidden at the
 *      final review step (not left as a dead disabled field).
 *   2. Inline per-message "Editar" links are suppressed in the review phase.
 *   3. Banned read-only / "proceder a generar" copy is gone from the wizard.
 *   4. The final review keeps the hidden-provider contract (recap enriched with
 *      wizard labels; provider only as traceability).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  wizard: join(ROOT, 'src/components/prospect-batches/chat-wizard/prospect-chat-wizard.tsx'),
  messageList: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-message-list.tsx'),
  summary: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-conversation-summary.tsx'),
  messages: join(ROOT, 'src/modules/prospect-batches/chat-wizard/wizard-messages.ts'),
  lushaDrawer: join(ROOT, 'src/components/prospect-batches/lusha-preview-drawer.tsx'),
  finalSearch: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-lusha-final-search.tsx'),
};

const src = {
  wizard: readFileSync(FILES.wizard, 'utf-8'),
  messageList: readFileSync(FILES.messageList, 'utf-8'),
  summary: readFileSync(FILES.summary, 'utf-8'),
  messages: readFileSync(FILES.messages, 'utf-8'),
  lushaDrawer: readFileSync(FILES.lushaDrawer, 'utf-8'),
  finalSearch: readFileSync(FILES.finalSearch, 'utf-8'),
};

describe('Blocked composer hidden at the final review step', () => {
  it('the wizard computes a hideComposer guard for validated/success', () => {
    assert.match(src.wizard, /hideComposer/);
    assert.match(src.wizard, /currentStep === 'validated'/);
  });

  it('the composer render is gated on !hideComposer', () => {
    assert.match(src.wizard, /!hideComposer &&/);
  });
});

describe('Inline "Editar" links suppressed in the review phase', () => {
  it('message list defines a review-phase set and gates canEdit on it', () => {
    assert.match(src.messageList, /REVIEW_PHASE_STEPS/);
    assert.match(src.messageList, /!REVIEW_PHASE_STEPS\.has\(currentStep\)/);
  });
});

describe('Banned copy removed', () => {
  it('no "Preview read-only" anywhere in the wizard/drawer', () => {
    assert.doesNotMatch(src.lushaDrawer, /Preview read-only/);
    assert.doesNotMatch(src.summary, /Preview read-only/);
  });

  it('no "proceder a generar los prospectos" in wizard messages/summary', () => {
    assert.doesNotMatch(src.messages, /proceder a generar/);
    assert.doesNotMatch(src.summary, /proceder a generar/);
  });

  it('no "previsualización read-only" default description', () => {
    assert.doesNotMatch(src.lushaDrawer, /previsualización read-only/);
  });
});

describe('Final review keeps the hidden-provider contract', () => {
  it('summary passes an enriched recap to the final search', () => {
    assert.match(src.summary, /buildWizardFinalRecap/);
    assert.match(src.summary, /recap=\{finalRecap\}/);
  });

  it('final-search forwards the recap without running effects', () => {
    assert.match(src.finalSearch, /recap/);
    assert.doesNotMatch(src.finalSearch, /useEffect/);
    assert.doesNotMatch(src.finalSearch, /useLayoutEffect/);
  });

  it('final-search CTA copy stays "Buscar con IA"', () => {
    assert.match(src.finalSearch, /Buscar con IA/);
  });
});
