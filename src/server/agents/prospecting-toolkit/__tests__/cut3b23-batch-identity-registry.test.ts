/**
 * AGENT1-CUT3B23 · CUT-3B3 — matriz de colisión del registro de identidad de lote.
 *
 * Es la suite que fija el comportamiento escalonado completo: qué suprime, qué NO
 * suprime, y sobre todo qué NO se puede fusionar aunque una señal débil coincida.
 *
 * Determinista y pura: sin Supabase, sin red, sin proveedores, sin reloj.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES,
  acceptIdentity,
  admitByBatchIdentity,
  createBatchIdentityCounters,
  createBatchIdentityRegistry,
  evaluateCandidateIdentity,
  isBatchIdentityBlockingStatus,
  isBatchIdentityHardDuplicate,
  seedBatchIdentityRegistry,
  tallyBatchIdentityDecision,
  tallyBatchIdentityError,
  tallyBatchIdentityPersisted,
  toBatchIdentityCountersMetadata,
} from '../batch-identity-registry';
import {
  buildCompanyIdentityEvidence,
  type CompanyIdentityEvidenceInput,
} from '../company-identity-evidence';

// ─── Ayudas ───────────────────────────────────────────────────────────────────

/** Registro con UNA identidad ya presente, con id de fila conocido. */
function registryWith(
  input: CompanyIdentityEvidenceInput,
  candidateId = 'existing-1',
  batchId = 'batch-A',
) {
  return acceptIdentity(
    createBatchIdentityRegistry(batchId),
    buildCompanyIdentityEvidence(input),
    candidateId,
  );
}

function decide(existing: CompanyIdentityEvidenceInput, incoming: CompanyIdentityEvidenceInput) {
  return evaluateCandidateIdentity(
    registryWith(existing),
    buildCompanyIdentityEvidence(incoming),
  );
}

/** La capa GRATUITA en Colombia: identidad fiscal, sin web. */
const FREE_CO = {
  countryCode: 'CO',
  taxId: '900123456',
  taxIdentifier: '900123456',
  name: 'Acme S.A.S.',
} satisfies CompanyIdentityEvidenceInput;

/** La capa de PAGO: dominio, sin identidad fiscal. */
const PAID_DOMAIN_ONLY = {
  countryCode: 'CO',
  domain: 'acme.com',
  name: 'Acme',
} satisfies CompanyIdentityEvidenceInput;

// ─── TIER 1 — identidad fiscal ────────────────────────────────────────────────

describe('CUT-3B3 · TIER 1 — identidad fiscal', () => {
  it('misma identidad fiscal, mismo país ⇒ DUPLICADO DURO', () => {
    const decision = decide(FREE_CO, { ...FREE_CO, name: 'ACME SAS' });
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
    assert.equal(decision.matchedTier, 1);
    assert.deepEqual([...decision.matchedCandidateIds], ['existing-1']);
  });

  it('misma identidad fiscal con DOMINIOS distintos ⇒ sigue siendo duplicado duro', () => {
    const decision = decide(
      { ...FREE_CO, domain: 'acme.com' },
      { ...FREE_CO, domain: 'acme.co' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
  });

  it('el MISMO identificador desnudo en países distintos NO es duplicado', () => {
    const decision = decide(
      { countryCode: 'CO', taxIdentifier: '900123456', name: 'Acme Colombia' },
      { countryCode: 'MX', taxIdentifier: '900123456', name: 'Acme Mexico' },
    );
    assert.notEqual(decision.action, 'hard_duplicate');
  });

  it('identidades fiscales distintas y NADA más en común ⇒ único', () => {
    const decision = decide(FREE_CO, {
      countryCode: 'CO',
      taxIdentifier: '800987654',
      name: 'Otra Compania',
    });
    assert.equal(decision.action, 'accepted_unique');
  });
});

// ─── TIER 0 — el conflicto fiscal manda sobre toda señal más débil ─────────────

describe('CUT-3B3 · TIER 0 — conflicto fiscal fuerte', () => {
  it('MISMO dominio con identidades fiscales en CONFLICTO ⇒ DISTINTOS', () => {
    const decision = decide(
      { countryCode: 'CO', taxIdentifier: '900123456', domain: 'grupo.com', name: 'Filial Uno' },
      { countryCode: 'CO', taxIdentifier: '800987654', domain: 'grupo.com', name: 'Filial Dos' },
    );
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedTier, 0);
    assert.equal(decision.softReason, 'fiscal_identity_conflict');
    assert.equal(isBatchIdentityHardDuplicate(decision), false);
  });

  it('MISMO id nativo del proveedor con conflicto fiscal ⇒ DISTINTOS', () => {
    const decision = decide(
      {
        countryCode: 'CO',
        taxIdentifier: '900123456',
        providerKey: 'lusha',
        providerEntityId: '55',
        name: 'Filial Uno',
      },
      {
        countryCode: 'CO',
        taxIdentifier: '800987654',
        providerKey: 'lusha',
        providerEntityId: '55',
        name: 'Filial Dos',
      },
    );
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedSignal, 'provider_entity_key');
  });

  it('MISMO LinkedIn de empresa con conflicto fiscal ⇒ DISTINTOS', () => {
    const decision = decide(
      {
        countryCode: 'CO',
        taxIdentifier: '900123456',
        linkedinUrl: 'https://linkedin.com/company/grupo',
        name: 'Filial Uno',
      },
      {
        countryCode: 'CO',
        taxIdentifier: '800987654',
        linkedinUrl: 'https://linkedin.com/company/grupo',
        name: 'Filial Dos',
      },
    );
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedSignal, 'linkedin_company');
  });

  it('MISMO nombre con conflicto fiscal ⇒ DISTINTOS, jamás duplicado', () => {
    const decision = decide(
      { countryCode: 'CO', taxIdentifier: '900123456', name: 'Servicios Integrales S.A.S.' },
      { countryCode: 'CO', taxIdentifier: '800987654', name: 'Servicios Integrales SAS' },
    );
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(isBatchIdentityHardDuplicate(decision), false);
  });
});

// ─── TIER 2 — dominio ─────────────────────────────────────────────────────────

describe('CUT-3B3 · TIER 2 — dominio', () => {
  it('mismo dominio, NINGUNO con identidad fiscal ⇒ duplicado duro', () => {
    const decision = decide(
      { countryCode: 'CO', domain: 'acme.com', name: 'Acme' },
      { countryCode: 'CO', domain: 'https://www.acme.com/co', name: 'Acme Colombia' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'normalized_domain');
    assert.equal(decision.matchedTier, 2);
  });

  it('mismo dominio, UNO sin identidad fiscal ⇒ duplicado duro', () => {
    const decision = decide(
      { countryCode: 'CO', taxIdentifier: '900123456', domain: 'acme.com', name: 'Acme' },
      { countryCode: 'CO', domain: 'acme.com', name: 'Acme Colombia' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'normalized_domain');
  });

  it('mismo dominio y MISMA identidad fiscal ⇒ duplicado duro por la señal más fuerte', () => {
    const decision = decide(
      { countryCode: 'CO', taxIdentifier: '900123456', domain: 'acme.com', name: 'Acme' },
      { countryCode: 'CO', taxIdentifier: '900.123.456-7', domain: 'acme.com', name: 'Acme' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
    assert.equal(decision.matchedTier, 1);
  });

  it('mismo dominio en PAÍSES distintos NO se salta en duro: posible duplicado', () => {
    const decision = decide(
      { countryCode: 'CO', domain: 'acme.com', name: 'Acme Colombia' },
      { countryCode: 'MX', domain: 'acme.com', name: 'Acme Mexico' },
    );
    assert.equal(decision.action, 'possible_duplicate');
    assert.equal(decision.softReason, 'country_mismatch');
    assert.equal(isBatchIdentityHardDuplicate(decision), false);
  });

  it('un país AUSENTE no es contradicción: sigue siendo duplicado duro', () => {
    const decision = decide(
      { domain: 'acme.com', name: 'Acme' },
      { countryCode: 'CO', domain: 'acme.com', name: 'Acme' },
    );
    assert.equal(decision.action, 'hard_duplicate');
  });
});

// ─── TIER 3 — id nativo del proveedor ─────────────────────────────────────────

describe('CUT-3B3 · TIER 3 — identidad nativa del proveedor', () => {
  it('mismo id de empresa de Apollo ⇒ duplicado duro', () => {
    const decision = decide(
      { providerKey: 'apollo', providerEntityId: 'org-1', name: 'Alfa' },
      { providerKey: 'apollo', providerEntityId: 'org-1', name: 'Beta' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'provider_entity_key');
    assert.equal(decision.matchedTier, 3);
  });

  it('mismo id de empresa de Lusha ⇒ duplicado duro', () => {
    const decision = decide(
      { providerKey: 'lusha', providerEntityId: '99', name: 'Alfa' },
      { providerKey: 'lusha', providerEntityId: '99', name: 'Beta' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'provider_entity_key');
  });

  it('🔴 el MISMO VALOR de id en Apollo y en Lusha NO puede coincidir', () => {
    const decision = decide(
      { providerKey: 'apollo', providerEntityId: '7', name: 'Alfa' },
      { providerKey: 'lusha', providerEntityId: '7', name: 'Beta' },
    );
    assert.equal(decision.action, 'accepted_unique');
    assert.equal(decision.matchedSignal, null);
  });
});

// ─── TIER 4 — LinkedIn de empresa ─────────────────────────────────────────────

describe('CUT-3B3 · TIER 4 — LinkedIn de empresa', () => {
  it('mismo LinkedIn de empresa ⇒ duplicado duro', () => {
    const decision = decide(
      { linkedinUrl: 'https://www.linkedin.com/company/acme/', name: 'Alfa' },
      { linkedinUrl: 'linkedin.com/company/acme?trk=x', name: 'Beta' },
    );
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'linkedin_company');
    assert.equal(decision.matchedTier, 4);
  });

  it('un perfil PERSONAL no participa: no crea coincidencia', () => {
    const decision = decide(
      { linkedinUrl: 'https://www.linkedin.com/in/juan-perez', name: 'Alfa' },
      { linkedinUrl: 'https://www.linkedin.com/in/juan-perez', name: 'Beta' },
    );
    assert.equal(decision.action, 'accepted_unique');
  });

  it('mismo LinkedIn en PAÍSES distintos ⇒ posible duplicado, no salto duro', () => {
    const decision = decide(
      { countryCode: 'CO', linkedinUrl: 'https://linkedin.com/company/acme', name: 'Alfa' },
      { countryCode: 'MX', linkedinUrl: 'https://linkedin.com/company/acme', name: 'Beta' },
    );
    assert.equal(decision.action, 'possible_duplicate');
    assert.equal(decision.softReason, 'country_mismatch');
  });
});

// ─── TIER 5 — nombre ──────────────────────────────────────────────────────────

describe('CUT-3B3 · TIER 5 — el nombre NUNCA suprime', () => {
  it('sólo el nombre coincide ⇒ ADMITIDO como posible duplicado', () => {
    const decision = decide(
      { countryCode: 'CO', name: 'Servicios Integrales S.A.S.' },
      { countryCode: 'CO', name: 'Servicios Integrales SAS' },
    );
    assert.equal(decision.action, 'possible_duplicate');
    assert.equal(decision.matchedSignal, 'canonical_name');
    assert.equal(decision.matchedTier, 5);
    assert.equal(decision.softReason, 'name_only');
    assert.equal(isBatchIdentityHardDuplicate(decision), false);
  });

  it('mismo nombre con DOMINIOS distintos sigue siendo admitido', () => {
    const decision = decide(
      { countryCode: 'CO', domain: 'uno.com', name: 'Acme S.A.S.' },
      { countryCode: 'CO', domain: 'dos.com', name: 'Acme SAS' },
    );
    assert.equal(isBatchIdentityHardDuplicate(decision), false);
  });
});

// ─── El par sin resolver: fiscal-sólo contra dominio-sólo ──────────────────────

describe('CUT-3B3 — incompletitud DELIBERADA (CUT-3A)', () => {
  it('fiscal-sólo contra dominio-sólo sin señal común ⇒ los DOS se admiten', () => {
    const freeThenPaid = decide(
      { ...FREE_CO, name: 'Empresa Uno' },
      { countryCode: 'CO', domain: 'empresados.com', name: 'Empresa Dos' },
    );
    assert.equal(freeThenPaid.action, 'accepted_unique');

    const paidThenFree = decide(
      { countryCode: 'CO', domain: 'empresados.com', name: 'Empresa Dos' },
      { ...FREE_CO, name: 'Empresa Uno' },
    );
    assert.equal(paidThenFree.action, 'accepted_unique');
  });

  it('sin NINGÚN identificador fuerte y con nombres distintos ⇒ admitido', () => {
    const decision = decide({ name: 'Alfa' }, { name: 'Beta' });
    assert.equal(decision.action, 'accepted_unique');
  });
});

// ─── Orden: gratuito→pago y pago→gratuito dan lo MISMO ────────────────────────

describe('CUT-3B3 — el ORDEN no cambia la decisión', () => {
  const paidWithSameTax = {
    countryCode: 'CO',
    taxIdentifier: '900.123.456-7',
    domain: 'acme.com',
    name: 'Acme',
  } satisfies CompanyIdentityEvidenceInput;

  it('gratuito y luego de pago ⇒ duplicado duro fiscal', () => {
    const decision = decide(FREE_CO, paidWithSameTax);
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
  });

  it('de pago y luego gratuito ⇒ duplicado duro fiscal (misma decisión)', () => {
    const decision = decide(paidWithSameTax, FREE_CO);
    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
  });
});

// ─── Estados que ocupan el lote ───────────────────────────────────────────────

describe('CUT-3B3 — estados bloqueantes resueltos contra el CHECK real', () => {
  it('los cinco estados de ocupación bloquean', () => {
    for (const status of BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES) {
      assert.equal(isBatchIdentityBlockingStatus(status), true, status);
    }
    assert.deepEqual([...BATCH_IDENTITY_BLOCKING_CANDIDATE_STATUSES], [
      'generated',
      'normalized',
      'needs_review',
      'approved',
      'converted_to_account',
    ]);
  });

  it('🔴 `discarded` NO bloquea: un descarte previo no puede tapar al legítimo', () => {
    assert.equal(isBatchIdentityBlockingStatus('discarded'), false);
  });

  it('`duplicate` tampoco bloquea: es una fila que ya perdió su sitio', () => {
    assert.equal(isBatchIdentityBlockingStatus('duplicate'), false);
  });

  it('un estado desconocido falla CERRADO: no bloquea', () => {
    assert.equal(isBatchIdentityBlockingStatus('qa_cleanup'), false);
    assert.equal(isBatchIdentityBlockingStatus(null), false);
    assert.equal(isBatchIdentityBlockingStatus(42), false);
  });
});

// ─── Ámbito: UN lote ──────────────────────────────────────────────────────────

describe('CUT-3B3 — ámbito de LOTE, no global', () => {
  it('la misma identidad en el MISMO lote coincide', () => {
    const registry = registryWith(FREE_CO, 'existing-1', 'batch-A');
    const decision = evaluateCandidateIdentity(registry, buildCompanyIdentityEvidence(FREE_CO));
    assert.equal(decision.action, 'hard_duplicate');
  });

  it('la misma identidad en OTRO lote no es coincidencia de este registro', () => {
    const otherBatch = createBatchIdentityRegistry('batch-B');
    const decision = evaluateCandidateIdentity(
      otherBatch,
      buildCompanyIdentityEvidence(FREE_CO),
    );
    assert.equal(decision.action, 'accepted_unique');
    assert.equal(otherBatch.batchId, 'batch-B');
  });

  it('sembrar no muta el registro de origen (inmutabilidad)', () => {
    const empty = createBatchIdentityRegistry('batch-A');
    const seeded = seedBatchIdentityRegistry(empty, [
      { candidateId: 'row-1', evidence: buildCompanyIdentityEvidence(FREE_CO) },
    ]);
    assert.equal(empty.entries.length, 0);
    assert.equal(seeded.entries.length, 1);
  });
});

// ─── Intra-corrida: aceptado antes en la MISMA ejecución ──────────────────────

describe('CUT-3B3 — duplicado intra-corrida', () => {
  it('un aceptado antes en la misma ejecución hace saltar al segundo', () => {
    const result = admitByBatchIdentity(
      createBatchIdentityRegistry('batch-A'),
      [FREE_CO, { ...FREE_CO, name: 'ACME S A S' }, PAID_DOMAIN_ONLY],
      (input) => buildCompanyIdentityEvidence(input),
    );
    assert.equal(result.admitted.length, 2);
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].decision.matchedSignal, 'fiscal_identity');
  });

  it('el registro devuelto contiene sólo los ADMITIDOS', () => {
    const result = admitByBatchIdentity(
      createBatchIdentityRegistry('batch-A'),
      [FREE_CO, { ...FREE_CO, name: 'Copia' }],
      (input) => buildCompanyIdentityEvidence(input),
    );
    assert.equal(result.registry.entries.length, 1);
  });
});

// ─── Procedencia: el ganador no se toca ───────────────────────────────────────

describe('CUT-3B3 — procedencia: gana el PRIMER durable aceptado', () => {
  it('el duplicado no sobrescribe ni añade nada al ganador', () => {
    const registry = registryWith(
      { ...FREE_CO, domain: 'ganador.com' },
      'winner-id',
      'batch-A',
    );
    const before = JSON.stringify(registry.entries);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({ ...FREE_CO, domain: 'perdedor.com' }),
    );

    assert.equal(decision.action, 'hard_duplicate');
    // `evaluateCandidateIdentity` no muta: el ganador y su dominio quedan intactos.
    assert.equal(JSON.stringify(registry.entries), before);
    assert.equal(registry.entries[0].candidateId, 'winner-id');
    assert.equal(registry.entries[0].evidence.normalizedDomain, 'ganador.com');
  });

  it('aceptar devuelve un registro NUEVO y no muta el anterior', () => {
    const first = registryWith(FREE_CO, 'winner-id', 'batch-A');
    const second = acceptIdentity(
      first,
      buildCompanyIdentityEvidence(PAID_DOMAIN_ONLY),
      'second-id',
    );
    assert.equal(first.entries.length, 1);
    assert.equal(second.entries.length, 2);
  });
});

// ─── Conteo (CUT-2) ───────────────────────────────────────────────────────────

describe('CUT-3B3 · § 15 — conteo: descubierto ≠ aceptado único', () => {
  it('un duplicado NO consume `identityAdmittedUnique`, sube `duplicateSkipped` y NO toca `errors`', () => {
    let counters = createBatchIdentityCounters();
    const registry = registryWith(FREE_CO);

    counters = tallyBatchIdentityDecision(
      counters,
      evaluateCandidateIdentity(registry, buildCompanyIdentityEvidence(FREE_CO)),
    );

    assert.equal(counters.rawDiscovered, 1);
    assert.equal(counters.identityAdmittedUnique, 0);
    assert.equal(counters.duplicateSkipped, 1);
    assert.equal(counters.errors, 0);
  });

  it('un posible duplicado SÍ cuenta como aceptado único (se persiste)', () => {
    const registry = registryWith({ countryCode: 'CO', name: 'Servicios Integrales S.A.S.' });
    const counters = tallyBatchIdentityDecision(
      createBatchIdentityCounters(),
      evaluateCandidateIdentity(
        registry,
        buildCompanyIdentityEvidence({ countryCode: 'CO', name: 'Servicios Integrales SAS' }),
      ),
    );
    assert.equal(counters.identityAdmittedUnique, 1);
    assert.equal(counters.possibleDuplicateAllowed, 1);
    assert.equal(counters.duplicateSkipped, 0);
    assert.equal(counters.errors, 0);
  });

  it('un conflicto fuerte cuenta como aceptado único y queda auditable', () => {
    const registry = registryWith({
      countryCode: 'CO',
      taxIdentifier: '900123456',
      domain: 'grupo.com',
      name: 'Filial Uno',
    });
    const counters = tallyBatchIdentityDecision(
      createBatchIdentityCounters(),
      evaluateCandidateIdentity(
        registry,
        buildCompanyIdentityEvidence({
          countryCode: 'CO',
          taxIdentifier: '800987654',
          domain: 'grupo.com',
          name: 'Filial Dos',
        }),
      ),
    );
    assert.equal(counters.identityAdmittedUnique, 1);
    assert.equal(counters.distinctStrongConflict, 1);
    assert.equal(counters.duplicateSkipped, 0);
  });

  it('un error de escritura sube SÓLO `errors`', () => {
    const counters = tallyBatchIdentityError(createBatchIdentityCounters());
    assert.equal(counters.errors, 1);
    assert.equal(counters.duplicateSkipped, 0);
    assert.equal(counters.identityAdmittedUnique, 0);
  });

  it('el objetivo se mide con `identityAdmittedUnique`, no con `rawDiscovered`', () => {
    const result = admitByBatchIdentity(
      createBatchIdentityRegistry('batch-A'),
      [FREE_CO, { ...FREE_CO, name: 'Copia A' }, { ...FREE_CO, name: 'Copia B' }],
      (input) => buildCompanyIdentityEvidence(input),
    );
    assert.equal(result.counters.rawDiscovered, 3);
    assert.equal(result.counters.identityAdmittedUnique, 1);
    assert.equal(result.counters.duplicateSkipped, 2);
    assert.equal(result.counters.errors, 0);
    // Tres filas descubiertas NO pueden llenar un objetivo de tres.
    assert.notEqual(result.counters.identityAdmittedUnique, result.counters.rawDiscovered);
  });

  it('la vista de metadata es sólo números y sin PII', () => {
    const metadata = toBatchIdentityCountersMetadata(createBatchIdentityCounters());
    assert.deepEqual(metadata, {
      raw_discovered: 0,
      identity_admitted_unique: 0,
      persisted_unique: 0,
      duplicate_skipped: 0,
      possible_duplicate_allowed: 0,
      distinct_strong_conflict: 0,
      errors: 0,
    });
    for (const value of Object.values(metadata)) {
      assert.equal(typeof value, 'number');
    }
  });
});

// ─── El resumen de evidencia no filtra PII ────────────────────────────────────

describe('CUT-3B3 — la decisión no expone valores sensibles', () => {
  it('`evidenceSummary` es booleano: nunca el NIT ni el nombre', () => {
    const decision = decide(FREE_CO, { ...FREE_CO, name: 'Copia' });
    assert.deepEqual(decision.evidenceSummary, {
      hasFiscalIdentity: true,
      hasDomain: false,
      hasProviderEntityKey: false,
      hasLinkedInCompany: false,
      hasCanonicalName: true,
    });
    const serialized = JSON.stringify(decision);
    assert.equal(serialized.includes('900123456'), false);
  });
});

// ─── Un duplicado es un RESULTADO, no una excepción ───────────────────────────

describe('CUT-3B3 · § 11 — un duplicado no se lanza como error', () => {
  it('evaluar un duplicado devuelve una decisión, no lanza', () => {
    assert.doesNotThrow(() => decide(FREE_CO, FREE_CO));
    assert.equal(decide(FREE_CO, FREE_CO).action, 'hard_duplicate');
  });
});

// ─── § 2 — TIER 0 manda ENTRE ENTRADAS, no sólo dentro de una ─────────────────

/** Registro con VARIAS identidades presentes, cada una con su id de fila. */
function registryWithMany(
  inputs: ReadonlyArray<[string, CompanyIdentityEvidenceInput]>,
  batchId = 'batch-A',
) {
  return inputs.reduce(
    (registry, [candidateId, input]) =>
      acceptIdentity(registry, buildCompanyIdentityEvidence(input), candidateId),
    createBatchIdentityRegistry(batchId),
  );
}

describe('CUT-3B23 REVIEW-FIX § 2 — precedencia de TIER 0 con MÚLTIPLES entradas', () => {
  it('🔴 DOMINIO: una fila MUDA del mismo dominio no puede suprimir a quien otra fila desmiente por NIT', () => {
    // A: mismo dominio, SIN identidad fiscal ⇒ por sí sola sería duplicado duro.
    // B: mismo dominio, identidad fiscal CONTRADICTORIA ⇒ conflicto TIER 0.
    // El entrante es una persona jurídica DISTINTA: no puede desaparecer.
    const registry = registryWithMany([
      ['taxless-A', { countryCode: 'CO', domain: 'grupo.com', name: 'Grupo Filial A' }],
      [
        'conflicting-B',
        { countryCode: 'CO', domain: 'grupo.com', taxIdentifier: '800987654', name: 'Grupo Filial B' },
      ],
    ]);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        domain: 'grupo.com',
        taxIdentifier: '900123456',
        name: 'Grupo Filial C',
      }),
    );

    assert.notEqual(decision.action, 'hard_duplicate');
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedTier, 0);
    assert.equal(decision.softReason, 'fiscal_identity_conflict');
    assert.ok(decision.matchedCandidateIds.includes('conflicting-B'));
  });

  it('🔴 IDENTIDAD DE PROVEEDOR: misma ambigüedad, mismo desenlace', () => {
    const registry = registryWithMany([
      [
        'taxless-A',
        { countryCode: 'CO', providerKey: 'lusha', providerEntityId: 'pc-9', name: 'Filial A' },
      ],
      [
        'conflicting-B',
        {
          countryCode: 'CO',
          providerKey: 'lusha',
          providerEntityId: 'pc-9',
          taxIdentifier: '800987654',
          name: 'Filial B',
        },
      ],
    ]);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        providerKey: 'lusha',
        providerEntityId: 'pc-9',
        taxIdentifier: '900123456',
        name: 'Filial C',
      }),
    );

    assert.notEqual(decision.action, 'hard_duplicate');
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedTier, 0);
  });

  it('🔴 LINKEDIN DE EMPRESA: misma ambigüedad, mismo desenlace', () => {
    const linkedinUrl = 'https://www.linkedin.com/company/grupo-holding';
    const registry = registryWithMany([
      ['taxless-A', { countryCode: 'CO', linkedinUrl, name: 'Filial A' }],
      ['conflicting-B', { countryCode: 'CO', linkedinUrl, taxIdentifier: '800987654', name: 'Filial B' }],
    ]);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        linkedinUrl,
        taxIdentifier: '900123456',
        name: 'Filial C',
      }),
    );

    assert.notEqual(decision.action, 'hard_duplicate');
    assert.equal(decision.action, 'distinct_strong_conflict');
    assert.equal(decision.matchedTier, 0);
  });

  it('🔴 SIN sobrecorregir: con la MISMA identidad fiscal en otra fila, TIER 1 sigue suprimiendo', () => {
    // La misma ambigüedad de antes MÁS una fila cuya identidad fiscal es
    // EXACTAMENTE la del entrante. La identidad legal afirmativa manda.
    const registry = registryWithMany([
      ['taxless-A', { countryCode: 'CO', domain: 'grupo.com', name: 'Filial A' }],
      [
        'conflicting-B',
        { countryCode: 'CO', domain: 'grupo.com', taxIdentifier: '800987654', name: 'Filial B' },
      ],
      ['same-fiscal-C', { countryCode: 'CO', taxIdentifier: '900123456', name: 'Filial C' }],
    ]);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({
        countryCode: 'CO',
        domain: 'grupo.com',
        taxIdentifier: '900123456',
        name: 'Filial C bis',
      }),
    );

    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'fiscal_identity');
    assert.equal(decision.matchedTier, 1);
    assert.ok(decision.matchedCandidateIds.includes('same-fiscal-C'));
  });

  it('sin conflicto fiscal en el lote, el dedupe por dominio sigue suprimiendo igual que antes', () => {
    const registry = registryWithMany([
      ['taxless-A', { countryCode: 'CO', domain: 'grupo.com', name: 'Filial A' }],
      ['taxless-B', { countryCode: 'CO', domain: 'otro.com', name: 'Filial B' }],
    ]);

    const decision = evaluateCandidateIdentity(
      registry,
      buildCompanyIdentityEvidence({ countryCode: 'CO', domain: 'grupo.com', name: 'Filial C' }),
    );

    assert.equal(decision.action, 'hard_duplicate');
    assert.equal(decision.matchedSignal, 'normalized_domain');
    assert.equal(decision.matchedTier, 2);
  });
});

// ─── § 3 — admitido ≠ persistido ─────────────────────────────────────────────

describe('CUT-3B23 REVIEW-FIX § 3 — `identityAdmittedUnique` no afirma que la fila exista', () => {
  it('la admisión NO toca `persistedUnique`', () => {
    const counters = tallyBatchIdentityDecision(
      createBatchIdentityCounters(),
      evaluateCandidateIdentity(
        createBatchIdentityRegistry('batch-A'),
        buildCompanyIdentityEvidence(FREE_CO),
      ),
    );
    assert.equal(counters.identityAdmittedUnique, 1);
    assert.equal(counters.persistedUnique, 0, 'admitir no es escribir');
    assert.equal(counters.errors, 0);
  });

  it('un fallo de escritura deja `persistedUnique` en 0 y sube `errors`', () => {
    let counters = tallyBatchIdentityDecision(
      createBatchIdentityCounters(),
      evaluateCandidateIdentity(
        createBatchIdentityRegistry('batch-A'),
        buildCompanyIdentityEvidence(FREE_CO),
      ),
    );
    counters = tallyBatchIdentityError(counters);
    assert.equal(counters.identityAdmittedUnique, 1);
    assert.equal(counters.persistedUnique, 0);
    assert.equal(counters.errors, 1);
  });

  it('una escritura real sube SÓLO `persistedUnique`', () => {
    const counters = tallyBatchIdentityPersisted(createBatchIdentityCounters());
    assert.equal(counters.persistedUnique, 1);
    assert.equal(counters.errors, 0);
    assert.equal(counters.duplicateSkipped, 0);
  });

  it('la reconciliación en bloque acepta el número REAL de filas confirmadas', () => {
    const admitted = admitByBatchIdentity(
      createBatchIdentityRegistry('batch-A'),
      [FREE_CO, { ...FREE_CO, taxId: '800987654', taxIdentifier: '800987654' }],
      (input) => buildCompanyIdentityEvidence(input),
    );
    assert.equal(admitted.counters.identityAdmittedUnique, 2);
    assert.equal(admitted.counters.persistedUnique, 0, 'admitir en bloque no escribe');

    // El motor confirmó UNA sola fila: eso es lo que puede contar contra el objetivo.
    const reconciled = tallyBatchIdentityPersisted(admitted.counters, 1);
    assert.equal(reconciled.persistedUnique, 1);
    assert.equal(reconciled.identityAdmittedUnique, 2);
  });

  it('un duplicado duro no sube ni `persistedUnique` ni `errors`', () => {
    const counters = tallyBatchIdentityDecision(
      createBatchIdentityCounters(),
      evaluateCandidateIdentity(registryWith(FREE_CO), buildCompanyIdentityEvidence(FREE_CO)),
    );
    assert.equal(counters.duplicateSkipped, 1);
    assert.equal(counters.persistedUnique, 0);
    assert.equal(counters.errors, 0);
  });
});
