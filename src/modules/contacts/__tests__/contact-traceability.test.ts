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

  it('10. hubspot_sync con hubspot_contact_id → "Sincronizado con HubSpot"', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({
        hubspot_contact_id: 'hs-001',
        metadata: { hubspot_sync: { mode: 'created', association_status: 'associated' } },
      }),
    );
    assert.equal(vm.hubspotSyncLabel, 'Sincronizado con HubSpot');
    assert.equal(vm.hubspotContactId, 'hs-001');
    assert.equal(vm.hubspotMode, 'created');
    assert.equal(vm.hubspotAssociationStatus, 'associated');
  });

  it('11. hubspot_contact_id sin metadata de sync → ID visible y label "Sincronizado"', () => {
    const vm = buildContactTraceabilityViewModel(
      makeContact({ hubspot_contact_id: 'hs-999' }),
    );
    assert.equal(vm.hubspotSyncLabel, 'Sincronizado con HubSpot');
    assert.equal(vm.hubspotContactId, 'hs-999');
    assert.equal(vm.hubspotMode, null);
  });

  it('12. sin HubSpot → "No sincronizado con HubSpot"', () => {
    const vm = buildContactTraceabilityViewModel(makeContact());
    assert.equal(vm.hubspotSyncLabel, 'No sincronizado con HubSpot');
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
