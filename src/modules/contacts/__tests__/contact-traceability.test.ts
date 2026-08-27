import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildContactTraceabilityViewModel } from '../contact-traceability';
import type { Contact } from '../types';

type ContactInput = Pick<Contact, 'source' | 'metadata' | 'hubspot_contact_id'>;

function makeContact(overrides: Partial<ContactInput> = {}): ContactInput {
  return {
    source: 'manual',
    metadata: {},
    hubspot_contact_id: null,
    ...overrides,
  };
}

describe('buildContactTraceabilityViewModel', () => {
  // ── Origen ─────────────────────────────────────────────────────────────────

  it('1. contacto con source_candidate_id → origen "Candidato aprobado por IA"', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { source_candidate_id: 'cand-abc' } }),
    );
    assert.equal(vm.hasSourceCandidate, true);
    assert.equal(vm.sourceCandidateId, 'cand-abc');
    assert.equal(vm.originLabel, 'Candidato aprobado por IA');
  });

  it('2. contacto sin source_candidate_id → origen "Creado manualmente"', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.hasSourceCandidate, false);
    assert.equal(vm.sourceCandidateId, null);
    assert.equal(vm.originLabel, 'Creado manualmente');
  });

  it('2b. fuente se toma de candidate_source cuando existe', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        source: 'manual',
        metadata: { candidate_source: 'apollo', source_candidate_id: 'x' },
      }),
    );
    assert.equal(vm.sourceLabel, 'Apollo');
  });

  it('2c. fuente cae al campo source cuando no hay candidate_source', () => {
    const vm = buildContactTraceabilityViewModel(makeContact({ source: 'hubspot' }));
    assert.equal(vm.sourceLabel, 'HubSpot');
  });

  // ── Relevancia ─────────────────────────────────────────────────────────────

  it('3. relevance.status = high_relevance → label "Alta"', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { relevance: { status: 'high_relevance', score: 0.95 } } }),
    );
    assert.equal(vm.hasRelevanceData, true);
    assert.equal(vm.relevanceLabel, 'Alta');
    assert.equal(vm.relevanceScore, 0.95);
  });

  it('4. relevance.status = medium_relevance → label "Media"', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { relevance: { status: 'medium_relevance' } } }),
    );
    assert.equal(vm.relevanceLabel, 'Media');
  });

  it('5. sin relevance → "Sin evaluación de IA registrada"', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.hasRelevanceData, false);
    assert.equal(vm.relevanceLabel, 'Sin evaluación de IA registrada');
    assert.equal(vm.relevanceScore, null);
  });

  // ── Completion ─────────────────────────────────────────────────────────────

  it('6. completion con fields → muestra campos completados legibles', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { completion: { completed_fields: ['email', 'linkedin_url'] } } }),
    );
    assert.equal(vm.hasCompletionData, true);
    assert.deepEqual(vm.completedFields, ['Email', 'LinkedIn']);
  });

  it('7. completion had_actionable_channel = true → true', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { completion: { had_actionable_channel: true, completed_fields: [] } } }),
    );
    assert.equal(vm.hasActionableChannel, true);
  });

  it('7b. completion had_actionable_channel = false → false', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ metadata: { completion: { had_actionable_channel: false, completed_fields: [] } } }),
    );
    assert.equal(vm.hasActionableChannel, false);
  });

  it('7c. sin completion → null', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.hasCompletionData, false);
    assert.equal(vm.hasActionableChannel, null);
    assert.deepEqual(vm.completedFields, []);
  });

  // ── Normalización ──────────────────────────────────────────────────────────

  it('8. normalization existente → isNormalized y campos legibles', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        metadata: {
          normalization: {
            status: 'normalized',
            fields: ['full_name', 'email', 'linkedin_url'],
          },
        },
      }),
    );
    assert.equal(vm.isNormalized, true);
    assert.deepEqual(vm.normalizedFields, ['Nombre completo', 'Email', 'LinkedIn']);
  });

  it('9. sin normalization → isNormalized false y campos vacíos', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.isNormalized, false);
    assert.deepEqual(vm.normalizedFields, []);
  });

  // ── HubSpot ────────────────────────────────────────────────────────────────

  // ── BACKFILL LEGACY — estas tres pruebas AFIRMABAN el defecto ──────────────
  //
  // Decían que un `hubspot_contact_id` presente basta para etiquetar «Sincronizado con HubSpot».
  // No basta: el vínculo dice que existe una ficha en HubSpot, no que sus datos estén al día, y
  // un contacto sin estado durable legible ni siquiera participa en la detección de pendientes
  // —la autoridad de `stale` devuelve `no_durable_state` y se calla—. Era la ficha en la que el
  // sistema menos sabía y la que con más seguridad afirmaba estar al día.
  //
  // Ahora el copy lo decide `resolveHubSpotSyncPresentation`, la misma autoridad que el badge
  // del drawer, y el ViewModel viaja además con el TONO para que la tarjeta no vuelva a deducir
  // el check verde del id.

  it('10. estado durable OBSERVADO → «Sincronizado», en verde', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        hubspot_contact_id: 'hs-001',
        metadata: {
          hubspot_sync: {
            status: 'synced',
            method: 'manual',
            attempted_at: '2026-08-20T10:00:00.000Z',
            hubspot_contact_id: 'hs-001',
            mode: 'created',
            association_status: 'associated',
          },
        },
      }),
    );
    assert.equal(vm.hubspotSyncLabel, 'Sincronizado');
    assert.equal(vm.hubspotSyncTone, 'synced');
    assert.equal(vm.hubspotContactId, 'hs-001');
    assert.equal(vm.hubspotMode, 'created');
    assert.equal(vm.hubspotAssociationStatus, 'associated');
  });

  it('10b. bloque SIN `status` legible → desconocido, aunque traiga auditoría legada', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        hubspot_contact_id: 'hs-001',
        metadata: { hubspot_sync: { mode: 'created', association_status: 'associated' } },
      }),
    );
    assert.equal(vm.hubspotSyncLabel, 'Estado de sincronización desconocido');
    assert.equal(vm.hubspotSyncTone, 'neutral');
    // La auditoría legada sigue mostrándose: no saber el estado no borra lo que sí consta.
    assert.equal(vm.hubspotMode, 'created');
  });

  it('11. hubspot_contact_id sin metadata de sync → ID visible y estado DESCONOCIDO', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ hubspot_contact_id: 'hs-999' }),
    );
    assert.equal(vm.hubspotSyncLabel, 'Estado de sincronización desconocido');
    assert.equal(vm.hubspotSyncTone, 'neutral');
    // El id se sigue enseñando: es la única pista del vínculo y ocultarlo empeoraría la ficha.
    assert.equal(vm.hubspotContactId, 'hs-999');
    assert.equal(vm.hubspotMode, null);
  });

  it('11b. línea base del backfill → «Vinculado a HubSpot», en neutro', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        hubspot_contact_id: 'hs-999',
        metadata: {
          hubspot_sync: {
            status: 'synced',
            method: null,
            attempted_at: null,
            hubspot_contact_id: 'hs-999',
            baseline_source: 'legacy_link_backfill',
            baseline_at: '2026-08-26T09:00:00.000Z',
          },
        },
      }),
    );
    // El vínculo consta; que los campos coincidan con HubSpot, NO. El copy no lo sugiere.
    assert.equal(vm.hubspotSyncLabel, 'Vinculado a HubSpot');
    assert.equal(vm.hubspotSyncTone, 'neutral');
  });

  it('12. sin HubSpot → «Sin sincronizar»', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.hubspotSyncLabel, 'Sin sincronizar');
    assert.equal(vm.hubspotSyncTone, 'neutral');
    assert.equal(vm.hubspotContactId, null);
  });

  // ── Seguridad: no expone JSON crudo ────────────────────────────────────────

  it('13. no expone objetos JSON crudos en ningún campo string del ViewModel', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        metadata: {
          source_candidate_id: 'cand-1',
          relevance: { status: 'high_relevance', score: 0.9, rejection_reasons: ['x', 'y'] },
          completion: { had_actionable_channel: true, completed_fields: ['email'] },
          normalization: { status: 'normalized', fields: ['email'] },
          hubspot_sync: { mode: 'linked_existing', association_status: 'failed' },
        },
        hubspot_contact_id: 'hs-x',
      }),
    );
    const stringFields: unknown[] = [
      vm.originLabel, vm.sourceLabel, vm.sourceCandidateId,
      vm.relevanceLabel, vm.hubspotSyncLabel, vm.hubspotMode, vm.hubspotAssociationStatus,
    ];
    for (const f of stringFields) {
      if (f === null || f === undefined) continue;
      assert.equal(typeof f, 'string', `Expected string, got ${typeof f}: ${JSON.stringify(f)}`);
      assert.equal((f as string).startsWith('{'), false, `Field looks like raw JSON: ${f}`);
    }
    // Arrays deben ser arrays de strings
    for (const arr of [vm.completedFields, vm.normalizedFields]) {
      assert.ok(Array.isArray(arr));
      arr.forEach((v) => assert.equal(typeof v, 'string'));
    }
  });
});
