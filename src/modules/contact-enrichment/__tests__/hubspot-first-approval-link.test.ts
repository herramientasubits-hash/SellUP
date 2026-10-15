import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { linkApprovedHubSpotCandidate } from '../hubspot-first-approval-link';

function fakeAdmin(candidate: Record<string, unknown> | null, updatedRows: Array<{ id: string }>) {
  const updates: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      if (table === 'contact_enrichment_candidates') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: candidate, error: null }) }) }) };
      }
      return {
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: () => ({ is: () => ({ select: async () => ({ data: updatedRows, error: null }) }) }) };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { admin, updates };
}

describe('Primero HubSpot — vínculo al aprobar', () => {
  it('candidato de HubSpot: el contacto queda con su hubspot_contact_id', async () => {
    const { admin, updates } = fakeAdmin({ source: 'hubspot', source_contact_id: 'h9', matched_hubspot_contact_id: 'h9' }, [{ id: 'c1' }]);
    assert.equal(await linkApprovedHubSpotCandidate(admin, 'cand-1', 'c1'), 'linked');
    assert.deepEqual(updates, [{ hubspot_contact_id: 'h9' }]);
  });

  it('candidato de Apollo/Lusha: no toca nada', async () => {
    const { admin, updates } = fakeAdmin({ source: 'apollo', source_contact_id: 'p1', matched_hubspot_contact_id: null }, []);
    assert.equal(await linkApprovedHubSpotCandidate(admin, 'cand-1', 'c1'), 'not_hubspot_candidate');
    assert.equal(updates.length, 0);
  });

  it('un contacto que ya tenía vínculo no se pisa', async () => {
    const { admin } = fakeAdmin({ source: 'hubspot', source_contact_id: 'h9', matched_hubspot_contact_id: null }, []);
    assert.equal(await linkApprovedHubSpotCandidate(admin, 'cand-1', 'c1'), 'already_linked');
  });
});
