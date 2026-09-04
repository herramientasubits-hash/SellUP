// AGENT1-DISCARDED-TAB-PARITY-1 — la tabla de "Descartadas" debe verse y
// comportarse igual que la de "Candidatos por revisar", con las acciones
// propias de descartadas.
//
// Guarda estática (no hay arnés de render RSC/DOM en este repo): compara las
// CAPACIDADES que ambas tablas declaran sobre <DataTable>. Si alguien añade una
// capacidad a la cola de revisión y no a Descartadas, o quita una de
// Descartadas, esta prueba falla y nombra exactamente cuál.
//
// Run: node --import tsx --test <this file>

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DISCARDED = readFileSync(
  path.join(__dirname, '..', 'discarded-prospects-data-table-client.tsx'),
  'utf8',
);
const REVIEW_QUEUE = readFileSync(
  path.join(__dirname, '..', 'prospects-data-table-client.tsx'),
  'utf8',
);

/** Capacidades de <DataTable> que ambas superficies deben declarar. */
const SHARED_DATATABLE_CAPABILITIES = [
  'enableRowSelection',
  'bulkActions=',
  'contextMenu=',
  'enableColumnReorder',
  'initialPageSize={20}',
  'fillHeight',
  'rowClickable',
  'settingsExtraSections=',
  'count=',
  'title=',
  'description=',
  'emptyState=',
] as const;

describe('Descartadas — paridad de tabla con Candidatos por revisar', () => {
  for (const capability of SHARED_DATATABLE_CAPABILITIES) {
    it(`declara "${capability}" igual que la cola de revisión`, () => {
      assert.ok(
        REVIEW_QUEUE.includes(capability),
        `precondición: la cola de revisión debe declarar ${capability}`,
      );
      assert.ok(
        DISCARDED.includes(capability),
        `la tabla de Descartadas debe declarar ${capability}`,
      );
    });
  }

  it('marca cada fila con "Nuevo" el mismo día, igual que la cola de revisión', () => {
    for (const [name, source] of [
      ['cola de revisión', REVIEW_QUEUE],
      ['Descartadas', DISCARDED],
    ] as const) {
      assert.ok(
        source.includes('isProspectCreatedToday'),
        `${name} debe derivar el badge "Nuevo" de isProspectCreatedToday`,
      );
      assert.match(source, />\s*Nuevo\s*</, `${name} debe renderizar el badge "Nuevo"`);
    }
  });

  it('reutiliza el MISMO encabezado de fecha (sort + rango), no una copia', () => {
    const shared = "@/components/prospects/prospect-date-range-column-header";
    assert.ok(REVIEW_QUEUE.includes(shared));
    assert.ok(DISCARDED.includes(shared));
    assert.ok(
      !DISCARDED.includes('function DateRangeColumnHeader'),
      'Descartadas no debe redefinir el encabezado de fecha',
    );
    assert.ok(
      !REVIEW_QUEUE.includes('function DateRangeColumnHeader'),
      'la cola de revisión no debe conservar la copia local',
    );
  });

  it('las acciones masivas son las de descartadas, no las de la cola de revisión', () => {
    for (const id of ["id: 'view-detail'", "id: 'send-to-review'", "id: 'keep-discarded'"]) {
      assert.ok(DISCARDED.includes(id), `falta la acción masiva ${id}`);
    }
    // Ninguna acción de la cola de revisión puede filtrarse a Descartadas.
    for (const foreign of ["id: 'approve'", "id: 'discard'", "id: 'mark-duplicate'"]) {
      assert.ok(
        !DISCARDED.includes(foreign),
        `Descartadas no debe ofrecer la acción de la cola de revisión ${foreign}`,
      );
    }
  });

  it('el envío masivo sigue siendo gratuito: sólo la server action ya auditada', () => {
    assert.ok(DISCARDED.includes('sendDiscardedProspectToReviewAction'));
    // Sin clientes de proveedor ni fetch directo desde la tabla.
    for (const provider of ['apollo', 'lusha', 'tavily', 'hubspot']) {
      assert.ok(
        !DISCARDED.toLowerCase().includes(provider),
        `la tabla de Descartadas no debe nombrar a ${provider}`,
      );
    }
  });
});
