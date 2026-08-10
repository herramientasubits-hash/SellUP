/**
 * Agente 2A — MAPEO del motivo de supresión entre los dos vocabularios
 * (AGENT2A-PHONE-REVEAL-4O-E2)
 *
 * El defecto que estas pruebas hacen imposible: `contact_enrichment_candidate_phones
 * .suppression_reason` (migración 109) y `phone_reveal_cache.suppression_reason` /
 * `phone_reveal_suppression_audit.reason_code` (migración 099) tienen nombres casi
 * idénticos y CERO valores en común. Un pass-through no falla en una fila rara:
 * falla en el 100% con un 23514, y solo en runtime — es exactamente la forma del
 * defecto que en el hilo de Agente 1 perdió «Almacenes La 14».
 *
 * Lo que se fija aquí:
 *   * TODO valor de origen tiene imagen, y la imagen está en la CHECK de la 109
 *     LEÍDA DEL SQL (no de una copia en TypeScript);
 *   * ningún valor de origen sobrevive tal cual: el pass-through es imposible;
 *   * `test_synthetic` no introduce un cuarto valor en Producción;
 *   * el mapeo es exhaustivo POR COMPILACIÓN, comprobado leyendo el `never`.
 *
 * Sin red, sin Supabase, sin proveedores, sin reloj, sin créditos.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  CANDIDATE_PHONE_SUPPRESSION_REASONS,
  SUPPRESSION_REASON_SOURCE_CODES,
  mapSuppressionReasonToCandidatePhoneReason,
} from '../candidate-phone-suppression-reason-mapping';
import { PHONE_CACHE_SUPPRESSION_REASON_CODES } from '../phone-cache-suppression-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const read = (...segments: string[]): string =>
  readFileSync(join(REPO_ROOT, ...segments), 'utf8');

const MIGRATION_109 = ['supabase', 'migrations', '109_contact_enrichment_candidate_phones.sql'];
const MIGRATION_112 = ['supabase', 'migrations', '112_suppress_candidate_phone_collection.sql'];

/** Valores admitidos por la CHECK de la 109, LEÍDOS del SQL. */
function collectionReasonsFromMigration(): string[] {
  const sql = read(...MIGRATION_109);
  const block = sql.match(
    /contact_enrichment_candidate_phones_suppression_reason_check\s*CHECK \(([\s\S]*?)\)\)/,
  );
  assert.ok(block, 'no se encontró la CHECK de suppression_reason en la 109');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
}

// ═══════════════════════════════════════════════════════════════
// § 5 — los dos vocabularios y su intersección vacía
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 5 · los dos vocabularios son distintos', () => {
  it('el vocabulario de la colección es EXACTAMENTE el de la CHECK de la 109', () => {
    assert.deepEqual(
      [...CANDIDATE_PHONE_SUPPRESSION_REASONS].sort(),
      collectionReasonsFromMigration(),
    );
  });

  it('la intersección de los dos vocabularios es VACÍA', () => {
    // Esta es la razón por la que el mapeo tiene que existir. Si algún día se
    // solaparan, este test lo diría antes de que alguien "simplificara" el mapeo.
    const overlap = PHONE_CACHE_SUPPRESSION_REASON_CODES.filter((code) =>
      (CANDIDATE_PHONE_SUPPRESSION_REASONS as readonly string[]).includes(code),
    );
    assert.deepEqual(overlap, []);
  });

  it('el módulo reexporta la MISMA lista de origen que valida la caché', () => {
    assert.equal(
      SUPPRESSION_REASON_SOURCE_CODES,
      PHONE_CACHE_SUPPRESSION_REASON_CODES,
      'una copia de la lista se quedaría atrás en silencio',
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 23 — un test por CADA valor real del dominio de origen
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 23 · mapeo exhaustivo y justificado', () => {
  /** Mapeo esperado, con la justificación que lo sostiene. */
  const EXPECTED: Record<string, { to: string; why: string }> = {
    dsar_erasure_request: {
      to: 'data_subject_request',
      why: 'un DSAR es por definición el titular ejerciendo su derecho de supresión',
    },
    do_not_contact_request: {
      to: 'data_subject_request',
      why: 'lo pide la persona; el derecho ejercido es oposición, pero el titular es el mismo',
    },
    legal_privacy_request: {
      to: 'data_subject_request',
      why: 'llega por el abogado del titular o una autoridad que actúa sobre su derecho: el vehículo cambia, el interesado no',
    },
    admin_privacy_correction: {
      to: 'operator_request',
      why: 'nadie de fuera lo pidió: SellUp corrige su propio dato',
    },
    test_synthetic: {
      to: 'operator_request',
      why: 'una supresión de prueba la origina un operador, y no se inventa un cuarto valor en la CHECK de Producción',
    },
  };

  it('cubre TODOS los valores de origen y ninguno más', () => {
    assert.deepEqual(
      [...PHONE_CACHE_SUPPRESSION_REASON_CODES].sort(),
      Object.keys(EXPECTED).sort(),
      'un motivo nuevo sin entrada aquí quedaría sin justificación documentada',
    );
  });

  for (const [source, { to, why }] of Object.entries(EXPECTED)) {
    it(`${source} → ${to} (${why})`, () => {
      const mapped = mapSuppressionReasonToCandidatePhoneReason(
        source as (typeof PHONE_CACHE_SUPPRESSION_REASON_CODES)[number],
      );
      assert.equal(mapped, to);
      // La salida pertenece SIEMPRE a la CHECK de la 109.
      assert.ok(
        collectionReasonsFromMigration().includes(mapped),
        `${mapped} no está en la CHECK de la migración 109`,
      );
    });
  }

  it('NINGÚN valor de origen sobrevive tal cual: el pass-through es imposible', () => {
    for (const source of PHONE_CACHE_SUPPRESSION_REASON_CODES) {
      const mapped = mapSuppressionReasonToCandidatePhoneReason(source);
      assert.notEqual(
        mapped,
        source as string,
        `${source} se devolvió sin traducir: la CHECK de la 109 lo rechazaría`,
      );
    }
  });

  it('`test_synthetic` no filtra vocabulario de pruebas a la colección', () => {
    const mapped = mapSuppressionReasonToCandidatePhoneReason('test_synthetic');
    assert.notEqual(mapped, 'test_synthetic');
    assert.equal(
      collectionReasonsFromMigration().includes('test_synthetic'),
      false,
      'la CHECK de la 109 no debe admitir un valor de pruebas',
    );
  });

  it('`provider_retraction` no es la imagen de ningún motivo de origen', () => {
    // No se fuerza ningún origen hacia él solo para "usar los tres": el
    // vocabulario de la caché no tiene un valor que signifique retractación del
    // proveedor.
    const images = PHONE_CACHE_SUPPRESSION_REASON_CODES.map(
      mapSuppressionReasonToCandidatePhoneReason,
    );
    assert.equal(images.includes('provider_retraction'), false);
  });

  it('un valor fuera del vocabulario de origen LANZA en vez de inventar un motivo', () => {
    assert.throws(
      () =>
        mapSuppressionReasonToCandidatePhoneReason(
          'not_a_reason' as (typeof PHONE_CACHE_SUPPRESSION_REASON_CODES)[number],
        ),
      /unmapped phone suppression reason code/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
// § 23 — guard estático: exhaustividad por COMPILACIÓN
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 23 · guards estáticos del mapeo', () => {
  const source = read(
    'src',
    'modules',
    'contact-enrichment',
    'candidate-phone-suppression-reason-mapping.ts',
  );

  it('el `default` asigna la entrada a `never` (añadir un motivo rompe la build)', () => {
    assert.match(source, /const exhaustive:\s*never\s*=\s*reason/);
  });

  it('no hay `default` silencioso: el fallback lanza', () => {
    const def = source.match(/default:\s*\{([\s\S]*?)\n {4}\}/);
    assert.ok(def, 'no se encontró el bloque default');
    assert.match(def[1], /throw new Error/);
    assert.equal(/return /.test(def[1]), false, 'el default no puede devolver un motivo');
  });

  it('el mapeo nunca devuelve la variable de entrada', () => {
    // `return reason` en cualquiera de sus formas sería el pass-through.
    assert.equal(/return\s+reason\b/.test(source), false);
    assert.equal(/return\s+input\b/.test(source), false);
  });

  it('el módulo es puro: sin Supabase, sin fetch, sin reloj', () => {
    for (const banned of [
      'createSupabaseAdminClient',
      'createClient',
      'fetch(',
      'Date.now',
      'new Date(',
      'console.',
    ]) {
      assert.equal(source.includes(banned), false, `no debe usar ${banned}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// § 5 — la migración 112 RECHAZA el vocabulario de origen
// ═══════════════════════════════════════════════════════════════

describe('4O-E2 § 5 · la RPC no acepta el vocabulario de la caché', () => {
  const sql = read(...MIGRATION_112);

  it('la RPC valida el motivo contra el vocabulario de la 109 y solo ese', () => {
    const reasons = sql.match(/c_reasons\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/);
    assert.ok(reasons, 'no se encontró el vocabulario de motivos en la RPC');
    const values = [...reasons[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    assert.deepEqual(values, collectionReasonsFromMigration());
  });

  it('un motivo fuera de ese vocabulario devuelve invalid_input sin escribir', () => {
    assert.match(sql, /'suppression_reason_unknown'/);
    // El rechazo está ANTES del primer UPDATE.
    const rejectAt = sql.indexOf("'suppression_reason_unknown'");
    const firstUpdateAt = sql.search(
      /UPDATE public\.contact_enrichment_candidate_phones/,
    );
    assert.notEqual(rejectAt, -1);
    assert.notEqual(firstUpdateAt, -1);
    assert.ok(rejectAt < firstUpdateAt, 'la validación debe preceder a toda escritura');
  });

  it('ningún valor del vocabulario de la caché aparece como aceptado en la RPC', () => {
    for (const code of PHONE_CACHE_SUPPRESSION_REASON_CODES) {
      // Aparece en la PROSA que explica por qué se rechaza; nunca en una
      // comparación ejecutable.
      assert.equal(
        new RegExp(`p_suppression_reason\\s*=\\s*'${code}'`).test(sql),
        false,
        `la RPC no debe comparar contra ${code}`,
      );
    }
  });
});
