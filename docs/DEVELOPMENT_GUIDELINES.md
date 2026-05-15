# Guidelines de Desarrollo - SellUp

## Principios Fundamentales

### 1. No poner lógica de negocio crítica en componentes visuales

Los componentes UI deben ser presentacionales. La lógica de negocio (validación de duplicidades, reglas de pipeline, criterios de "inteligencia lista") debe vivir en la capa de aplicación (`modules/`).

**Correcto:**

```typescript
// components/Pipeline.tsx (presentacional)
<Card> {account.status} </Card>

// modules/pipeline/usePipeline.ts (lógica de negocio)
const updateStage = (account: Account, newStage: Stage) => {
  if (!canTransition(account, newStage)) {
    throw new Error('No se puede realizar esta transición')
  }
}
```

### 2. Mantener servicios e integraciones desacoplados

Los conectores (HubSpot, Apollo, proveedores de IA) deben ser módulos separados con interfaces definidas.

**Correcto:**

```typescript
// server/integrations/hubspot/types.ts
export interface HubSpotContact {
  id: string;
  email: string;
  // ...
}

// server/integrations/hubspot/client.ts
export class HubSpotClient {
  async getContact(id: string): Promise<HubSpotContact> {
    // implementación
  }
}
```

### 3. No crear módulos fuera del alcance actual sin justificación

El MVP tiene un alcance definido: de prospecto a cuenta preparada para contacto.

**No hacer:**

- Crear módulos de reuniones, propuestas, business cases, alertas como navegación principal
- Construir integraciones avanzadas antes de que el flujo principal funcione
- Agregar scoring sofisticado o priorización antes del MVP

### 4. Tratar agentes como capacidades del producto, no como chats aislados

Los agentes no deben ser interfaces de chat independientes. Deben:

- Ejecutarse desde contextos específicos (cuenta, expediente)
- Producir outputs estructurados que se guardan y reutilizan
- Dejar trazabilidad de ejecuciones, tokens y costos

### 5. Preparar trazabilidad y costos desde el diseño

Toda ejecución de agente debe registrar:

- Usuario
- Cuenta
- Proveedor/modelo
- Tokens entrada/salida
- Costo estimado
- Duración
- Estado (éxito, error, regeneración)
- Resultado

### 6. No duplicar la función de HubSpot

SellUp es un complemento de HubSpot, no un reemplazo. No construir:

- CRM completo con gestión de contacts
- Pipeline estándar de HubSpot
- Funcionalidades de Deals que existan en HubSpot

## Estructura de Código

### Componentes

- Ubicar en `src/components/` si son reutilizables
- Ubicar en `src/modules/[modulo]/components/` si son específicos de un módulo
- Mantener presentacionales, delegar lógica a hooks y servicios

### Hooks y Servicios

```typescript
// modules/pipeline/hooks/usePipeline.ts
export function usePipeline() {
  // lógica de negocio relacionada al pipeline
}

// modules/pipeline/services/pipelineService.ts
export const pipelineService = {
  // operaciones de negocio
};
```

### Tipos

- Definir en `src/types/` si son globales
- Definir en el módulo si son específicos del módulo
- Usar interfaces sobre types para extensibilidad

## Naming Conventions

- **Archivos:** kebab-case (`use-pipeline.ts`, `pipeline-service.ts`)
- **Componentes:** PascalCase (`PipelineCard.tsx`, `AccountList.tsx`)
- **Funciones:** camelCase (`getAccounts`, `updateStage`)
- **Constantes:** UPPER_SNAKE_CASE (`PIPELINE_STAGES`)

## Imports

- Usar alias `@/` para imports desde `src/`
- Orden: external → internal → relative

```typescript
import { useState } from "react"; // external
import { Button } from "@/components/ui"; // internal
import { pipelineService } from "@/modules/pipeline/services";
```

## Git y Commits

- Commits atómicos y descriptivos
- Usar conventional commits:
  - `feat:` nueva funcionalidad
  - `fix:` corrección de bug
  - `docs:` documentación
  - `refactor:` refactorización
  - `chore:` tareas menores

## Testing

- Tests unitarios para lógica de negocio en `modules/`
- Componentes: verificar renderizado y estados
- Mantener cobertura para lógica crítica

## Revisión de Código

Antes de crear PR:

1. Ejecutar `npm run lint`
2. Ejecutar `npm run typecheck`
3. Verificar `npm run build`
4. Revisar que los cambios respeten este documento

---

Para ver la arquitectura, ir a `docs/ARCHITECTURE.md`.
Para ver la estructura, ir a `docs/PROJECT_STRUCTURE.md`.
Para ver el sistema visual, ir a `docs/UI_FOUNDATIONS.md`.
