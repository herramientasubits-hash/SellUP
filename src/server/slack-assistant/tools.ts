// ============================================================
// Asistente de Slack — herramientas de SÓLO LECTURA (puro).
// Claude no toca la base: pide una herramienta y SellUp la resuelve con el
// alcance de quien pregunta. Mismos permisos que la plataforma:
//   · con alcance por rol (admin todo; líder su equipo en cascada por el
//     organigrama; vendedor lo suyo): resumen, prospectos, empresas, ficha,
//     contactos, búsquedas y uso de IA (dólares sólo admin y líderes);
//   · sólo administradores (en SellUp son pantallas de Configuración):
//     usuarios, catálogos y presupuesto.
// La fuente de datos se inyecta: aquí no hay Supabase.
// ============================================================

import type {
  AssistantAccountDetail,
  AssistantAccountList,
  AssistantContactList,
  AssistantProspectList,
  AssistantSearch,
  AssistantSummary,
  AssistantUsage,
  AssistantUserList,
  AssistantSourceCatalog,
  AssistantIndustryCatalog,
  AssistantBudget,
  ProspectState,
  UsagePeriod,
  CreatedPeriod,
} from './tool-types';

import type { AssistantActionResolver, Resolution } from './action-resolver.server';
import type { HelpAnswer } from './help/lookup';
import {
  discardReasonLabel,
  DISCARD_REASON_KEYS,
  MAX_ACTION_ITEMS,
  proposalSummary,
  type ActionItem,
  type ActionKind,
} from './action-proposal';
import { composeDiscardReason, validateDiscardReason } from '@/modules/prospect-review/discard-reason';

export type * from './tool-types';

/** Lo que una herramienta de acción deja listo para que la persona confirme. */
export interface ProposedAction {
  kind: ActionKind;
  items: ActionItem[];
  targetUserId?: string;
  targetName?: string;
  reason?: string;
}

/** Acciones con confirmación: se resuelve qué y se PROPONE; nunca se ejecuta aquí. */
export interface AssistantActionContext {
  resolver: AssistantActionResolver;
  propose(proposal: ProposedAction): void;
}

/** Filtros comunes. Todos opcionales; el alcance por rol se aplica siempre aparte. */
export interface AssistantFilters {
  /** Texto libre: nombre, dominio o NIT. */
  texto?: string;
  /** Código ISO de 2 letras (CL) o nombre (Chile). */
  pais?: string;
  industria?: string;
  /** Nombre o correo de la persona responsable (dentro de lo que se puede ver). */
  responsable?: string;
  periodo?: CreatedPeriod;
}

/** Datos comerciales: cualquier rol, filtrados por su alcance. */
export interface AssistantDataSource {
  summary(): Promise<AssistantSummary>;
  prospects(filters: AssistantFilters & { busqueda?: string; estado: ProspectState }, limit: number): Promise<AssistantProspectList>;
  accounts(filters: AssistantFilters & { estado?: string }, limit: number): Promise<AssistantAccountList>;
  accountDetail(query: string): Promise<AssistantAccountDetail>;
  contacts(filters: { texto?: string; empresa?: string; cargo?: string; pais?: string }, limit: number): Promise<AssistantContactList>;
  searches(filters: AssistantFilters, limit: number): Promise<AssistantSearch[]>;
  /** Mismo alcance que la pantalla Uso de IA: admin todo, líder su equipo en cascada, vendedor lo suyo. */
  aiUsage(period: UsagePeriod, responsable?: string): Promise<AssistantUsage>;
  /** Guía de uso de SellUp (fichas escritas desde el código), filtrada por rol. */
  help(query: string): HelpAnswer;
}

/** Datos de administración: sólo si quien pregunta es admin. */
export interface AssistantAdminDataSource {
  users(filters: { texto?: string; estado?: string; rol?: string }, limit: number): Promise<AssistantUserList>;
  sourceCatalog(filters: { pais?: string; texto?: string; estado?: string }, limit: number): Promise<AssistantSourceCatalog>;
  industryCatalog(filters: { texto?: string }): Promise<AssistantIndustryCatalog>;
  budget(): Promise<AssistantBudget>;
}

export const MAX_TOOL_LIMIT = 50;
export const PROSPECT_STATES: readonly ProspectState[] = ['por_revisar', 'descartados', 'aprobados', 'duplicados', 'todos'];

const PERIOD_PROPERTY = {
  type: 'string',
  enum: ['hoy', 'semana', 'mes', 'todo'],
  description: 'Creadas hoy, en los últimos 7 días, en el mes en curso o sin límite (hora de Bogotá).',
} as const;
const COUNTRY_PROPERTY = { type: 'string', description: 'Código ISO de 2 letras (CL, CO, MX…) o nombre del país.' } as const;
const OWNER_PROPERTY = { type: 'string', description: 'Nombre o correo de la persona responsable.' } as const;
const LIMIT_PROPERTY = { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT } as const;

/** Herramientas comerciales: las ve cualquier rol. */
export const COMMERCIAL_TOOLS = [
  {
    name: 'mi_resumen',
    description:
      'Totales de lo que la persona ve en SellUp: empresas activas por estado, prospectos por revisar, búsquedas en curso y contactos. Sólo totales: para listar nombres usa las otras herramientas.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'prospectos',
    description:
      'Lista con NOMBRE las empresas candidatas que encontraron las búsquedas. estado: por_revisar (por defecto, esperan aprobación), descartados (con quién y por qué), aprobados, duplicados o todos. Filtra por país, fecha, búsqueda de origen, industria, responsable o texto (nombre, dominio, NIT).',
    input_schema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: [...PROSPECT_STATES] },
        pais: COUNTRY_PROPERTY,
        periodo: PERIOD_PROPERTY,
        busqueda: { type: 'string', description: 'Nombre (o parte) de la búsqueda de origen.' },
        industria: { type: 'string' },
        responsable: OWNER_PROPERTY,
        texto: { type: 'string', description: 'Nombre, dominio o NIT.' },
        limite: LIMIT_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'empresas',
    description:
      'Lista empresas ya aprobadas en SellUp («Empresas»). Busca por texto (nombre, dominio o NIT) y/o filtra por país, estado, industria, responsable o fecha de creación. Para TODO el detalle de una empresa usa ficha_empresa.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Nombre, dominio o NIT.' },
        pais: COUNTRY_PROPERTY,
        estado: {
          type: 'string',
          enum: ['new', 'ready_for_research', 'research_in_progress', 'ready_for_outreach'],
          description: 'Nueva, Lista para investigar, Investigación en curso, Lista para contacto.',
        },
        industria: { type: 'string' },
        responsable: OWNER_PROPERTY,
        periodo: PERIOD_PROPERTY,
        limite: LIMIT_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'ficha_empresa',
    description:
      'TODO sobre una empresa aprobada: datos (razón social, NIT, país, ciudad, industria, tamaño, web, LinkedIn, HubSpot), estado, responsable, notas, contactos y el trabajo de Rumbo (investigación y primer contacto). Busca por nombre, dominio, NIT, ID de SellUp o ID de HubSpot.',
    input_schema: {
      type: 'object',
      properties: { consulta: { type: 'string', description: 'Nombre, dominio, NIT, ID de SellUp o ID de HubSpot.' } },
      required: ['consulta'],
      additionalProperties: false,
    },
  },
  {
    name: 'contactos',
    description:
      'Busca contactos (personas) por nombre, correo o cargo, y/o por empresa o país de la empresa. Devuelve cargo, correo, teléfono, LinkedIn y empresa. Úsala para «contactos de X», «¿quién es Juan Pérez?» o «gerentes de RR. HH. en Chile».',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Nombre o correo de la persona.' },
        empresa: { type: 'string', description: 'Nombre o dominio de la empresa.' },
        cargo: { type: 'string', description: 'Parte del cargo (gerente, RR. HH., talento…).' },
        pais: COUNTRY_PROPERTY,
        limite: LIMIT_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'busquedas',
    description:
      'Búsquedas de empresas (lotes de prospección), las más recientes primero: estado, país, industria, meta, responsable y cuántos candidatos hay en cada estado. Filtra por país, fecha, responsable o texto del nombre.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Parte del nombre de la búsqueda.' },
        pais: COUNTRY_PROPERTY,
        responsable: OWNER_PROPERTY,
        periodo: PERIOD_PROPERTY,
        limite: LIMIT_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'uso_de_ia',
    description:
      'Uso de IA y costos con el alcance del rol (admin: todo; líder: su equipo en cascada; vendedor: lo suyo): consultas a proveedores (Claude, Apollo, Lusha, Tavily…), errores, créditos y costo en dólares (sólo admin y líderes ven dólares) por proveedor y por persona; hoy, últimos 7 días o mes en curso. Opcional: de una persona.',
    input_schema: {
      type: 'object',
      properties: {
        periodo: { type: 'string', enum: ['hoy', 'semana', 'mes'] },
        responsable: OWNER_PROPERTY,
      },
      required: ['periodo'],
      additionalProperties: false,
    },
  },
  {
    name: 'ayuda_sellup',
    description:
      'Guía de uso de SellUp: CÓMO se hace algo en la plataforma (importar empresas desde un archivo, buscar empresas y sus modos, revisar y aprobar, Rumbo, contactos y teléfonos, asignar, uso de IA, presupuesto, usuarios…). Úsala SIEMPRE ante preguntas de «cómo» y responde sólo con lo que traiga.',
    input_schema: {
      type: 'object',
      properties: { tema: { type: 'string', description: 'La pregunta o el tema (p. ej. «importar empresas desde un archivo»).' } },
      required: ['tema'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_aprobar',
    description:
      'PROPONE aprobar prospectos de «Por revisar» (pasan a Empresas y se crean o enlazan en HubSpot). No ejecuta: deja un botón «Confirmar» para la persona. Indica los nombres (o NIT/dominio) o una búsqueda/país para «todos los de…». Máximo 25.',
    input_schema: {
      type: 'object',
      properties: {
        nombres: { type: 'array', items: { type: 'string' }, maxItems: 25 },
        busqueda: { type: 'string', description: 'Todos los pendientes de esta búsqueda.' },
        pais: COUNTRY_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_descartar',
    description:
      'PROPONE descartar prospectos de «Por revisar» con un motivo (obligatorio). No ejecuta: deja un botón «Confirmar». Motivos: out_of_segment, too_small, too_large, wrong_country, wrong_industry, already_customer, not_priority_now, bad_data, duplicate_confirmed, inactive_or_dissolved, not_for_profit, other (con detalle).',
    input_schema: {
      type: 'object',
      properties: {
        nombres: { type: 'array', items: { type: 'string' }, maxItems: 25 },
        busqueda: { type: 'string' },
        pais: COUNTRY_PROPERTY,
        motivo: { type: 'string', enum: [...DISCARD_REASON_KEYS] },
        detalle: { type: 'string', description: 'Texto del motivo (obligatorio si el motivo es other).' },
      },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
  {
    name: 'proponer_asignar',
    description:
      'PROPONE asignar prospectos («Por revisar») o empresas a una persona activa. No ejecuta: deja un botón «Confirmar». Indica tipo, los nombres (o búsqueda/país para prospectos) y a quién.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['prospectos', 'empresas'] },
        nombres: { type: 'array', items: { type: 'string' }, maxItems: 25 },
        busqueda: { type: 'string' },
        pais: COUNTRY_PROPERTY,
        persona: { type: 'string', description: 'Nombre o correo de quien recibe.' },
      },
      required: ['tipo', 'persona'],
      additionalProperties: false,
    },
  },
] as const;

/** Herramientas de administración: sólo para administradores (como en la plataforma). */
export const ADMIN_TOOLS = [
  {
    name: 'usuarios',
    description:
      'Usuarios de SellUp: nombre, correo, rol, estado (Activo, Inactivo, Pendiente…), grupo, jefe directo y último ingreso. Filtra por texto, estado o rol.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Nombre o correo.' },
        estado: { type: 'string', enum: ['active', 'suspended', 'pending_approval', 'rejected', 'archived'] },
        rol: { type: 'string', description: 'admin, commercial_lead, commercial_manager, seller_bd, growth…' },
        limite: LIMIT_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'catalogo_de_fuentes',
    description:
      'Catálogo de fuentes de datos (registros públicos, cámaras, proveedores) por país: estado operativo, tipo, prioridad, uso en SellUp y conexión. Filtra por país, texto o estado.',
    input_schema: {
      type: 'object',
      properties: { pais: COUNTRY_PROPERTY, texto: { type: 'string' }, estado: { type: 'string' }, limite: LIMIT_PROPERTY },
      additionalProperties: false,
    },
  },
  {
    name: 'catalogo_de_industrias',
    description: 'Catálogo activo de industrias y subindustrias que usa SellUp para clasificar empresas. Filtra por texto.',
    input_schema: { type: 'object', properties: { texto: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'presupuesto',
    description:
      'Presupuesto y créditos por proveedor: asignación mensual, consumo del mes (créditos y dólares), saldo informado por el proveedor y reglas de presupuesto activas.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
] as const;

export type AssistantToolName = (typeof COMMERCIAL_TOOLS)[number]['name'] | (typeof ADMIN_TOOLS)[number]['name'];

const ADMIN_TOOL_NAMES: ReadonlySet<string> = new Set(ADMIN_TOOLS.map((t) => t.name));

/** Las herramientas que se le ofrecen a Claude según el rol. */
export function toolsForRole(isAdmin: boolean): ReadonlyArray<(typeof COMMERCIAL_TOOLS)[number] | (typeof ADMIN_TOOLS)[number]> {
  return isAdmin ? [...COMMERCIAL_TOOLS, ...ADMIN_TOOLS] : [...COMMERCIAL_TOOLS];
}

const ACCOUNT_STATES = new Set(['new', 'ready_for_research', 'research_in_progress', 'ready_for_outreach']);
const USER_STATES = new Set(['active', 'suspended', 'pending_approval', 'rejected', 'archived']);

function clampLimit(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(MAX_TOOL_LIMIT, Math.max(1, n));
}

function text(value: unknown): string | undefined {
  const t = typeof value === 'string' ? value.trim().slice(0, 200) : '';
  return t || undefined;
}

function createdPeriod(value: unknown): CreatedPeriod {
  return value === 'hoy' || value === 'semana' || value === 'mes' ? value : 'todo';
}

/** Filtros comunes leídos de lo que mandó Claude (lo desconocido se ignora). */
export function readFilters(args: Record<string, unknown>): AssistantFilters {
  return {
    texto: text(args.texto),
    pais: text(args.pais),
    industria: text(args.industria),
    responsable: text(args.responsable),
    periodo: createdPeriod(args.periodo),
  };
}

function prospectState(value: unknown): ProspectState {
  return PROSPECT_STATES.includes(value as ProspectState) ? (value as ProspectState) : 'por_revisar';
}

const ok = (result: unknown) => ({ content: JSON.stringify(result), isError: false });
const fail = (error: string) => ({ content: JSON.stringify({ error }), isError: true });

/**
 * Ejecuta una herramienta y devuelve el texto (JSON) que se le pasa a Claude.
 * Nunca lanza: un error vuelve como `{ error }` para que Claude lo explique.
 * 🔴 Las de administración exigen `admin` (sin él responden que no hay permiso),
 * aunque Claude las pida por su nombre.
 */
export async function runAssistantTool(
  data: AssistantDataSource,
  admin: AssistantAdminDataSource | null,
  name: string,
  input: unknown,
  actions: AssistantActionContext | null = null,
): Promise<{ content: string; isError: boolean }> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (ADMIN_TOOL_NAMES.has(name) && !admin) {
    return fail('Sin permiso: esta información sólo la ven los administradores de SellUp.');
  }
  try {
    switch (name) {
      case 'mi_resumen':
        return ok(await data.summary());
      case 'prospectos':
        return ok(
          await data.prospects(
            { ...readFilters(args), busqueda: text(args.busqueda), estado: prospectState(args.estado) },
            clampLimit(args.limite, 20),
          ),
        );
      case 'empresas': {
        const estado = typeof args.estado === 'string' && ACCOUNT_STATES.has(args.estado) ? args.estado : undefined;
        return ok(await data.accounts({ ...readFilters(args), estado }, clampLimit(args.limite, 15)));
      }
      case 'ficha_empresa': {
        const query = text(args.consulta);
        return query ? ok(await data.accountDetail(query)) : fail('Falta la empresa a buscar.');
      }
      case 'contactos': {
        const filters = { texto: text(args.texto), empresa: text(args.empresa), cargo: text(args.cargo), pais: text(args.pais) };
        if (!filters.texto && !filters.empresa && !filters.cargo && !filters.pais) {
          return fail('Di a quién buscar: nombre, correo, cargo, empresa o país.');
        }
        return ok(await data.contacts(filters, clampLimit(args.limite, 15)));
      }
      case 'busquedas':
        return ok(await data.searches(readFilters(args), clampLimit(args.limite, 5)));
      case 'uso_de_ia': {
        const period = args.periodo === 'hoy' || args.periodo === 'semana' ? args.periodo : 'mes';
        return ok(await data.aiUsage(period, text(args.responsable)));
      }
      case 'usuarios': {
        const estado = typeof args.estado === 'string' && USER_STATES.has(args.estado) ? args.estado : undefined;
        return ok(await admin!.users({ texto: text(args.texto), estado, rol: text(args.rol) }, clampLimit(args.limite, 30)));
      }
      case 'catalogo_de_fuentes':
        return ok(
          await admin!.sourceCatalog({ pais: text(args.pais), texto: text(args.texto), estado: text(args.estado) }, clampLimit(args.limite, 20)),
        );
      case 'catalogo_de_industrias':
        return ok(await admin!.industryCatalog({ texto: text(args.texto) }));
      case 'presupuesto':
        return ok(await admin!.budget());
      case 'ayuda_sellup': {
        const query = text(args.tema);
        return query ? ok(data.help(query)) : fail('Falta el tema.');
      }
      case 'proponer_aprobar':
      case 'proponer_descartar':
      case 'proponer_asignar':
        if (!actions) return fail('Las acciones no están disponibles en esta conversación.');
        return await proposeAction(actions, name, args);
      default:
        return fail(`Herramienta desconocida: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return fail(`No se pudo leer: ${message.slice(0, 200)}`);
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, 200)).filter(Boolean).slice(0, MAX_ACTION_ITEMS)
    : [];
}

const PROPOSAL_NOTE =
  'Quedó un botón «Confirmar» debajo de tu respuesta: resume qué se hará y di que se confirma con ese botón. NO digas que ya se hizo.';

function proposalResult(proposal: ProposedAction, resolution: Resolution) {
  return {
    propuesta: 'lista para confirmar',
    resumen: proposalSummary(proposal),
    elementos: proposal.items.map((i) => i.nombre),
    noEncontrados: resolution.noEncontrados,
    ambiguos: resolution.ambiguos,
    recortados: resolution.recortados,
    nota: PROPOSAL_NOTE,
  };
}

function nothingToPropose(resolution: Resolution) {
  return {
    propuesta: 'ninguna',
    noEncontrados: resolution.noEncontrados,
    ambiguos: resolution.ambiguos,
    nota: 'No se encontró nada que se pueda incluir (dentro de lo que esta persona ve y en «Por revisar»). Pide precisar.',
  };
}

async function proposeAction(actions: AssistantActionContext, name: string, args: Record<string, unknown>) {
  const selection = { nombres: stringList(args.nombres), busqueda: text(args.busqueda), pais: text(args.pais) };

  if (name === 'proponer_aprobar' || name === 'proponer_descartar') {
    if (selection.nombres.length === 0 && !selection.busqueda && !selection.pais) {
      return fail('Di qué prospectos: nombres, o una búsqueda o país para «todos los de…».');
    }
    let reason: string | undefined;
    if (name === 'proponer_descartar') {
      const key = typeof args.motivo === 'string' && (DISCARD_REASON_KEYS as string[]).includes(args.motivo) ? args.motivo : '';
      const validation = validateDiscardReason(composeDiscardReason(key as never, text(args.detalle) ?? ''));
      if (!key || !validation.ok) return fail('Falta un motivo de descarte válido (y el detalle si el motivo es «otro»).');
      reason = validation.reason;
    }
    const resolution = await actions.resolver.resolveProspects(selection);
    if (resolution.items.length === 0) return ok(nothingToPropose(resolution));
    const proposal: ProposedAction = { kind: name === 'proponer_aprobar' ? 'approve' : 'discard', items: resolution.items, ...(reason ? { reason } : {}) };
    actions.propose(proposal);
    return ok(proposalResult(proposal, resolution));
  }

  // proponer_asignar
  const tipo = args.tipo === 'empresas' ? 'empresas' : 'prospectos';
  const persona = text(args.persona);
  if (!persona) return fail('Falta a quién asignar.');
  const target = await actions.resolver.resolveActiveUser(persona);
  if (!target.user) {
    return ok({ propuesta: 'ninguna', nota: `No hay una única persona activa que coincida con «${persona}».`, opciones: target.opciones });
  }
  if (tipo === 'empresas' && selection.nombres.length === 0) return fail('Di qué empresas asignar (por nombre, dominio o NIT).');
  if (tipo === 'prospectos' && selection.nombres.length === 0 && !selection.busqueda && !selection.pais) {
    return fail('Di qué prospectos: nombres, o una búsqueda o país para «todos los de…».');
  }
  const resolution = tipo === 'empresas' ? await actions.resolver.resolveAccounts(selection) : await actions.resolver.resolveProspects(selection);
  if (resolution.items.length === 0) return ok(nothingToPropose(resolution));
  const proposal: ProposedAction = {
    kind: tipo === 'empresas' ? 'assign_accounts' : 'assign_prospects',
    items: resolution.items,
    targetUserId: target.user.id,
    targetName: target.user.nombre,
  };
  actions.propose(proposal);
  return ok(proposalResult(proposal, resolution));
}

/** Para el mensaje: el motivo legible de una clave. */
export { discardReasonLabel };
