/**
 * AGENT1-STRUCTURAL-DOMAIN-OWNERSHIP-X6.10-A
 *
 * La suite del CONTRATO de evidencia estructural. No hay cableado: ningún
 * llamador de producción invoca todavía `evaluateStructuralDomainOwnership`, y
 * esta suite existe precisamente para decidir si merece la pena cablearlo.
 *
 * 🔴 Lo que esta suite tiene que demostrar NO es cuánto recupera la capa, sino
 * que no abre una vía de falsos positivos. Por eso la mayoría de las aserciones
 * son de NO aceptación:
 *
 *   · LinkedIn no puede confirmar bajo NINGUNA entrada (§ 7.1, barrido);
 *   · un dominio no puede probarse a sí mismo (§ 1.3);
 *   · la página del GRUPO no acredita el dominio de una filial (§ 5.1);
 *   · `EPM ↔ une.com.co` se queda rechazado, con y sin LinkedIn (§ 4.3);
 *   · `Universidad de Nariño` sigue fuera de alcance (§ 4.4);
 *   · `D1 S.A.S` no tiene evidencia que evaluar (§ 4.5).
 *
 * Los seis pares de la § 3.1 son los que se MIDIERON en Producción sobre las 71
 * filas con `disposition = 'ownership_domain_rejected'`, dominio y
 * `linkedin_url`. Se asientan aquí para que el informe de X6.10-A diga la
 * verdad sobre qué apoyaría LinkedIn si algún día se le diera poder — que hoy
 * no lo tiene.
 *
 * Sin red, sin proveedor, sin base, sin reloj. Determinístico.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  MAX_TRUSTED_DOMAIN_ALIASES,
  STRUCTURAL_OWNERSHIP_SOURCES,
  evaluateStructuralDomainOwnership,
  type StructuralOwnershipEvidence,
  type StructuralOwnershipResult,
} from '../structural-domain-ownership';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NO_PROVENANCE = {
  provider: null,
  operation: null,
  observedAt: null,
} as const;

function evidence(
  overrides: Partial<StructuralOwnershipEvidence> & { companyName: string; domain: string | null },
): StructuralOwnershipEvidence {
  return {
    providerDomainAliases: [],
    providerLinkedInCompanyUrl: null,
    provenance: NO_PROVENANCE,
    ...overrides,
  };
}

function evaluate(
  companyName: string,
  domain: string | null,
  overrides: Partial<StructuralOwnershipEvidence> = {},
): StructuralOwnershipResult {
  return evaluateStructuralDomainOwnership(evidence({ companyName, domain, ...overrides }));
}

function assertNotConfirmed(result: StructuralOwnershipResult, message: string): void {
  assert.notEqual(result.outcome, 'confirmed', `${message} — detail=${result.detail}`);
}

// ─── § 1 · puerta de entrada ──────────────────────────────────────────────────

describe('X6.10-A § 1 — la puerta de entrada, y qué significa cada ausencia', () => {
  it('1.1 · sin dominio no hay pregunta que formular', () => {
    const result = evaluate('Caracol Televisión', null);
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.equal(result.decidingSource, null);
    // Las DOS fuentes se declaran ausentes: sin dominio ninguna se evaluó.
    assert.deepEqual([...result.absentSources].sort(), [...STRUCTURAL_OWNERSHIP_SOURCES].sort());
    assert.deepEqual(result.evaluatedSources, []);
  });

  it('1.2 · sin ninguna fuente, `insufficient_evidence` y ambas ausentes', () => {
    const result = evaluate('Caracol Televisión', 'caracoltv.com');
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.equal(result.linkedInCorroboration, 'absent');
    assert.deepEqual([...result.absentSources].sort(), [...STRUCTURAL_OWNERSHIP_SOURCES].sort());
  });

  it('1.3 · `all_domains = [primary_domain]` — un dominio NO se prueba a sí mismo', () => {
    // 🔴 La condición que impide el razonamiento circular: si el conjunto de
    // alias sólo contiene el dominio que se juzga, no hay nada que corrobore.
    const result = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: ['caracoltv.com'],
    });
    assert.equal(result.outcome, 'insufficient_evidence');
    // La fuente SÍ llegó y SÍ se evaluó — no es una ausencia.
    assert.ok(result.evaluatedSources.includes('provider_domain_alias_set'));
  });

  it('1.4 · el mismo dominio repetido con y sin `www.` sigue siendo uno solo', () => {
    const result = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: ['caracoltv.com', 'www.caracoltv.com', 'https://caracoltv.com/'],
    });
    assert.equal(result.outcome, 'insufficient_evidence');

    // 🔴 Y la deduplicación tiene que ocurrir ANTES del tope de cardinalidad:
    // un proveedor que repita el mismo dominio en nueve formatos distintos no
    // está acumulando dominios, y tratarlo como acumulación perdería una
    // agrupación legítima de dos.
    const padded = ['caracoltelevision.com'];
    for (let i = 0; i < MAX_TRUSTED_DOMAIN_ALIASES; i++) {
      padded.push(i % 2 === 0 ? 'www.caracoltv.com' : 'https://caracoltv.com/');
    }
    const deduped = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: padded,
    });
    assert.equal(deduped.outcome, 'confirmed');
  });

  it('1.5 · un nombre vacío no acredita nada', () => {
    const result = evaluate('   ', 'caracoltv.com', {
      providerDomainAliases: ['caracoltv.com', 'caracoltelevision.com'],
    });
    assert.equal(result.outcome, 'insufficient_evidence');
  });
});

// ─── § 2 · E1, conjunto de alias del proveedor ────────────────────────────────

describe('X6.10-A § 2 — E1: el alias que SÍ explica el nombre acredita al que no', () => {
  it('2.1 · «Caracol Televisión» ↔ caracoltv.com vía `caracoltelevision.com`', () => {
    // El caso que X6.9 no puede resolver: `tv` no es prefijo de «televisión».
    // Aquí no se compara `caracoltv` con nada: se compara el OTRO alias.
    const result = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: ['caracoltv.com', 'caracoltelevision.com'],
    });
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.decidingSource, 'provider_domain_alias_set');
    assert.equal(result.signal, 'alias_domain_accredited_by_company_name');
  });

  it('2.2 · el dominio tiene que PERTENECER al conjunto', () => {
    const result = evaluate('Caracol Televisión', 'otrodominio.com', {
      providerDomainAliases: ['caracoltv.com', 'caracoltelevision.com'],
    });
    assertNotConfirmed(result, 'un dominio fuera del conjunto no puede acreditarse');
  });

  it('2.3 · un conjunto de puro ruido no acredita', () => {
    const result = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: ['caracoltv.com', 'cdn-x9.net', 'parked-42.biz'],
    });
    assert.equal(result.outcome, 'insufficient_evidence');
  });

  it('2.4 · por encima del tope de cardinalidad el conjunto deja de ser evidencia', () => {
    const aliases = ['caracoltv.com', 'caracoltelevision.com'];
    for (let i = 0; i < MAX_TRUSTED_DOMAIN_ALIASES; i++) aliases.push(`relleno-${i}.com`);
    const result = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: aliases,
    });
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.match(result.detail, /tope/);
  });

  it('2.4b · el tope es NUEVE dominios distintos, no una constante relativa', () => {
    // 🔴 El test de arriba se construye a partir de `MAX_TRUSTED_DOMAIN_ALIASES`
    // y por eso pasa con cualquier valor: subir el tope a 100 lo dejaba verde.
    // Éste fija el número en términos absolutos — nueve alias distintos son
    // acumulación—, así que mover el tope obliga a mover el test a mano.
    const nine = [
      'caracoltv.com',
      'caracoltelevision.com',
      'noticiascaracol.com',
      'gol.caracoltv.com',
      'bluradio.com',
      'shock.co',
      'caracolplay.com',
      'redmas.com.co',
      'elespectador.com',
    ];
    assert.equal(nine.length, 9);
    const tooMany = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: nine,
    });
    assert.equal(tooMany.outcome, 'insufficient_evidence');

    // Y ocho sí son una agrupación utilizable.
    const eight = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: nine.slice(0, 8),
    });
    assert.equal(eight.outcome, 'confirmed');
  });

  it('2.5 · contradicción: el conjunto describe a la candidata y el dominio no está', () => {
    // 🔴 `rejected` exige las DOS mitades. Sin un alias acreditado, el conjunto
    // no describe a esta empresa y su ausencia no demuestra nada.
    const contradicted = evaluate('Caracol Televisión', 'senalcolombia.tv', {
      providerDomainAliases: ['caracoltelevision.com', 'caracoltv.com'],
    });
    assert.equal(contradicted.outcome, 'rejected');
    assert.equal(contradicted.signal, 'domain_absent_from_accredited_alias_set');

    const merelyAbsent = evaluate('Caracol Televisión', 'senalcolombia.tv', {
      providerDomainAliases: ['cdn-x9.net'],
    });
    assert.equal(merelyAbsent.outcome, 'insufficient_evidence');
  });

  it('2.6 · frontera de confianza declarada: E1 confía en la AGRUPACIÓN del proveedor', () => {
    // Si un proveedor agrupara mal dos dominios, E1 heredaría ese error — y
    // esto lo deja escrito en vez de esconderlo. La prueba textual la sigue
    // poniendo el gate sobre UNO de los miembros; lo que E1 no puede auditar es
    // si los miembros son de verdad la misma organización.
    const result = evaluate('Ferretería Andina', 'dominio-ajeno-xyz.com', {
      providerDomainAliases: ['dominio-ajeno-xyz.com', 'ferreteriaandina.com'],
    });
    assert.equal(result.outcome, 'confirmed');
  });
});

// ─── § 3 · E2, LinkedIn — corrobora, nunca decide ─────────────────────────────

describe('X6.10-A § 3 — E2: la doble pata, y su techo', () => {
  /**
   * Los seis pares ÚNICOS medidos en Producción: filas
   * `ownership_domain_rejected` con dominio y `linkedin_url` cuyo slug contiene
   * la etiqueta del dominio y NO es el nombre normalizado.
   *
   * `supports` significa exactamente «las dos patas se sostienen», no
   * «acreditado»: ninguno de estos seis se acepta en X6.10-A.
   */
  const MEASURED_PAIRS: ReadonlyArray<{
    readonly name: string;
    readonly domain: string;
    readonly linkedIn: string;
    readonly corroboration: 'supports' | 'inconclusive';
  }> = [
    {
      name: 'La Vaquita Supermercados',
      domain: 'vaquitaexpress.com.co',
      linkedIn: 'linkedin.com/company/inversiones-vaquita-express',
      corroboration: 'supports',
    },
    {
      name: 'Sinmente. CO.',
      domain: 'sinmente.co',
      linkedIn: 'linkedin.com/company/sinmente',
      corroboration: 'supports',
    },
    {
      name: 'CityDent® Clínicas Dentales De Colombia',
      domain: 'citydent.com.co',
      linkedIn: 'linkedin.com/company/citydentcolombia',
      corroboration: 'supports',
    },
    {
      name: 'PRIMARIO',
      domain: '1primario.com',
      linkedIn: 'linkedin.com/company/1primario',
      corroboration: 'supports',
    },
    {
      name: 'Mister Pollo MRP',
      domain: 'misterpollo.co',
      linkedIn: 'linkedin.com/company/mister-pollo-colombia',
      corroboration: 'supports',
    },
    {
      // 🔴 La sigla NO la salva LinkedIn: ningún token del nombre aparece en
      // `dpjd`, así que la pata 2 falla. Es una recuperación que E2 NO hace.
      name: 'DISTRIBUCIONES PASTOR JULIO DELGADO',
      domain: 'dpjd.com',
      linkedIn: 'linkedin.com/company/dpjd',
      corroboration: 'inconclusive',
    },
  ];

  for (const pair of MEASURED_PAIRS) {
    it(`3.1 · «${pair.name}» ↔ ${pair.domain} → ${pair.corroboration}, y NUNCA confirmed`, () => {
      const result = evaluate(pair.name, pair.domain, {
        providerLinkedInCompanyUrl: pair.linkedIn,
      });
      assert.equal(result.linkedInCorroboration, pair.corroboration);
      assert.equal(result.outcome, 'insufficient_evidence');
      assert.equal(result.decidingSource, null);
    });
  }

  it('3.2 · una sola pata (slug acredita, nombre NO anclado) no es apoyo', () => {
    // El caso de la página del GRUPO asociada a una filial.
    const result = evaluate('Alimentos XYZ S.A.S', 'nutresa.com', {
      providerLinkedInCompanyUrl: 'linkedin.com/company/grupo-nutresa',
    });
    assert.equal(result.linkedInCorroboration, 'inconclusive');
    assertNotConfirmed(result, 'el slug del grupo no acredita a la filial');
  });

  it('3.3 · una sola pata (nombre anclado, slug NO acredita) no es apoyo', () => {
    // Fila real de Producción: el slug repite el nombre, que ya fue rechazado.
    const result = evaluate('Rodríguez y Asociados', 'ryalaw.co', {
      providerLinkedInCompanyUrl: 'linkedin.com/company/rodríguez-y-asociados',
    });
    assert.equal(result.linkedInCorroboration, 'inconclusive');
    assertNotConfirmed(result, 'un slug que repite el nombre no aporta información nueva');
  });

  it('3.4 · un perfil PERSONAL nunca entra', () => {
    const result = evaluate('Sinmente. CO.', 'sinmente.co', {
      providerLinkedInCompanyUrl: 'linkedin.com/in/algun-fundador',
    });
    assert.equal(result.linkedInCorroboration, 'absent');
    assert.ok(result.absentSources.includes('provider_linkedin_company_slug'));
  });

  it('3.5 · una URL que no es de LinkedIn tampoco', () => {
    const result = evaluate('Sinmente. CO.', 'sinmente.co', {
      providerLinkedInCompanyUrl: 'https://x.com/company/sinmente',
    });
    assert.equal(result.linkedInCorroboration, 'absent');
  });
});

// ─── § 4 · los cinco casos documentados ───────────────────────────────────────

describe('X6.10-A § 4 — los cinco casos, uno por uno', () => {
  it('4.1 · RTVC con SÓLO el LinkedIn observado → insufficient_evidence', () => {
    // 🔴 El slug real de Producción es `rtvc---senialcolombia` y el dominio es
    // `senalcolombia.tv`: `senialcolombia` ≠ `senalcolombia`, una letra. La pata
    // 1 falla y NO se arregla — arreglarla exige un umbral difuso, que es
    // exactamente lo que X6.10 no hace.
    const result = evaluate('rtvc', 'senalcolombia.tv', {
      providerLinkedInCompanyUrl: 'linkedin.com/company/rtvc---senialcolombia',
    });
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.equal(result.linkedInCorroboration, 'inconclusive');
  });

  it('4.2 · RTVC con `all_domains` → confirmed, y sólo por E1', () => {
    const result = evaluate('rtvc', 'senalcolombia.tv', {
      providerDomainAliases: ['senalcolombia.tv', 'rtvc.gov.co'],
      providerLinkedInCompanyUrl: 'linkedin.com/company/rtvc---senialcolombia',
    });
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.decidingSource, 'provider_domain_alias_set');
    // Y LinkedIn sigue sin decidir: su apoyo se registra aparte, inalterado.
    assert.equal(result.linkedInCorroboration, 'inconclusive');
  });

  it('4.3 · EPM ↔ une.com.co se queda rechazado — regresión negativa PERMANENTE', () => {
    // Que exista una relación societaria o de marca histórica no demuestra que
    // el dominio actual sea de la candidata. Ninguna entrada puede confirmarlo:
    // ni sin fuentes, ni con el LinkedIn de EPM, ni con `all_domains` real.
    const variants: Array<Partial<StructuralOwnershipEvidence>> = [
      {},
      { providerLinkedInCompanyUrl: 'linkedin.com/company/epm' },
      { providerLinkedInCompanyUrl: 'linkedin.com/company/une-epm-telecomunicaciones' },
      { providerDomainAliases: ['une.com.co'] },
      { providerDomainAliases: ['epm.com.co'] },
      {
        providerDomainAliases: ['epm.com.co'],
        providerLinkedInCompanyUrl: 'linkedin.com/company/epm',
      },
    ];
    for (const variant of variants) {
      const result = evaluate('EPM', 'une.com.co', variant);
      assertNotConfirmed(result, `EPM ↔ une.com.co NUNCA es confirmed (${JSON.stringify(variant)})`);
    }
  });

  it('4.4 · Universidad de Nariño queda FUERA de X6.10', () => {
    // `udenar` es una abreviatura institucional: es afinación de X6.9, no
    // evidencia estructural. Sin fuentes estructurales no hay nada que evaluar.
    const result = evaluate('Universidad de Nariño', 'udenar.edu.co');
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.deepEqual([...result.absentSources].sort(), [...STRUCTURAL_OWNERSHIP_SOURCES].sort());
  });

  it('4.5 · D1 S.A.S no tiene evidencia que evaluar', () => {
    // Su fila real en Producción murió por `sellup_duplicate / same_active_domain`
    // —no por ownership— y llegó SIN `linkedin_url`.
    const result = evaluate('D1 S.A.S', 'tiendasd1.com');
    assert.equal(result.outcome, 'insufficient_evidence');
    assert.equal(result.linkedInCorroboration, 'absent');
  });
});

// ─── § 5 · parece relacionada y no lo está ────────────────────────────────────

describe('X6.10-A § 5 — asociación ≠ propiedad', () => {
  it('5.1 · la marca compartida no basta: hace falta la agrupación del proveedor', () => {
    // Sin `all_domains`, «Caracol» y `caracoltv.com` siguen sin relación
    // demostrable, por mucho que el nombre contenga la marca.
    const result = evaluate('Caracol', 'caracoltv.com');
    assertNotConfirmed(result, 'compartir marca no es ser dueño del dominio');
  });

  it('5.2 · el mismo dominio ofrecido a dos nombres no acredita a los dos', () => {
    const aliases = ['caracoltv.com', 'caracoltelevision.com'];
    const owner = evaluate('Caracol Televisión', 'caracoltv.com', {
      providerDomainAliases: aliases,
    });
    const stranger = evaluate('Panadería Los Alpes', 'caracoltv.com', {
      providerDomainAliases: aliases,
    });
    assert.equal(owner.outcome, 'confirmed');
    assertNotConfirmed(stranger, 'el conjunto no describe a esta empresa');
  });
});

// ─── § 6 · evidencia mixta ────────────────────────────────────────────────────

describe('X6.10-A § 6 — evidencia mixta: nadie tapa a nadie', () => {
  it('6.1 · E1 confirma y el apoyo de LinkedIn se registra sin fusionarse', () => {
    const result = evaluate('Mister Pollo MRP', 'misterpollo.co', {
      providerDomainAliases: ['misterpollo.co', 'misterpollomrp.com'],
      providerLinkedInCompanyUrl: 'linkedin.com/company/mister-pollo-colombia',
    });
    assert.equal(result.outcome, 'confirmed');
    assert.equal(result.decidingSource, 'provider_domain_alias_set');
    assert.equal(result.linkedInCorroboration, 'supports');
  });

  it('6.2 · un LinkedIn que apoya NO puede levantar un `rejected` de E1', () => {
    const result = evaluate('Sinmente. CO.', 'sinmente.co', {
      // El proveedor enumera los dominios de la organización y éste no está.
      providerDomainAliases: ['sinmenteapp.com', 'sinmente.com.co'],
      providerLinkedInCompanyUrl: 'linkedin.com/company/sinmente',
    });
    assert.equal(result.outcome, 'rejected');
    assert.equal(result.decidingSource, 'provider_domain_alias_set');
    assert.equal(result.linkedInCorroboration, 'supports');
  });
});

// ─── § 7 · trinquetes ─────────────────────────────────────────────────────────

describe('X6.10-A § 7 — trinquetes del contrato', () => {
  it('7.1 · LinkedIn NUNCA confirma: barrido sobre toda la matriz sin alias', () => {
    // 🔴 La invariante central de X6.10-A. Si alguien le diera poder a E2, este
    // barrido lo caza sin depender de que exista un caso concreto.
    const names = [
      'rtvc',
      'La Vaquita Supermercados',
      'Sinmente. CO.',
      'PRIMARIO',
      'Mister Pollo MRP',
      'CityDent® Clínicas Dentales De Colombia',
      'EPM',
    ];
    const domains = ['senalcolombia.tv', 'vaquitaexpress.com.co', 'sinmente.co', 'une.com.co'];
    const slugs = [
      'linkedin.com/company/rtvc---senialcolombia',
      'linkedin.com/company/inversiones-vaquita-express',
      'linkedin.com/company/sinmente',
      'linkedin.com/company/1primario',
      'linkedin.com/company/mister-pollo-colombia',
      'linkedin.com/company/epm',
    ];
    let evaluated = 0;
    for (const name of names) {
      for (const domain of domains) {
        for (const slug of slugs) {
          const result = evaluate(name, domain, { providerLinkedInCompanyUrl: slug });
          evaluated++;
          assert.notEqual(
            result.outcome,
            'confirmed',
            `LinkedIn no puede confirmar: ${name} + ${domain} + ${slug}`,
          );
          assert.notEqual(result.decidingSource, 'provider_linkedin_company_slug');
        }
      }
    }
    assert.equal(evaluated, names.length * domains.length * slugs.length);
  });

  it('7.2 · sin un alias DISTINTO del dominio, E1 no confirma nunca', () => {
    // 🔴 Los pares están elegidos para que el GATE YA ACREDITE el dominio por
    // su cuenta. Es el único modo de que el trinquete muerda: si el gate lo
    // rechazara, quitar la exclusión «alias ≠ dominio» no cambiaría el
    // desenlace y el test daría una seguridad falsa.
    const selfAccrediting: ReadonlyArray<readonly [string, string]> = [
      ['Sinmente. CO.', 'sinmente.co'],
      ['rtvc', 'rtvc.gov.co'],
      ['Caracol Televisión', 'caracoltelevision.com'],
    ];
    for (const [name, domain] of selfAccrediting) {
      const result = evaluate(name, domain, { providerDomainAliases: [domain] });
      assertNotConfirmed(result, `${domain} no puede probarse a sí mismo`);
      assert.equal(result.decidingSource, null);
    }
  });

  it('7.3 · el módulo es puro: sin red, sin base, sin reloj, sin difuso', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/structural-domain-ownership.ts'),
      'utf8',
    );
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [
      'fetch(',
      'Date.now',
      'new Date',
      'supabase',
      'createClient',
      'levenshtein',
      'process.env',
      'await ',
    ]) {
      assert.equal(
        body.includes(forbidden),
        false,
        `el contrato estructural no puede contener "${forbidden}"`,
      );
    }
  });

  it('7.4 · no decide por TLD ni por sector', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/structural-domain-ownership.ts'),
      'utf8',
    );
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of ['.gov.co', '.edu.co', 'industry', 'keywords', 'description']) {
      assert.equal(
        body.includes(forbidden),
        false,
        `el contrato estructural no puede mirar "${forbidden}"`,
      );
    }
  });

  it('7.5 · la autoridad textual se INVOCA, no se reimplementa', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/structural-domain-ownership.ts'),
      'utf8',
    );
    assert.match(source, /from '\.\/company-ownership-gate'/);
    assert.match(source, /isBlockedByCompanyOwnership\(/);
    // Una segunda copia de la política de TLD es cómo las dos capas divergen.
    assert.equal(/STRIP_TLDS|\.com\.co'/.test(source), false);
  });

  it('7.6 · X6.9 no se toca: su módulo y su gate no aparecen modificados aquí', () => {
    // El contrato estructural vive en su propio fichero. Si alguien moviera
    // reglas de X6.9 aquí dentro, este guard no lo vería — pero la suite de
    // X6.9 corre sin cambios en el mismo script y sí lo vería.
    const gate = fs.readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/company-ownership-gate.ts'),
      'utf8',
    );
    assert.equal(
      gate.includes('structural-domain-ownership'),
      false,
      'X6.10-A no cablea nada: el gate no puede conocer esta capa todavía',
    );
  });
});
