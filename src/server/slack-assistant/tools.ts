// ============================================================
// Asistente de Slack — herramientas de SÓLO LECTURA (puro).
// Claude no toca la base: pide una herramienta y SellUp la resuelve con el
// alcance de quien pregunta (admin ve todo, líder su equipo, vendedor lo suyo).
// La fuente de datos se inyecta: aquí no hay Supabase.
// ============================================================

export type UsagePeriod = 'hoy' | 'semana' | 'mes';

export interface AssistantSummary {
  empresasActivas: number;
  empresasPorEstado: Record<string, number>;
  prospectosPorRevisar: number;
  busquedasEnCurso: number;
  contactos: number;
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
  searchAccounts(text: string, limit: number): Promise<AssistantAccount[]>;
  accountContacts(accountText: string, limit: number): Promise<{ empresa: string | null; contactos: AssistantContact[] }>;
  recentSearches(limit: number): Promise<AssistantSearch[]>;
  aiUsage(period: UsagePeriod): Promise<AssistantUsage>;
}

export const MAX_TOOL_LIMIT = 15;

/** Definiciones para la API de Claude (`tools`). */
export const ASSISTANT_TOOLS = [
  {
    name: 'mi_resumen',
    description:
      'Resumen de lo que la persona tiene en SellUp (o su equipo, si es líder; todo, si es admin): empresas activas por estado, prospectos por revisar, búsquedas en curso y contactos.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'buscar_empresas',
    description:
      'Busca empresas en SellUp por nombre, dominio o NIT (texto parcial). Devuelve estado, país, industria, responsable y cuántos contactos tiene.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Nombre, dominio o NIT a buscar.' },
        limite: { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT },
      },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'contactos_de_empresa',
    description: 'Contactos guardados de una empresa (nombre, cargo, correo, teléfono, LinkedIn).',
    input_schema: {
      type: 'object',
      properties: {
        empresa: { type: 'string', description: 'Nombre o dominio de la empresa.' },
        limite: { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT },
      },
      required: ['empresa'],
      additionalProperties: false,
    },
  },
  {
    name: 'ultimas_busquedas',
    description:
      'Las búsquedas de empresas más recientes (lotes de prospección): estado, país, industria, meta y cuántos candidatos hay en cada estado.',
    input_schema: {
      type: 'object',
      properties: { limite: { type: 'integer', minimum: 1, maximum: MAX_TOOL_LIMIT } },
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

function clampLimit(value: unknown, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(MAX_TOOL_LIMIT, Math.max(1, n));
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
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
      case 'buscar_empresas': {
        const query = text(args.texto);
        if (!query) return { content: JSON.stringify({ error: 'Falta el texto a buscar.' }), isError: true };
        result = await data.searchAccounts(query, clampLimit(args.limite, 8));
        break;
      }
      case 'contactos_de_empresa': {
        const query = text(args.empresa);
        if (!query) return { content: JSON.stringify({ error: 'Falta la empresa.' }), isError: true };
        result = await data.accountContacts(query, clampLimit(args.limite, 10));
        break;
      }
      case 'ultimas_busquedas':
        result = await data.recentSearches(clampLimit(args.limite, 5));
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
