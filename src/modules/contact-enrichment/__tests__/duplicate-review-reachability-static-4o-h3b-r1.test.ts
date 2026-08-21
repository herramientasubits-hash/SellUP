/**
 * Tests estáticos — alcanzabilidad de la revisión de duplicados y frontera de diagnóstico
 * (AGENT2A-PHONE-REVEAL-4O-H3-B-R1 · § 5, § 6, § 11, § 15, § 16).
 *
 * Estos tests leen el CÓDIGO FUENTE. Es deliberado: lo que hay que fijar aquí no es un valor
 * devuelto sino la FORMA de las consultas y de la instrumentación —qué estados admite el
 * cargador, qué cuenta cada contador, y dónde queda el rastro cuando algo falla—. Un test de
 * runtime con el cliente de Supabase mockeado no puede verlo, porque el mock ES la consulta.
 *
 * 0 red, 0 DB, 0 proveedores, 0 créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REVIEWABLE_CONTACT_CANDIDATE_STATUSES } from '../reviewable-candidate-statuses';
import { isNextControlFlowSignal } from '../next-control-flow-signal';

const MODULE_DIR = join(process.cwd(), 'src', 'modules', 'contact-enrichment');
const COMPONENT_DIR = join(process.cwd(), 'src', 'components', 'contact-enrichment');

const actionsSource = readFileSync(join(MODULE_DIR, 'actions.ts'), 'utf8');

/**
 * Aísla el cuerpo de una función exportada de `actions.ts` para poder afirmar sobre ELLA.
 *
 * Corta en la llave de cierre a nivel superior (`\n}`), NO en el siguiente `export`: si cortara
 * ahí se tragaría el JSDoc de la función siguiente y las aserciones mirarían texto ajeno.
 */
function functionBody(source: string, name: string): string {
  const signature = `export async function ${name}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `no se encontró la función ${name}`);
  const rest = source.slice(start + signature.length);
  const end = rest.indexOf('\n}');
  assert.notEqual(end, -1, `no se encontró el cierre de ${name}`);
  return rest.slice(0, end);
}

/** Los argumentos de cada `console.error(...)` del fragmento — el rastro, y nada más. */
function consoleErrorPayloads(body: string): string[] {
  const payloads: string[] = [];
  let index = body.indexOf('console.error(');
  while (index !== -1) {
    const from = index + 'console.error('.length;
    // Balanceo de paréntesis: el payload es un objeto literal multilínea.
    let depth = 1;
    let cursor = from;
    while (cursor < body.length && depth > 0) {
      const char = body[cursor];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      cursor += 1;
    }
    payloads.push(body.slice(from, cursor - 1));
    index = body.indexOf('console.error(', cursor);
  }
  return payloads;
}

// ═══════════════════════════════════════════════════════════════
// 1. § 5 — la API de estados revisables es EXPLÍCITA
// ═══════════════════════════════════════════════════════════════

describe('1 — § 5 estados revisables explícitos', () => {
  it('1a la lista es exactamente `pending_review` + `duplicate`', () => {
    assert.deepEqual(
      [...REVIEWABLE_CONTACT_CANDIDATE_STATUSES],
      ['pending_review', 'duplicate'],
      'ampliar esta lista es una decisión de producto: debe romper este ratchet',
    );
  });

  it('1b los estados TERMINALES quedan fuera', () => {
    // `discarded` es el estado de un candidato rechazado en este esquema (no existe un
    // `rejected` ni un `blocked_suppressed` en `contact_enrichment_candidates.status`).
    for (const terminal of ['approved', 'discarded']) {
      assert.equal(
        (REVIEWABLE_CONTACT_CANDIDATE_STATUSES as readonly string[]).includes(terminal),
        false,
        `${terminal} NO puede abrirse en el detalle de revisión`,
      );
    }
  });

  it('1b-bis la constante NO vive en el módulo `use server`', () => {
    // Next 16 rechaza el build entero con «A "use server" file can only export async functions,
    // found object» si un módulo de server actions exporta un valor. Este ratchet convierte ese
    // fallo de BUILD en un fallo de TEST, que es mucho más barato de descubrir.
    assert.ok(actionsSource.startsWith("'use server'"), 'actions.ts es un módulo de server actions');
    for (const match of actionsSource.matchAll(/^export (const|let|var|class|interface|type|enum) (\w+)/gm)) {
      const [, kind, name] = match;
      // `interface` y `type` se borran en compilación: no llegan al runtime y están permitidos.
      if (kind === 'interface' || kind === 'type') continue;
      assert.fail(
        `actions.ts no puede exportar \`${kind} ${name}\`: un módulo 'use server' sólo exporta funciones async`,
      );
    }
  });

  it('1c el cargador filtra por esa lista, NO por «cualquier estado no nulo»', () => {
    const body = functionBody(actionsSource, 'getReviewableContactCandidateById');

    assert.ok(
      body.includes(".in('status', REVIEWABLE_CONTACT_CANDIDATE_STATUSES)"),
      'debe filtrar por la constante explícita',
    );
    assert.equal(
      body.includes(".eq('status', 'pending_review')"),
      false,
      'ya no puede restringirse sólo a pendientes: un duplicado dejaría de abrirse',
    );
    // Las formas de «déjalo pasar todo» que § 5 prohíbe explícitamente.
    for (const pattern of ['status !== null', 'status != null', '.not(']) {
      assert.equal(body.includes(pattern), false, `el filtro no puede ser «${pattern}»`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. § 6 — el nombre ya no miente
// ═══════════════════════════════════════════════════════════════

describe('2 — § 6 rename', () => {
  it('2a no queda ninguna función «Pending…ById» que acepte duplicados', () => {
    assert.equal(
      actionsSource.includes('getPendingContactCandidateById'),
      false,
      'una función llamada "Pending" que admite `duplicate` es un nombre falso',
    );
  });

  it('2b el consumidor del drawer usa el nombre nuevo', () => {
    const sheet = readFileSync(
      join(COMPONENT_DIR, 'contact-candidate-detail-sheet.tsx'),
      'utf8',
    );
    assert.ok(sheet.includes('getReviewableContactCandidateById'));
    assert.equal(sheet.includes('getPendingContactCandidateById'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. § 11 — los conteos NO cambian de significado
// ═══════════════════════════════════════════════════════════════

describe('3 — § 11 conteos separados', () => {
  it('3a «Por revisar» sigue contando SÓLO `pending_review`', () => {
    const body = functionBody(actionsSource, 'getPendingContactCandidatesCount');
    assert.ok(body.includes(".eq('status', 'pending_review')"));
    assert.equal(
      body.includes('duplicate'),
      false,
      'sumar duplicados aquí cambiaría el significado de una métrica existente',
    );
  });

  it('3b los duplicados tienen su propio conteo', () => {
    const body = functionBody(actionsSource, 'getDuplicateContactCandidatesCount');
    assert.ok(body.includes(".eq('status', 'duplicate')"));
  });

  it('3c el listado de pendientes y el de duplicados son consultas distintas y disjuntas', () => {
    const pending = functionBody(actionsSource, 'getPendingContactCandidates');
    const duplicates = functionBody(actionsSource, 'getDuplicateContactCandidates');

    assert.ok(pending.includes(".eq('status', 'pending_review')"));
    assert.ok(duplicates.includes(".eq('status', 'duplicate')"));
    // Ninguna de las dos puede colar estados terminales.
    for (const body of [pending, duplicates]) {
      assert.equal(body.includes("'approved'"), false);
      assert.equal(body.includes("'discarded'"), false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. § 15 — el rastro cubre TODA la función, no sólo la query
// ═══════════════════════════════════════════════════════════════

describe('4 — § 15 diagnóstico del load_error', () => {
  const body = functionBody(actionsSource, 'getReviewableContactCandidateById');

  it('4a el fallo de la LECTURA sigue registrándose en el servidor', () => {
    assert.ok(body.includes("read_failed"));
    assert.ok(body.includes('code: error.code'));
  });

  it('4b los fallos ARRIBA de la lectura también dejan rastro, con su etapa', () => {
    // Esto es exactamente lo que faltaba: en el fallo observado en Producción no hubo NINGUNA
    // petición a Supabase, así que el rastro post-query de #279 no podía existir.
    assert.ok(body.includes('load_failed'), 'debe haber un rastro para el fallo no-de-lectura');
    assert.ok(body.includes('stage'), 'el rastro debe decir en qué frontera se rompió');
    for (const stage of ["'session'", "'client'", "'read'", "'map'"]) {
      assert.ok(body.includes(stage), `la etapa ${stage} debe estar cubierta`);
    }
  });

  it('4c NINGÚN rastro puede llevar PII del candidato', () => {
    // Se afirma sobre los ARGUMENTOS del log, no sobre todo el cuerpo: el cuerpo contiene
    // legítimamente `const { data, error } = ...`, que no es un rastro.
    const payloads = consoleErrorPayloads(body);
    assert.ok(payloads.length >= 2, 'debe haber rastro de lectura y rastro de etapa');

    for (const payload of payloads) {
      // Sólo id (uuid), etapa y códigos. La proyección lleva nombre, email y teléfono.
      for (const pii of [
        'full_name',
        'email',
        'phone',
        'linkedin_url',
        'data',
        'candidate.',
        'JSON.stringify',
      ]) {
        assert.equal(
          payload.includes(pii),
          false,
          `el rastro no puede incluir «${pii}» — payload: ${payload.trim()}`,
        );
      }
    }
  });

  it('4d las señales de control de flujo de Next se RE-LANZAN, no se registran como fallo', () => {
    assert.ok(
      body.includes('isNextControlFlowSignal'),
      'un `redirect()` tragado convierte una sesión caducada en «no se pudo cargar»',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. La detección de señales de Next
// ═══════════════════════════════════════════════════════════════

describe('5 — isNextControlFlowSignal', () => {
  it('5a reconoce el digest de redirect()', () => {
    assert.equal(
      isNextControlFlowSignal(
        Object.assign(new Error('x'), { digest: 'NEXT_REDIRECT;replace;/login;307;' }),
      ),
      true,
    );
  });

  it('5b reconoce el digest de notFound() y del resto de HTTP access fallbacks', () => {
    assert.equal(
      isNextControlFlowSignal(Object.assign(new Error('x'), { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })),
      true,
    );
  });

  it('5c NO confunde un fallo real con una señal', () => {
    assert.equal(isNextControlFlowSignal(new Error('read failed')), false);
    assert.equal(isNextControlFlowSignal(null), false);
    assert.equal(isNextControlFlowSignal(undefined), false);
    assert.equal(isNextControlFlowSignal('NEXT_REDIRECT'), false, 'un string no es un error');
    assert.equal(
      isNextControlFlowSignal(Object.assign(new Error('x'), { digest: 42 })),
      false,
      'un digest no-string no es una señal',
    );
    assert.equal(
      isNextControlFlowSignal(
        Object.assign(new Error('x'), { digest: 'NEXT_REDIRECTISH_THING' }),
      ),
      false,
      'el prefijo debe estar delimitado, no ser un simple startsWith laxo',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. § 16 — la cola de duplicados es alcanzable desde la navegación
// ═══════════════════════════════════════════════════════════════

describe('6 — § 16 superficie de duplicados', () => {
  it('6a existe una ruta propia para la cola de duplicados', () => {
    const nav = readFileSync(join(process.cwd(), 'src', 'config', 'navigation.ts'), 'utf8');
    assert.ok(nav.includes('CONTACTS_DUPLICATES_ROUTE'));
    assert.ok(nav.includes('tab=duplicates'));
  });

  it('6b la pill de duplicados está separada de «Candidatos por revisar»', () => {
    const tabs = readFileSync(
      join(process.cwd(), 'src', 'components', 'navigation', 'contacts-module-tabs-nav.tsx'),
      'utf8',
    );
    assert.ok(tabs.includes('"duplicates"'));
    assert.ok(tabs.includes('Duplicados'));
    assert.ok(tabs.includes('Candidatos por revisar'), 'la cola histórica no desaparece');
  });

  it('6c la página resuelve la cola de duplicados a su propio panel', () => {
    const page = readFileSync(
      join(process.cwd(), 'src', 'app', '(sellup)', 'contacts', 'page.tsx'),
      'utf8',
    );
    assert.ok(page.includes("tab === 'duplicates'"));
    assert.ok(page.includes('queue="duplicates"'));
  });
});
