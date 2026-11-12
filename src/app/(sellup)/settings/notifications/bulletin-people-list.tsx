'use client';

import { useMemo, useState } from 'react';
import { Search } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BulletinFrequency, NotificationSettingRow } from '@/modules/notifications/notification-catalog';
import { FrequencySelect } from './frequency-select';
import { activeFrequencies, frequencyLabel, type NotificationSettingsData } from './notification-settings-types';

// ============================================================
// Panel izquierdo del «Boletín»: las personas, con buscador y filtros por rol
// y por frecuencia activa. Cada fila dice qué boletines le llegan hoy.
// ============================================================

type Person = NotificationSettingsData['users'][number];
export type ActiveFilter = BulletinFrequency | 'all' | 'none';

const ALL_ROLES = 'all';

interface BulletinPeopleListProps {
  users: readonly Person[];
  roles: ReadonlyArray<{ key: string; label: string }>;
  rows: readonly NotificationSettingRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export function filterPeople(
  users: readonly Person[],
  rows: readonly NotificationSettingRow[],
  filters: { query: string; role: string; active: ActiveFilter },
): Array<{ person: Person; frequencies: BulletinFrequency[] }> {
  const q = normalize(filters.query.trim());
  return users
    .map((person) => ({ person, frequencies: activeFrequencies(person, rows) }))
    .filter(({ person }) => !q || normalize(`${person.name} ${person.email ?? ''}`).includes(q))
    .filter(({ person }) => filters.role === ALL_ROLES || person.roleKey === filters.role)
    .filter(({ frequencies }) => {
      if (filters.active === 'all') return true;
      if (filters.active === 'none') return frequencies.length === 0;
      return frequencies.includes(filters.active);
    });
}

export function BulletinPeopleList({ users, roles, rows, selectedId, onSelect }: BulletinPeopleListProps) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [active, setActive] = useState<ActiveFilter>('all');

  const visible = useMemo(() => filterPeople(users, rows, { query, role, active }), [users, rows, query, role, active]);
  const roleOptions = [{ key: ALL_ROLES, label: 'Todos los roles' }, ...roles];

  return (
    <section aria-label="Personas" className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          aria-label="Buscar persona"
          placeholder="Buscar por nombre o correo…"
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={role} onValueChange={(next) => setRole(String(next))}>
          <SelectTrigger size="sm" className="w-full" aria-label="Rol">
            <SelectValue>{roleOptions.find((r) => r.key === role)?.label}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {roleOptions.map((r) => (
              <SelectItem key={r.key} value={r.key}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FrequencySelect<ActiveFilter>
          value={active}
          onChange={setActive}
          ariaLabel="Frecuencia activa"
          leading={[{ value: 'all', label: 'Todas' }]}
          trailing={[{ value: 'none', label: 'Sin boletín' }]}
          size="sm"
          className="w-full"
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {visible.length === 1 ? '1 persona' : `${visible.length} personas`}
      </p>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nadie coincide con esos filtros.</p>
      ) : (
        <ul className="-mx-1 flex max-h-[32rem] flex-col gap-1 overflow-y-auto px-1" aria-label="Lista de personas">
          {visible.map(({ person, frequencies }) => {
            const selected = person.id === selectedId;
            return (
              <li key={person.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={person.name}
                  onClick={() => onSelect(person.id)}
                  className={cn(
                    'flex w-full flex-col gap-1 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
                    selected && 'bg-primary/10 hover:bg-primary/10',
                  )}
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className={cn('truncate text-sm font-medium', selected ? 'text-primary' : 'text-foreground')}>{person.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{person.roleLabel}</span>
                  </span>
                  <span className="flex flex-wrap gap-1" data-testid={`chips-${person.id}`}>
                    {frequencies.length === 0 ? (
                      <span className="text-xs text-muted-foreground">Sin boletín</span>
                    ) : (
                      frequencies.map((f) => (
                        <Badge key={f} variant="brand">
                          {frequencyLabel(f)}
                        </Badge>
                      ))
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
