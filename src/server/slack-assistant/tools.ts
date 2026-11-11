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

export type * from './tool-types';

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
      default:
        return fail(`Herramienta desconocida: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return fail(`No se pudo leer: ${message.slice(0, 200)}`);
  }
}
