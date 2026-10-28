/**
 * El pie de un panel lateral no queda pegado al borde.
 *
 * En producción (27-10) el detalle de una etapa del Pipeline mostraba «Ver todos
 * los contactos» y «Buscar más contactos con IA» pegados al borde de abajo,
 * cortados por la esquina redondeada: `DrawerShell` pintaba `footer` tal cual y
 * sólo `actions` llevaba la barra con borde, fondo y margen.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');

describe('DrawerShell — el footer va en la barra del pie', () => {
  const shell = read('components/shared/drawer-shell.tsx');

  it('footer y actions comparten la misma barra (borde, fondo y margen)', () => {
    assert.ok(shell.includes('{footer ?? actions}'));
    // El pie de UBITS (28-10): borde arriba, gris al 40 % y 20px · 12px de margen.
    assert.match(shell, /<SheetFooter className="[^"]*border-t[^"]*px-5 py-3">\s*\{footer \?\? actions\}/);
  });

  it('sólo se pinta suelto con footerBare', () => {
    assert.ok(shell.includes('{footer && footerBare ? ('));
  });

  it('quien usa footerBare trae su propia barra con margen', () => {
    const ownBars = [
      // candidate-detail-sheet → ProspectReviewActions
      read('components/prospects/prospect-review-actions.tsx'),
      // import-candidates-drawer → FooterBar
      read('components/prospect-batches/import-candidates-footer.tsx'),
    ];
    for (const source of ownBars) {
      assert.match(source, /className="shrink-0 border-t [^"]*px-\d+ py-3"/);
    }
    assert.ok(read('components/prospect-batches/candidate-detail-sheet.tsx').includes('footerBare'));
    assert.ok(read('components/prospect-batches/import-candidates-drawer.tsx').includes('footerBare'));
  });
});

describe('ModalShell — mismo criterio', () => {
  it('footer y actions van en DialogFooter', () => {
    assert.ok(read('components/shared/modal-shell.tsx').includes('<DialogFooter>{footer ?? actions}</DialogFooter>'));
  });
});
