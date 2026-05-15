import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">
            <span className="text-primary">Sell</span>
            <span className="text-foreground">Up</span>
          </CardTitle>
          <CardDescription>
            Acceso interno a SellUp. En una siguiente fase aquí se implementará
            Google OAuth con Supabase Auth.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            <p className="font-medium">Estado: Base técnica inicial</p>
            <p className="mt-1">
              La funcionalidad de autenticación se implementará en una fase
              posterior del desarrollo.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
