/**
 * x64-lusha-country-ownership-gate.test.ts — X6.4-A.
 *
 * ── El defecto que cierra ────────────────────────────────────────────────────
 *
 * La corrida `bedebe9b-0e22-4c8d-99e7-2c8d4a95a4c8` (CO × retail) persistió
 * «Maestro Perú» (`www.maestro.com.pe`) con `country_code = 'CO'`. La pierna
 * Lusha pasaba por `evaluateProspectIntakeGate`, cuyo eje de país compara el
 * `countryCode` que el PROVEEDOR declaró — y Lusha declaró `CO`, así que no
 * había contradicción que ver. La evidencia estaba en el dominio, y el gate que
 * lee dominios (`evaluateCountryCompatibility`) sólo lo invocaba la ruta Apollo.
 * Lo mismo con ownership: `evaluateCompanyOwnership` no entraba en esta pierna.
 *
 * ── Qué NO cambia ────────────────────────────────────────────────────────────
 *
 * No hay reglas nuevas: las dos funciones son las de Apollo, importadas.
 * `company-ownership-gate.ts`, `country-compatibility.ts`, `candidate-survival.ts`,
 * `resolveFinalCandidateCap`, el gate de Apollo, el presupuesto, las banderas y
 * las migraciones quedan intactos.
 *
 * 🔴 0 proveedores · 0 créditos · 0 red · 0 Supabase real · 0 Producción ·
 * 0 migraciones · 0 banderas. Todo inyectado o puro.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { evaluateLushaCountryOwnershipGate } from '../lusha-country-ownership-gate';
import { resolveLushaCandidatesDuplicateState } from '../lusha-pending-review';
import type { LushaPreviewCompany, LushaPreviewInput } from '../lusha-preview';
import { resolveLushaDiscardDisposition } from '@/modules/prospect-discards/lusha-mapping';
import { decideCandidateSurvival } from '@/server/agents/prospecting-toolkit/candidate-survival';
import type { ProspectSearchCriteria } from '@/server/agents/prospect-intake/types';

// ── Arnés ────────────────────────────────────────────────────────────────────

const CRITERIA: ProspectSearchCriteria = {
  countryCode: 'CO',
  industry: 'Retail',
  subindustries: [],
  minEmployees: 200,
} as unknown as ProspectSearchCriteria;

function company(overrides: Partial<LushaPreviewCompany> = {}): LushaPreviewCompany {
  return {
    providerCompanyId: 'lusha-1',
    name: 'Makro Colombia',
    domain: 'www.makro.com.co',
    country: 'Colombia',
    countryIso2: 'CO',
    industry: 'Retail',
    employeesExact: 1200,
    employeesMin: null,
    employeesMax: null,
    linkedinUrl: null,
    score: 1,
    passesGate: true,
    ...overrides,
  } as unknown as LushaPreviewCompany;
}

// ═══════════════════════════════════════════════════════════════════════════
// § A · PAÍS — una corrida CO no admite una empresa claramente extranjera
// ═══════════════════════════════════════════════════════════════════════════

describe('§ A · país', () => {
  it('A — el caso REAL: `maestro.com.pe` en una corrida CO se rechaza', () => {
    const rejection = evaluateLushaCountryOwnershipGate({
      name: 'Maestro Perú',
      domain: 'www.maestro.com.pe',
      website: 'https://www.maestro.com.pe',
      targetCountryCode: 'CO',
    });
    assert.ok(rejection !== null, '🔴 sin rechazo se repite la corrida bedebe9b');
    assert.equal(rejection.kind, 'country_incompatible');
    // El motivo es el VERBATIM de la autoridad, no una etiqueta nuestra.
    assert.match(rejection.reason, /foreign_country_tld:\.com\.pe:PE/);
  });

  it('A2 — el `country_code` que el PROVEEDOR declara no salva a la empresa', () => {
    // Lusha etiquetó `CO` esta fila. El dominio dice otra cosa, y el dominio manda.
    const rejection = evaluateLushaCountryOwnershipGate({
      name: 'Maestro Perú',
      domain: 'maestro.com.pe',
      website: null,
      targetCountryCode: 'CO',
    });
    assert.equal(rejection?.kind, 'country_incompatible');
  });

  it('B — un país válido (`.com.co`) continúa', () => {
    assert.equal(
      evaluateLushaCountryOwnershipGate({
        name: 'Makro Colombia',
        domain: 'www.makro.com.co',
        website: 'https://www.makro.com.co',
        targetCountryCode: 'CO',
      }),
      null,
    );
  });

  it('B2 — un dominio GLOBAL sin señal de país continúa: ausencia ≠ rechazo', () => {
    // 🔴 La regla del contrato X6.2-A: la falta de evidencia no rechaza. Esta
    // empresa sigue su camino y acaba, como hoy, en `needs_review`.
    assert.equal(
      evaluateLushaCountryOwnershipGate({
        name: 'Haceb',
        domain: 'www.haceb.com',
        website: 'https://www.haceb.com',
        targetCountryCode: 'CO',
      }),
      null,
    );
  });

  it('B3 — sin país pedido no hay contradicción posible: no se rechaza', () => {
    assert.equal(
      evaluateLushaCountryOwnershipGate({
        name: 'Maestro Perú',
        domain: 'www.maestro.com.pe',
        website: null,
        targetCountryCode: null,
      }),
      null,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § B · OWNERSHIP — el mismo gate de Apollo, sin una segunda lógica
// ═══════════════════════════════════════════════════════════════════════════

describe('§ B · ownership', () => {
  it('C — ownership válido continúa', () => {
    assert.equal(
      evaluateLushaCountryOwnershipGate({
        name: 'Haceb',
        domain: 'www.haceb.com',
        website: 'https://www.haceb.com',
        targetCountryCode: 'CO',
      }),
      null,
    );
  });

  it('D — ownership inválido se rechaza CON razón explícita', () => {
    const rejection = evaluateLushaCountryOwnershipGate({
      name: 'Fábrica Nacional de Chocolates',
      domain: 'www.blogdenoticiasempresariales.com',
      website: 'https://www.blogdenoticiasempresariales.com',
      targetCountryCode: 'CO',
    });
    assert.ok(rejection !== null);
    assert.equal(rejection.kind, 'ownership_mismatch');
    assert.notEqual(rejection.reason.trim(), '', 'la razón no puede venir vacía');
    assert.equal(rejection.evaluationName, 'Fábrica Nacional de Chocolates');
  });

  it('D2 — PAÍS antes que OWNERSHIP: el orden del writer canónico', () => {
    // Dominio peruano que SÍ acredita a la empresa: se rechaza por país, no por
    // ownership. Que el dominio sea suyo no la trae a Colombia.
    const rejection = evaluateLushaCountryOwnershipGate({
      name: 'Maestro',
      domain: 'maestro.com.pe',
      website: 'https://maestro.com.pe',
      targetCountryCode: 'CO',
    });
    assert.equal(rejection?.kind, 'country_incompatible');
  });

  it('D3 — sin NOMBRE el ownership no se evalúa: la ausencia no rechaza', () => {
    // El gate compartido de intake ya descarta antes con `missing_name`; aquí
    // no se inventa un segundo rechazo por ausencia.
    assert.equal(
      evaluateLushaCountryOwnershipGate({
        name: null,
        domain: 'www.haceb.com',
        website: 'https://www.haceb.com',
        targetCountryCode: 'CO',
      }),
      null,
    );
  });

  it('D4 — LinkedIn NO participa: el gate compara nombre contra dominio', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/prospect-batches/lusha-country-ownership-gate.ts'),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/linkedin/i.test(code), false, '🔴 LinkedIn no puede sustituir al ownership');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § C · el rechazo ocurre ANTES de persistir, y deja disposición durable
// ═══════════════════════════════════════════════════════════════════════════

describe('§ C · antes de persistir + trazabilidad', () => {
  it('la empresa extranjera NO llega al chequeo de duplicados ni a `resolved`', async () => {
    const duplicateChecks: string[] = [];
    const input = { countryCode: 'CO' } as unknown as LushaPreviewInput;

    const outcome = await resolveLushaCandidatesDuplicateState(
      {
        checkCompanyDuplicate: async (dup: { name?: string | null }) => {
          duplicateChecks.push(dup.name ?? '');
          return {
            status: 'new_candidate',
            confidence: 0,
            input: { name: dup.name ?? '' },
            matches: [],
            summary: '',
            checkedSources: ['sellup', 'hubspot'],
          } as never;
        },
        fetchActiveCandidates: async () => [],
        officialSourceResolvers: [],
      } as never,
      input,
      [
        company({ providerCompanyId: 'l-1', name: 'Makro Colombia', domain: 'www.makro.com.co' }),
        company({ providerCompanyId: 'l-2', name: 'Maestro Perú', domain: 'www.maestro.com.pe' }),
      ],
      CRITERIA,
    );

    assert.equal(outcome.countryOwnershipExcluded.length, 1);
    assert.equal(outcome.countryOwnershipExcluded[0].company.name, 'Maestro Perú');
    assert.equal(outcome.countryOwnershipExcluded[0].rejection.kind, 'country_incompatible');

    const resolvedNames = outcome.resolved.map((r) => r.company.name);
    assert.deepEqual(resolvedNames, ['Makro Colombia']);
    assert.equal(
      duplicateChecks.includes('Maestro Perú'),
      false,
      '🔴 una empresa rechazada por país no puede llegar al chequeo de duplicados',
    );

    // 🔴 Ningún contador existente cambia de significado: el gate compartido de
    // intake no excluyó a nadie aquí.
    assert.equal(outcome.gate.hardExcludedCount, 0);
    assert.equal(outcome.hardExcludedCompanies.length, 0);
  });

  it('la disposición durable usa códigos que YA existen (0 migraciones)', () => {
    const country = resolveLushaDiscardDisposition({
      kind: 'country_incompatible',
      reason: 'foreign_country_tld:.com.pe:PE',
    });
    assert.deepEqual(country, {
      disposition: 'country_rejected',
      reasonCode: 'foreign_country_tld:.com.pe:PE',
    });

    const ownership = resolveLushaDiscardDisposition({
      kind: 'ownership_mismatch',
      reason: 'Domain "x.com" does not match company name "Y"',
    });
    assert.equal(ownership?.disposition, 'ownership_domain_rejected');
    assert.equal(ownership?.reasonCode, 'Domain "x.com" does not match company name "Y"');
  });

  it('sin motivo legible la disposición NO se pierde: cae a su código de respaldo', () => {
    assert.deepEqual(resolveLushaDiscardDisposition({ kind: 'country_incompatible' }), {
      disposition: 'country_rejected',
      reasonCode: 'country_incompatible',
    });
    assert.deepEqual(resolveLushaDiscardDisposition({ kind: 'ownership_mismatch' }), {
      disposition: 'ownership_domain_rejected',
      reasonCode: 'ownership_mismatch',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// § D · lo que este corte NO puede haber tocado
// ═══════════════════════════════════════════════════════════════════════════

describe('§ D · no-regresión', () => {
  it('H — `enrichment_cap_reached` no es un rechazo: X5 sigue en pie', () => {
    // La supervivencia no conoce el enrichment ni su cupo. Una empresa que pasó
    // los gates obligatorios sobrevive aunque nunca compitiera por un crédito.
    const decision = decideCandidateSurvival({
      mandatoryRejection: null,
      sectorEvidenceState: 'sector_evidence_missing_needs_enrichment',
    });
    assert.equal(decision.survives, true);
    assert.equal(decision.cohort, 'survives_incomplete');
    assert.equal(decision.rejectionReason, null);

    const survival = readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/candidate-survival.ts'),
      'utf8',
    );
    const code = survival.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(
      /enrichment_cap_reached/.test(code),
      false,
      '🔴 el cupo de enrichment no puede volver a decidir supervivencia',
    );
  });

  it('el gate de Lusha REUTILIZA las autoridades de Apollo, no las reimplementa', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/prospect-batches/lusha-country-ownership-gate.ts'),
      'utf8',
    );
    assert.match(source, /import \{ evaluateCountryCompatibility \}/);
    assert.match(source, /isBlockedByCompanyOwnership/);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    // Ni listas de TLD propias, ni umbrales, ni una segunda tabla de países.
    assert.equal(/\.com\.pe|\.com\.mx|FOREIGN_COUNTRY_TLDS\s*=/.test(code), false);
  });

  it('`company-ownership-gate.ts` no fue modificado por este corte', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/server/agents/prospecting-toolkit/company-ownership-gate.ts'),
      'utf8',
    );
    assert.equal(/X6\.4/.test(source), false, '🔴 X6.4 no puede tocar el gate de ownership');
  });
});
