/**
 * AGENT1-PREPAID-TECHNOLOGY-CIIU-FALSE-POSITIVE-CORRECTION §§ 1, 3, 4, 5, 6.
 *
 * ── El defecto de Producción que esta suite fija ─────────────────────────────
 *
 * Corrida del 2026-09-01, lote `2610bda2-6c69-4a87-a583-68e1e071e822`
 * (CO / technology / objetivo 5). La capa gratuita `co_siis_discovery` devolvió y
 * persistió CINCO empresas cuyo CIIU declarado era `4791`, «Comercio al por menor
 * por correo y por internet», y las cinco contaron contra el objetivo:
 *
 *     acceptedBeforeProvider = 5 · residualGap = 0 · providerRequired = false
 *
 * Lusha hizo 0 peticiones, 0 páginas y 0 créditos — correctamente, porque el
 * hueco estaba cerrado. El defecto NO era del runtime de Lusha: era un FALSO
 * POSITIVO de la evidencia macro GRATUITA. La palabra que las admitía era
 * `internet`, término confirmatorio de Tecnología, que en esa descripción nombra
 * el CANAL de venta de un minorista y no la actividad de la empresa.
 *
 * ── Qué NO se hizo para cerrarlo ─────────────────────────────────────────────
 *
 * No se degradó ni se borró `internet` (§ 3): es un valor de industria REAL que
 * Apollo declara y quitarlo habría destruido un verdadero positivo para probar un
 * falso. No se escribió una segunda taxonomía ni un `if technology then exclude
 * 4791` en el adaptador CIIU (§ 2). Se reforzó la EXCLUSIÓN declarada de
 * Tecnología, que el evaluador compartido ya comprueba ANTES que la confirmación.
 *
 * 🔴 Cero llamadas externas y cero créditos: todo doble es una función local.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MACRO_INDUSTRIES } from '@/modules/macro-industry-catalog/macro-industries';
import { assessDeclaredMacroIndustryEvidence } from '@/modules/macro-industry-catalog/macro-industry-evidence-core';
import { getCiiuSectorDescriptionExact } from '@/server/source-catalog/connectors/socrata-colombia/normalizers';
import type {
  DuplicateCheckInput,
  DuplicateCheckResult,
} from '@/server/agents/prospecting-toolkit/types';
import { buildCoSiisDiscoveryAdapter, type CoSiisSnapshotRow } from '../co-siis-discovery-adapter';
import { macroHasCiiuCoverage, resolveMacroCiiuCodes } from '../macro-ciiu-index';
import {
  assessCountrySourceMacroPrecision,
  isCountrySourceMacroPrecisionAdmitted,
} from '../country-source-macro-precision';
import { runPrePaidNoveltyGate } from '../run-prepaid-novelty-gate';

/** El código exacto de la corrida y su descripción exacta en la tabla del repo. */
const RETAIL_INTERNET_CIIU = '4791';
const RETAIL_INTERNET_DESCRIPTION = 'Comercio al por menor por correo y por internet';

const TECHNOLOGY = MACRO_INDUSTRIES.find((definition) => definition.key === 'technology')!;

/** Juzga una evidencia declarada contra Tecnología, con la forma de un proveedor. */
function judgeTechnology(declaredIndustry: string, extraText: readonly string[] = []) {
  const declaredIndustries = declaredIndustry === '' ? [] : [declaredIndustry];
  return assessDeclaredMacroIndustryEvidence(TECHNOLOGY, {
    declaredIndustries,
    classificationText: [...declaredIndustries, ...extraText],
    providerEvidenceFields: ['industry'],
  });
}

// ─── § 1 · La descripción de la corrida es la del repo ────────────────────────

test('§ 1 — la descripción de CIIU 4791 es exactamente la que Producción devolvió', () => {
  assert.equal(getCiiuSectorDescriptionExact(RETAIL_INTERNET_CIIU), RETAIL_INTERNET_DESCRIPTION);
});

// ─── § 4 · El falso positivo está cerrado ─────────────────────────────────────

test('§ 4 — CIIU 4791 ya NO pertenece al índice de Tecnología', () => {
  assert.equal(resolveMacroCiiuCodes('technology').includes(RETAIL_INTERNET_CIIU), false);
});

test('§ 4 — la industria declarada del minorista RECHAZA Tecnología, y por exclusión', () => {
  const assessment = judgeTechnology(RETAIL_INTERNET_DESCRIPTION);
  assert.equal(assessment.verdict, 'rejected');
  // 🔴 El motivo importa tanto como el veredicto: `excluding_industry_declared`
  // demuestra que ganó la REGLA 1 (exclusión antes que confirmación), que es el
  // mecanismo que se reforzó. Un `declared_industry_outside_macro` significaría
  // que se cerró borrando el término confirmatorio, que es lo que § 3 prohíbe.
  assert.equal(assessment.reason, 'excluding_industry_declared');
  assert.deepEqual(assessment.matchedConfirmingTerms, []);
  assert.ok(assessment.matchedExcludingIndustries.length > 0);
});

test('§ 4 — la capa gratuita CO no admite a esa empresa por ninguna vía', () => {
  const precision = assessCountrySourceMacroPrecision({
    macroIndustryKey: 'technology',
    company: { declaredIndustry: RETAIL_INTERNET_DESCRIPTION },
  });
  assert.equal(precision.verdict, 'rejected');
  assert.equal(isCountrySourceMacroPrecisionAdmitted(precision), false);
});

test('§ 4 — Tecnología queda SIN cobertura CIIU, y eso se declara en vez de rellenarse', () => {
  // El índice de Tecnología tenía UN solo código, y era este falso positivo. Al
  // cerrarlo la macro se queda en cero, que es el estado honesto: la tabla CIIU
  // del repo no contiene ninguna descripción que PRUEBE Tecnología. § 7 del hito
  // anterior prohíbe fabricar cobertura, así que no se inventan códigos: la
  // fuente devuelve cero y el proveedor de pago hace exactamente lo de siempre.
  assert.deepEqual([...resolveMacroCiiuCodes('technology')], []);
  assert.equal(macroHasCiiuCoverage('technology'), false);
});

// ─── § 4 · Los verdaderos positivos siguen en pie ─────────────────────────────

test('§ 4 — las industrias declaradas que SÍ son Tecnología siguen confirmando', () => {
  // Valores de industria que Apollo y Lusha declaran de verdad. `Internet` está
  // deliberadamente el primero: es el término que causó el falso positivo y NO se
  // tocó, así que sigue probando pertenencia cuando es la industria declarada.
  for (const declared of [
    'Internet',
    'Computer Software',
    'Information Technology and Services',
    'Computer & Network Security',
    'Cloud Computing',
    'Artificial Intelligence',
    'Machine Learning',
    'Desarrollo de software',
    'SaaS',
  ]) {
    const assessment = judgeTechnology(declared);
    assert.equal(assessment.verdict, 'confirmed', `${declared} debe confirmar Tecnología`);
  }
});

test('§ 4 — sin industria declarada, el texto clasificatorio tecnológico sigue confirmando', () => {
  const assessment = judgeTechnology('', ['plataforma saas de ciberseguridad']);
  assert.equal(assessment.verdict, 'confirmed');
});

// ─── § 5 · Paridad entre proveedores ──────────────────────────────────────────

test('§ 5 — `internet` SOLO ya no vuelve Tecnología a un minorista explícito', () => {
  // La evidencia macro es COMPARTIDA: este mismo núcleo juzga a Apollo, a Lusha y
  // a la capa gratuita. Un minorista cuya única señal tecnológica es el canal por
  // el que vende no puede convertirse en evidencia fuerte de Tecnología en
  // NINGUNA de las tres rutas.
  for (const declared of ['Retail', 'Comercio al por menor de prendas de vestir']) {
    const assessment = judgeTechnology(declared, [
      'vendemos por internet a todo el pais',
      'tienda online',
    ]);
    assert.equal(assessment.verdict, 'rejected', `${declared} no puede confirmar Tecnología`);
    assert.equal(assessment.reason, 'excluding_industry_declared');
  }
});

test('§ 5 — el mismo refuerzo es simétrico para el comercio MAYORISTA', () => {
  const assessment = judgeTechnology('Comercio al por mayor de computadoras y equipos de telecomunicaciones');
  assert.notEqual(assessment.verdict, 'confirmed');
});

test('§ 5 — ninguna otra macro industria cambió de cobertura por este corte', () => {
  // El refuerzo se compone SÓLO en `technology`. Las demás macros tienen códigos
  // de comercio cuyo PRODUCTO comerciado sí es su dominio (4773 farmacéuticos →
  // Salud, 4663 materiales de construcción → Propiedad & Construcción) y esa es
  // una decisión de producto distinta que este hito no toma. Estos conteos son el
  // baseline medido sobre `origin/main` ANTES del cambio.
  const baseline: ReadonlyArray<readonly [string, number]> = [
    ['transport_logistics', 2],
    ['insurance_financial_services', 9],
    ['health_pharma', 4],
    ['retail', 0],
    ['property_construction', 14],
    ['industry_manufacturing_chemicals_automotive', 14],
    ['government', 2],
    ['energy_mining_environment', 5],
    ['consumer_goods', 0],
    ['services_company', 2],
    ['agroindustry', 4],
  ];
  for (const [key, count] of baseline) {
    assert.equal(resolveMacroCiiuCodes(key).length, count, `${key} no debe cambiar`);
  }
});

// ─── § 6 · Semántica del objetivo pre-pago ────────────────────────────────────

function noMatch(input: DuplicateCheckInput): DuplicateCheckResult {
  return {
    status: 'new_candidate',
    confidence: 0,
    input,
    matches: [],
    summary: 'no_match',
    checkedSources: ['sellup', 'hubspot'],
  };
}

/** Fila sintética con el CIIU exacto de la corrida. Nunca un nombre real. */
function retailInternetRow(key: string): CoSiisSnapshotRow {
  return {
    record_identity_key: key,
    legal_name: `EMPRESA SINTETICA ${key}`,
    normalized_legal_name: `empresa sintetica ${key}`,
    tax_id: `9000000${key}`,
    sector: 'COMERCIO',
    city: 'BOGOTA',
    department: 'BOGOTA D.C.',
    ciiu: RETAIL_INTERNET_CIIU,
  };
}

test('§ 6 — la forma de Producción: 5 filas 4791 y objetivo 5 ya NO cierran el hueco', async () => {
  const rows = ['1', '2', '3', '4', '5'].map(retailInternetRow);
  let adapterQueries = 0;

  const result = await runPrePaidNoveltyGate(
    {
      provider: 'lusha',
      countryCode: 'CO',
      macroIndustryKey: 'technology',
      requestedTarget: 5,
    },
    {
      countrySourceAdapter: buildCoSiisDiscoveryAdapter(async () => {
        adapterQueries += 1;
        return rows;
      }),
      checkCompanyDuplicate: async (input) => noMatch(input),
    },
  );

  // Lo que Producción publicó el 2026-09-01 —y que era falso— era exactamente lo
  // contrario de estas tres líneas.
  assert.notEqual(result.context.acceptedBeforeProvider, 5);
  assert.equal(result.context.acceptedBeforeProvider, 0);
  assert.ok(result.context.residualGap > 0);
  assert.equal(result.context.residualGap, 5);
  assert.equal(result.context.providerRequired, true);
  assert.deepEqual([...result.acceptedCompanies], []);

  // 🔴 Y la fuente ni siquiera pregunta: sin un solo código que confirme la macro,
  // el gate declara la ausencia de cobertura ANTES de consultar. Una consulta sin
  // filtro habría devuelto la población entera, que es el modo de fallo que § 4
  // del hito anterior prohíbe. Cero filas leídas, cero candidatos persistidos.
  assert.equal(adapterQueries, 0);
  assert.equal(result.context.freeSource.attempted, false);
});

test('§ 6 — la fuente gratuita NO puede suprimir al proveedor con evidencia falsa', () => {
  // Enunciado directo del hito: si la única prueba que la capa gratuita tiene de
  // pertenencia a la macro es un falso positivo, el proveedor de pago SIGUE siendo
  // necesario. Esto es lo contrario de un ahorro: el ahorro del 01-09 fue ficticio.
  const admitted = ['1', '2', '3', '4', '5']
    .map(retailInternetRow)
    .filter((row) =>
      isCountrySourceMacroPrecisionAdmitted(
        assessCountrySourceMacroPrecision({
          macroIndustryKey: 'technology',
          company: { declaredIndustry: getCiiuSectorDescriptionExact(row.ciiu) },
        }),
      ),
    );
  assert.equal(admitted.length, 0);
});

// ─── Mutación ─────────────────────────────────────────────────────────────────

test('🔴 mutación — quitar la exclusión de comercio resucita el falso positivo', () => {
  // Se reconstruye la definición ANTERIOR al corte —misma confirmación, exclusión
  // sin los términos de comercio— y se comprueba que el evaluador compartido la
  // vuelve a admitir. Si algún día alguien recorta esos términos «porque no
  // coinciden con nada», esta prueba nombra exactamente lo que se pierde.
  const beforeCorrection = {
    ...TECHNOLOGY,
    evidence: {
      ...TECHNOLOGY.evidence,
      excludingIndustries: TECHNOLOGY.evidence.excludingIndustries.filter(
        (term) => !term.startsWith('comercio') && term !== 'retail' && term !== 'wholesale',
      ),
    },
  };
  const resurrected = assessDeclaredMacroIndustryEvidence(beforeCorrection, {
    declaredIndustries: [RETAIL_INTERNET_DESCRIPTION],
    classificationText: [RETAIL_INTERNET_DESCRIPTION],
    providerEvidenceFields: ['ciiu_description'],
  });
  assert.equal(resurrected.verdict, 'confirmed');
  assert.deepEqual(resurrected.matchedConfirmingTerms, ['internet']);
});
