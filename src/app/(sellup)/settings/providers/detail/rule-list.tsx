'use client';

/**
 * rule-list.tsx — las reglas de presupuesto de un alcance (global, rol, grupo
 * o usuario) con sus acciones, o el vacío que invita a crear la primera.
 * Solo presentación: lo que pasa al pulsar llega por props.
 */

import { Pencil, Power, Trash2 } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListItem } from '@/components/data-display';
import type { BudgetRuleRow } from '@/modules/budgets/rule-queries';
import {
  formatLimit,
  ON_EXCEED_LABELS,
  PERIOD_LABELS,
} from '@/app/(sellup)/settings/budget-credits/rules/budget-rule-display';

export interface RuleListProps {
  rules: BudgetRuleRow[];
  /** La regla cuyo estado se está cambiando: su botón queda apagado. */
  togglingId: string | null;
  /** La regla que se está eliminando: su botón queda apagado. */
  deletingId: string | null;
  onEdit: (rule: BudgetRuleRow) => void;
  onToggle: (rule: BudgetRuleRow) => void;
  onRequestDelete: (rule: BudgetRuleRow) => void;
  /** Sin él no se ofrece crear (todavía no hay opciones de formulario). */
  onCreate?: () => void;
}

function RuleActions({
  rule,
  togglingId,
  deletingId,
  onEdit,
  onToggle,
  onRequestDelete,
}: Omit<RuleListProps, 'rules' | 'onCreate'> & { rule: BudgetRuleRow }) {
  return (
    <>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar regla" onClick={() => onEdit(rule)}>
        <Pencil aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={rule.is_active ? 'Desactivar regla' : 'Activar regla'}
        disabled={togglingId === rule.id}
        onClick={() => onToggle(rule)}
      >
        <Power aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="icon-xs"
        aria-label="Eliminar regla"
        disabled={deletingId === rule.id}
        onClick={() => onRequestDelete(rule)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </>
  );
}

/** Las reglas de un alcance, o el vacío que invita a crear la primera. */
export function RuleList({ rules, onCreate, ...actions }: RuleListProps) {
  if (rules.length === 0) {
    return (
      <EmptyState
        variant="plain"
        title="Sin reglas configuradas para este alcance."
        className="py-6"
        action={
          onCreate ? (
            <Button size="xs" variant="outline" type="button" className="mt-2" onClick={onCreate}>
              Crear primera regla
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div role="list" className="mt-2 divide-y divide-border/50">
      {rules.map((rule) => (
        <ListItem
          key={rule.id}
          role="listitem"
          size="sm"
          className="px-0"
          title={
            <span className="flex items-center gap-2">
              <span className="truncate">{rule.scopeLabel}</span>
              <Badge variant={rule.is_active ? 'positive' : 'neutral'}>
                {rule.is_active ? 'Activa' : 'Inactiva'}
              </Badge>
            </span>
          }
          description={
            <>
              <span className="font-medium tabular-nums text-foreground">
                {formatLimit(rule.limit_credits, rule.limit_usd)}
              </span>
              {' · '}
              {PERIOD_LABELS[rule.period_type]}
              {' · '}
              {ON_EXCEED_LABELS[rule.on_exceed]}
            </>
          }
          actions={<RuleActions rule={rule} {...actions} />}
        />
      ))}
    </div>
  );
}
