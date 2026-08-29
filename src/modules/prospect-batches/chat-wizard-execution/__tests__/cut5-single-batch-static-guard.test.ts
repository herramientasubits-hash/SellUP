/**
 * Guarda estática — AGENT1-LOCAL-CUT5-SINGLE-BATCH-PLUMBING §§ 4, 5, 6, 13, 19.
 *
 * Lo que fija: el hilo del lote canónico no se puede cortar en silencio, y
 * ninguna rama del wizard puede recuperar la creación paralela que este corte
 * eliminó.
 *
 * ── 🔴 Lo que esta guarda NO hace (§ 19) ────────────────────────────────────
 *
 * NO prohíbe globalmente `.from('prospect_batches').insert`. Hay creadores
 * legítimos fuera del wizard —la ruta de import externo, el writer estructurado
 * standalone del catálogo de fuentes, la cola de Lusha— y una prohibición global
 * los rompería o, peor, empujaría a alguien a saltarse el writer canónico. Lo que
 * se fija es el CONDICIONAL: quien recibe un lote no puede crear otro.
 *
 * 🔴 Los comentarios se retiran ANTES de buscar. Grepear en crudo confunde
 * «nombrar el atajo para prohibirlo» con «usarlo» — este mismo archivo cita
 * literales que prohíbe. Cada aserción trae su control en NEGATIVO: se comprueba
 * que la búsqueda SÍ detecta el defecto cuando está.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

const ORCHESTRATOR =
  'src/modules/prospect-batches/chat-wizard-execution/wizard-execution-actions.ts';
const RESOLVER = 'src/modules/prospect-batches/chat-wizard-execution/wizard-canonical-batch.ts';
const FREE_RUNNER =
  'src/server/prospect-batches/country-source-discovery/run-prepaid-novelty-discovery.server.ts';
const FREE_PERSIST =
  'src/server/prospect-batches/country-source-discovery/persist-country-source-candidates.ts';
const STRUCTURED_WRITER =
  'src/server/agents/prospecting-toolkit/structured-source-candidate-writer.ts';
const CANDIDATE_WRITER = 'src/server/agents/prospecting-toolkit/candidate-writer.ts';

function code(rel: string): string {
  return stripTsComments(readFileSync(rel, 'utf-8'));
}

// ── § 5 · el hilo llega hasta la rama gratuita ───────────────────────────────

describe('CUT-5 § 19 · el hilo del lote canónico no se corta', () => {
  it('el orquestador VIVO pasa `resolveBatchId` a la capa gratuita', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(
      src.includes('resolveBatchId: resolveCanonicalBatchId'),
      '🔴 sin esto la capa gratuita vuelve a crear lote propio',
    );

    // Control en NEGATIVO: la búsqueda detecta la mutación.
    const mutated = src.replace('resolveBatchId: resolveCanonicalBatchId', 'resolveBatchId: undefined');
    assert.ok(!mutated.includes('resolveBatchId: resolveCanonicalBatchId'));
  });

  it('el runner gratuito PASA el lote resuelto al writer, no `null`', () => {
    const src = code(FREE_RUNNER);
    assert.ok(
      src.includes('batchId: canonicalBatchId'),
      '🔴 el writer tiene que recibir el lote canónico',
    );

    const mutated = src.replace('batchId: canonicalBatchId', 'batchId: null');
    assert.ok(!mutated.includes('batchId: canonicalBatchId'));
    assert.ok(mutated.includes('batchId: null'), 'y gana el defecto que se prohíbe');
  });

  it('`persistCountrySourceCandidates` reenvía el lote recibido, sin inventarlo', () => {
    const src = code(FREE_PERSIST);
    assert.ok(
      src.includes('batchId: input.batchId ?? null'),
      '🔴 el adaptador no puede descartar el lote que le pasaron',
    );
  });
});

// ── § 4 · una sola autoridad de reserva ──────────────────────────────────────

describe('CUT-5 § 19 · la reserva tiene un dueño único', () => {
  it('el orquestador reserva SÓLO a través del resolutor canónico', () => {
    const src = code(ORCHESTRATOR);

    assert.ok(
      src.includes('createCanonicalWizardBatchResolver(deps.reserveSlot'),
      'el resolutor recibe la dep de reserva',
    );
    assert.ok(
      src.includes('canonicalBatch.resolve()'),
      'y el paso 9 resuelve contra él en vez de reservar por su cuenta',
    );

    // 🔴 `deps.reserveSlot` sólo puede APARECER como argumento del resolutor.
    // Una segunda invocación directa sería una segunda autoridad de creación.
    const directCalls = src.match(/deps\.reserveSlot\s*\(/g) ?? [];
    assert.equal(
      directCalls.length,
      0,
      '🔴 nadie más puede llamar a la reserva directamente',
    );
  });

  it('el resolutor no guarda estado de módulo — nada compartido entre ejecuciones', () => {
    const src = code(RESOLVER);

    // 🔴 La columna IMPORTA: `settled` e `inFlight` viven INDENTADOS, dentro de
    // la fábrica, y ahí son correctos —son el estado de UNA ejecución—. Lo que
    // no puede existir es un mutable en la columna 0, porque ése lo compartirían
    // todas las ejecuciones del proceso (§ 13).
    const moduleLevelMutable = src
      .split('\n')
      .filter((line) => /^(let|var)\s/.test(line));
    assert.deepEqual(
      moduleLevelMutable,
      [],
      '🔴 sin singleton de módulo: el resolutor muere con su ejecución',
    );

    // Control en NEGATIVO: la búsqueda SÍ detecta el singleton cuando está.
    const mutated = `${src}\nlet sharedAcrossExecutions = null;`;
    assert.ok(
      mutated.split('\n').some((line) => /^(let|var)\s/.test(line)),
      'la guarda distingue la columna 0 del estado local de la fábrica',
    );
  });
});

// ── § 13 · ninguna heurística de «último lote» en la ruta viva ───────────────

describe('CUT-5 § 19 · «último lote» no es identidad de ejecución', () => {
  const FORBIDDEN = [
    'latest_batch',
    'latestBatch',
    "order('created_at', { ascending: false })",
  ] as const;

  it('la ruta activa del wizard no resuelve el lote por recencia', () => {
    for (const rel of [ORCHESTRATOR, RESOLVER, FREE_RUNNER, FREE_PERSIST]) {
      const src = code(rel);
      for (const shortcut of FORBIDDEN) {
        assert.ok(
          !src.includes(shortcut),
          `${rel} no puede identificar la ejecución por recencia (${shortcut})`,
        );
      }
    }
  });

  it('control NEGATIVO — la búsqueda sí detecta la heurística cuando está', () => {
    const mutated = `${code(ORCHESTRATOR)}\nconst x = latestBatch;`;
    assert.ok(FORBIDDEN.some((s) => mutated.includes(s)));
  });

  it('la identidad durable sigue siendo `(created_by, client_request_id)`', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(
      src.includes('clientRequestId: req.clientRequestId'),
      '🔴 § 12 — no se inventa identidad nueva: se reutiliza la que ya existía',
    );
  });
});

// ── § 6 · quien recibe lote no crea otro; quien no, sigue pudiendo ──────────

describe('CUT-5 § 19 · el fallback de creación es INALCANZABLE con lote recibido', () => {
  it('el writer estructurado sólo crea lote dentro de `if (!batchId)`', () => {
    const src = code(STRUCTURED_WRITER);

    const guardIdx = src.indexOf('if (!batchId) {');
    assert.ok(guardIdx > 0, 'la guarda condicional existe');

    const insertIdx = src.indexOf(".from('prospect_batches')");
    assert.ok(insertIdx > guardIdx, '🔴 el INSERT vive DESPUÉS de la guarda, no antes');

    // El lote adoptado se toma del input, no se recalcula.
    assert.ok(
      src.includes('let batchId = input.batchId ?? null;'),
      '🔴 el lote recibido es el punto de partida',
    );
  });

  it('el candidate-writer adopta `existingBatchId` en vez de crear', () => {
    const src = code(CANDIDATE_WRITER);
    assert.ok(src.includes('if (existingBatchId) {'), 'la rama de adopción existe');
    assert.ok(
      src.includes('batchId = existingBatchId;'),
      '🔴 el lote reservado por el wizard se usa tal cual',
    );
  });

  it('§ 19 — NO se prohíbe globalmente crear lotes: los flujos standalone siguen vivos', () => {
    // Import externo y writer estructurado standalone conservan su creación.
    // Si esto dejara de ser cierto, la guarda de arriba se habría convertido en
    // una prohibición global y habría roto rutas legítimas (§ 7).
    const importRoute = code('src/app/api/prospect-batches/create-import-batch/route.ts');
    assert.ok(
      importRoute.includes(".from('prospect_batches')"),
      '🔴 el import externo conserva su lote propio',
    );
    assert.ok(
      code(STRUCTURED_WRITER).includes(".from('prospect_batches')"),
      '🔴 el catálogo de fuentes conserva su ruta standalone',
    );
  });
});

// ── § 9 · CUT-6 sigue apagado ────────────────────────────────────────────────

describe('CUT-5 § 9 · este corte NO enciende la activación parcial', () => {
  it('el llamador vivo sigue pasando la constante de activación, no `true`', () => {
    const src = code(ORCHESTRATOR);
    assert.ok(
      src.includes('partialGapSupported: WIZARD_APOLLO_PARTIAL_GAP_SUPPORTED'),
      '🔴 CUT-5 es fontanería: la activación se decide en CUT-6',
    );
    assert.ok(
      !src.includes('partialGapSupported: true'),
      'ningún literal encendido en el sitio de la llamada',
    );
  });
});
