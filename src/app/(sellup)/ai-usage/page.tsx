import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AIUsagePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Uso de IA y costos
        </h1>
        <p className="text-muted-foreground">
          Aquí vivirá la vista mínima de ejecuciones, tokens y costos de IA.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Estado: Placeholder</CardTitle>
          <CardDescription>
            Esta página se implementará en la fase de desarrollo del módulo de
            Uso de IA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>
              La vista de Uso de IA y costos mostrará el registro de ejecuciones
              de agentes con: usuario, cuenta, modelo, tokens, costo estimado,
              duración, estado y resultado.
            </p>
            <ul className="mt-2 list-disc pl-4">
              <li>Consumo por agente</li>
              <li>Costos por cuenta</li>
              <li>Trazabilidad de ejecuciones</li>
              <li>Estados y regeneraciones</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
