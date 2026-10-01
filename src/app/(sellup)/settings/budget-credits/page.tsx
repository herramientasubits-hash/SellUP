import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, Layers } from "@/icons";
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getBudgetRulesForAdmin, getBudgetRuleFormOptions } from '@/modules/budgets/rule-queries';
import { SettingsPage } from '@/components/settings/settings-page';
import { SurfaceCard } from '@/components/shared/surface-card';
import { buttonVariants } from '@/components/ui/button';
import { BudgetRulesTabbedSection } from './rules/budget-rules-client';

/**
 * Vista antigua de «Créditos y presupuestos». El consumo, las cuotas y la
 * conexión de cada proveedor se gestionan en Proveedores y consumo: aquí ya no
 * se repite esa tabla. Lo único propio de esta pantalla son las reglas de
 * presupuesto de toda la organización, y por eso se quedan.
 */
export default async function BudgetCreditsPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [rules, options] = await Promise.all([
    getBudgetRulesForAdmin(),
    getBudgetRuleFormOptions(),
  ]);

  return (
    <SettingsPage
      title="Créditos y presupuestos"
      description="Los topes de gasto de la organización. El consumo y las cuotas de cada proveedor están en Proveedores y consumo."
      trail={[{ label: 'Proveedores y consumo', href: '/settings/providers' }]}
    >
      <SurfaceCard>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="size-4" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-base font-semibold leading-tight tracking-tight text-foreground">
              El consumo y las cuotas se mudaron a Proveedores y consumo
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ahí ves cuánto ha gastado cada proveedor este mes, ajustas su cuota y revisas su conexión, todo en una
              sola tabla.
            </p>
          </div>
          <Link href="/settings/providers" className={buttonVariants({ className: 'shrink-0' })}>
            Ir a Proveedores y consumo
            <ArrowRight aria-hidden />
          </Link>
        </div>
      </SurfaceCard>

      <BudgetRulesTabbedSection rules={rules} options={options} />
    </SettingsPage>
  );
}
