# Estructura del Proyecto SellUp

## Vista General

```
src/
├── app/              # Rutas y layouts de Next.js
├── components/      # Componentes reutilizables
├── config/           # Configuración global
├── lib/              # Utilidades y clientes
├── modules/          # Dominios funcionales
├── server/           # Lógica de servidor
└── types/            # Tipos globales
```

## Detalle de Carpetas Principales

### `src/app/`

Contiene las rutas de Next.js usando App Router.

```
app/
├── (auth)/           # Grupo de rutas de autenticación
│   └── login/        # Página de login
├── (sellup)/         # Grupo de rutas principales del MVP
│   ├── layout.tsx    # Layout con sidebar y header
│   ├── pipeline/     # Pipeline SellUp
│   ├── accounts/     # Cuentas y expediente
│   ├── ai-usage/     # Uso de IA y costos
│   └── settings/    # Configuración
├── layout.tsx        # Layout raíz
├── page.tsx          # Página de inicio (redirect)
└── providers.tsx     # Providers (theme, tooltip)
```

### `src/components/`

Componentes reutilizables organizados por función:

```
components/
├── layout/           # Estructura (sidebar, header, shell)
├── navigation/       # Navegación
├── theme/            # Theme provider y toggle
└── ui/               # Componentes shadcn/ui (button, card, etc.)
```

### `src/config/`

Configuración centralizada:

```
config/
├── navigation.ts     # Items de navegación del MVP
└── app.ts            # Configuración de la aplicación
```

### `src/lib/`

Utilidades y clientes externos:

```
lib/
├── env/              # Variables de entorno
│   └── client.ts
├── supabase/         # Clientes Supabase
│   ├── client.ts     # Cliente navegador
│   └── server.ts     # Cliente servidor
└── utils.ts          # Utilidades (cn)
```

### `src/modules/`

Dominios funcionales del MVP. Cada módulo sigue una estructura similar:

```
modules/
├── auth/             # Autenticación (pendiente)
├── pipeline/         # Pipeline SellUp
├── accounts/         # Cuentas y expediente
├── prospect-creation/  # Creación de prospectos (flujo contextual)
├── prospect-batches/   # Generación por lotes (flujo contextual)
├── batch-review/      # Revisión de lotes (flujo contextual)
├── account-intelligence/ # Inteligencia de cuenta (embebido en expediente)
├── speech/           # Speech y preparación (embebido en expediente)
├── ai-usage/         # Uso de IA y costos
└── settings/         # Configuración
```

**Nota:** Los módulos de flujos contextuales y capacidades embebidas existen como dominios funcionales pero no como secciones principales de navegación.

### `src/server/`

Lógica del lado del servidor:

```
server/
├── agents/           # Definiciones de agentes (pendiente)
├── integrations/    # Conectores externos (pendiente)
├── repositories/    # Repositorios de datos (pendiente)
├── services/        # Servicios de negocio (pendiente)
└── workflows/       # Orquestación de flujos (pendiente)
```

### `src/types/`

Tipos globales de TypeScript (pendiente de definir con el modelo de datos).

## Relación entre Dominios del MVP y Carpetras

| Dominio           | Carpeta                        | Navegación Principal |
| ----------------- | ------------------------------ | -------------------- |
| Pipeline SellUp   | `modules/pipeline`             | ✅ Sí                |
| Cuentas           | `modules/accounts`             | ✅ Sí                |
| Expediente        | `modules/accounts`             | ✅ Via accounts      |
| Prospect Creation | `modules/prospect-creation`    | ❌ Contextual        |
| Batch Generation  | `modules/prospect-batches`     | ❌ Contextual        |
| Batch Review      | `modules/batch-review`         | ❌ Contextual        |
| Inteligencia      | `modules/account-intelligence` | ❌ Embebido          |
| Speech            | `modules/speech`               | ❌ Embebido          |
| Uso IA            | `modules/ai-usage`             | ✅ Sí                |
| Settings          | `modules/settings`             | ✅ Sí                |

## Siguiente Paso

Para entender los principios de desarrollo, ver `docs/DEVELOPMENT_GUIDELINES.md`.

Para entender el sistema visual, ver `docs/UI_FOUNDATIONS.md`.
