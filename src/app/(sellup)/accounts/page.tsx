import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Empresas / Cuentas
        </h1>
        <p className="text-muted-foreground">
          Aquí vivirá la vista transversal de Empresas / Cuentas registradas en
          SellUp.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Estado: Placeholder</CardTitle>
          <CardDescription>
            Esta página se implementará en la fase de desarrollo del módulo de
            Cuentas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>
              La vista de Empresas / Cuentas mostrará el listado transversal de
              todas las cuentas registradas en SellUp con filtros, búsqueda y
              acceso al expediente.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
