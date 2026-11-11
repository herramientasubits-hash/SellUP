// ============================================================
// Asistente de Slack — lectura de ADMINISTRACIÓN (sólo administradores).
// En SellUp son pantallas de Configuración y el Catálogo de fuentes, que sólo
// ve un admin: usuarios, catálogos y presupuesto. `handle-question` sólo crea
// esta fuente si quien pregunta es admin, y `runAssistantTool` la vuelve a
// exigir. Sólo lectura (🔴 el presupuesto se LEE, nunca se toca).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { displayUserName } from '@/modules/access/user-names';
import { roleLabelFor } from '@/modules/access/role-labels';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import {
  AI_FLOW_STATUS_LABELS,
  CONNECTION_MODE_LABELS,
  OPERATIONAL_STATUS_LABELS,
  PRIORITY_LABELS,
  SELLUP_USE_LABELS,
  TYPE_LABELS,
} from '@/modules/source-catalog/labels';
import { providerDisplayName } from '@/modules/usage-tracking/provider-failure';
import { loadActiveDiscoveryCatalog } from '@/modules/industry-catalog/discovery-catalog-loader';
import { budgetLink, sourceCatalogLink, usersLink } from './links';
import { day, round2, usagePeriodStart } from './query-helpers';
import type {
  AssistantAdminDataSource,
  AssistantBudget,
  AssistantIndustryCatalog,
  AssistantSourceCatalog,
  AssistantUserList,
} from './tools';

/** Cómo se llama cada estado de acceso en Usuarios (suspended = «Inactivo»). */
export const ACCESS_STATUS_LABELS: Readonly<Record<string, string>> = {
  active: 'Activo',
  suspended: 'Inactivo',
  pending_approval: 'Pendiente',
  rejected: 'Rechazado',
  archived: 'Archivado',
};

const BUDGET_SCOPE_LABELS: Record<string, string> = { global: 'Toda la plataforma', user: 'Persona', group: 'Grupo', role: 'Rol' };
const BUDGET_PERIOD_LABELS: Record<string, string> = { monthly: 'Mensual', weekly: 'Semanal', daily: 'Diario' };
const ON_EXCEED_LABELS: Record<string, string> = { block: 'Bloquear', warn: 'Avisar', require_approval: 'Requiere aprobación' };

function label(map: Readonly<Record<string, string>>, key: string | null | undefined): string {
  return key ? map[key] ?? key : '';
}

function matches(haystack: Array<string | null | undefined>, needle: string | undefined): boolean {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return haystack.some((h) => (h ?? '').toLowerCase().includes(n));
}

export function createAssistantAdminDataSource(
  admin: SupabaseClient,
  options: { appUrl: string; now?: Date },
): AssistantAdminDataSource {
  const appUrl = options.appUrl;
  const now = options.now ?? new Date();

  return {
    async users(filters, limit): Promise<AssistantUserList> {
      const [{ data: users, error }, { data: groups }] = await Promise.all([
        admin
          .from('internal_users')
          .select('id, full_name, email, access_status, last_login_at, manager_id, group_id, roles(key)')
          .order('full_name', { ascending: true })
          .limit(1000),
        admin.from('organization_groups').select('id, name'),
      ]);
      if (error) throw new Error(error.message);
      const rows = (users ?? []) as unknown as Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        access_status: string;
        last_login_at: string | null;
        manager_id: string | null;
        group_id: string | null;
        roles: { key: string } | null;
      }>;
      const groupNames = new Map(((groups ?? []) as Array<{ id: string; name: string }>).map((g) => [g.id, g.name]));
      const byId = new Map(rows.map((u) => [u.id, u]));

      const porEstado: Record<string, number> = {};
      for (const u of rows) porEstado[label(ACCESS_STATUS_LABELS, u.access_status)] = (porEstado[label(ACCESS_STATUS_LABELS, u.access_status)] ?? 0) + 1;

      const filtered = rows.filter(
        (u) =>
          (!filters.estado || u.access_status === filters.estado) &&
          (!filters.rol || u.roles?.key === filters.rol || roleLabelFor(u.roles?.key).toLowerCase().includes(filters.rol.toLowerCase())) &&
          matches([u.full_name, u.email], filters.texto),
      );
      return {
        total: filtered.length,
        porEstado,
        enlace: usersLink(appUrl),
        usuarios: filtered.slice(0, limit).map((u) => {
          const manager = u.manager_id ? byId.get(u.manager_id) : undefined;
          return {
            nombre: displayUserName(u) ?? 'Sin nombre',
            correo: u.email,
            rol: roleLabelFor(u.roles?.key),
            estado: label(ACCESS_STATUS_LABELS, u.access_status),
            grupo: u.group_id ? groupNames.get(u.group_id) ?? null : null,
            jefe: manager ? displayUserName(manager) : null,
            ultimoIngreso: u.last_login_at ? day(u.last_login_at) : null,
          };
        }),
      };
    },

    async sourceCatalog(filters, limit): Promise<AssistantSourceCatalog> {
      const { sources } = getSourceCatalogViewModel();
      const country = filters.pais?.trim().toUpperCase();
      const filtered = sources.filter(
        (s) =>
          (!country || country.length !== 2 || s.countryCodes.includes(country)) &&
          (!filters.estado ||
            s.operationalStatus === filters.estado ||
            label(OPERATIONAL_STATUS_LABELS, s.operationalStatus).toLowerCase().includes(filters.estado.toLowerCase())) &&
          matches([s.name, s.key, s.recommendedUse, ...(s.sectors ?? [])], filters.texto ?? (country && country.length !== 2 ? filters.pais : undefined)),
      );
      const porEstado: Record<string, number> = {};
      for (const s of filtered) {
        const key = label(OPERATIONAL_STATUS_LABELS, s.operationalStatus);
        porEstado[key] = (porEstado[key] ?? 0) + 1;
      }
      return {
        total: filtered.length,
        porEstado,
        enlace: sourceCatalogLink(appUrl),
        fuentes: filtered.slice(0, limit).map((s) => ({
          nombre: s.name,
          paises: s.countryCodes,
          tipo: label(TYPE_LABELS, s.type),
          prioridad: label(PRIORITY_LABELS, s.priority),
          estado: label(OPERATIONAL_STATUS_LABELS, s.operationalStatus),
          usoEnSellUp: `${label(SELLUP_USE_LABELS, s.sellupUse)} · ${label(AI_FLOW_STATUS_LABELS, s.aiFlowStatus)}`,
          conexion: label(CONNECTION_MODE_LABELS, s.connectionMode),
          url: s.url,
        })),
      };
    },

    async industryCatalog(filters): Promise<AssistantIndustryCatalog> {
      // El mismo catálogo que usa la plataforma para buscar y clasificar.
      const catalog = await loadActiveDiscoveryCatalog(admin);
      const list = catalog.industries
        .map((industry) => ({
          nombre: industry.name,
          subindustrias: catalog.subindustries.filter((sub) => sub.industryId === industry.id).map((sub) => sub.name),
        }))
        .filter((i) => !filters.texto || matches([i.nombre, ...i.subindustrias], filters.texto));
      return { version: catalog.version ?? null, industrias: list };
    },

    async budget(): Promise<AssistantBudget> {
      const monthStart = usagePeriodStart('mes', now);
      const [{ data: tools, error: toolsError }, { data: rules, error: rulesError }] = await Promise.all([
        admin
          .from('tool_catalog')
          .select('provider_key, display_name, consumption_unit, monthly_credits_allowance, monthly_usd_allowance, credits_remaining_external, is_active')
          .eq('is_active', true),
        admin
          .from('budget_rules')
          .select('provider_key, scope_type, period_type, limit_credits, limit_usd, on_exceed')
          .eq('is_active', true),
      ]);
      if (toolsError) throw new Error(toolsError.message);
      if (rulesError) throw new Error(rulesError.message);

      const usage = new Map<string, { credits: number; usd: number }>();
      for (let page = 0; page < 20; page++) {
        const { data, error } = await admin
          .from('provider_usage_logs')
          .select('provider_key, credits_used, estimated_cost_usd')
          .gte('created_at', monthStart)
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as Array<{ provider_key: string; credits_used: number | null; estimated_cost_usd: number | null }>) {
          const u = usage.get(r.provider_key) ?? { credits: 0, usd: 0 };
          u.credits += Number(r.credits_used ?? 0);
          u.usd += Number(r.estimated_cost_usd ?? 0);
          usage.set(r.provider_key, u);
        }
        if (!data || data.length < 1000) break;
      }

      const toolRows = (tools ?? []) as Array<{
        provider_key: string;
        display_name: string | null;
        consumption_unit: string | null;
        monthly_credits_allowance: number | null;
        monthly_usd_allowance: number | null;
        credits_remaining_external: number | null;
      }>;
      return {
        mes: day(monthStart).slice(0, 7),
        enlace: budgetLink(appUrl),
        proveedores: toolRows.map((t) => {
          const u = usage.get(t.provider_key) ?? { credits: 0, usd: 0 };
          return {
            proveedor: t.display_name || providerDisplayName(t.provider_key),
            unidad: t.consumption_unit,
            asignacionMensualCreditos: t.monthly_credits_allowance === null ? null : Number(t.monthly_credits_allowance),
            asignacionMensualUsd: t.monthly_usd_allowance === null ? null : Number(t.monthly_usd_allowance),
            usadoMesCreditos: round2(u.credits),
            usadoMesUsd: round2(u.usd),
            saldoInformadoPorProveedor: t.credits_remaining_external === null ? null : Number(t.credits_remaining_external),
          };
        }),
        reglasActivas: ((rules ?? []) as Array<Record<string, string | number | null>>).map((r) => ({
          proveedor: providerDisplayName(String(r.provider_key ?? '')),
          alcance: label(BUDGET_SCOPE_LABELS, r.scope_type as string),
          periodo: label(BUDGET_PERIOD_LABELS, r.period_type as string),
          limiteCreditos: r.limit_credits === null ? null : Number(r.limit_credits),
          limiteUsd: r.limit_usd === null ? null : Number(r.limit_usd),
          alSuperar: label(ON_EXCEED_LABELS, r.on_exceed as string),
        })),
      };
    },
  };
}
