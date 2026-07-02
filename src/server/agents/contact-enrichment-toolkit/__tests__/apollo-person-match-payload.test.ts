/**
 * Tests — Apollo person_match payload (Hito 17A.8D)
 *
 * Verifica que buildMatchParams envía los identificadores más fuertes y los
 * flags necesarios para que Apollo revele email. Sin llamadas reales a Apollo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  completeContactWithApollo,
  PHONE_COMPLETION_ENABLED,
  type CompletionMatchDiagnostics,
} from '../contact-completion-adapter';
import type { NormalizedApolloContact } from '../contact-normalizer';
import type { ApolloPerson, MatchPersonParams, ApolloEnrichResult } from '@/server/integrations/apollo-client';

// ── Builder helpers ─────────────────────────────────────────────

function contact(overrides: Partial<NormalizedApolloContact> = {}): NormalizedApolloContact {
  return {
    firstName: 'Ana',
    lastName: 'Pérez',
    fullName: 'Ana Pérez',
    title: 'HR Director',
    seniority: 'director',
    department: 'human resources',
    country: 'Colombia',
    linkedinUrl: null,
    email: null,
    phone: null,
    source: 'apollo',
    sourceContactId: null,
    confidence: 0.6,
    enrichmentMetadata: { provider: 'apollo' },
    ...overrides,
  };
}


// ── Tests: payload de people/match ─────────────────────────────

describe('buildMatchParams — reveal_personal_emails', () => {
  it('siempre incluye reveal_personal_emails: true para obtener email de Apollo', async () => {
    let sentParams: MatchPersonParams | null = null;
    const base = contact({ firstName: 'Ana', lastName: 'Pérez' });

    await completeContactWithApollo(
      { candidate: base, companyName: 'Corp SA', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async (p) => {
          sentParams = p;
          return { success: true, data: undefined };
        },
      },
    );

    assert.ok(sentParams, 'matchPerson debe haberse llamado');
    assert.equal(
      (sentParams as MatchPersonParams).reveal_personal_emails,
      true,
      'reveal_personal_emails debe ser true para que Apollo revele email',
    );
  });

  it('reveal_phone_number NO está en el payload (phone reveal desactivado)', async () => {
    let sentParams: MatchPersonParams | null = null;
    const base = contact({ firstName: 'Ana', lastName: 'Pérez' });

    await completeContactWithApollo(
      { candidate: base, companyName: 'Corp SA', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async (p) => {
          sentParams = p;
          return { success: true, data: undefined };
        },
      },
    );

    assert.ok(sentParams, 'matchPerson debe haberse llamado');
    assert.equal(
      (sentParams as MatchPersonParams).reveal_phone_number,
      undefined,
      'reveal_phone_number no debe estar en el payload (phone reveal desactivado)',
    );
  });
});

describe('buildMatchParams — Apollo person ID', () => {
  it('incluye id cuando sourceContactId está disponible', async () => {
    let sentParams: MatchPersonParams | null = null;
    const base = contact({ sourceContactId: 'apollo-person-xyz123' });

    await completeContactWithApollo(
      { candidate: base, companyName: 'Corp SA', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async (p) => {
          sentParams = p;
          return { success: true, data: undefined };
        },
      },
    );

    assert.ok(sentParams, 'matchPerson debe haberse llamado');
    assert.equal(
      (sentParams as MatchPersonParams).id,
      'apollo-person-xyz123',
      'id debe incluirse para match directo al perfil del people_search',
    );
  });

  it('Apollo person ID solo (sin nombre ni empresa) es identidad suficiente para llamar match', async () => {
    let called = false;
    // Sin firstName, lastName, companyName, companyDomain pero CON sourceContactId.
    const base = contact({
      firstName: null,
      lastName: null,
      fullName: '',
      sourceContactId: 'apollo-xyz',
      email: null,
      linkedinUrl: null,
    });

    await completeContactWithApollo(
      { candidate: base, companyName: '', companyDomain: null, relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => {
          called = true;
          return { success: true, data: undefined };
        },
      },
    );

    assert.equal(called, true, 'Apollo person ID solo debe ser identidad suficiente para ejecutar match');
  });

  it('sin sourceContactId no incluye campo id en el payload', async () => {
    let sentParams: MatchPersonParams | null = null;
    const base = contact({ sourceContactId: null });

    await completeContactWithApollo(
      { candidate: base, companyName: 'Corp SA', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async (p) => {
          sentParams = p;
          return { success: true, data: undefined };
        },
      },
    );

    assert.ok(sentParams, 'matchPerson debe haberse llamado (tiene nombre + empresa)');
    assert.equal(
      (sentParams as MatchPersonParams).id,
      undefined,
      'id no debe estar en el payload cuando sourceContactId es null',
    );
  });
});

describe('buildMatchParams — linkedin_url', () => {
  it('incluye linkedin_url en el payload cuando el candidato lo tiene', async () => {
    let sentParams: MatchPersonParams | null = null;
    // Sin title: el candidato NO es accionable (isActionableContactCandidate = false)
    // pero sí tiene linkedin → match se ejecuta y linkedin_url debe ir en el payload.
    const base = contact({ linkedinUrl: 'https://linkedin.com/in/ana-perez', title: null, enrichmentMetadata: {} });

    await completeContactWithApollo(
      { candidate: base, companyName: 'Corp SA', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async (p) => {
          sentParams = p;
          return { success: true, data: undefined };
        },
      },
    );

    assert.ok(sentParams, 'matchPerson debe haberse llamado (candidato no accionable pero tiene linkedin como id fuerte)');
    assert.equal(
      (sentParams as MatchPersonParams).linkedin_url,
      'https://linkedin.com/in/ana-perez',
    );
  });
});

describe('buildMatchParams — identidad mínima con id', () => {
  it('sin identidad mínima (sin id, sin name, sin email, sin linkedin) → skipped sin llamar a Apollo', async () => {
    let called = false;
    const base = contact({
      firstName: null,
      lastName: null,
      fullName: '',
      sourceContactId: null,
      email: null,
      linkedinUrl: null,
    });

    const res = await completeContactWithApollo(
      { candidate: base, companyName: '', companyDomain: null, relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => {
          called = true;
          return { success: true, data: undefined };
        },
      },
    );

    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'insufficient_input_for_match');
    assert.equal(called, false, 'no debe llamar a Apollo sin identidad mínima');
  });
});

// ── Tests: diagnósticos seguros ─────────────────────────────────

describe('CompletionMatchDiagnostics — seguridad y shapes', () => {
  it('matchDiagnostics.skipped_sensitive_values es siempre true', async () => {
    const base = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => ({
          success: true,
          data: {
            id: 'apx1',
            first_name: 'Ana',
            last_name: 'Pérez',
            title: 'HR Director',
            email: 'ana@corp.com',
            linkedin_url: null,
            phone_numbers: [],
            organization: null,
          } satisfies ApolloPerson,
        }),
      },
    );

    const diag = res.matchDiagnostics as CompletionMatchDiagnostics;
    assert.ok(diag, 'matchDiagnostics debe estar presente cuando se llamó matchPerson');
    assert.equal(diag.skipped_sensitive_values, true);
  });

  it('matchDiagnostics reporta had_apollo_person_id correctamente', async () => {
    const withId = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: withId, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: async () => ({ success: true, data: undefined }) },
    );
    assert.equal(res.matchDiagnostics?.had_apollo_person_id, true);
  });

  it('matchDiagnostics reporta response_had_email_field cuando Apollo devuelve email', async () => {
    const base = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => ({
          success: true,
          data: {
            id: 'apx1',
            first_name: 'Ana',
            last_name: 'Pérez',
            title: 'HR Director',
            email: 'ana@corp.com',
            linkedin_url: null,
            phone_numbers: [],
            organization: null,
          } satisfies ApolloPerson,
        }),
      },
    );
    assert.equal(res.matchDiagnostics?.response_had_email_field, true);
    assert.equal(res.matchDiagnostics?.response_had_person_object, true);
  });

  it('matchDiagnostics reporta response_had_locked_email_signal para placeholder bloqueado', async () => {
    const base = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => ({
          success: true,
          data: {
            id: 'apx1',
            first_name: 'Ana',
            last_name: 'Pérez',
            title: 'HR Director',
            email: 'email_not_unlocked@domain.com',
            linkedin_url: null,
            phone_numbers: [],
            organization: null,
          } satisfies ApolloPerson,
        }),
      },
    );
    // El normalizer elimina el email bloqueado, pero el diagnóstico lo detecta antes.
    assert.equal(res.matchDiagnostics?.response_had_locked_email_signal, true);
    // El contacto resultante NO debe tener ese email bloqueado.
    assert.equal(res.contact.email, null, 'email bloqueado debe ser descartado por el normalizer');
  });

  it('matchDiagnostics.payload_fields_sent incluye reveal_personal_emails', async () => {
    const base = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: async () => ({ success: true, data: undefined }) },
    );
    assert.ok(
      res.matchDiagnostics?.payload_fields_sent.includes('reveal_personal_emails'),
      'payload_fields_sent debe incluir reveal_personal_emails',
    );
  });

  it('matchDiagnostics no expone el valor del email (solo shape)', async () => {
    const base = contact({ sourceContactId: 'apx1' });
    const res = await completeContactWithApollo(
      { candidate: base, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      {
        matchPerson: async () => ({
          success: true,
          data: {
            id: 'apx1',
            first_name: 'Ana',
            last_name: 'Pérez',
            title: 'HR Director',
            email: 'ana@secretcorp.com',
            linkedin_url: null,
            phone_numbers: [],
            organization: null,
          } satisfies ApolloPerson,
        }),
      },
    );
    const diag = res.matchDiagnostics as CompletionMatchDiagnostics;
    const diagStr = JSON.stringify(diag);
    // El diagnóstico NO debe contener el email real.
    assert.ok(
      !diagStr.includes('ana@secretcorp.com'),
      'matchDiagnostics no debe exponer valores de email',
    );
    // Pero sí debe reportar que había un campo email.
    assert.equal(diag.response_had_email_field, true);
  });

  it('matchDiagnostics no está presente cuando el candidato ya era accionable (no se llamó match)', async () => {
    const actionable = contact({ email: 'existing@corp.com' });
    const res = await completeContactWithApollo(
      { candidate: actionable, companyName: 'Corp', relevanceStatus: 'high_relevance' },
      { matchPerson: async () => ({ success: true }) },
    );
    assert.equal(res.status, 'skipped');
    assert.equal(res.matchDiagnostics, undefined, 'no hubo llamada → no hay diagnóstico');
  });
});

// ── Tests: phone reveal desactivado ────────────────────────────

describe('PHONE_COMPLETION_ENABLED constante', () => {
  it('PHONE_COMPLETION_ENABLED es false (phone reveal desactivado por política)', () => {
    assert.equal(PHONE_COMPLETION_ENABLED, false);
  });
});
