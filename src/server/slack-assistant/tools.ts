// ============================================================
// Asistente de Slack — herramientas de SÓLO LECTURA (puro).
// Claude no toca la base: pide una herramienta y SellUp la resuelve con el
// alcance de quien pregunta (admin ve todo, líder su equipo, vendedor lo suyo).
// La fuente de datos se inyecta: aquí no hay Supabase.
// ============================================================

export type UsagePeriod = 'hoy' | 'semana' | 'mes';
/** Periodo de creación: `todo` = sin límite de fecha. */
export type CreatedPeriod = UsagePeriod | 'todo';

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

export interface AssistantSummary {
  empresasActivas: number;
  empresasPorEstado: Record<string, number>;
  prospectosPorRevisar: number;
  busquedasEnCurso: number;
  contactos: number;
  enlaces: { empresas: string; porRevisar: string; busquedas: string };
}

export interface AssistantProspect {
  nombre: string;
  pais: string | null;
  industria: string | null;
  tamano: string | null;
  sitioWeb: string | null;
  nit: string | null;
  busqueda: string | null;
  responsable: string | null;
  creado: string;
}

export interface AssistantProspectList {
  total: number;
  mostrados: number;
  enlace: string;
  prospectos: AssistantProspect[];
}

export interface AssistantAccount {
  nombre: string;
  estado: string;
  pais: string | null;
  industria: string | null;
  sitioWeb: string | null;
  responsable: string | null;
  contactos: number;
  creada: string;
  enlace: string;
}

export interface AssistantAccountList {
  total: number;
  mostradas: number;
  empresas: AssistantAccount[];
}

export interface AssistantContact {
  nombre: string;
  cargo: string | null;
  correo: string | null;
  telefono: string | null;
  linkedin: string | null;
}

export interface AssistantSearch {
  nombre: string;
  estado: string;
  pais: string | null;
  industria: string | null;
  meta: number | null;
  responsable: string | null;
  creada: string;
  candidatos: Record<string, number>;
  enlace: string;
}

export interface AssistantUsage {
  periodo: UsagePeriod;
  desde: string;
  consultas: number;
  errores: number;
  costoUsd: number;
  porProveedor: Array<{ proveedor: string; consultas: number; errores: number; costoUsd: number }>;
}

/** Lo que el asistente puede leer, ya filtrado por el alcance de quien pregunta. */
export interface AssistantDataSource {
  summary(): Promise<AssistantSummary>;
  pendingProspects(filters: AssistantFilters & { busqueda?: string }, limit: number): Promise<AssistantProspectList>;
  accounts(filters: AssistantFilters & { estado?: string }, limit: number): Promise<AssistantAccountList>;
  accountContacts(accountText: string, limit: number): Promise<{ empresa: string | null; enlace: string | null; contactos: AssistantContact[] }>;
  searches(filters: AssistantFilters, limit: number): Promise<AssistantSearch[]>;
  aiUsage(period: UsagePeriod): Promise<AssistantUsage>;
}

export const MAX_TOOL_LIMIT = 50;

const PERIOD_PROPERTY = {
  type: 'string',
  enum: ['hoy', 'semana', 'mes', 'todo'],
  description: 'Creadas hoy, en los últimos 7 días, en el mes en curso o sin límite (hora de Bogotá).',
} as const;
const COUNTRY_PROPERTY = { type: 'string', description: 'Código ISO de 2 letras (CL, CO, MX…) o nombre del país.' } as const;
const OWNER_PROPERTY = { type: 'string', description: 'Nombre o correo de la persona responsable.' } as const;
const LIMIT_PROPERTY = { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT } as const;

/** Definiciones para la API de Claude (`tools`). */
export const ASSISTANT_TOOLS = [
  {
    name: 'mi_resumen',
    description:
      'Totales de lo que la persona ve en SellUp: empresas activas por estado, prospectos por revisar, búsquedas en curso y contactos. Sólo totales: para listar nombres usa las otras herramientas.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'prospectos_por_revisar',
    description:
      'Lista con NOMBRE las empresas que están en «Por revisar» (candidatas encontradas por las búsquedas que esperan aprobación o descarte). Filtra por país, fecha de creación, búsqueda de origen, industria, responsable o texto. Úsala para «qué empresas de Chile están por revisar hoy».',
    input_schema: {
      type: 'object',
      properties: {
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
      'Empresas ya aprobadas en SellUp («Empresas»). Busca por texto (nombre, dominio o NIT) y/o filtra por país, estado, industria, responsable o fecha de creación. Devuelve estado, responsable, contactos y enlace a su ficha.',
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
    name: 'contactos_de_empresa',
    description: 'Contactos guardados de una empresa aprobada (nombre, cargo, correo, teléfono, LinkedIn).',
    input_schema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o dominio de la empresa.' },
        limite: LIMIT_PROPERTY,
      },
      required: ['empresa'],
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
      'Consultas a proveedores (Claude, Apollo, Lusha, Tavily…) y su costo estimado en dólares: hoy, últimos 7 días o el mes en curso.',
    input_schema: {
      type: 'object',
      properties: { periodo: { type: 'string', enum: ['hoy', 'semana', 'mes'] } },
      required: ['periodo'],
      additionalProperties: false,
    },
  },
] as const;

export type AssistantToolName = (typeof ASSISTANT_TOOLS)[number]['name'];

const ACCOUNT_STATES = new Set(['new', 'ready_for_research', 'research_in_progress', 'ready_for_outreach']);

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

/**
 * Ejecuta una herramienta y devuelve el texto (JSON) que se le pasa a Claude.
 * Nunca lanza: un error vuelve como `{ error }` para que Claude lo explique.
 */
export async function runAssistantTool(
  data: AssistantDataSource,
  name: string,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  try {
    let result: unknown;
    switch (name) {
      case 'mi_resumen':
        result = await data.summary();
        break;
      case 'prospectos_por_revisar':
        result = await data.pendingProspects({ ...readFilters(args), busqueda: text(args.busqueda) }, clampLimit(args.limite, 20));
        break;
      case 'empresas': {
        const estado = typeof args.estado === 'string' && ACCOUNT_STATES.has(args.estado) ? args.estado : undefined;
        result = await data.accounts({ ...readFilters(args), estado }, clampLimit(args.limite, 15));
        break;
      }
      case 'contactos_de_empresa': {
        const query = text(args.empresa);
        if (!query) return { content: JSON.stringify({ error: 'Falta la empresa.' }), isError: true };
        result = await data.accountContacts(query, clampLimit(args.limite, 15));
        break;
      }
      case 'busquedas':
        result = await data.searches(readFilters(args), clampLimit(args.limite, 5));
        break;
      case 'uso_de_ia': {
        const period = args.periodo === 'hoy' || args.periodo === 'semana' ? args.periodo : 'mes';
        result = await data.aiUsage(period);
        break;
      }
      default:
        return { content: JSON.stringify({ error: `Herramienta desconocida: ${name}` }), isError: true };
    }
    return { content: JSON.stringify(result), isError: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'error';
    return { content: JSON.stringify({ error: `No se pudo leer: ${message.slice(0, 200)}` }), isError: true };
  }
}
