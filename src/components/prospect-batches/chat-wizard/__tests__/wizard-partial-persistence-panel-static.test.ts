/**
 * Pruebas estáticas de la CADENA de la persistencia PARCIAL y de la ficha de
 * subindustria.
 *
 * AGENT1-APOLLO-CANDIDATE-INSERT-FORENSICS-1 · § 7, § 10 y § 11.
 *
 * El copy correcto no sirve si la UI no lo pide, y las cifras correctas no
 * sirven si el servidor no las envía. Estas pruebas de texto fuente sostienen la
 * cadena contra ediciones futuras:
 *
 *   1. el writer publica duplicados tardíos, completos y pendientes de revisión;
 *   2. la acción los proyecta hacia el cliente junto al estado de tres valores;
 *   3. el panel NO pinta el bloque verde de éxito cuando la escritura fue parcial;
 *   4. el panel no se cierra solo ni emite un toast de éxito en ese caso;
 *   5. la ficha del candidato muestra el estado de la subindustria pedida.
 *
 * Sin DOM, sin red, sin base de datos.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = process.cwd();

const FILES = {
  writer: join(ROOT, 'src/server/agents/prospecting-toolkit/candidate-writer.ts'),
  readiness: join(
    ROOT,
    'src/server/agents/prospecting-toolkit/prospect-candidate-persistence-readiness.ts',
  ),
  action: join(
    ROOT,
    'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts',
  ),
  copy: join(ROOT, 'src/modules/prospect-batches/chat-wizard-execution/wizard-result-copy.ts'),
  panels: join(ROOT, 'src/components/prospect-batches/chat-wizard/wizard-execution-panels.tsx'),
  sheet: join(ROOT, 'src/components/prospect-batches/candidate-detail-sheet.tsx'),
  subindustry: join(
    ROOT,
    'src/modules/prospect-batches/candidate-subindustry-status-display.ts',
  ),
};

const src = Object.fromEntries(
  Object.entries(FILES).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
) as Record<keyof typeof FILES, string>;

// ── § 7 — la cadena de cifras llega entera ────────────────────────────────────

describe('§ 7 — el writer publica las cifras administrativas', () => {
  it('el resultado de persistencia acepta duplicados tardíos, completos y revisión', () => {
    for (const field of [
      'lateDuplicateCount',
      'completeValidCandidates',
      'reviewOnlyCandidates',
    ]) {
      assert.match(src.readiness, new RegExp(`${field}\\?: number;`), `falta ${field}`);
    }
  });

  it('el writer las alimenta con el contador canónico, no con el total de filas', () => {
    assert.match(src.writer, /lateDuplicateCount,/);
    assert.match(
      src.writer,
      /completeValidCandidates: canonicalCompletenessCounters\.complete_valid_candidates/,
    );
    assert.match(
      src.writer,
      /reviewOnlyCandidates: canonicalCompletenessCounters\.review_only_candidates/,
    );
  });
});

describe('§ 7 — la acción proyecta el estado de tres valores hacia el cliente', () => {
  it('envía el estado y las cuatro cantidades de la escritura', () => {
    for (const field of [
      'persistenceStatus',
      'persistenceAttemptedCount',
      'persistenceSucceededCount',
      'persistenceFailedCount',
      'persistenceGap',
    ]) {
      assert.match(src.action, new RegExp(`${field}: pipelineResult\\.persistenceOutcome\\.`));
    }
  });

  it('lo no medido viaja como null, no como cero', () => {
    for (const field of [
      'lateDuplicateCount',
      'completeValidCandidates',
      'reviewOnlyCandidates',
    ]) {
      assert.match(src.action, new RegExp(`${field}:[\\s\\S]{0,80}\\?\\? null`), field);
    }
  });
});

// ── § 7 — el panel no miente en ninguna dirección ─────────────────────────────

describe('§ 7 — el panel no presenta una escritura parcial como éxito total', () => {
  it('el bloque verde está gateado por la ausencia de persistencia parcial', () => {
    assert.match(src.panels, /\{!isPartialPersistence && \(/);
    assert.match(src.panels, /isPartialPersistence = resultCopy\.cause === 'persistence_partial'/);
  });

  it('no se cierra solo ni emite un toast de éxito cuando fue parcial', () => {
    const branch = src.panels.slice(
      src.panels.indexOf('if (isPartialPersistence) {'),
      src.panels.indexOf("if (status === 'no_new_candidates') {"),
    );
    assert.ok(branch.length > 0, 'debe existir la rama de persistencia parcial en el efecto');
    assert.doesNotMatch(branch, /toast\.success/);
    assert.doesNotMatch(branch, /onClose\(\)/);
  });

  it('el panel parcial ofrece cerrar pero NO reeditar y relanzar', () => {
    const block = src.panels.slice(src.panels.indexOf('{isPartialPersistence && ('));
    assert.ok(block.length > 0);
    assert.match(block, /Cerrar/);
    assert.doesNotMatch(block, /onEditSearch/);
  });

  it('el desglose administrativo se pinta junto al aviso de persistencia', () => {
    assert.match(src.panels, /buildWizardPersistenceBreakdown/);
    assert.match(src.panels, /data-testid="wizard-persistence-breakdown"/);
  });
});

describe('§ 7 — el núcleo de copy sigue siendo puro', () => {
  it('sin React, sin Supabase, sin env', () => {
    assert.doesNotMatch(src.copy, /from 'react'/);
    assert.doesNotMatch(src.copy, /process\.env/);
    assert.doesNotMatch(src.copy, /supabase/i);
    assert.doesNotMatch(src.copy, /'use client'/);
  });
});

// ── § 10 y § 11 — la ficha del candidato ──────────────────────────────────────

describe('§ 10 — la ficha no etiqueta como Web/IA lo que produjo Apollo', () => {
  it('la procedencia sale del mapa de etiquetas, no de un literal', () => {
    assert.match(src.sheet, /VENDOR_CANDIDATE_SOURCE_LABELS\[candidate\.source_primary\]/);
    assert.doesNotMatch(src.sheet, /'Web\/IA'/);
  });

  it('el writer persiste `apollo` para una corrida de company discovery de Apollo', () => {
    assert.match(
      src.writer,
      /const candidateSourcePrimary = isApolloCompanyDiscoveryRun \? 'apollo' : 'web_ai'/,
    );
  });
});

describe('§ 11 — la ficha muestra el estado de la subindustria pedida', () => {
  it('llama al resolutor puro y pinta el bloque', () => {
    assert.match(src.sheet, /resolveCandidateSubindustryStatus\(/);
    assert.match(src.sheet, /data-testid="candidate-subindustry-status"/);
  });

  it('muestra veredicto, conteo hacia el objetivo y motivos', () => {
    assert.match(src.sheet, /data-testid="candidate-subindustry-verdict"/);
    assert.match(src.sheet, /data-testid="candidate-subindustry-counts-toward-target"/);
    assert.match(src.sheet, /data-testid="candidate-subindustry-review-reasons"/);
  });

  it('el resolutor es puro: sin React, sin Supabase, sin env', () => {
    assert.doesNotMatch(src.subindustry, /from 'react'/);
    assert.doesNotMatch(src.subindustry, /process\.env/);
    assert.doesNotMatch(src.subindustry, /supabase/i);
    assert.doesNotMatch(src.subindustry, /'use client'/);
  });

  it('ninguna empresa está codificada por nombre en el CÓDIGO', () => {
    // Los comentarios sí nombran a las empresas de la corrida `9a9acf99`: son la
    // razón de existir del módulo. Lo que no puede haber es una regla que mire
    // el nombre — sería una lista blanca disfrazada de clasificación.
    const withoutComments = src.subindustry
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const name of ['Juan Valdez', 'Alpina', 'Grupo Diana', 'La 14']) {
      assert.ok(!withoutComments.includes(name), `${name} no puede estar codificada`);
    }
  });
});
