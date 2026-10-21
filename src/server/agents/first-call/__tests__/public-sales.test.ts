/**
 * Tests — Agente 3 · «le vende al Estado» (AGENT3-PUBLIC-SALES-1, auditoría de «Proveedores»
 * 21-10, bloque «Próximo»).
 *
 * Lo que la empresa le vende a entidades públicas (por su número fiscal) o el «Proveedor de X»
 * de la búsqueda del Agente 1 llegan a la ficha como hecho interno, con su enlace, y el
 * redactor lo usa como motivo concreto. Puro: sin red, sin Producción.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInternalFacts, type InternalContext } from '../internal-facts';
import {
  formatPublicAmount,
  publicSalesStatement,
  publicSalesTaxIdForms,
  readSupplierRelationship,
  summarizePublicSales,
  type PublicSalesRow,
} from '../public-sales';
import { buildWriterSystemPrompt } from '../writer-prompt';

const row = (buyer: string, name: string, amount: number, url: string | null, first: string, last: string): PublicSalesRow => ({
  buyer_code: buyer,
  buyer_name: name,
  total_amount: String(amount),
  currency: 'MXN',
  order_count: 2,
  first_order_on: first,
  last_order_on: last,
  top_order_url: url,
  top_order_amount: amount,
});

const ROWS = [
  row('050GYR', 'INSTITUTO MEXICANO DEL SEGURO SOCIAL', 90_000_000, 'https://comprasmx.gob.mx/c/1', '2025-11-03', '2026-08-20'),
  row('051GYN', 'INSTITUTO DE SEGURIDAD  Y SERVICIOS SOCIALES', 40_000_000, null, '2025-10-10', '2026-06-01'),
  row('009000', 'SECRETARIA DE INFRAESTRUCTURA', 5_500_000, 'https://comprasmx.gob.mx/c/3', '2026-01-15', '2026-09-30'),
  row('012000', 'SECRETARIA DE SALUD', 800_000, null, '2026-02-01', '2026-02-01'),
];

describe('1. el resumen de compras públicas', () => {
  it('cuenta entidades, suma, toma las 3 de más monto y la orden más grande con enlace', () => {
    const summary = summarizePublicSales(ROWS, { countryName: 'México', sourceLabel: 'Compras MX' });
    assert.ok(summary);
    assert.equal(summary.entityCount, 4);
    assert.deepEqual(summary.topEntities, [
      'INSTITUTO MEXICANO DEL SEGURO SOCIAL',
      'INSTITUTO DE SEGURIDAD Y SERVICIOS SOCIALES',
      'SECRETARIA DE INFRAESTRUCTURA',
    ]);
    assert.equal(summary.totalAmount, 136_300_000);
    assert.equal(summary.orderCount, 8);
    assert.equal(summary.firstOrderOn, '2025-10-10');
    assert.equal(summary.lastOrderOn, '2026-09-30');
    assert.equal(summary.evidenceUrl, 'https://comprasmx.gob.mx/c/1');
  });

  it('la frase lleva las cifras exactas, el período y la fuente', () => {
    const summary = summarizePublicSales(ROWS, { countryName: 'México', sourceLabel: 'Compras MX' })!;
    assert.equal(
      publicSalesStatement(summary),
      'Le vende al Estado de México: 4 entidades públicas (entre ellas INSTITUTO MEXICANO DEL SEGURO SOCIAL, INSTITUTO DE SEGURIDAD Y SERVICIOS SOCIALES, SECRETARIA DE INFRAESTRUCTURA), 8 contratos u órdenes por MXN 136 millones entre 2025-10 y 2026-09, según las compras públicas.',
    );
    assert.equal(formatPublicAmount(85_000, 'USD'), 'USD 85.000');
  });

  it('sin filas no hay resumen', () => {
    assert.equal(summarizePublicSales([], { countryName: 'Chile', sourceLabel: 'ChileCompra' }), null);
  });

  it('el número fiscal se busca en sus formas (RUT con y sin guion)', () => {
    assert.deepEqual(publicSalesTaxIdForms('76.286.049-k', 'CL').sort(), ['76.286.049-K', '76286049-K', '76286049K'].sort());
    assert.deepEqual(publicSalesTaxIdForms(' EGC981025898 ', 'MX'), ['EGC981025898']);
    assert.deepEqual(publicSalesTaxIdForms('123', 'PE'), []);
  });
});

describe('2. la relación de la búsqueda de proveedores', () => {
  it('lee «Proveedor de X» de la candidata (contrato o caso de éxito)', () => {
    assert.deepEqual(
      readSupplierRelationship({
        relationship: {
          kind: 'supplier_of',
          reference_company_name: 'Bancolombia',
          evidence: 'Bancolombia implementó RPA de Automation Anywhere.',
          evidence_url: 'https://www.automationanywhere.com/caso',
        },
      }),
      {
        referenceName: 'Bancolombia',
        evidence: 'Bancolombia implementó RPA de Automation Anywhere.',
        evidenceUrl: 'https://www.automationanywhere.com/caso',
        source: 'web',
      },
    );
    assert.equal(readSupplierRelationship({ relationship: { kind: 'competitor_of', reference_company_name: 'X' } }), null);
    assert.equal(readSupplierRelationship(null), null);
    assert.equal(
      readSupplierRelationship({ relationship: { kind: 'supplier_of', reference_company_name: 'X', evidence_url: 'javascript:alert(1)' } })?.evidenceUrl,
      null,
    );
  });
});

describe('3. en la ficha', () => {
  const base: InternalContext = {
    account: {
      id: 'a1',
      name: 'Mainbit',
      legalName: null,
      website: null,
      domain: 'mainbit.com.mx',
      country: 'México',
      countryCode: 'MX',
      industry: 'Tecnología',
      companySize: null,
      taxIdentifier: 'MAI950101AB1',
      taxIdentifierType: 'RFC',
      hubspotCompanyId: null,
    },
    classification: null,
    curatedLists: [],
    relations: [],
    hubspot: null,
    decisionMaker: null,
  };

  it('con compras públicas: un hecho con su enlace y su fuente', () => {
    const summary = summarizePublicSales(ROWS, { countryName: 'México', sourceLabel: 'Compras MX' });
    const facts = buildInternalFacts({ ...base, publicSales: summary });
    const fact = facts.find((f) => f.statement.startsWith('Le vende al Estado'));
    assert.ok(fact);
    assert.equal(fact.sourceUrl, 'https://comprasmx.gob.mx/c/1');
    assert.equal(fact.sourceLabel, 'Compras públicas (Compras MX)');
    assert.equal(fact.publishedOn, '2026-09-30');
  });

  it('sin compras públicas pero con «Proveedor de X»: ese hecho', () => {
    const facts = buildInternalFacts({
      ...base,
      supplierRelationship: { referenceName: 'Ecopetrol', evidence: 'Proveedor Icónico en Innovación 2023-2024.', evidenceUrl: 'https://ecopetrol.com.co/p', source: 'web' },
    });
    const fact = facts.find((f) => f.statement.startsWith('Es proveedor de'));
    assert.equal(fact?.statement, 'Es proveedor de Ecopetrol: Proveedor Icónico en Innovación 2023-2024.');
    assert.equal(fact?.sourceLabel, 'Búsqueda de proveedores del Agente 1');
  });

  it('sin nada de eso, la ficha queda igual que antes', () => {
    const facts = buildInternalFacts(base);
    assert.equal(facts.some((f) => /Estado|proveedor/i.test(f.statement)), false);
  });

  it('el redactor sabe usarlo como motivo, sin opinar de contratos ni montos', () => {
    assert.match(buildWriterSystemPrompt(), /le vende al Estado o que es proveedora de otra empresa/);
  });
});
