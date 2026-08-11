/**
 * Agente 2A — Guardas ESTÁTICAS de «Ver más números»
 * (AGENT2A-PHONE-REVEAL-4O-G)
 *
 * Estas pruebas sólo LEEN archivos del disco: no conectan con ninguna base, no
 * llaman a ningún proveedor y no gastan un crédito.
 *
 * Son el mecanismo que sostiene el contrato central del hito —ver números
 * almacenados cuesta CERO— cuando ya no quede nadie que recuerde por qué. El
 * contrato no se puede demostrar sólo ejecutando el código: un test de
 * comportamiento prueba que HOY no se llamó a Apollo; estas guardas prueban que
 * la llamada NO ESTÁ ESCRITA, y fallan en el momento en que alguien la añada.
 *
 * Cada aserción vale por lo que PROHÍBE.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// __tests__ → contact-enrichment → modules → src → raíz del repo
const repoRoot = join(here, '..', '..', '..', '..');

const CORE = 'src/modules/contact-enrichment/candidate-stored-phones-core.ts';
const READ = 'src/modules/contact-enrichment/candidate-stored-phones-read.ts';
const ACTIONS = 'src/modules/contact-enrichment/candidate-stored-phones-actions.ts';
const DISCLOSURE = 'src/components/contact-enrichment/candidate-stored-phones-disclosure.tsx';
const COPY = 'src/components/contact-enrichment/candidate-stored-phones-copy.ts';
const LABELS = 'src/components/contact-enrichment/phone-display-labels.ts';

/** Todo lo que 4O-G añade. La lista es el alcance. */
const NEW_FILES = [CORE, READ, ACTIONS, DISCLOSURE, COPY, LABELS] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

/** El archivo sin comentarios: lo que realmente se ejecuta. */
function executable(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return (
        !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

const sources = Object.fromEntries(
  NEW_FILES.map((file) => [file, executable(read(file))]),
) as Record<(typeof NEW_FILES)[number], string>;

// ═══════════════════════════════════════════════════════════════
// 1. Cero proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-G — ningún camino de lectura puede llamar a un proveedor', () => {
  it('ningún archivo nuevo importa o invoca el cliente de Apollo', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /apollo-client|startApolloPhoneReveal|callApollo/i.test(sources[file]),
        false,
        `${file} no debe tocar el cliente de Apollo`,
      );
    }
  });

  it('ningún archivo nuevo importa o invoca el cliente de Lusha', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /lusha-client|lusha-phone-fallback-actions|revealCandidatePhoneViaLusha|callLusha/i.test(
          sources[file],
        ),
        false,
        `${file} no debe tocar el cliente de Lusha`,
      );
    }
  });

  it('ningún archivo nuevo invoca una acción de reveal ni el motor del waterfall', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /revealCandidatePhone|phone-reveal-actions|phone-reveal-waterfall-core|phone-reveal-waterfall-actions|startPhoneRevealWaterfall|executeLegacyLushaOnly|legacy-lusha-only-reveal-engine/.test(
          sources[file],
        ),
        false,
        `${file} no debe poder disparar un reveal`,
      );
    }
  });

  it('ningún archivo nuevo hace red por su cuenta', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /\bfetch\s*\(|axios|https?:\/\/api\./.test(sources[file]),
        false,
        `${file} no debe hacer red`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Cero dinero
// ═══════════════════════════════════════════════════════════════

describe('4O-G — ningún camino de lectura puede reservar, gastar ni contabilizar', () => {
  it('ningún archivo nuevo toca reservas de crédito', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /credit-reservation|reserve_and_create|phone_reveal_credit_reservations|reserveCredits/i.test(
          sources[file],
        ),
        false,
        `${file} no debe reservar créditos`,
      );
    }
  });

  it('ningún archivo nuevo toca el presupuesto', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /credit-budget|budget_rules|computeEffectiveConsumption|wizard_monthly_budget/i.test(
          sources[file],
        ),
        false,
        `${file} no debe consultar ni mover presupuesto`,
      );
    }
  });

  it('ningún archivo nuevo escribe un usage log de proveedor', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /logProviderUsage|usage-tracking\/logging|provider_usage_logs/.test(sources[file]),
        false,
        `${file} no debe escribir contabilidad de proveedor`,
      );
    }
  });

  it('ningún archivo nuevo crea corridas de waterfall', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /phone_reveal_waterfall_runs|createWaterfallRun/.test(sources[file]),
        false,
        `${file} no debe crear corridas`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Cero escritura
// ═══════════════════════════════════════════════════════════════

describe('4O-G — la cadena entera es de sólo lectura', () => {
  it('la lectura sólo hace SELECT: ni insert, ni update, ni delete, ni upsert', () => {
    const code = sources[READ];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
      assert.equal(code.includes(forbidden), false, `${READ} no debe contener ${forbidden}`);
    }
    assert.ok(code.includes('.select('), 'la lectura sí debe hacer SELECT');
  });

  it('la lectura NO llama ninguna RPC — ni siquiera las de 110/111/112/113', () => {
    // Las funciones de persistencia son transaccionales y ESCRIBEN. Invocar
    // cualquiera de ellas para «ver» teléfonos convertiría una consulta en una
    // mutación.
    assert.equal(
      /\.rpc\(|persist_candidate_|suppress_candidate_phone/.test(sources[READ]),
      false,
    );
  });

  it('ninguna acción escribe: sólo delega en la lectura y en el núcleo puro', () => {
    const code = sources[ACTIONS];
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(']) {
      assert.equal(code.includes(forbidden), false, `${ACTIONS} no debe contener ${forbidden}`);
    }
  });

  it('nada de esto toca el estado del reveal en el candidato', () => {
    // Abrir el disclosure no puede mover `phone_reveal_status` ni sus compañeros:
    // mirar un dato no es un intento de revelarlo.
    for (const file of NEW_FILES) {
      assert.equal(
        /phone_reveal_status|phone_reveal_provider|phone_reveal_cost_credits|phone_revealed_at/.test(
          sources[file],
        ),
        false,
        `${file} no debe tocar el estado del reveal`,
      );
    }
  });

  it('nada de esto escribe en contactos ni en HubSpot', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /hubspot|approveContactCandidate|from\('contacts'\)/i.test(sources[file]),
        false,
        `${file} no debe tocar contactos ni HubSpot`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Independencia de flags de proveedor
// ═══════════════════════════════════════════════════════════════

describe('4O-G — un dato ya guardado no depende de que el proveedor esté encendido', () => {
  it('no se consulta ENABLE_PHONE_REVEAL_WATERFALL', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /isPhoneRevealWaterfallEnabled|ENABLE_PHONE_REVEAL_WATERFALL/.test(sources[file]),
        false,
        `${file} no debe depender del flag del waterfall`,
      );
    }
  });

  it('no se consulta ENABLE_LUSHA_PHONE_REVEAL_FALLBACK', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /isLushaPhoneRevealFallbackEnabled|ENABLE_LUSHA_PHONE_REVEAL_FALLBACK/.test(
          sources[file],
        ),
        false,
        `${file} no debe depender del flag de Lusha`,
      );
    }
  });

  it('no se lee ningún feature flag en absoluto', () => {
    for (const file of NEW_FILES) {
      assert.equal(
        /feature-flags|process\.env/.test(sources[file]),
        false,
        `${file} no debe leer flags ni entorno`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Autorización
// ═══════════════════════════════════════════════════════════════

describe('4O-G — autorización de servidor, no de UI', () => {
  it('las dos acciones exigen rol antes de leer', () => {
    const code = sources[ACTIONS];
    assert.ok(code.includes('resolveActorRoleKey'), 'debe resolver el rol del actor');
    assert.ok(code.includes('isAuthorized'), 'debe comprobar el rol');
    // Ambas exportadas y ambas pasando por el gate.
    const gateCount = (code.match(/isAuthorized\(await resolveActorRoleKey\(\)\)/g) ?? [])
      .length;
    assert.equal(gateCount, 2, 'las DOS acciones deben pasar por el gate');
  });

  it('el rol autorizado es el mismo `admin` de la revisión del candidato', () => {
    assert.match(
      sources[ACTIONS],
      /CANDIDATE_STORED_PHONES_AUTHORIZED_ROLE_KEYS: readonly string\[\] = \['admin'\]/,
    );
    // Espejo declarado del waterfall: si una de las dos cambia, esto avisa.
    assert.match(
      executable(read('src/modules/contact-enrichment/phone-reveal-waterfall-core.ts')),
      /PHONE_REVEAL_WATERFALL_AUTHORIZED_ROLE_KEYS: readonly string\[\] = \['admin'\]/,
    );
  });

  it('la lectura privilegiada NO es invocable desde el navegador', () => {
    // El módulo que usa el service role no lleva 'use server': no puede
    // convertirse en un endpoint por accidente.
    assert.equal(sources[READ].includes("'use server'"), false);
    assert.ok(sources[READ].includes('createSupabaseAdminClient'));
    // Y el componente cliente sólo conoce las acciones, nunca la lectura directa.
    assert.equal(sources[DISCLOSURE].includes('candidate-stored-phones-read'), false);
    assert.equal(sources[DISCLOSURE].includes('createSupabaseAdminClient'), false);
  });

  it('no se crea ninguna ruta pública que consulte teléfonos por UUID', () => {
    const routes = execFileSync(
      'git',
      ['ls-files', 'src/app/api'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\n')
      .filter((path) => path.includes('stored-phone') || path.includes('candidate-phone'));
    assert.deepEqual(routes, []);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Privacidad
// ═══════════════════════════════════════════════════════════════

describe('4O-G — privacidad', () => {
  it('la consulta pide columnas explícitas y nunca `*`', () => {
    // `select('*')` arrastraría toda columna futura, incluidas la razón de
    // supresión y quién la aplicó.
    assert.equal(/\.select\(\s*['"`]\*/.test(sources[READ]), false);
  });

  it('no se traen los metadatos del tombstone más allá de la marca que filtra', () => {
    assert.equal(
      /suppression_reason|suppressed_by/.test(sources[READ]),
      false,
      'la razón de la supresión y su autor no tienen por qué salir de la base',
    );
  });

  it('ningún archivo nuevo imprime un teléfono', () => {
    for (const file of NEW_FILES) {
      const code = sources[file];
      // Se permite `console.error` con el CÓDIGO de la operación; lo que se
      // prohíbe es que un número, una fila o un payload entren en un log.
      assert.equal(
        /console\.(log|info|debug|warn)\s*\(/.test(code),
        false,
        `${file} no debe imprimir en consola fuera de errores`,
      );
      assert.equal(
        /console\.error\([^)]*(phone|number|row|data)\b[^)]*\)/i.test(
          code.replace(/console\.error\(\s*'\[candidate-stored-phones\][^']*'/g, ''),
        ),
        false,
        `${file} no debe imprimir números ni filas`,
      );
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Copy: ver ≠ buscar
// ═══════════════════════════════════════════════════════════════

describe('4O-G — el copy no puede prometer una búsqueda', () => {
  it('ningún verbo de búsqueda aparece en el copy', () => {
    const code = sources[COPY];
    for (const forbidden of ['Buscar', 'Encontrar', 'Revelar', 'Enriquecer', 'Consultando']) {
      assert.equal(
        code.includes(forbidden),
        false,
        `«${forbidden}» implicaría gasto: este bloque sólo muestra lo guardado`,
      );
    }
  });

  it('el CTA usa el verbo VER', () => {
    assert.match(sources[COPY], /Ver 1 número más/);
    assert.match(sources[COPY], /Ver \$\{additionalCount\} números más/);
  });

  it('no se muestra costo por número', () => {
    // Los teléfonos guardados vinieron de respuestas cobradas POR RESPUESTA:
    // un precio unitario sería una cifra que nadie facturó.
    for (const file of [COPY, DISCLOSURE] as const) {
      assert.equal(
        /crédito|credits|costó|costo/i.test(sources[file]),
        false,
        `${file} no debe hablar de costo`,
      );
    }
  });

  it('todavía NO existe un CTA «Buscar más números», ni deshabilitado', () => {
    // Un botón gris con ese texto ya anuncia una capacidad que no existe.
    const sheet = executable(
      read('src/components/contact-enrichment/contact-candidate-detail-sheet.tsx'),
    );
    assert.equal(sheet.includes('Buscar más números'), false);
    assert.equal(sources[DISCLOSURE].includes('Buscar más números'), false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Alcance: lo que el hito NO toca
// ═══════════════════════════════════════════════════════════════

describe('4O-G — alcance', () => {
  function changedAgainstMain(): readonly string[] {
    return execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  it('no añade ni modifica ninguna migración', () => {
    // 4O-B ya creó todo el esquema necesario. Si hiciera falta schema para
    // MOSTRAR teléfonos, el hito estaría mal planteado.
    const migrations = changedAgainstMain().filter((path) =>
      path.startsWith('supabase/migrations/'),
    );
    assert.deepEqual(migrations, []);
  });

  it('no modifica el código de proveedor, presupuesto, reservas ni waterfall', () => {
    const forbiddenPrefixes = [
      'src/server/integrations/apollo',
      'src/server/integrations/lusha',
      'src/modules/contact-enrichment/phone-reveal-waterfall',
      'src/modules/contact-enrichment/phone-reveal-credit',
      'src/modules/contact-enrichment/phone-reveal-actions.ts',
      'src/modules/contact-enrichment/lusha-phone-fallback',
      'src/modules/contact-enrichment/legacy-lusha-only-reveal-engine.ts',
    ];
    const touched = changedAgainstMain().filter((path) =>
      forbiddenPrefixes.some((prefix) => path.startsWith(prefix)),
    );
    assert.deepEqual(touched, []);
  });

  it('no modifica la aprobación del candidato ni los contactos', () => {
    const touched = changedAgainstMain().filter(
      (path) =>
        path.startsWith('src/modules/contacts/') ||
        path.endsWith('candidate-review-core.ts'),
    );
    assert.deepEqual(touched, []);
  });
});
