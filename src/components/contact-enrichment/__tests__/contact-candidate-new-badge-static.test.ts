/**
 * AGENT2A-CONTACT-NEW-BADGE-1 — parity with Agent 1's "Nuevo" badge.
 *
 * Static source-inspection tests (no render, no DB, no providers): the badge's
 * logic and visual style must match `prospects-data-table-client.tsx` exactly,
 * must be independent from workflow status (Por revisar / Duplicado) and from
 * phone reveal, and must never trigger a write merely by rendering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(here, '..');
const repoRoot = join(here, '..', '..', '..', '..');

function readComponent(relative: string): string {
  return readFileSync(join(componentsDir, relative), 'utf8');
}
function readRepo(relative: string): string {
  return readFileSync(join(repoRoot, relative), 'utf8');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const dataTable = readComponent('contact-candidates-data-table-client.tsx');
const detailSheet = readComponent('contact-candidate-detail-sheet.tsx');
const dataTableCode = stripComments(dataTable);
const detailSheetCode = stripComments(detailSheet);

const agent1DataTable = readRepo('src/components/prospects/prospects-data-table-client.tsx');
const AGENT1_BADGE_CLASSES =
  'border-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-semibold px-1.5 py-0.5 shrink-0';

describe('Nuevo badge — reuses Agent 1 source of truth', () => {
  it('imports isCandidateCreatedToday (mirrors isProspectCreatedToday), not a bespoke rule', () => {
    assert.ok(/import\s*\{\s*isCandidateCreatedToday\s*\}/.test(dataTable));
    assert.ok(/import\s*\{\s*isCandidateCreatedToday\s*\}/.test(detailSheet));
  });

  it('Agent 1 badge classes exist verbatim in prospects-data-table-client.tsx (regression guard)', () => {
    assert.ok(
      agent1DataTable.includes(AGENT1_BADGE_CLASSES),
      'Agent 1 Nuevo badge markup must remain unchanged',
    );
  });

  it('candidate list badge uses the exact same classes as Agent 1', () => {
    assert.ok(
      dataTable.includes(AGENT1_BADGE_CLASSES),
      'candidate list Nuevo badge must match Agent 1 visual style exactly',
    );
  });

  it('candidate detail drawer badge uses the exact same classes as Agent 1', () => {
    assert.ok(
      detailSheet.includes(AGENT1_BADGE_CLASSES),
      'candidate detail Nuevo badge must match Agent 1 visual style exactly',
    );
  });

  it('candidate list still says literal "Nuevo" (no bespoke copy)', () => {
    const idx = dataTable.indexOf(AGENT1_BADGE_CLASSES);
    const after = dataTable.slice(idx, idx + 200);
    assert.ok(/>\s*Nuevo\s*</.test(after));
  });

  it('candidate detail still says literal "Nuevo" (no bespoke copy)', () => {
    const idx = detailSheet.indexOf(AGENT1_BADGE_CLASSES);
    const after = detailSheet.slice(idx, idx + 200);
    assert.ok(/>\s*Nuevo\s*</.test(after));
  });
});

describe('Nuevo badge — coexists with workflow status, does not replace it', () => {
  it('candidate list still renders "Por revisar" plain text status untouched', () => {
    assert.ok(dataTableCode.includes("Todas las filas de este tab comparten estado") === false ||
      /Por revisar/.test(dataTableCode));
    assert.ok(/Por revisar/.test(dataTable));
  });

  it('candidate detail still renders both "Por revisar" and "Duplicado" status badges', () => {
    assert.ok(detailSheetCode.includes('Por revisar'));
    assert.ok(detailSheetCode.includes('Duplicado'));
  });

  it('the Nuevo badge condition is independent of candidate.status (no shared guard)', () => {
    const idx = detailSheetCode.indexOf('isCandidateCreatedToday(candidate.created_at)');
    assert.notEqual(idx, -1);
    const conditionWindow = detailSheetCode.slice(Math.max(0, idx - 120), idx + 40);
    assert.equal(
      /candidate\.status/.test(conditionWindow),
      false,
      'Nuevo must not be gated on candidate.status — they are independent dimensions',
    );
  });

  it('title block renders Nuevo AND the status badge as separate sibling elements, not a ternary replacing one with the other', () => {
    const titleBlockStart = detailSheetCode.indexOf('candidate.full_name');
    const titleBlockEnd = detailSheetCode.indexOf('loadOutcome', titleBlockStart);
    const titleBlock = detailSheetCode.slice(titleBlockStart, titleBlockEnd);
    const nuevoIdx = titleBlock.indexOf('Nuevo');
    const porRevisarIdx = titleBlock.indexOf('Por revisar');
    assert.notEqual(nuevoIdx, -1);
    assert.notEqual(porRevisarIdx, -1);
    assert.ok(nuevoIdx < porRevisarIdx, 'Nuevo badge must render before the status badge, as a sibling');
  });
});

describe('Nuevo badge — independent of phone reveal', () => {
  it('candidate list Nuevo condition does not reference phone/phone_reveal fields', () => {
    const idx = dataTableCode.indexOf('isCandidateCreatedToday');
    const line = dataTableCode.slice(Math.max(0, idx - 80), idx + 80);
    assert.equal(/phone/i.test(line), false);
  });

  it('candidate detail Nuevo condition does not reference phone/phone_reveal fields', () => {
    const idx = detailSheetCode.indexOf('isCandidateCreatedToday(candidate.created_at)');
    const line = detailSheetCode.slice(Math.max(0, idx - 80), idx + 80);
    assert.equal(/phone/i.test(line), false);
  });

  it('isCandidateCreatedToday itself has no phone-reveal imports or references', () => {
    const helper = readRepo('src/modules/contact-enrichment/candidate-date-utils.ts');
    assert.equal(/phone/i.test(helper), false);
  });
});

describe('Nuevo badge — no writes triggered merely by rendering', () => {
  it('candidate-date-utils.ts contains no Supabase/DB/server-action calls', () => {
    const helper = readRepo('src/modules/contact-enrichment/candidate-date-utils.ts');
    assert.equal(/supabase|createClient|INSERT|UPDATE|DELETE|'use server'/i.test(helper), false);
  });

  it('helper does not import candidate review / approval / phone-reveal actions', () => {
    const helper = readRepo('src/modules/contact-enrichment/candidate-date-utils.ts');
    assert.equal(/actions'|Action\(/i.test(helper), false);
  });
});
