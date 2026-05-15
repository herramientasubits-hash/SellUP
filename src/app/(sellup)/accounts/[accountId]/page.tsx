import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface AccountPageProps {
  params: Promise<{
    accountId: string;
  }>;
}

export default async function AccountDetailPage({ params }: AccountPageProps) {
  const { accountId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Expediente de Cuenta
        </h1>
        <p className="text-muted-foreground">
          Aquí vivirá el Expediente de cuenta, pantalla contextual central del
          MVP.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Cuenta: {accountId}</CardTitle>
          <CardDescription>
            Esta página se implementará en la fase de desarrollo del Expediente
            de Cuenta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p>
              El Expediente de cuenta es la pantalla de trabajo más importante
              del MVP, donde el usuario consulta información, ve outputs
              generados (inteligencia comercial, speech), ejecuta agentes,
              resuelve bloqueos y revisa actividad y costos asociados.
            </p>
            <p className="mt-2">
              <strong>ID de cuenta:</strong> {accountId}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
