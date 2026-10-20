/**
 * Agente 3 (Rumbo) · banco de evaluación interno de la investigación y los mensajes.
 *
 * Corre la preparación REAL (Tavily + Claude) de un conjunto fijo de empresas y NO
 * escribe nada en la base de datos: la ficha, las preparaciones, el estado de la empresa
 * y el registro de uso se capturan en memoria y salen en un informe. Sirve para medir
 * antes y después de cada cambio sin tocar Producción (dueña 19-10).
 *
 * Gasta de verdad en Tavily y en Claude (el gasto NO queda en Uso de IA, porque no se
 * escribe nada): por eso exige `--confirm-spend`, salvo con `--replay` y `--writer=off`.
 *
 * Uso (desde la raíz del repo, con las variables de un entorno con lectura):
 *   set -a; . ../.env.local; set +a
 *   node --import tsx scripts/agent3/research-eval.mts --label=antes --user=<id> --confirm-spend
 *   node --import tsx scripts/agent3/research-eval.mts --label=despues --user=<id> --confirm-spend --writer=off
 *   node --import tsx scripts/agent3/research-eval.mts --compare=/tmp/eval/antes.json,/tmp/eval/despues.json
 *
 * Opciones:
 *   --set=base|paises|todo       el banco de siempre (CO, MX, CL, CR, PE), los otros países o todo
 *   --accounts=nombre1,nombre2   sólo esas empresas del banco (por nombre)
 *   --writer=on|off              off = no llama al redactor (mide sólo la investigación)
 *   --channels=call,email        canales para el redactor (por defecto los 4)
 *   --record=<dir>               guarda lo que devolvieron Tavily y las páginas
 *   --replay=<dir>               usa lo guardado en vez de llamar a Tavily y a las páginas
 *   --user=<internal_user_id>    el vendedor (su nombre va en los mensajes); obligatorio
 *   --out=<dir>                  dónde guardar el informe (por defecto, la carpeta temporal:
 *                                trae nombres reales y mensajes, nunca dentro del repositorio)
 *   --confirm-spend              confirma el gasto real en Tavily y Claude
 *   --tavily=off                 simula que Tavily no responde (mide el respaldo con Claude)
 *   --extraction-model=<modelo>  otro modelo para investigar (p. ej. claude-sonnet-4-6)
 *   --dump=<dir>                 guarda la respuesta cruda de Claude al investigar
 *
 * Gasto aproximado por empresa: investigación ~US$0,08 + 2–6 créditos de Tavily; con el
 * redactor de 4 canales y todos los tipos de mensaje, ~US$0,15 más.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import { buildLiveFirstCallDeps, loadFirstCallContext, readCuratedLists } from '../../src/server/agents/first-call/run-first-call.server';
import { runFirstCall, type BriefPatch, type FirstCallContext, type PackInsert, type UsageLogInput, type RunFirstCallDeps } from '../../src/server/agents/first-call/run-first-call';
import { WRITER_SUBMIT_TOOL } from '../../src/server/agents/first-call/writer-prompt';
import type { FirstCallChannel, FirstCallRequest } from '../../src/server/agents/first-call/types';
import { computeResearchMetrics, compareRuns, type EvalCompanyResult, type EvalRun } from './research-eval-metrics';

/**
 * Una empresa del banco. Las que no están en SellUp (`synthetic`) se investigan igual con
 * sus datos públicos, SIN decisor: no se inventan personas (dueña 19-10: cubrir los 20
 * países y las 12 industrias aunque SellUp no tenga cuentas ahí).
 */
export interface EvalEntry {
  name: string;
  contact: string | null;
  synthetic?: { country: string; countryCode: string; industry: string; website: string };
}

/** El banco de siempre: empresas reales con su decisor de RR. HH. (CO, MX, CL, CR, PE). */
export const EVAL_SET: ReadonlyArray<EvalEntry> = [
  { name: 'Davivienda Colombia', contact: 'Fabian Martinez' },
  { name: 'Auteco', contact: 'Andrea Guevara' },
  { name: 'Itaú Colombia', contact: 'Cristian Penafiel Arancibia' },
  { name: 'Grupo LALA', contact: 'Francisco Delgadillo Murillo' },
  { name: 'Asdeporte', contact: 'Liliana Reyes' },
  { name: 'O’Reilly Autopartes México', contact: 'Katia Soto' },
  { name: 'Teamcore', contact: 'Cali Munaylla' },
  { name: 'Pizza Pizza', contact: 'Juvenal Lavin' },
  { name: 'Grupo Ciisa', contact: 'Emily Cerdas Sibaja' },
  { name: 'Elifarma', contact: 'Ariana Lock' },
];

/**
 * El resto de los países: las cuentas de SellUp con decisor que hay (DO, EC, HN, US) y,
 * donde no hay ninguna, una empresa real conocida de una industria distinta cada una.
 */
export const EVAL_SET_COUNTRIES: ReadonlyArray<EvalEntry> = [
  { name: 'Anex Tour', contact: 'Aysun Dumrul' },
  { name: 'Zurich Seguros Ecuador', contact: 'Andres Aguirre' },
  { name: 'Lácteos de Honduras', contact: 'Jennifer Coello' },
  { name: 'The Coca-Cola Company', contact: 'Peggy McCaslin' },
  { name: 'Adecoagro', contact: null, synthetic: { country: 'Argentina', countryCode: 'AR', industry: 'Agroindustria', website: 'https://www.adecoagro.com' } },
  { name: 'Banco Mercantil Santa Cruz', contact: null, synthetic: { country: 'Bolivia', countryCode: 'BO', industry: 'Seguros y Servicios Financieros', website: 'https://www.bmsc.com.bo' } },
  { name: 'Magazine Luiza', contact: null, synthetic: { country: 'Brasil', countryCode: 'BR', industry: 'Retail', website: 'https://www.magazineluiza.com.br' } },
  { name: 'Iberdrola', contact: null, synthetic: { country: 'España', countryCode: 'ES', industry: 'Gas / Petróleo / Energía / Minería / Medio Ambiente', website: 'https://www.iberdrola.com' } },
  { name: 'Cementos Progreso', contact: null, synthetic: { country: 'Guatemala', countryCode: 'GT', industry: 'Propiedad & Construcción', website: 'https://www.cempro.com' } },
  { name: 'Compañía Licorera de Nicaragua', contact: null, synthetic: { country: 'Nicaragua', countryCode: 'NI', industry: 'Consumo Masivo', website: 'https://www.flordecana.com' } },
  { name: 'Copa Airlines', contact: null, synthetic: { country: 'Panamá', countryCode: 'PA', industry: 'Transporte & Logística', website: 'https://www.copaair.com' } },
  { name: 'Tigo Paraguay', contact: null, synthetic: { country: 'Paraguay', countryCode: 'PY', industry: 'Tecnología', website: 'https://www.tigo.com.py' } },
  { name: 'Hospital de Diagnóstico', contact: null, synthetic: { country: 'El Salvador', countryCode: 'SV', industry: 'Salud & Farmacéuticos', website: 'https://www.hdiagnostico.com' } },
  { name: 'ANTEL', contact: null, synthetic: { country: 'Uruguay', countryCode: 'UY', industry: 'Gobierno', website: 'https://www.antel.com.uy' } },
  { name: 'Empresas Polar', contact: null, synthetic: { country: 'Venezuela', countryCode: 'VE', industry: 'Consumo Masivo', website: 'https://www.empresaspolar.com' } },
];

/** El contexto de una empresa que no está en SellUp: sus datos públicos, sin decisor. */
async function syntheticContext(entry: EvalEntry, userId: string): Promise<FirstCallContext> {
  const synthetic = entry.synthetic!;
  const domain = synthetic.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const admin = createSupabaseAdminClient();
  const { data: user } = await admin.from('internal_users').select('full_name').eq('id', userId).maybeSingle();
  const fullName = (user as { full_name?: string | null } | null)?.full_name ?? null;
  return {
    internal: {
      account: {
        id: `eval-${domain}`,
        name: entry.name,
        legalName: null,
        website: synthetic.website,
        domain,
        country: synthetic.country,
        countryCode: synthetic.countryCode,
        industry: synthetic.industry,
        companySize: null,
        taxIdentifier: null,
        taxIdentifierType: null,
        hubspotCompanyId: null,
      },
      classification: null,
      curatedLists: await readCuratedLists({ name: entry.name, domain, country_code: synthetic.countryCode }),
      relations: [],
      hubspot: null,
      decisionMaker: null,
    },
    decisionMakers: [],
    sellerName: fullName ? fullName.split(/\s+/)[0] : null,
    currentBrief: null,
    researchRunning: false,
  };
}

const ALL_CHANNELS: FirstCallChannel[] = ['call', 'whatsapp', 'email', 'linkedin'];

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function key(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

async function findAccount(name: string, contactName: string | null) {
  const admin = createSupabaseAdminClient();
  const { data: accounts } = await admin.from('accounts').select('id, name').eq('name', name).neq('pipeline_status', 'archived');
  for (const account of (accounts ?? []) as Array<{ id: string; name: string }>) {
    const { data: contacts } = await admin
      .from('contacts')
      .select('id, full_name')
      .eq('account_id', account.id)
      .eq('contact_status', 'active');
    const contact = ((contacts ?? []) as Array<{ id: string; full_name: string | null }>).find((c) => c.full_name === contactName);
    if (contact) return { accountId: account.id, contactId: contact.id };
  }
  return null;
}

async function readAccountDirect(accountId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('accounts')
    .select('*, owner:owner_id ( id, full_name, email ), created_by_user:created_by ( id, full_name )')
    .eq('id', accountId)
    .maybeSingle();
  return (data ?? null) as never;
}

/** Las dependencias reales, sin una sola escritura: todo lo que se guardaría queda en `captured`. */
interface EvalOptions {
  writer: boolean;
  channels: FirstCallChannel[];
  record: string | null;
  replay: string | null;
  /** Simula que Tavily no responde (sin créditos del mes): mide el respaldo con Claude. */
  tavilyOff: boolean;
  /** Otro modelo para investigar (empresa y decisor); el redactor sigue con el activo. */
  extractionModel: string | null;
  /** Guarda la respuesta cruda de Claude al investigar (para diagnosticar). */
  dump: string | null;
}

function evalDeps(userId: string, opts: EvalOptions, fixedContext: FirstCallContext | null = null) {
  const live = buildLiveFirstCallDeps(userId);
  const captured = { patches: [] as BriefPatch[], packs: [] as PackInsert[], logs: [] as UsageLogInput[], statuses: [] as string[] };
  const store = (dir: string, kind: string, parts: unknown, value: unknown) => {
    mkdirSync(path.join(dir, kind), { recursive: true });
    writeFileSync(path.join(dir, kind, `${key(parts)}.json`), JSON.stringify({ parts, value }, null, 1));
  };
  const load = (dir: string, kind: string, parts: unknown) => {
    const file = path.join(dir, kind, `${key(parts)}.json`);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { value: unknown }).value : undefined;
  };
  const deps: RunFirstCallDeps = {
    ...live,
    loadContext: async (request) => fixedContext ?? loadFirstCallContext(request, userId, { readAccount: readAccountDirect, skipHubSpot: true }),
    checkBudget: async (provider) => (opts.tavilyOff && provider === 'tavily' ? { allowed: false } : live.checkBudget(provider)),
    resolveModels: async () => {
      const models = await live.resolveModels();
      return 'error' in models || !opts.extractionModel ? models : { ...models, extractionModel: opts.extractionModel };
    },
    createBrief: async () => `eval-${Date.now()}`,
    updateBrief: async (_id, patch) => {
      captured.patches.push(patch);
    },
    insertPack: async (pack) => {
      captured.packs.push(pack);
      return `eval-pack-${captured.packs.length}`;
    },
    advanceAccountStatus: async (_accountId, target) => {
      captured.statuses.push(String(target));
    },
    logUsage: async (entry) => {
      captured.logs.push(entry);
    },
    searchNews: async (input) => {
      if (opts.replay) {
        const saved = load(opts.replay, 'search', input);
        if (saved !== undefined) return saved as Awaited<ReturnType<RunFirstCallDeps['searchNews']>>;
      }
      const output = await live.searchNews(input);
      if (opts.record) store(opts.record, 'search', input, output);
      return output;
    },
    fetchPage: async (url) => {
      if (opts.replay) {
        const saved = load(opts.replay, 'page', url);
        if (saved !== undefined) return saved as Awaited<ReturnType<RunFirstCallDeps['fetchPage']>>;
      }
      const output = await live.fetchPage(url);
      if (opts.record) store(opts.record, 'page', url, output);
      return output;
    },
    runConversation: async (body, apiKey) => {
      const isWriter = (body.tools as Array<{ name?: string }> | undefined)?.some((t) => t.name === WRITER_SUBMIT_TOOL);
      if (opts.dump && !isWriter) {
        const output = await live.runConversation(body, apiKey);
        mkdirSync(opts.dump, { recursive: true });
        writeFileSync(path.join(opts.dump, `${Date.now()}-${key(body.messages)}.json`), JSON.stringify({ body, output }, null, 1));
        return output;
      }
      if (isWriter && !opts.writer) {
        return { content: [], stopReason: 'skipped', usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, webSearchRequests: 0, webFetchRequests: 0 }, requests: 0 };
      }
      return live.runConversation(body, apiKey);
    },
  };
  return { deps, captured };
}

async function evaluateCompany(entry: EvalEntry, userId: string, opts: EvalOptions): Promise<EvalCompanyResult> {
  const contactLabel = entry.contact ?? '(sin decisor)';
  const fixed = entry.synthetic ? await syntheticContext(entry, userId) : null;
  const found = fixed ? { accountId: fixed.internal.account.id, contactId: null } : await findAccount(entry.name, entry.contact);
  if (!found) return { name: entry.name, contact: contactLabel, error: 'no_encontrada' } as EvalCompanyResult;
  const { deps, captured } = evalDeps(userId, opts, fixed);
  const request: FirstCallRequest = {
    accountId: found.accountId,
    contactIds: found.contactId ? [found.contactId] : [],
    channels: opts.channels,
    goals: ['book_meeting'],
    productKeys: [],
    approaches: [],
    referralNote: null,
    refreshResearch: true,
    regenerateFromPackId: null,
    regenerationReason: null,
  };
  const startedAt = Date.now();
  let resultCode = 'ok';
  try {
    const result = await runFirstCall(request, deps);
    if (!result.ok) resultCode = result.code;
  } catch (err) {
    resultCode = `excepcion: ${err instanceof Error ? err.message : String(err)}`;
  }
  const brief = captured.patches.reduce((acc, p) => ({ ...acc, ...p }), {} as BriefPatch);
  return {
    name: entry.name,
    contact: contactLabel,
    resultCode,
    durationMs: Date.now() - startedAt,
    brief,
    packs: captured.packs,
    logs: captured.logs,
    metrics: computeResearchMetrics({ brief, packs: captured.packs, logs: captured.logs, nowMs: Date.now() }),
  };
}

async function main() {
  const compare = arg('compare');
  if (compare) {
    const [a, b] = compare.split(',').map((file) => JSON.parse(readFileSync(file, 'utf8')) as EvalRun);
    console.log(compareRuns(a, b));
    return;
  }
  const label = arg('label') ?? 'eval';
  const out = arg('out') ?? path.join(os.tmpdir(), 'agent3-eval');
  const writer = (arg('writer') ?? 'on') !== 'off';
  const channels = (arg('channels')?.split(',') as FirstCallChannel[] | undefined) ?? ALL_CHANNELS;
  const only = arg('accounts')?.split(',').map((s) => s.trim().toLowerCase());
  const userId = arg('user');
  if (!userId) {
    console.error('Falta --user=<internal_user_id> (el vendedor cuyo nombre va en los mensajes).');
    process.exitCode = 1;
    return;
  }
  const opts: EvalOptions = {
    writer,
    channels,
    record: arg('record'),
    replay: arg('replay'),
    tavilyOff: arg('tavily') === 'off',
    extractionModel: arg('extraction-model'),
    dump: arg('dump'),
  };
  // Sin respuestas guardadas o con el redactor, se gasta de verdad: se confirma a propósito.
  const spends = !opts.replay || writer;
  if (spends && !process.argv.includes('--confirm-spend')) {
    console.error('Esta corrida gasta en Tavily y/o Claude y no queda en Uso de IA. Agrega --confirm-spend para confirmarlo.');
    process.exitCode = 1;
    return;
  }
  // --set=base (el de siempre), paises (los otros países) o todo.
  const which = arg('set') ?? 'base';
  const pool = which === 'paises' ? EVAL_SET_COUNTRIES : which === 'todo' ? [...EVAL_SET, ...EVAL_SET_COUNTRIES] : EVAL_SET;
  const set = pool.filter((e) => !only || only.includes(e.name.toLowerCase()));

  const companies: EvalCompanyResult[] = [];
  for (const entry of set) {
    process.stderr.write(`· ${entry.name}… `);
    const result = await evaluateCompany(entry, userId, opts);
    process.stderr.write(`${result.resultCode ?? result.error} (${Math.round((result.durationMs ?? 0) / 1000)} s)\n`);
    companies.push(result);
  }
  const run: EvalRun = { label, createdAt: new Date().toISOString(), writer, channels, companies };
  mkdirSync(out, { recursive: true });
  const file = path.join(out, `${label}.json`);
  writeFileSync(file, JSON.stringify(run, null, 1));
  console.log(compareRuns(run, null));
  console.log(`\nGuardado en ${file}`);
}

void main();
