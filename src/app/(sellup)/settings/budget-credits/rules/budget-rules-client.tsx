'use client';

import { useState } from 'react';
import { Plus } from '@/icons';
import { SettingsPage } from '@/components/settings/settings-page';
import { LegacyCompatBanner } from '../../legacy-compat-banner';
import { Button } from '@/components/ui/button';
import { toggleBudgetRuleStatus, deleteBudgetRule } from '@/modules/budgets/rule-actions';
import type { BudgetRuleRow, BudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { CreateDrawer, EditDrawer } from './budget-rule-drawers';
import { RulesDataTable } from './budget-rules-table';
import { DeleteBudgetRuleDialog } from './delete-budget-rule-dialog';

// Los paneles de crear y editar también se usan desde el detalle de un
// proveedor: se siguen exportando desde aquí para no romper esa ruta.
export { CreateDrawer, EditDrawer };

// ─── Estado compartido de la gestión de reglas ────────────────────────────────

interface RulesWorkspaceProps {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
  showCreate: boolean;
  onShowCreateChange: (open: boolean) => void;
  showCreateAction?: boolean;
}

/** La lista de reglas con sus paneles de crear/editar y la confirmación de borrado. */
function RulesWorkspace({ rules, options, showCreate, onShowCreateChange, showCreateAction }: RulesWorkspaceProps) {
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    window.location.reload();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    setArchiveError(null);
    const result = await deleteBudgetRule(rule.id);
    if (!result.success) {
      setArchiveError(result.error ?? 'No se pudo eliminar la regla. Inténtalo de nuevo.');
      setArchiving(null);
      return;
    }
    setArchiving(null);
    setConfirmArchive(null);
    window.location.reload();
  }

  return (
    <>
      <RulesDataTable
        rules={rules}
        onCreate={() => onShowCreateChange(true)}
        onEdit={setEditRule}
        onToggle={handleToggle}
        onArchive={(rule) => { setArchiveError(null); setConfirmArchive(rule); }}
        busyId={toggling ?? archiving}
        showCreateAction={showCreateAction}
      />

      <CreateDrawer options={options} open={showCreate} onOpenChange={onShowCreateChange} />
      <EditDrawer rule={editRule} open={!!editRule} onOpenChange={(v) => { if (!v) setEditRule(null); }} />

      <DeleteBudgetRuleDialog
        rule={confirmArchive}
        deleting={archiving !== null}
        error={archiveError}
        onConfirm={handleArchive}
        onCancel={() => setConfirmArchive(null)}
      />
    </>
  );
}

// ─── Section (embedded in the budget-credits page) ────────────────────────────

interface TabbedSectionProps {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

/**
 * Las reglas dentro de otra pantalla. Conserva el nombre por compatibilidad:
 * ya no hay pestañas por alcance, el alcance se filtra desde su columna.
 */
export function BudgetRulesTabbedSection({ rules, options }: TabbedSectionProps) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <RulesWorkspace
      rules={rules}
      options={options}
      showCreate={showCreate}
      onShowCreateChange={setShowCreate}
      showCreateAction
    />
  );
}

// ─── Main client component ────────────────────────────────────────────────────

interface Props {
  rules: BudgetRuleRow[];
  options: BudgetRuleFormOptions;
}

export function BudgetRulesClient({ rules, options }: Props) {
  const [showCreate, setShowCreate] = useState(false);

  return (
    <SettingsPage
      title="Reglas de presupuesto"
      description="Fija un tope de gasto por proveedor para toda la empresa, un rol, un grupo o una persona."
      trail={[{ label: 'Proveedores y consumo', href: '/settings/providers' }]}
      actions={
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus />
          Nueva regla
        </Button>
      }
    >
      <LegacyCompatBanner
        message="También puedes gestionar las reglas de cada proveedor desde su detalle, en Proveedores y consumo."
        ctaLabel="Ir a Proveedores y consumo"
        ctaHref="/settings/providers"
      />
      <RulesWorkspace
        rules={rules}
        options={options}
        showCreate={showCreate}
        onShowCreateChange={setShowCreate}
      />
    </SettingsPage>
  );
}
