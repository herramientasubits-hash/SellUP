import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Configuración e Integraciones
        </h1>
        <p className="text-muted-foreground">
          Aquí vivirá el módulo de Configuración e Integraciones de SellUp.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Estado: Placeholder</CardTitle>
          <CardDescription>
            Esta página se implementará en la fase de desarrollo del módulo de
            Configuración.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>El módulo de Configuración permitirá gestionar:</p>
            <ul className="mt-2 list-disc pl-4">
              <li>Proveedores de IA y modelos</li>
              <li>Integración con HubSpot</li>
              <li>Integración con Apollo.io</li>
              <li>Niveles de automatización</li>
              <li>Parámetros del sistema</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
