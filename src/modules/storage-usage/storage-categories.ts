/**
 * Integraciones › Supabase — de «tablas de Postgres» a «cosas de SellUp».
 *
 * La función `sellup_storage_usage()` (migración 162) devuelve el peso de cada
 * tabla. Aquí se agrupan en lo que la dueña reconoce: empresas, contactos,
 * búsquedas, catálogo de fuentes… y se decide si el espacio pide atención.
 *
 * Puro: sin red ni base. Lo usa la página y lo fijan sus pruebas.
 */

export type StorageCategoryKey =
  | 'source_catalog'
  | 'companies'
  | 'contacts'
  | 'searches'
  | 'provider_usage'
  | 'system_logs'
  | 'users'
  | 'configuration'
  | 'other';

export interface StorageCategoryMeta {
  key: StorageCategoryKey;
  label: string;
  /** Qué hay adentro, en una frase. */
  description: string;
}

export const STORAGE_CATEGORIES: Readonly<Record<StorageCategoryKey, StorageCategoryMeta>> = {
  source_catalog: {
    key: 'source_catalog',
    label: 'Catálogo de fuentes',
    description: 'Registros oficiales de empresas por país y compras públicas.',
  },
  companies: {
    key: 'companies',
    label: 'Empresas',
    description: 'Fichas de empresas, banco de empresas, árboles corporativos y competidores.',
  },
  contacts: {
    key: 'contacts',
    label: 'Contactos',
    description: 'Contactos, teléfonos y búsquedas de contactos.',
  },
  searches: {
    key: 'searches',
    label: 'Búsquedas y prospectos',
    description: 'Búsquedas del Agente 1, prospectos encontrados y descartados.',
  },
  provider_usage: {
    key: 'provider_usage',
    label: 'Consumo de proveedores',
    description: 'Registro de uso de Apollo, Lusha, IA y presupuestos.',
  },
  system_logs: {
    key: 'system_logs',
    label: 'Registros del sistema',
    description: 'Tareas automáticas, llamadas internas y auditorías.',
  },
  users: {
    key: 'users',
    label: 'Usuarios y accesos',
    description: 'Personas, roles, sesiones y equipos.',
  },
  configuration: {
    key: 'configuration',
    label: 'Configuración y catálogos',
    description: 'Industrias, proveedores, integraciones y ajustes.',
  },
  other: {
    key: 'other',
    label: 'Otros',
    description: 'Tablas internas de Supabase y lo que no encaja arriba.',
  },
};

/** Orden en que se prueban las reglas: la primera que coincide gana. */
const RULES: ReadonlyArray<{ category: StorageCategoryKey; test: (schema: string, name: string) => boolean }> = [
  { category: 'system_logs', test: (schema) => schema === 'cron' || schema === 'net' },
  { category: 'users', test: (schema) => schema === 'auth' },
  {
    category: 'source_catalog',
    test: (_s, name) =>
      /^(source_|public_procurement_|peru_sunat_|br_receita_)/.test(name),
  },
  {
    category: 'contacts',
    test: (_s, name) => /^(contacts?$|contact_|phone_reveal_|first_call_)/.test(name),
  },
  {
    category: 'companies',
    test: (_s, name) =>
      /^(accounts$|account_|agent1_company_|agent1_competitor_|hubspot_owner_)/.test(name),
  },
  {
    category: 'searches',
    test: (_s, name) =>
      /^(prospect_|agent_run|agent1_run_|apollo_round_|provider_seen_|lusha_prospecting_|result_quality_)/.test(name),
  },
  {
    category: 'provider_usage',
    test: (_s, name) =>
      /^(provider_usage_|tool_quota_|provider_pricing_|ai_model_pricing$|wizard_|budget_)/.test(name),
  },
  {
    category: 'system_logs',
    test: (_s, name) =>
      /(_audit$|^integration_webhook_|^system_automations$|^user_notifications$)/.test(name),
  },
  {
    category: 'users',
    test: (_s, name) => /^(internal_users$|roles$|user_|organization_groups$)/.test(name),
  },
  {
    category: 'configuration',
    test: (_s, name) =>
      /^(industr|subindustr|provider_industry_|provider_suppressions?$|external_integration|prospecting_provider|tool_catalog$|ai_)/.test(name),
  },
];

export function classifyTable(schema: string, name: string): StorageCategoryKey {
  for (const rule of RULES) {
    if (rule.test(schema, name)) return rule.category;
  }
  return 'other';
}

// ─── Lo que llega de la función SQL ───────────────────────────────────────────

export interface StorageTableUsage {
  schema: string;
  name: string;
  totalBytes: number;
  rows: number;
  rowsExact: boolean;
}

export interface StorageUsageReport {
  databaseBytes: number;
  generatedAt: string;
  tables: StorageTableUsage[];
}

function toNonNegativeNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Valida lo que devuelve la RPC; cualquier forma inesperada ⇒ null (no se inventan números). */
export function parseStorageUsageReport(raw: unknown): StorageUsageReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const databaseBytes = toNonNegativeNumber(obj.database_bytes);
  if (databaseBytes === null || !Array.isArray(obj.tables)) return null;

  const tables: StorageTableUsage[] = [];
  for (const item of obj.tables) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const totalBytes = toNonNegativeNumber(t.total_bytes);
    const rows = toNonNegativeNumber(t.rows);
    if (typeof t.schema !== 'string' || typeof t.name !== 'string' || totalBytes === null || rows === null) continue;
    tables.push({ schema: t.schema, name: t.name, totalBytes, rows, rowsExact: t.rows_exact === true });
  }

  return {
    databaseBytes,
    generatedAt: typeof obj.generated_at === 'string' ? obj.generated_at : new Date().toISOString(),
    tables,
  };
}

// ─── Agrupado por categoría ──────────────────────────────────────────────────

export interface StorageCategoryUsage extends StorageCategoryMeta {
  totalBytes: number;
  rows: number;
  /** Alguna tabla de la categoría se contó por estimación. */
  rowsApproximate: boolean;
  /** Parte del total de la base, 0–100. */
  share: number;
  /** Sus tablas, de la más pesada a la más liviana. */
  tables: StorageTableUsage[];
}

export function groupStorageByCategory(report: StorageUsageReport): StorageCategoryUsage[] {
  const groups = new Map<StorageCategoryKey, StorageTableUsage[]>();
  for (const table of report.tables) {
    const key = classifyTable(table.schema, table.name);
    groups.set(key, [...(groups.get(key) ?? []), table]);
  }

  const tablesTotal = report.tables.reduce((sum, t) => sum + t.totalBytes, 0);
  const base = Math.max(report.databaseBytes, tablesTotal, 1);

  return [...groups.entries()]
    .map(([key, tables]) => {
      const totalBytes = tables.reduce((sum, t) => sum + t.totalBytes, 0);
      return {
        ...STORAGE_CATEGORIES[key],
        totalBytes,
        rows: tables.reduce((sum, t) => sum + t.rows, 0),
        rowsApproximate: tables.some((t) => !t.rowsExact),
        share: (totalBytes / base) * 100,
        tables: [...tables].sort((a, b) => b.totalBytes - a.totalBytes),
      };
    })
    .sort((a, b) => b.totalBytes - a.totalBytes);
}

// ─── ¿Pide atención el espacio? ──────────────────────────────────────────────

/** Disco incluido en el plan Pro de Supabase. Se cambia con `SUPABASE_DISK_INCLUDED_GB`. */
export const DEFAULT_DISK_INCLUDED_GB = 8;
export const STORAGE_WARNING_PERCENT = 80;

export type StorageLevel = 'ok' | 'warning' | 'over';

export interface StorageCapacity {
  includedBytes: number;
  percent: number;
  level: StorageLevel;
}

export function resolveIncludedDiskGb(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DISK_INCLUDED_GB;
}

export function evaluateStorageCapacity(databaseBytes: number, includedGb: number): StorageCapacity {
  const includedBytes = includedGb * 1024 ** 3;
  const percent = (databaseBytes / includedBytes) * 100;
  const level: StorageLevel = percent >= 100 ? 'over' : percent >= STORAGE_WARNING_PERCENT ? 'warning' : 'ok';
  return { includedBytes, percent, level };
}

// ─── Formatos ────────────────────────────────────────────────────────────────

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 8_622_161_920 ⇒ «8,0 GB». En español: coma decimal. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  const digits = exponent === 0 || value >= 100 ? 0 : 1;
  return `${value.toLocaleString('es-CO', { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${UNITS[exponent]}`;
}

export function formatPercent(percent: number): string {
  if (percent > 0 && percent < 0.1) return '<0,1 %';
  return `${percent.toLocaleString('es-CO', { maximumFractionDigits: 1 })} %`;
}

export function formatRows(rows: number, approximate: boolean): string {
  const text = Math.round(rows).toLocaleString('es-CO');
  return approximate ? `≈ ${text}` : text;
}
