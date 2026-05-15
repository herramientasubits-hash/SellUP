import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function PipelinePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pipeline SellUp</h1>
        <p className="text-muted-foreground">
          Aquí vivirá el Pipeline SellUp / Prospección, entrada operativa
          principal del MVP.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Estado: Placeholder</CardTitle>
          <CardDescription>
            Esta página se implementará en la fase de desarrollo del módulo de
            Pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>
              El Pipeline mostrará el avance de las cuentas en los cuatro
              macroestados funcionales:
            </p>
            <ul className="mt-2 list-disc pl-4">
              <li>Cuentas en preparación inicial</li>
              <li>Cuentas listas para profundización</li>
              <li>Inteligencia comercial lista</li>
              <li>Preparadas para contacto</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
