/**
 * AGENT1-CUT3B1-FISCAL-IDENTITY-TRUTH - guarda estática § 9 / § 10.
 *
 * CUT-3A probó que la comparación de NOMBRE entre capas está efectivamente rota
 * porque cada escritor usa un normalizador distinto. Convertir esa señal muerta
 * en un SUPRESOR DURO antes de que exista una semántica de identidad escalonada
 * podría producir fusiones falsas. Por eso este corte NO toca el nombre.
 *
 * Esta guarda demuestra que la identidad FISCAL es el único comportamiento de
 * identidad dura nuevo o cambiado: los módulos que este corte introduce o
 * modifica no consumen normalizadores de nombre, ni dominio, ni identidad de
 * proveedor, ni construyen registro alguno.
 *
 * Metodología: se compara el CUERPO EJECUTABLE (sin comentarios ni cadenas), no
 * el archivo crudo — nombrar algo en prosa no es usarlo en código. La propia
 * guarda se prueba en NEGATIVO al final, para que no pueda pasar por vacía.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOOLKIT_DIR = join(import.meta.dirname, '..');

/**
 * Elimina comentarios de bloque, comentarios de línea y literales de cadena.
 * Lo que queda es el cuerpo que el motor ejecuta.
 */
export function stripNonExecutable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^\\'])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^\\"])*"/g, '""');
}

/**
 * Elimina SÓLO comentarios. Se usa para aserciones sobre especificadores de
 * import: la ruta de un import es estructura ejecutable, no prosa, y por eso no
 * se puede borrar como un literal cualquiera.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

function executableBody(fileName: string): string {
  return stripNonExecutable(readFileSync(join(TOOLKIT_DIR, fileName), 'utf8'));
}

function bodyWithoutComments(fileName: string): string {
  return stripComments(readFileSync(join(TOOLKIT_DIR, fileName), 'utf8'));
}

/** Los DOS módulos que este corte introduce o modifica en la ruta de decisión. */
const CUT_MODULES = ['fiscal-identity.ts', 'tax-id-novelty-checker.ts'] as const;

/**
 * Símbolos de identidad NO fiscal. Ninguno debe aparecer en el cuerpo ejecutable
 * de los módulos del corte.
 */
const FORBIDDEN_IDENTITY_SYMBOLS = [
  'normalizeName',
  'normalizeCompanyName',
  'buildIdentityKey',
  'normalizeDomain',
  'extractDomainFromWebsite',
  'normalizeLinkedinUrl',
  'normalized_name',
  'identity_key',
  'provider_person_id',
  'provider_seen',
] as const;

describe('§ 9 - ninguna supresión por NOMBRE nace en este corte', () => {
  for (const moduleName of CUT_MODULES) {
    it(`${moduleName} no usa normalizadores de nombre ni de dominio`, () => {
      const body = executableBody(moduleName);
      for (const symbol of FORBIDDEN_IDENTITY_SYMBOLS) {
        assert.ok(
          !body.includes(symbol),
          `${moduleName} referencia "${symbol}" en código ejecutable`,
        );
      }
    });
  }

  it('los normalizadores de nombre siguen existiendo intactos y sin nuevo consumidor fiscal', () => {
    // normalization.ts conserva su normalizeCompanyName: este corte no lo unifica.
    const normalization = executableBody('normalization.ts');
    assert.ok(normalization.includes('export function normalizeCompanyName'));
    assert.ok(normalization.includes('export function normalizeTaxIdentifier'));
    // Y no importa la autoridad fiscal: la derivación persistida de identity_key
    // sigue siendo la histórica hasta que CUT-3B2 decida versionado/backfill.
    assert.ok(!/from '\.\/fiscal-identity'/.test(bodyWithoutComments('normalization.ts')));
  });
});

describe('§ 10 - el registro entre capas NO se construye en este corte', () => {
  it('ningún módulo del corte crea tabla, alias ni ON CONFLICT de identidad', () => {
    const forbidden = ['ON CONFLICT', 'onConflict', 'upsert(', 'CREATE TABLE', 'CREATE UNIQUE'];
    for (const moduleName of CUT_MODULES) {
      const body = executableBody(moduleName);
      for (const token of forbidden) {
        assert.ok(!body.includes(token), `${moduleName} contiene "${token}"`);
      }
    }
  });

  it('el checker fiscal sigue sin escribir: ni insert, ni update, ni delete, ni rpc', () => {
    const body = executableBody('tax-id-novelty-checker.ts');
    for (const token of ['.insert(', '.update(', '.delete(', '.rpc(']) {
      assert.ok(!body.includes(token), `tax-id-novelty-checker.ts contiene "${token}"`);
    }
  });

  it('la autoridad fiscal es pura: no toca base de datos, red ni proveedores', () => {
    const body = executableBody('fiscal-identity.ts');
    // `supabase` cubre cualquier acceso al cliente (incluido `supabase.from`);
    // no se prohíbe `.from(` a secas porque `Array.from` es puro y legítimo.
    for (const token of ['supabase', 'fetch(', 'process.env', 'await ', 'async ']) {
      assert.ok(!body.includes(token), `fiscal-identity.ts contiene "${token}"`);
    }
    assert.ok(!/\bsupabase\s*\.\s*from\s*\(/.test(body));
  });

  it('la autoridad fiscal no importa nada del entorno de ejecución', () => {
    // Un módulo puro no necesita imports: si algún día los necesita, esta guarda
    // obliga a justificarlo explícitamente.
    assert.ok(!/^\s*import\s/m.test(bodyWithoutComments('fiscal-identity.ts')));
  });
});

describe('§ 4 - la autoridad canónica es única y consumida por el checker', () => {
  it('el checker deriva su semántica fiscal de ./fiscal-identity', () => {
    // El especificador del import se comprueba sobre el cuerpo SIN comentarios:
    // es estructura ejecutable, y stripNonExecutable borra literales de cadena.
    assert.match(
      bodyWithoutComments('tax-id-novelty-checker.ts'),
      /from '\.\/fiscal-identity'/,
    );
    const body = executableBody('tax-id-novelty-checker.ts');
    assert.ok(body.includes('canonicalizeFiscalIdentifier'));
    assert.ok(body.includes('resolveStoredFiscalIdentity'));
    assert.ok(body.includes('buildFiscalIdentityKey'));
  });

  it('el checker ya no define su propio recorte de etiqueta ni su propio umbral', () => {
    const body = executableBody('tax-id-novelty-checker.ts');
    assert.ok(!body.includes('replace(/[^a-z0-9]/gi'));
    assert.ok(!body.includes('v.length < 5'));
  });

  it('el índice ya no se llama byTaxId: la clave lleva ámbito de país', () => {
    const body = executableBody('tax-id-novelty-checker.ts');
    assert.ok(!body.includes('byTaxId'));
    assert.ok(body.includes('byFiscalKey'));
    assert.ok(body.includes('countryNamespace'));
  });
});

// --- La guarda probada en NEGATIVO -----------------------------------------
//
// Sin esto, un stripNonExecutable roto (p. ej. que devolviera cadena vacía)
// dejaría pasar TODAS las aserciones anteriores como falsos verdes.

describe('la guarda estática se prueba a sí misma', () => {
  it('stripNonExecutable borra prosa pero conserva código', () => {
    const source = [
      '/* aquí se menciona normalizeCompanyName en prosa */',
      '// y aquí también identity_key',
      'const literal = "normalizeName";',
      'const real = canonicalizeFiscalIdentifier(value);',
    ].join('\n');
    const body = stripNonExecutable(source);

    assert.ok(!body.includes('normalizeCompanyName'), 'la prosa de bloque debe desaparecer');
    assert.ok(!body.includes('identity_key'), 'la prosa de línea debe desaparecer');
    assert.ok(!body.includes('normalizeName'), 'el literal de cadena debe desaparecer');
    assert.ok(body.includes('canonicalizeFiscalIdentifier'), 'el código real debe sobrevivir');
    assert.ok(body.includes('const real ='), 'el código real debe sobrevivir');
  });

  it('la guarda FALLA si un símbolo prohibido aparece en código ejecutable', () => {
    const offending = stripNonExecutable('const k = buildIdentityKey(name);');
    assert.ok(
      FORBIDDEN_IDENTITY_SYMBOLS.some((symbol) => offending.includes(symbol)),
      'la lista de símbolos prohibidos debe poder detectar un uso real',
    );
  });

  it('no se protege sobre un cuerpo vacío: los módulos del corte tienen código', () => {
    for (const moduleName of CUT_MODULES) {
      const body = executableBody(moduleName);
      assert.ok(body.length > 500, `${moduleName} produjo un cuerpo sospechosamente corto`);
      assert.ok(body.includes('export function'), `${moduleName} no expone funciones`);
    }
  });

  it('stripComments conserva literales pero borra prosa', () => {
    const src = "/* prosa */ import { x } from './modulo'; // cola\n";
    const body = stripComments(src);
    assert.ok(body.includes("from './modulo'"), 'el especificador debe sobrevivir');
    assert.ok(!body.includes('prosa'), 'la prosa de bloque debe desaparecer');
    assert.ok(!body.includes('cola'), 'la prosa de línea debe desaparecer');
  });

  it('no protege una ruta de URL confundida con comentario de línea', () => {
    const body = stripNonExecutable("const u = 'https://ejemplo.co/x'; const y = real;");
    assert.ok(body.includes('const y = real;'), 'el // de una URL no debe truncar el resto');
  });
});
