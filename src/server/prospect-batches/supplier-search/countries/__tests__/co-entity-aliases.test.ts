/**
 * AUDIT-HARDENING-1 — siglas de entidades públicas colombianas en «Proveedores de una
 * empresa»: «ICBF», «SENA», «DIAN»… se buscan por el nombre oficial de la entidad.
 *
 * Puro: sin red ni base. Cubre (1) la clave de comparación, (2) la integridad de la
 * tabla curada, y (3) el paso completo: la sigla se traduce, la elección sigue siendo
 * «una sola entidad o ninguna», y sin tabla (otros países) nada cambia.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CO_PUBLIC_ENTITY_ALIASES,
  coEntityAliasKey,
  findCoEntityAlias,
  resolveCoEntityAlias,
} from '../co-entity-aliases';
import { CO_COUNTRY } from '../co';
import {
  pickPublicBuyer,
  runPublicBuyerSupplierStep,
  type PublicBuyerStepDeps,
  type PublicEntityRow,
} from '../../public-buyer-suppliers';

describe('coEntityAliasKey', () => {
  it('ignora puntos, mayúsculas, tildes, espacios y el artículo inicial', () => {
    assert.equal(coEntityAliasKey('I.C.B.F.'), 'ICBF');
    assert.equal(coEntityAliasKey('icbf'), 'ICBF');
    assert.equal(coEntityAliasKey('la DIAN'), 'DIAN');
    assert.equal(coEntityAliasKey('El SENA'), 'SENA');
    assert.equal(coEntityAliasKey('Min Salud'), coEntityAliasKey('MinSalud'));
    assert.equal(coEntityAliasKey('Migración Colombia'), 'MIGRACIONCOLOMBIA');
  });

  it('una sola palabra que parece artículo no se borra', () => {
    assert.equal(coEntityAliasKey('la'), 'LA');
    assert.equal(coEntityAliasKey('   '), '');
  });
});

describe('resolveCoEntityAlias', () => {
  it('traduce una sigla conocida al nombre oficial', () => {
    assert.equal(resolveCoEntityAlias('ICBF'), 'INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR');
    assert.equal(resolveCoEntityAlias('SENA'), 'SERVICIO NACIONAL DE APRENDIZAJE');
    assert.equal(
      resolveCoEntityAlias('DIAN'),
      'UNIDAD ADMINISTRATIVA ESPECIAL DIRECCION DE IMPUESTOS Y ADUANAS NACIONALES',
    );
    assert.equal(resolveCoEntityAlias('MinHacienda'), 'MINISTERIO DE HACIENDA Y CREDITO PUBLICO');
    assert.equal(resolveCoEntityAlias('Supersociedades'), 'SUPERINTENDENCIA DE SOCIEDADES');
  });

  it('sólo si TODA la referencia es la sigla: un fragmento o una empresa privada no cuentan', () => {
    assert.equal(resolveCoEntityAlias('ICBF Bogotá'), null);
    assert.equal(resolveCoEntityAlias('regional del ICBF'), null);
    assert.equal(resolveCoEntityAlias('Bancolombia'), null);
    assert.equal(resolveCoEntityAlias('Alcaldía de Medellín'), null);
    assert.equal(resolveCoEntityAlias(''), null);
  });

  it('dos siglas de la misma entidad dan el mismo nombre', () => {
    assert.equal(resolveCoEntityAlias('SNR'), resolveCoEntityAlias('Supernotariado'));
    assert.equal(resolveCoEntityAlias('SFC'), resolveCoEntityAlias('Superfinanciera'));
  });
});

describe('integridad de la tabla curada', () => {
  const entries = CO_PUBLIC_ENTITY_ALIASES;

  it('hay una lista razonable y cada entrada tiene lo mínimo', () => {
    assert.ok(entries.length >= 60, `sólo ${entries.length} entidades`);
    for (const entry of entries) {
      assert.ok(entry.aliases.length >= 1, entry.officialName);
      assert.match(entry.nit, /^\d{9}$/, `NIT de ${entry.officialName}`);
      assert.ok(entry.officialName.trim().length >= 8, entry.officialName);
    }
  });

  it('ninguna sigla se repite (ni dentro de la misma entidad ni entre entidades)', () => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      for (const alias of entry.aliases) {
        const key = coEntityAliasKey(alias);
        assert.ok(key.length >= 3, `sigla muy corta: ${alias}`);
        assert.equal(seen.get(key), undefined, `sigla repetida: ${alias} (${seen.get(key)} y ${entry.officialName})`);
        seen.set(key, entry.officialName);
      }
    }
  });

  it('ningún NIT ni nombre oficial se repite', () => {
    assert.equal(new Set(entries.map((e) => e.nit)).size, entries.length, 'NIT repetido');
    const names = entries.map((e) => CO_COUNTRY.normalizeBuyerName?.(e.officialName) ?? e.officialName);
    assert.equal(new Set(names).size, entries.length, 'dos entradas normalizan al mismo nombre');
  });

  it('los nombres oficiales vienen limpios: mayúsculas, sin tildes ni caracteres dañados', () => {
    for (const entry of entries) {
      assert.equal(entry.officialName, entry.officialName.toUpperCase(), entry.officialName);
      assert.doesNotMatch(entry.officialName, /[̀-ͯ]|[ÁÉÍÓÚÑÃ�]/, entry.officialName);
      assert.equal(entry.officialName, entry.officialName.trim());
    }
  });

  it('el nombre oficial normaliza a algo útil con el MISMO normalizador del registro', () => {
    for (const entry of entries) {
      const normalized = CO_COUNTRY.normalizeBuyerName?.(entry.officialName) ?? '';
      assert.ok(normalized.length >= 8, `${entry.officialName} → «${normalized}»`);
    }
  });

  it('una sigla no es el comienzo de su propio nombre (sería redundante: ya la encontraría el prefijo)', () => {
    for (const entry of entries) {
      for (const alias of entry.aliases) {
        const prefix = entry.officialName.startsWith(`${alias.toUpperCase()} `);
        assert.equal(prefix, false, `${alias} es prefijo de ${entry.officialName}`);
      }
    }
  });

  it('las entidades con NIT sucio en el SIGEP quedaron fuera a propósito', () => {
    for (const alias of ['MINTRABAJO', 'MINVIVIENDA', 'MINDEFENSA', 'DPS', 'EJERCITO', 'ARMADA', 'UPTC']) {
      assert.equal(findCoEntityAlias(alias), null, alias);
    }
  });
});

describe('el paso completo con la tabla de Colombia', () => {
  const ICBF: PublicEntityRow = {
    taxId: '899999239',
    normalizedLegalName: 'INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR',
    shortName: null,
    isHead: true,
  };
  const STEP_INPUT = {
    batchId: 'b1',
    referenceCompanyName: 'ICBF',
    countryCode: 'CO',
    macroIndustryKey: 'technology',
    nowIso: '2026-10-14T00:00:00Z',
  };

  function deps(findPublicEntities: PublicBuyerStepDeps['findPublicEntities'], withAliases = true) {
    const searched: string[] = [];
    const result: PublicBuyerStepDeps = {
      sourceKey: 'co_secop2_buyer_suppliers',
      normalizeName: CO_COUNTRY.normalizeBuyerName,
      ...(withAliases ? { resolveReferenceAlias: resolveCoEntityAlias } : {}),
      findPublicEntities: async (name) => {
        searched.push(name);
        return findPublicEntities(name);
      },
      listSuppliers: async () => ({ ok: true, suppliers: [], read: 0, outsideIndustry: 0, tableVersion: 'v' }),
      listPublicOnlyTaxIds: async () => new Set(),
      findDomainsByTaxId: async () => new Map(),
      writeWithWebsite: async (companies) => ({ written: companies.length, failed: false }),
      recordWithoutWebsite: async (companies) => companies.length,
    };
    return { deps: result, searched };
  }

  it('«ICBF» busca el nombre oficial y encuentra la entidad (antes: no_public_entity)', async () => {
    const f = deps(async () => [ICBF]);
    const outcome = await runPublicBuyerSupplierStep(STEP_INPUT, f.deps);
    assert.deepEqual(f.searched, ['INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR']);
    assert.equal(outcome.executed, true);
    if (!outcome.executed) return;
    assert.equal(outcome.buyer.taxId, '899999239');
    assert.equal(outcome.buyer.matchedBy, 'exact');
    assert.equal(outcome.buyer.viaAlias, 'ICBF');
  });

  it('sin tabla de siglas (otro país, o antes de este cambio) nada cambia: la sigla no encuentra a nadie', async () => {
    const f = deps(async () => [], false);
    const outcome = await runPublicBuyerSupplierStep(STEP_INPUT, f.deps);
    assert.deepEqual(f.searched, ['ICBF']);
    assert.deepEqual(outcome, { executed: false, reason: 'not_public_entity' });
  });

  it('una referencia que no es sigla se busca igual que siempre, sin marca de sigla', async () => {
    const medellin: PublicEntityRow = { taxId: '890905211', normalizedLegalName: 'ALCALDIA DE MEDELLIN', shortName: null, isHead: true };
    const f = deps(async () => [medellin]);
    const outcome = await runPublicBuyerSupplierStep({ ...STEP_INPUT, referenceCompanyName: 'Alcaldía de Medellín' }, f.deps);
    assert.deepEqual(f.searched, ['ALCALDIA DE MEDELLIN']);
    assert.equal(outcome.executed, true);
    if (outcome.executed) assert.equal('viaAlias' in outcome.buyer, false);
  });

  it('si el nombre oficial coincidiera con DOS entidades, no elige: ambiguous_entity (nunca la equivocada)', async () => {
    const regional: PublicEntityRow = {
      taxId: '800000000',
      normalizedLegalName: 'INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR REGIONAL X',
      shortName: null,
      isHead: false,
    };
    const otherHead: PublicEntityRow = { ...regional, taxId: '800000001', normalizedLegalName: 'INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR REGIONAL Y' };
    const f = deps(async () => [regional, otherHead]);
    const outcome = await runPublicBuyerSupplierStep(STEP_INPUT, f.deps);
    assert.deepEqual(outcome, { executed: false, reason: 'ambiguous_entity' });
  });

  it('la elección por nombre sigue siendo pickPublicBuyer: el nombre oficial da la entidad exacta', () => {
    const picked = pickPublicBuyer('INSTITUTO COLOMBIANO DE BIENESTAR FAMILIAR', [ICBF], CO_COUNTRY.normalizeBuyerName);
    assert.deepEqual(picked, { entity: ICBF, matchedBy: 'exact' });
  });
});
