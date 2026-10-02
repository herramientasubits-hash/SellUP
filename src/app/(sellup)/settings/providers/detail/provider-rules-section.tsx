'use client';

/**
 * provider-rules-section.tsx — «Reglas de presupuesto» de un proveedor, dentro
 * de la pestaña «Presupuesto»: las reglas por alcance y sus acciones (crear,
 * editar, activar o desactivar, eliminar con confirmación).
 */

import { useState, useTransition } from 'react';
import { Plus, ScrollText } from '@/icons';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DrawerSection } from '@/components/shared/drawer-section';
import type { BudgetRuleFormOptions, BudgetRuleRow } from '@/modules/budgets/rule-queries';
import { deleteBudgetRule, toggleBudgetRuleStatus } from '@/modules/budgets/rule-actions';
import type { BudgetScopeType } from '@/modules/usage-tracking/types';
import { CreateDrawer, EditDrawer } from '@/app/(sellup)/settings/budget-credits/rules/budget-rules-client';
import { DeleteBudgetRuleDialog } from '@/app/(sellup)/settings/budget-credits/rules/delete-budget-rule-dialog';
import { RuleList } from './rule-list';

const RULE_SCOPES: BudgetScopeType[] = ['global', 'role', 'group', 'user'];

const SCOPE_SECTION_LABEL: Record<BudgetScopeType, string> = {
  global: 'Globales',
  role: 'Por rol',
  group: 'Por grupo',
  user: 'Por usuario',
};

// ── Sección ───────────────────────────────────────────────────────────────────

export interface ProviderRulesSectionProps {
  rules: BudgetRuleRow[];
  formOptions: BudgetRuleFormOptions | null;
  providerKey: string;
  isNotMeasured: boolean;
  onRefresh: () => void;
}

export function ProviderRulesSection({
  rules,
  formOptions,
  providerKey,
  isNotMeasured,
  onRefresh,
}: ProviderRulesSectionProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [editRule, setEditRule] = useState<BudgetRuleRow | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<BudgetRuleRow | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleToggle(rule: BudgetRuleRow) {
    setToggling(rule.id);
    await toggleBudgetRuleStatus(rule.id, !rule.is_active);
    setToggling(null);
    onRefresh();
  }

  async function handleArchive(rule: BudgetRuleRow) {
    setArchiving(rule.id);
    setArchiveError(null);
    const result = await deleteBudgetRule(rule.id);
    setArchiving(null);
    if (!result.success) {
      setArchiveError(result.error ?? 'Error al eliminar la regla.');
      return;
    }
    setConfirmArchive(null);
    onRefresh();
  }

  if (isNotMeasured) {
    return (
      <Alert>
        <AlertDescription>Las reglas no aplican para este proveedor.</AlertDescription>
      </Alert>
    );
  }

  const openCreate = formOptions ? () => setShowCreate(true) : undefined;

  return (
    <>
      <DrawerSection
        title="Reglas de presupuesto"
        icon={ScrollText}
        badge={rules.length > 0 ? rules.length : undefined}
        action={
          openCreate ? (
            <Button size="xs" variant="outline" type="button" onClick={openCreate}>
              <Plus aria-hidden="true" />
              Crear regla
            </Button>
          ) : undefined
        }
      >
        <Tabs defaultValue="global">
          <TabsList className="grid h-auto w-full grid-cols-4">
            {RULE_SCOPES.map((s) => (
              <TabsTrigger key={s} value={s} className="py-1.5 text-xs">
                {SCOPE_SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
          {RULE_SCOPES.map((s) => (
            <TabsContent key={s} value={s}>
              <RuleList
                rules={rules.filter((r) => r.scope_type === s)}
                togglingId={toggling}
                deletingId={archiving}
                onEdit={setEditRule}
                onToggle={handleToggle}
                onRequestDelete={setConfirmArchive}
                onCreate={openCreate}
              />
            </TabsContent>
          ))}
        </Tabs>

        {rules.length === 0 && !formOptions && (
          <Alert variant="info" className="mt-3">
            <AlertDescription>
              La creación de reglas se conectará directamente en este panel de forma progresiva.
            </AlertDescription>
          </Alert>
        )}
      </DrawerSection>

      <DeleteBudgetRuleDialog
        rule={confirmArchive}
        deleting={confirmArchive !== null && archiving === confirmArchive.id}
        error={archiveError}
        onConfirm={handleArchive}
        onCancel={() => { setConfirmArchive(null); setArchiveError(null); }}
      />

      {formOptions && (
        <>
          <CreateDrawer
            options={formOptions}
            open={showCreate}
            onOpenChange={setShowCreate}
            defaultProviderKey={providerKey}
            onSuccess={() => { setShowCreate(false); startTransition(onRefresh); }}
          />
          <EditDrawer
            rule={editRule}
            open={!!editRule}
            onOpenChange={(v) => { if (!v) setEditRule(null); }}
            onSuccess={() => { setEditRule(null); startTransition(onRefresh); }}
          />
        </>
      )}
    </>
  );
}
