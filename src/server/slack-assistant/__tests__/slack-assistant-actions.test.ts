import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANCEL_ACTION_ID,
  CONFIRM_ACTION_ID,
  confirmationProblem,
  decodeActionValue,
  encodeActionValue,
  MAX_ACTION_ITEMS,
  outcomeText,
  proposalBlocks,
  type ActionProposal,
} from '../action-proposal';
import { verifyOutcomes } from '../action-verify';
import { collectByName, type AssistantActionResolver, type Resolution } from '../action-resolver.server';
import { runAssistantTool, toolsForRole, type AssistantDataSource, type ProposedAction } from '../tools';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ASKER = id(900);

function proposal(overrides: Partial<ActionProposal> = {}): ActionProposal {
  return {
    kind: 'approve',
    items: [
      { id: id(1), nombre: 'COPEC S.A.' },
      { id: id(2), nombre: 'Alxar Internacional SpA', posibleDuplicado: true, enHubSpot: true },
    ],
    askerId: ASKER,
    askerSlackId: 'U-ASKER',
    expiresAt: 2_000_000_000,
    ...overrides,
  };
}

describe('propuesta en el botón', () => {
  it('ida y vuelta: ids, advertencias, quién pidió y vencimiento', () => {
    const decoded = decodeActionValue(encodeActionValue(proposal()));
    assert.ok(decoded);
    assert.equal(decoded.kind, 'approve');
    assert.deepEqual(decoded.ids, [id(1), id(2)]);
    assert.deepEqual([...decoded.possibleDuplicateIds], [id(2)]);
    assert.deepEqual([...decoded.hubSpotMatchIds], [id(2)]);
    assert.equal(decoded.askerSlackId, 'U-ASKER');
  });

  it('25 elementos con advertencias caben en un botón de Slack (2.000 caracteres)', () => {
    const items = Array.from({ length: MAX_ACTION_ITEMS }, (_, i) => ({ id: id(i + 1), nombre: `E${i}`, posibleDuplicado: true, enHubSpot: true }));
    const value = encodeActionValue(proposal({ items }));
    assert.ok(value.length <= 2000, String(value.length));
  });

  it('🔴 un botón manipulado o raro no se ejecuta', () => {
    const good = JSON.parse(encodeActionValue(proposal())) as Record<string, unknown>;
    const bad = (patch: Record<string, unknown>) => decodeActionValue(JSON.stringify({ ...good, ...patch }));
    assert.equal(decodeActionValue('no-json'), null);
    assert.equal(bad({ k: 'delete' }), null);
    assert.equal(bad({ ids: ['1; drop'] }), null);
    assert.equal(bad({ ids: [] }), null);
    assert.equal(bad({ ids: Array.from({ length: 26 }, (_, i) => id(i)) }), null);
    assert.equal(bad({ dup: [7] }), null);
    assert.equal(bad({ k: 'assign_accounts' }), null, 'asignar sin destino');
    assert.equal(bad({ k: 'discard' }), null, 'descartar sin motivo');
    assert.equal(bad({ a: 'no-uuid' }), null);
  });

  it('🔴 sólo confirma quien pidió, y antes de que venza', () => {
    const decoded = decodeActionValue(encodeActionValue(proposal({ expiresAt: 1000 })))!;
    assert.match(confirmationProblem(decoded, 'U-OTRO', 900) ?? '', /Sólo quien pidió/);
    assert.match(confirmationProblem(decoded, 'U-ASKER', 1001) ?? '', /venció/);
    assert.equal(confirmationProblem(decoded, 'U-ASKER', 999), null);
  });

  it('el mensaje dice qué pasará, marca advertencias y trae Confirmar/Cancelar', () => {
    const message = proposalBlocks(proposal());
    assert.match(message.text, /Aprobar 2 prospectos: cada uno pasa a Empresas y se crea o enlaza en HubSpot/);
    assert.match(message.text, /Alxar Internacional SpA \(posible duplicado, ya está en HubSpot\)/);
    const actions = message.blocks.find((b) => b.type === 'actions') as { elements: Array<{ action_id: string; text: { text: string } }> };
    assert.deepEqual(actions.elements.map((e) => e.action_id), [CONFIRM_ACTION_ID, CANCEL_ACTION_ID]);
    assert.equal(actions.elements[0].text.text, 'Aprobar (2)');
    const discard = proposalBlocks(proposal({ kind: 'discard', reason: 'Fuera del segmento objetivo' }));
    assert.match(discard.text, /Descartar 2 prospectos con el motivo «Fuera del segmento objetivo»/);
  });
});

describe('qué quedó hecho de verdad', () => {
  it('🔴 manda la base: aprobado aunque la acción respondiera error; pendiente aunque respondiera bien', () => {
    const state = new Map([
      [id(1), { name: 'COPEC S.A.', status: 'converted_to_account', owner: null, convertedAccountId: 'acc' }],
      [id(2), { name: 'Alxar', status: 'needs_review', owner: null, convertedAccountId: null }],
    ]);
    const outcomes = verifyOutcomes({ kind: 'approve', ids: [id(1), id(2), id(3)], targetUserId: null }, state, new Map([[id(1), 'error raro']]));
    assert.deepEqual(outcomes, [
      { nombre: 'COPEC S.A.', ok: true, detalle: 'ya está en Empresas' },
      { nombre: 'Alxar', ok: false, detalle: 'sigue en Por revisar' },
      { nombre: id(3), ok: false, detalle: 'no se encontró' },
    ]);
    assert.match(outcomeText('approve', outcomes), /^\*Aprobados: 1 de 3\.\*/);
  });

  it('asignar: cuenta sólo si el responsable quedó siendo el destino', () => {
    const state = new Map([
      [id(1), { name: 'A', status: 'needs_review', owner: 'target', convertedAccountId: null }],
      [id(2), { name: 'B', status: 'needs_review', owner: 'otro', convertedAccountId: null }],
    ]);
    const outcomes = verifyOutcomes({ kind: 'assign_prospects', ids: [id(1), id(2)], targetUserId: 'target' }, state, new Map([[id(2), 'Sin permiso']]));
    assert.deepEqual(outcomes.map((o) => o.ok), [true, false]);
    assert.equal(outcomes[1].detalle, 'Sin permiso');
  });
});

describe('encontrar los elementos por nombre', () => {
  it('uno = listo; varios = hay que precisar (salvo nombre exacto); ninguno = no encontrado', () => {
    const matches = new Map([
      ['Copec', [{ id: id(1), name: 'COPEC S.A.' }, { id: id(2), name: 'Empresas Copec' }]],
      ['copec s.a.', [{ id: id(1), name: 'COPEC S.A.' }, { id: id(2), name: 'Empresas Copec' }]],
      ['Nada', []],
    ]);
    const result = collectByName(['Copec', 'copec s.a.', 'Nada'], matches, (r) => ({ id: r.id, nombre: r.name }));
    assert.deepEqual(result.items, [{ id: id(1), nombre: 'COPEC S.A.' }]);
    assert.deepEqual(result.ambiguos, [{ pedido: 'Copec', opciones: ['COPEC S.A.', 'Empresas Copec'] }]);
    assert.deepEqual(result.noEncontrados, ['Nada']);
  });
});

// ── Herramientas de propuesta ────────────────────────────────────────────────

const data = {} as AssistantDataSource;
const resolution = (items: Resolution['items']): Resolution => ({ items, noEncontrados: [], ambiguos: [], recortados: 0 });

function actionContext(overrides: Partial<AssistantActionResolver> = {}) {
  const proposals: ProposedAction[] = [];
  const resolver: AssistantActionResolver = {
    resolveProspects: async () => resolution([{ id: id(1), nombre: 'COPEC S.A.' }]),
    resolveAccounts: async () => resolution([{ id: id(5), nombre: 'Enex' }]),
    resolveActiveUser: async () => ({ user: { id: id(7), nombre: 'Pedro Tapia' }, opciones: [] }),
    ...overrides,
  };
  return { proposals, context: { resolver, propose: (p: ProposedAction) => proposals.push(p) } };
}

describe('proponer (nunca ejecutar)', () => {
  it('aprobar: deja la propuesta y le dice a Claude que NO diga que ya se hizo', async () => {
    const { proposals, context } = actionContext();
    const result = await runAssistantTool(data, null, 'proponer_aprobar', { nombres: ['Copec'] }, context);
    assert.equal(result.isError, false);
    assert.match(result.content, /lista para confirmar/);
    assert.match(result.content, /NO digas que ya se hizo/);
    assert.deepEqual(proposals, [{ kind: 'approve', items: [{ id: id(1), nombre: 'COPEC S.A.' }] }]);
  });

  it('descartar exige un motivo válido; «otro» exige detalle', async () => {
    const { proposals, context } = actionContext();
    assert.equal((await runAssistantTool(data, null, 'proponer_descartar', { nombres: ['Copec'] }, context)).isError, true);
    assert.equal((await runAssistantTool(data, null, 'proponer_descartar', { nombres: ['Copec'], motivo: 'other' }, context)).isError, true);
    const okResult = await runAssistantTool(data, null, 'proponer_descartar', { nombres: ['Copec'], motivo: 'too_small' }, context);
    assert.equal(okResult.isError, false);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].kind, 'discard');
    assert.match(proposals[0].reason ?? '', /pequeña/);
  });

  it('asignar: resuelve a la persona; si hay varias, pide precisar sin proponer', async () => {
    const one = actionContext();
    await runAssistantTool(data, null, 'proponer_asignar', { tipo: 'empresas', nombres: ['Enex'], persona: 'Pedro' }, one.context);
    assert.deepEqual(one.proposals, [{ kind: 'assign_accounts', items: [{ id: id(5), nombre: 'Enex' }], targetUserId: id(7), targetName: 'Pedro Tapia' }]);

    const many = actionContext({ resolveActiveUser: async () => ({ user: null, opciones: ['Pedro Tapia', 'Pedro Suárez'] }) });
    const result = await runAssistantTool(data, null, 'proponer_asignar', { tipo: 'prospectos', busqueda: 'Copec', persona: 'Pedro' }, many.context);
    assert.match(result.content, /Pedro Suárez/);
    assert.equal(many.proposals.length, 0);
  });

  it('sin nada que incluir no hay propuesta; sin contexto de acciones, error', async () => {
    const empty = actionContext({ resolveProspects: async () => ({ items: [], noEncontrados: ['X'], ambiguos: [], recortados: 0 }) });
    const result = await runAssistantTool(data, null, 'proponer_aprobar', { nombres: ['X'] }, empty.context);
    assert.match(result.content, /"propuesta":"ninguna"/);
    assert.equal(empty.proposals.length, 0);
    assert.equal((await runAssistantTool(data, null, 'proponer_aprobar', { nombres: ['X'] }, null)).isError, true);
    assert.equal((await runAssistantTool(data, null, 'proponer_aprobar', {}, actionContext().context)).isError, true);
  });

  it('las herramientas de propuesta están para todos los roles (la acción revisa el permiso al confirmar)', () => {
    for (const isAdmin of [false, true]) {
      const names: string[] = toolsForRole(isAdmin).map((t) => t.name);
      for (const name of ['proponer_aprobar', 'proponer_descartar', 'proponer_asignar']) assert.ok(names.includes(name), name);
    }
  });
});
