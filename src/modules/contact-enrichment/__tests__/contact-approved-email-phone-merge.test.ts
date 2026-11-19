/**
 * AGENT2A-CONTACT-APPROVED-EMAIL-PHONE-MERGE (Bryan 19-11).
 *
 *  - «Verificar correo» dice la verdad: sin guardar en SellUp no dice «quedó»; cada desenlace de
 *    HubSpot tiene su frase (409 → fusionar);
 *  - 409: el contacto que HubSpot devuelve BUSCANDO POR EL CORREO es el principal de la fusión, el
 *    vinculado a SellUp se fusiona dentro, SellUp se repunta al id resultante;
 *  - después de fusionar: LinkedIn y cargo REEMPLAZAN, teléfonos al primer campo vacío sin repetir,
 *    empresa de la cuenta como «Principal», propietario = quien confirma;
 *  - teléfono: un contacto «legacy» (escalar sin colección) arranca su colección con
 *    `legacy_incumbent` (169) y la proyección se repite UNA vez; la regla 164 se respeta.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  classifyHubSpotMergeOffer,
  hubspotMergeOutcomeText,
  planMergeFollowUp,
  readPendingHubSpotEmailConflict,
  runHubSpotContactMerge,
  type HubSpotMergeDeps,
  type HubSpotMergeInput,
} from '../contact-hubspot-merge-core';
import {
  buildBootstrapLegacyContactPhoneParams,
  legacyPhoneSourceFromPair,
  parseBootstrapLegacyContactPhoneEnvelope,
  planProviderPhoneNotice,
  projectWithLegacyContactBootstrap,
  shouldPushProjectedPhonesToHubSpot,
} from '../legacy-contact-phone-bootstrap-core';
import { hubspotAdditionalEmailNote, hubspotPrimaryEmailNote, verificationOutcomeText } from '../official-contact-email-check-view';
import type { ProjectApprovedCandidatePhonesOutcome } from '../post-approval-reveal-core';

const root = process.cwd();
const code = (rel: string) =>
  readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const CE = 'src/modules/contact-enrichment';

const NEW_EMAIL = 'ana.perez@acme.com';

function candidateMetadata(block: Record<string, unknown>) {
  return { email_check: { resolution: 'applied', hubspot_outcome: 'conflict', found_email: NEW_EMAIL, ...block } };
}

// ── 409 pendiente ───────────────────────────────────────────────────

describe('readPendingHubSpotEmailConflict', () => {
  it('lee el 409 aplicado en SellUp', () => {
    assert.deepEqual(readPendingHubSpotEmailConflict(candidateMetadata({})), { foundEmail: NEW_EMAIL });
  });
  it('sin 409, sin aplicar o ya fusionado: nada', () => {
    assert.equal(readPendingHubSpotEmailConflict(candidateMetadata({ hubspot_outcome: 'promoted' })), null);
    assert.equal(readPendingHubSpotEmailConflict(candidateMetadata({ resolution: 'dismissed' })), null);
    assert.equal(readPendingHubSpotEmailConflict(candidateMetadata({ hubspot_merge: { outcome: 'merged' } })), null);
    assert.equal(readPendingHubSpotEmailConflict(null), null);
  });
  it('una fusión que falló deja el 409 pendiente (se puede reintentar)', () => {
    assert.deepEqual(readPendingHubSpotEmailConflict(candidateMetadata({ hubspot_merge: { outcome: 'merge_failed' } })), {
      foundEmail: NEW_EMAIL,
    });
  });
});

describe('classifyHubSpotMergeOffer', () => {
  const contact = { email: NEW_EMAIL, hubspotContactId: '111', archivedAt: null };
  const conflict = { foundEmail: NEW_EMAIL };
  const other = { id: '222', email: NEW_EMAIL, firstName: 'Ana', lastName: 'Pérez', jobTitle: 'Gerente' };

  it('otro contacto tiene el correo → se ofrece fusionar', () => {
    const offer = classifyHubSpotMergeOffer({ contact, conflict, other });
    assert.equal(offer.status, 'available');
    if (offer.status === 'available') {
      assert.equal(offer.other.id, '222');
      assert.equal(offer.other.name, 'Ana Pérez');
      assert.equal(offer.currentHubSpotContactId, '111');
    }
  });
  it('nadie lo tiene ya → reintentar', () => {
    assert.equal(classifyHubSpotMergeOffer({ contact, conflict, other: null }).status, 'retry');
  });
  it('HubSpot no responde → hubspot_unavailable', () => {
    assert.equal(classifyHubSpotMergeOffer({ contact, conflict, other: 'error' }).status, 'hubspot_unavailable');
  });
  it('el que lo tiene es el mismo vinculado, el correo cambió, sin HubSpot o archivado → nada', () => {
    assert.equal(classifyHubSpotMergeOffer({ contact, conflict, other: { ...other, id: '111' } }).status, 'none');
    assert.equal(classifyHubSpotMergeOffer({ contact: { ...contact, email: 'otro@acme.com' }, conflict, other }).status, 'none');
    assert.equal(classifyHubSpotMergeOffer({ contact: { ...contact, hubspotContactId: null }, conflict, other }).status, 'none');
    assert.equal(classifyHubSpotMergeOffer({ contact: { ...contact, archivedAt: '2026-11-01' }, conflict, other }).status, 'none');
    assert.equal(classifyHubSpotMergeOffer({ contact, conflict: null, other }).status, 'none');
  });
});

// ── Lo que viaja después de fusionar ───────────────────────────────

describe('planMergeFollowUp', () => {
  const merged = {
    properties: {
      hs_linkedin_url: 'https://www.linkedin.com/in/ana-vieja',
      jobtitle: 'Analista',
      phone: '+57 300 111 2233',
      mobilephone: null,
      telefono_alterno: null,
    },
    ownerId: '900',
  };

  it('LinkedIn y cargo REEMPLAZAN; propietario = quien confirma', () => {
    const plan = planMergeFollowUp({
      sellup: { linkedinUrl: 'https://linkedin.com/in/ana-perez', jobTitle: 'Gerente de Talento' },
      actorOwnerId: '901',
      merged,
      sellupPhones: [],
    });
    assert.deepEqual(plan.replace, {
      hs_linkedin_url: 'https://linkedin.com/in/ana-perez',
      jobtitle: 'Gerente de Talento',
      hubspot_owner_id: '901',
    });
  });

  it('el mismo LinkedIn (otra forma de URL), el mismo cargo y el mismo dueño no se reenvían', () => {
    const plan = planMergeFollowUp({
      sellup: { linkedinUrl: 'linkedin.com/in/ana-vieja/', jobTitle: 'analista' },
      actorOwnerId: '900',
      merged,
      sellupPhones: [],
    });
    assert.deepEqual(plan.replace, {});
  });

  it('teléfonos: al primer campo vacío y nunca repetidos', () => {
    const plan = planMergeFollowUp({
      sellup: { linkedinUrl: null, jobTitle: null },
      actorOwnerId: null,
      merged,
      sellupPhones: [{ phone: '+573001112233' }, { phone: '+57 310 555 6677' }],
    });
    assert.equal(plan.phones.phone, undefined, 'phone ya tiene dato: no se pisa');
    assert.ok(plan.phones.mobilephone, 'el número nuevo va a mobilephone');
    assert.ok(!Object.values(plan.phones).some((v) => String(v).replace(/\D/g, '') === '573001112233'), 'el repetido no viaja');
  });

  it('sin poder leer el contacto fusionado no viaja ningún teléfono', () => {
    const plan = planMergeFollowUp({
      sellup: { linkedinUrl: null, jobTitle: null },
      actorOwnerId: null,
      merged: null,
      sellupPhones: [{ phone: '+57 310 555 6677' }],
    });
    assert.deepEqual(plan.phones, {});
  });
});

// ── Orquestación ────────────────────────────────────────────────────

function mergeInput(overrides: Partial<HubSpotMergeInput['contact']> = {}): HubSpotMergeInput {
  return {
    conflict: { foundEmail: NEW_EMAIL },
    contact: {
      email: NEW_EMAIL,
      hubspotContactId: '111',
      archivedAt: null,
      linkedinUrl: 'https://linkedin.com/in/ana-perez',
      jobTitle: 'Gerente',
      accountHubSpotCompanyId: '555',
      ...overrides,
    },
  };
}

function fakeDeps(overrides: Partial<HubSpotMergeDeps> = {}) {
  const calls: string[] = [];
  const deps: HubSpotMergeDeps = {
    findByEmail: async () => {
      calls.push('find');
      return { id: '222', email: NEW_EMAIL, firstName: 'Ana', lastName: 'Pérez', jobTitle: null };
    },
    promotePrimaryEmail: async () => {
      calls.push('promote');
      return 'promoted';
    },
    merge: async (primary, toMerge) => {
      calls.push(`merge:${primary}<-${toMerge}`);
      return { ok: true, mergedId: '333' };
    },
    repoint: async ({ fromIds, toId }) => {
      calls.push(`repoint:${fromIds.join(',')}->${toId}`);
      return { ok: true, otherContactIds: ['otro-contacto'] };
    },
    readMerged: async () => ({ properties: { phone: '+57 300 111 2233', mobilephone: null, jobtitle: 'Analista' }, ownerId: '900' }),
    readPrimaryEmail: async () => NEW_EMAIL,
    loadSellupPhones: async () => [{ phone: '+57 310 555 6677' }],
    resolveActorOwnerId: async () => '901',
    replaceProperties: async (_id, props) => {
      calls.push(`replace:${Object.keys(props).sort().join(',')}`);
      return { ok: true, written: Object.keys(props) };
    },
    fillPhones: async (_id, plan) => {
      calls.push(`phones:${Object.keys(plan).join(',')}`);
      return { ok: true, written: Object.keys(plan) };
    },
    setPrimaryCompany: async (id, company) => {
      calls.push(`company:${id}:${company}`);
      return { ok: true };
    },
    ...overrides,
  };
  return { deps, calls };
}

describe('runHubSpotContactMerge', () => {
  it('el que tiene el correo es el PRINCIPAL; SellUp se repunta al id NUEVO; luego viaja lo de SellUp', async () => {
    const { deps, calls } = fakeDeps();
    const report = await runHubSpotContactMerge(mergeInput(), deps);
    assert.equal(report.outcome, 'merged');
    assert.equal(report.primaryHubSpotContactId, '222');
    assert.equal(report.mergedFromHubSpotContactId, '111');
    assert.equal(report.mergedHubSpotContactId, '333');
    assert.deepEqual(report.otherSellupContactIds, ['otro-contacto']);
    assert.ok(calls.includes('merge:222<-111'));
    assert.ok(calls.includes('repoint:111,222->333'));
    assert.ok(calls.indexOf('merge:222<-111') < calls.indexOf('repoint:111,222->333'));
    assert.ok(calls.includes('replace:hs_linkedin_url,hubspot_owner_id,jobtitle'));
    assert.ok(calls.includes('phones:mobilephone'));
    assert.ok(calls.includes('company:333:555'));
    assert.equal(report.steps.email, 'primary');
    assert.equal(report.steps.owner, 'written');
    assert.equal(report.steps.phones, 'written');
  });

  it('si la fusión falla no se toca nada más', async () => {
    const { deps, calls } = fakeDeps({ merge: async () => ({ error: 'HUBSPOT_MERGE_HTTP_400', status: 400 }) });
    const report = await runHubSpotContactMerge(mergeInput(), deps);
    assert.equal(report.outcome, 'merge_failed');
    assert.equal(report.httpStatus, 400);
    assert.deepEqual(calls, ['find']);
  });

  it('nadie más tiene el correo → reintenta el principal, sin fusionar', async () => {
    const { deps, calls } = fakeDeps({ findByEmail: async () => null });
    const report = await runHubSpotContactMerge(mergeInput(), deps);
    assert.equal(report.outcome, 'promoted_on_retry');
    assert.deepEqual(calls, ['promote']);
  });

  it('el que tiene el correo ya es el vinculado → already_same, sin fusionar', async () => {
    const { deps, calls } = fakeDeps({
      findByEmail: async () => ({ id: '111', email: NEW_EMAIL, firstName: null, lastName: null, jobTitle: null }),
    });
    assert.equal((await runHubSpotContactMerge(mergeInput(), deps)).outcome, 'already_same');
    assert.ok(!calls.some((c) => c.startsWith('merge')));
  });

  it('HubSpot no responde → hubspot_unavailable, sin fusionar', async () => {
    const { deps, calls } = fakeDeps({
      findByEmail: async () => {
        throw new Error('hubspot_not_connected');
      },
    });
    assert.equal((await runHubSpotContactMerge(mergeInput(), deps)).outcome, 'hubspot_unavailable');
    assert.deepEqual(calls, []);
  });

  it('sin 409 pendiente o con el correo cambiado en SellUp → not_pending', async () => {
    const { deps, calls } = fakeDeps();
    assert.equal((await runHubSpotContactMerge({ ...mergeInput(), conflict: null }, deps)).outcome, 'not_pending');
    assert.equal((await runHubSpotContactMerge(mergeInput({ email: 'otro@acme.com' }), deps)).outcome, 'not_pending');
    assert.equal((await runHubSpotContactMerge(mergeInput({ archivedAt: '2026-11-01' }), deps)).outcome, 'not_pending');
    assert.deepEqual(calls, []);
  });

  it('sin propietario de HubSpot para quien confirma, el propietario no se toca', async () => {
    const { deps, calls } = fakeDeps({ resolveActorOwnerId: async () => null });
    const report = await runHubSpotContactMerge(mergeInput(), deps);
    assert.equal(report.steps.owner, 'skipped');
    assert.ok(calls.includes('replace:hs_linkedin_url,jobtitle'));
  });

  it('copy de cada desenlace', () => {
    assert.match(hubspotMergeOutcomeText('merged'), /fusionados/);
    assert.match(hubspotMergeOutcomeText('merge_failed', 403), /permiso/);
  });
});

// ── «Verificar correo» dice la verdad ───────────────────────────────

describe('frases de HubSpot en «Verificar correo»', () => {
  it('409 → ofrece fusionar; cada fallo dice que en HubSpot no cambió', () => {
    assert.match(hubspotPrimaryEmailNote('conflict'), /Fusionar en HubSpot/);
    assert.match(hubspotPrimaryEmailNote('promoted'), /también quedó como principal/);
    assert.match(hubspotPrimaryEmailNote('unreadable'), /no se cambió/);
    assert.match(hubspotPrimaryEmailNote('hubspot_unavailable'), /no se cambió/);
    assert.match(hubspotAdditionalEmailNote('added_as_additional'), /adicional/);
    assert.match(verificationOutcomeText('same_company_new_email', 'conflict'), /quedó como principal en SellUp/);
  });

  it('la acción no da por guardado lo que no se guardó', () => {
    const src = code(`${CE}/official-contact-identity-completion-actions.ts`);
    assert.match(src, /if \(!applied\.contactUpdated\) return \{ \.\.\.fail\('contact_not_saved'\)/);
  });
});

// ── Teléfono: contacto «legacy» ─────────────────────────────────────

function outcome(status: ProjectApprovedCandidatePhonesOutcome['status'], inserted = 0): ProjectApprovedCandidatePhonesOutcome {
  return {
    status,
    detail: null,
    candidateId: 'cand',
    contactId: 'cont',
    phonesSeen: inserted,
    phonesInserted: inserted,
    phonesReused: 0,
    phonesSkippedSuppressed: 0,
    sourcesInserted: inserted,
    sourcesReused: 0,
    primaryDedupeKey: null,
    primaryElectedNow: false,
    scalarSynced: false,
    scalarFallback: 'absent',
    hubspotSyncTransition: 'not_evaluated',
  };
}

describe('projectWithLegacyContactBootstrap', () => {
  const scalar = { phone: '+57 300 111 2233', phoneType: 'work', countryCode: 'CO' };

  it('sin forma legacy: una sola proyección y ningún arranque', async () => {
    let projections = 0;
    const result = await projectWithLegacyContactBootstrap('cont', {
      project: async () => {
        projections += 1;
        return outcome('projected', 1);
      },
      readContactScalar: async () => scalar,
      bootstrap: async () => assert.fail('no debe arrancar'),
      nowIso: () => '2026-11-19T00:00:00.000Z',
    });
    assert.equal(projections, 1);
    assert.equal(result.bootstrap, null);
  });

  it('forma legacy: arranca la colección con el número del contacto y proyecta UNA vez más', async () => {
    const statuses = [outcome('scalar_incumbent_unprojectable'), outcome('projected', 1)];
    let params: unknown = null;
    const result = await projectWithLegacyContactBootstrap('cont', {
      project: async () => statuses.shift()!,
      readContactScalar: async () => scalar,
      bootstrap: async (p) => {
        params = p;
        return 'bootstrapped';
      },
      nowIso: () => '2026-11-19T00:00:00.000Z',
    });
    assert.equal(result.bootstrap, 'bootstrapped');
    assert.equal(result.outcome.status, 'projected');
    assert.equal(statuses.length, 0);
    const built = params as Record<string, unknown>;
    assert.equal(built.p_contact_id, 'cont');
    assert.equal(built.p_observed_phone, '+57 300 111 2233');
    assert.equal(built.p_phone_type, 'work');
    assert.match(String(built.p_dedupe_key), /^[a-z0-9]+:[0-9a-f]{64}$/, 'la clave es un hash, nunca el número');
    assert.doesNotMatch(String(built.p_dedupe_key), /3001112233/);
  });

  it('si el arranque no entra (número cambiado, lápida…) devuelve el rechazo original', async () => {
    let projections = 0;
    const result = await projectWithLegacyContactBootstrap('cont', {
      project: async () => {
        projections += 1;
        return outcome('scalar_incumbent_unprojectable');
      },
      readContactScalar: async () => scalar,
      bootstrap: async () => 'stale',
      nowIso: () => '2026-11-19T00:00:00.000Z',
    });
    assert.equal(projections, 1);
    assert.equal(result.bootstrap, 'stale');
    assert.equal(result.outcome.status, 'scalar_incumbent_unprojectable');
  });

  it('sin número utilizable no arranca nada', () => {
    assert.equal(buildBootstrapLegacyContactPhoneParams({ contactId: 'c', scalar: { phone: null, phoneType: null, countryCode: null }, nowIso: 'x' }), null);
    assert.equal(parseBootstrapLegacyContactPhoneEnvelope({ status: 'bootstrapped' }), 'bootstrapped');
    assert.equal(parseBootstrapLegacyContactPhoneEnvelope({ status: 'raro' }), 'unparseable');
  });
});

describe('el número nuevo llega a HubSpot aunque el principal no cambie', () => {
  it('se envía cuando entró un número y la fase 2 no va a correr', () => {
    assert.equal(shouldPushProjectedPhonesToHubSpot({ ...outcome('projected', 1), hubspotSyncTransition: 'not_evaluated' }), true);
  });
  it('no se envía si la fase 2 ya corre (saliente cambiado), si no entró nada o si no proyectó', () => {
    assert.equal(shouldPushProjectedPhonesToHubSpot({ ...outcome('projected', 1), hubspotSyncTransition: 'marked' }), false);
    assert.equal(shouldPushProjectedPhonesToHubSpot(outcome('projected', 0)), false);
    assert.equal(shouldPushProjectedPhonesToHubSpot(outcome('scalar_incumbent_unprojectable')), false);
  });
  it('el envío usa la regla de siempre: primer campo vacío, nunca repetido, nunca reemplaza', () => {
    const src = code(`${CE}/contact-projected-phones-hubspot-push.server.ts`);
    assert.match(src, /planRevealedPhonesForHubSpot\(phones, existing\.properties\)/);
    assert.match(src, /fillEmptyHubSpotContactProperties\(/);
    assert.doesNotMatch(src, /replaceHubSpotContactProperties|patchHubSpotContactProperties|updateHubSpotContact\(/);
  });
});

describe('«Teléfono Apollo / Lusha» tras proyectar', () => {
  const newest = { number: '+57 310 555 6677', type: 'mobile', source: 'apollo_reveal', observedAt: '2026-11-19' };
  it('el número nuevo de proveedor se muestra aparte (el principal de HubSpot no cambia, regla 164)', () => {
    assert.deepEqual(planProviderPhoneNotice({ phonesInserted: 1, contactPhone: '+57 300 111 2233', current: null, newest }), {
      number: '+57 310 555 6677',
      type: 'mobile',
      source: 'apollo_reveal',
      observed_at: '2026-11-19',
    });
  });
  it('nada nuevo, igual al principal o ya mostrado → no se escribe', () => {
    assert.equal(planProviderPhoneNotice({ phonesInserted: 0, contactPhone: null, current: null, newest }), null);
    assert.equal(planProviderPhoneNotice({ phonesInserted: 1, contactPhone: '573105556677', current: null, newest }), null);
    assert.equal(planProviderPhoneNotice({ phonesInserted: 1, contactPhone: null, current: { number: '+573105556677' }, newest }), null);
  });
  it('procedencia de la colección → vocabulario del escalar', () => {
    assert.equal(legacyPhoneSourceFromPair('lusha', 'reveal'), 'lusha_reveal');
    assert.equal(legacyPhoneSourceFromPair('apollo', 'waterfall'), 'apollo_reveal');
    assert.equal(legacyPhoneSourceFromPair('unknown', 'manual'), null, 'el legacy_incumbent no es de proveedor');
  });
});

// ── Guardas estáticas ───────────────────────────────────────────────

describe('guardas estáticas', () => {
  const sql = readFileSync(path.join(root, 'supabase/migrations/169_bootstrap_legacy_contact_phone_incumbent.sql'), 'utf8');
  // Sin comentarios ni el COMMENT ON (que documenta lo que NO hace).
  const body = sql.replace(/--.*$/gm, '').replace(/COMMENT ON FUNCTION[\s\S]*?';\n/, '');

  it('169: procedencia legacy_incumbent = (unknown, manual), sin tocar el escalar ni borrar', () => {
    assert.match(body, /'unknown', 'manual', 'v1:legacy_incumbent:'/);
    assert.match(body, /SECURITY INVOKER/);
    assert.match(body, /ON CONFLICT \(contact_id, dedupe_key\) DO NOTHING/);
    assert.doesNotMatch(body, /UPDATE\s+public\.contacts/i);
    assert.doesNotMatch(body, /DELETE\s+FROM/i);
    assert.doesNotMatch(body, /mobile_phone/);
    assert.match(body, /TO service_role;/);
    assert.doesNotMatch(body, /GRANT EXECUTE[^;]*TO (anon|authenticated)/);
  });

  it('los dos caminos de la proyección post-aprobación pasan por el arranque legacy', () => {
    for (const rel of ['approved-candidate-reveal-contact-sync.server.ts', 'post-approval-reveal-actions.ts']) {
      const src = code(`${CE}/${rel}`);
      assert.match(src, /projectApprovedCandidatePhonesWithLegacyBootstrap\(/, rel);
      assert.doesNotMatch(src, /projectApprovedCandidatePhonesOntoContact\(/, rel);
    }
  });

  it('la fusión: el principal es el que tiene el correo y siempre hay confirmación en la UI', () => {
    const core = code(`${CE}/contact-hubspot-merge-core.ts`);
    assert.match(core, /deps\.merge\(primaryId, current\)/);
    const panel = code('src/components/contacts/official-contact-hubspot-merge-panel.tsx');
    assert.match(panel, /<ConfirmDialog/);
    assert.match(panel, /onClick=\{\(\) => setConfirmOpen\(true\)\}/);
  });
});
