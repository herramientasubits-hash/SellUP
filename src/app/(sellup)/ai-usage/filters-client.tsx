'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { FilterOptions, FilterUser } from '@/modules/ai-usage/queries';

const PERIOD_OPTIONS = [
  { value: 'all', label: 'Todo el período' },
  { value: '7d', label: 'Últimos 7 días' },
  { value: '30d', label: 'Últimos 30 días' },
  { value: 'current_month', label: 'Mes actual' },
] as const;

const PROVIDER_DISPLAY: Record<string, string> = {
  tavily: 'Tavily',
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  apollo: 'Apollo',
  lusha: 'Lusha',
  hubspot: 'HubSpot',
  samu_ia: 'Samu IA',
};

const AGENT_DISPLAY: Record<string, string> = {
  prospect_generation: 'Generación de prospectos',
  account_intelligence: 'Inteligencia de cuenta',
  commercial_speech: 'Speech comercial',
  post_meeting_followup: 'Seguimiento post-reunión',
};

function labelProvider(key: string) {
  return PROVIDER_DISPLAY[key] ?? key;
}

function labelAgent(key: string, name: string | null) {
  return AGENT_DISPLAY[key] ?? name ?? key;
}

function labelUser(u: FilterUser) {
  if (u.full_name && u.email) return `${u.full_name} (${u.email})`;
  return u.full_name ?? u.email ?? u.id.slice(0, 8);
}

interface FiltersClientProps {
  options: FilterOptions;
  currentPeriod: string;
  currentProvider: string;
  currentAgent: string;
  currentStatus: string;
  currentUser: string;
  currentGroup: string;
}

export function FiltersClient({
  options,
  currentPeriod,
  currentProvider,
  currentAgent,
  currentStatus,
  currentUser,
  currentGroup,
}: FiltersClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === '' || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  // Changing the group may invalidate the selected user: if the user does
  // not belong to the new group, clear it to avoid an impossible combination.
  const onGroupChange = useCallback(
    (value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete('group');
      } else {
        params.set('group', value);
        const selected = options.users.find((u) => u.id === currentUser);
        if (selected && selected.role_key !== value) {
          params.delete('user');
        }
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams, options.users, currentUser],
  );

  // Usuario dropdown is scoped to the selected group (if any), so the two
  // filters always express a possible combination.
  const visibleUsers = useMemo(() => {
    if (!currentGroup) return options.users;
    return options.users.filter((u) => u.role_key === currentGroup);
  }, [options.users, currentGroup]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mr-1">
        Filtrar
      </span>

      {/* Período */}
      <Select
        value={currentPeriod || 'all'}
        onValueChange={(v) => setParam('period', v)}
      >
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="Período" />
        </SelectTrigger>
        <SelectContent>
          {PERIOD_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-xs">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Proveedor */}
      {options.providers.length > 0 && (
        <Select
          value={currentProvider || 'all'}
          onValueChange={(v) => setParam('provider', v)}
        >
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los proveedores
            </SelectItem>
            {options.providers.map((p) => (
              <SelectItem key={p} value={p} className="text-xs">
                {labelProvider(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Agente */}
      {options.agents.length > 0 && (
        <Select
          value={currentAgent || 'all'}
          onValueChange={(v) => setParam('agent', v)}
        >
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Agente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los agentes
            </SelectItem>
            {options.agents.map((a) => (
              <SelectItem key={a.key} value={a.key} className="text-xs">
                {labelAgent(a.key, a.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Estado */}
      {options.statuses.length > 0 && (
        <Select
          value={currentStatus || 'all'}
          onValueChange={(v) => setParam('status', v)}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los estados
            </SelectItem>
            {options.statuses.map((s) => (
              <SelectItem key={s} value={s} className="text-xs capitalize">
                {s.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Grupo / Rol */}
      {options.groups.length > 0 && (
        <Select
          value={currentGroup || 'all'}
          onValueChange={onGroupChange}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Grupo / rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los grupos
            </SelectItem>
            {options.groups.map((g) => (
              <SelectItem key={g.key} value={g.key} className="text-xs">
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Usuario */}
      {options.users.length > 0 ? (
        <Select
          value={currentUser || 'all'}
          onValueChange={(v) => setParam('user', v)}
        >
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue placeholder="Usuario" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">
              Todos los usuarios
            </SelectItem>
            {visibleUsers.map((u) => (
              <SelectItem key={u.id} value={u.id} className="text-xs">
                {labelUser(u)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Select disabled value="none">
          <SelectTrigger className="h-8 w-[180px] text-xs opacity-50 cursor-not-allowed">
            <SelectValue placeholder="Sin usuarios" />
          </SelectTrigger>
        </Select>
      )}
    </div>
  );
}
