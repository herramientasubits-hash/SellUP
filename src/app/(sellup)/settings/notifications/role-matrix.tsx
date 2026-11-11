'use client';

import { RotateCcw } from '@/icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  appliesToRole,
  roleEnabled,
  type NotificationDefinition,
  type NotificationSettingRow,
} from '@/modules/notifications/notification-catalog';
import { GROUP_LABEL, findRule, type RuleInput } from './notification-settings-types';

// ============================================================
// «Avisos» por rol: filas = avisos del catálogo (por grupo), columnas = roles.
// Cada celda dice lo que vale para el rol (su regla o el valor por defecto).
// ============================================================

interface RoleMatrixProps {
  catalog: readonly NotificationDefinition[];
  roles: ReadonlyArray<{ key: string; label: string }>;
  rows: readonly NotificationSettingRow[];
  pendingKey: string | null;
  onChange: (input: RuleInput) => void;
}

const GROUP_ORDER = ['avisos', 'alertas', 'boletin'] as const;

export function cellKey(notificationKey: string, roleKey: string): string {
  return `role:${roleKey}:${notificationKey}`;
}

export function RoleMatrix({ catalog, roles, rows, pendingKey, onChange }: RoleMatrixProps) {
  const gridTemplate = { gridTemplateColumns: `minmax(16rem, 1fr) repeat(${roles.length}, minmax(6.5rem, 7rem))` };

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Por rol"
        description="Lo que recibe cada rol por Slack. La campanita de SellUp no cambia: esto sólo decide si además llega por Slack."
      />
      <div className="overflow-x-auto">
        <div role="table" aria-label="Avisos por rol" className="min-w-max">
          <div role="row" className="grid items-end gap-2 border-b border-border/60 pb-2" style={gridTemplate}>
            <span role="columnheader" className="text-xs font-medium text-muted-foreground">Aviso</span>
            {roles.map((role) => (
              <span key={role.key} role="columnheader" className="text-center text-xs font-medium text-muted-foreground">
                {role.label}
              </span>
            ))}
          </div>

          {GROUP_ORDER.map((group) => {
            const entries = catalog.filter((d) => d.group === group);
            if (entries.length === 0) return null;
            return (
              <div key={group} role="rowgroup" className="pt-4">
                <div role="row" className="pb-1">
                  <span role="cell" className="text-sm font-semibold text-foreground">{GROUP_LABEL[group].title}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{GROUP_LABEL[group].description}</span>
                </div>
                {entries.map((def) => (
                  <div key={def.key} role="row" className="grid items-center gap-2 border-b border-border/40 py-2.5 last:border-b-0" style={gridTemplate}>
                    <div role="rowheader" className="min-w-0 pr-2">
                      <p className="text-sm font-medium text-foreground">{def.label}</p>
                      <p className="text-xs text-muted-foreground">{def.description}</p>
                    </div>
                    {roles.map((role) => (
                      <RoleCell
                        key={role.key}
                        def={def}
                        role={role}
                        rows={rows}
                        busy={pendingKey === cellKey(def.key, role.key)}
                        onChange={onChange}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </SurfaceCard>
  );
}

function RoleCell({
  def,
  role,
  rows,
  busy,
  onChange,
}: {
  def: NotificationDefinition;
  role: { key: string; label: string };
  rows: readonly NotificationSettingRow[];
  busy: boolean;
  onChange: (input: RuleInput) => void;
}) {
  if (!appliesToRole(def.key, role.key)) {
    return (
      <span role="cell" className="text-center text-sm text-muted-foreground" title="No aplica a este rol">
        —
      </span>
    );
  }
  const checked = roleEnabled(def.key, role.key, rows);
  const hasRule = findRule(rows, 'role', role.key, def.key) !== null;
  const base = { scopeType: 'role' as const, scopeId: role.key, notificationKey: def.key };

  return (
    <div role="cell" className="flex flex-col items-center gap-1">
      <Switch
        checked={checked}
        disabled={busy}
        aria-label={`${def.label} — ${role.label}`}
        onCheckedChange={(next) => onChange({ ...base, enabled: next })}
      />
      {hasRule ? (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          aria-label={`Restablecer ${def.label} — ${role.label}`}
          onClick={() => onChange({ ...base, enabled: null })}
        >
          <RotateCcw aria-hidden="true" />
          Restablecer
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">Por defecto</span>
      )}
    </div>
  );
}
