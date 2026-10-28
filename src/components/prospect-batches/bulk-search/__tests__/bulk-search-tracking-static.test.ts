/**
 * Búsqueda masiva · seguimiento (PR 4) — contrato ESTÁTICO: el Centro de
 * procesos conduce las rondas aunque esté cerrado o plegado, Growth agrupa las
 * rondas en su búsqueda y «Asignar a…» usa la asignación de siempre.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

const TRAY = read('components/prospect-batches/agent-runs-tray/agent-runs-tray.tsx');
const ROWS = read('components/prospect-batches/bulk-search/bulk-search-rows.tsx');
const WORKSPACE = read('components/growth/growth-workspace.tsx');
const GROWTH = read('app/(sellup)/growth/page.tsx');
const DRAWER = read('components/prospect-batches/bulk-search/bulk-search-assign-drawer.tsx');
const PENDING = read('modules/prospect-batches/bulk-search/bulk-search-assign-actions.ts');

describe('el Centro de procesos conduce', () => {
  it('monta el conductor dentro de la lista, que queda montada aunque el centro esté cerrado', () => {
    assert.ok(TRAY.includes('<BulkSearchRows onActiveChange={setBulkSearchActive}'));
    assert.ok(TRAY.includes('keepMounted'));
  });

  it('una búsqueda en curso cuenta como trabajo en curso y el centro no se ve vacío', () => {
    assert.ok(TRAY.includes('if (bulkSearchActive) counts.running += 1;'));
    assert.ok(TRAY.includes('!bulkSearchVisible'));
  });

  it('retoma al volver a la pestaña y al lanzar una nueva', () => {
    assert.ok(ROWS.includes("document.addEventListener('visibilitychange', onVisible)"));
    assert.ok(ROWS.includes('window.addEventListener(BULK_SEARCH_STARTED_EVENT, onStarted)'));
  });

  it('una pestaña no conduce dos veces la misma búsqueda', () => {
    assert.ok(ROWS.includes('if (drivingRef.current.has(id) || !aliveRef.current) return;'));
  });

  it('sin acceso (bandera apagada o no es Growth) no vuelve a preguntar', () => {
    assert.ok(ROWS.includes('enabledRef.current = false'));
  });
});

describe('Prospección masiva', () => {
  it('lista las búsquedas masivas solo con acceso', () => {
    assert.ok(GROWTH.includes('const bulkAccess = await resolveBulkSearchAccess();'));
    assert.ok(GROWTH.includes('bulkAccess.ok ? await listBulkSearchesForUser(bulkAccess.userId)'));
  });

  it('las rondas se ven en su búsqueda, no como búsquedas sueltas', () => {
    assert.ok(WORKSPACE.includes('searches.filter((row) => !roundBatchIds.has(row.id))'));
    assert.ok(WORKSPACE.includes('data={tableSearches}'));
  });
});

describe('«Asignar a…» en bloque', () => {
  it('reparte con splitEvenly y asigna con la acción de siempre', () => {
    assert.ok(DRAWER.includes('splitEvenly(ids, selected)'));
    assert.ok(DRAWER.includes('assignCandidatesToUser(share.ids, share.userId)'));
  });

  it('las empresas son solo de una búsqueda propia y las mismas que se pueden asignar en «Por revisar»', () => {
    assert.ok(PENDING.includes('await resolveBulkSearchAccess()'));
    assert.ok(PENDING.includes(".eq('created_by', access.userId)"));
    assert.ok(PENDING.includes('NON_ASSIGNABLE_CANDIDATE_STATUSES'));
  });
});

describe('la barra de avance dice la verdad', () => {
  it('el indicador del Progress no se estira: respeta el width que pone Base UI', () => {
    const progress = read('components/ui/progress.tsx');
    const block = progress.slice(progress.indexOf('<ProgressPrimitive.Indicator'), progress.indexOf('/>', progress.indexOf('<ProgressPrimitive.Indicator')));
    const indicator = block.match(/className=\{cn\("([^"]*)"/)?.[1] ?? '';
    assert.ok(indicator.includes('h-full'), 'el indicador tiene que leer su className');
    assert.equal(/\bflex-1\b/.test(indicator), false, 'flex-1 llenaba toda barra sin importar el valor');
    assert.equal(/\bsize-full\b/.test(indicator), false);
  });
});
