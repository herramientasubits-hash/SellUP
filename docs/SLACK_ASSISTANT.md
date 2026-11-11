# Asistente de SellUp en Slack (sólo consulta)

Cualquier persona **activa** en SellUp puede escribirle por mensaje directo al bot de SellUp en Slack, o mencionarlo en un canal (`@SellUp …`). El bot le responde con datos de SellUp.

## Qué puede consultar cada rol

Son los mismos permisos que en la plataforma:

| Rol | Alcance |
|---|---|
| **Administrador** | Todo SellUp, incluidas las pantallas de Configuración. |
| **Líder o manager comercial** | Lo suyo y lo de su equipo **en cascada por el organigrama**: grupo, subgrupos y reportes directos e indirectos. |
| **Vendedor / BD y Growth** | Sólo lo suyo. |

### Herramientas para todos los roles (con su alcance)

| Herramienta | Qué responde |
|---|---|
| `mi_resumen` | Totales: empresas activas por estado, prospectos por revisar, búsquedas en curso y contactos. |
| `prospectos` | Empresas candidatas **con nombre** en cualquier estado: por revisar (por defecto), descartados (quién, cuándo y por qué), aprobados, duplicados o todos. Filtros: país, periodo, búsqueda, industria, responsable y texto. |
| `empresas` | Lista de empresas aprobadas. Filtros: texto (nombre, dominio o NIT), país, estado, industria, responsable y periodo. |
| `ficha_empresa` | **Todo** sobre una empresa: razón social, NIT, país, ciudad, industria, tamaño, web, LinkedIn, HubSpot, estado, responsable, notas, contactos y el trabajo de Rumbo (investigación y primeros contactos). Se busca por nombre, dominio, NIT, **ID de SellUp** o **ID de HubSpot**. |
| `contactos` | Personas por nombre, correo, cargo o área, empresa o país. |
| `busquedas` | Búsquedas recientes con sus candidatos por estado. |
| `uso_de_ia` | Consultas, errores, créditos y costo por proveedor y por persona: hoy, la semana o el mes. **Los dólares sólo los ven el administrador y los líderes o managers**; el vendedor ve créditos, como en «Uso de IA». |

### Herramientas sólo para administradores

En SellUp son pantallas de Configuración o del Catálogo de fuentes.

| Herramienta | Qué responde |
|---|---|
| `usuarios` | Nombre, correo, rol, estado (Activo, Inactivo, Pendiente…), grupo, jefe directo y último ingreso. |
| `catalogo_de_fuentes` | Fuentes por país: estado operativo, tipo, prioridad, uso en SellUp y conexión. |
| `catalogo_de_industrias` | Industrias y subindustrias del catálogo activo. |
| `presupuesto` | Por proveedor: asignación mensual, consumo del mes en créditos y dólares, saldo que informa el proveedor y reglas de presupuesto activas. **Sólo lectura.** |

A quien no es administrador **ni siquiera se le ofrecen** estas herramientas. Si las pide por nombre, el bot responde «Sin permiso».

### Cómo se aplica el permiso

- **Identidad:** el correo de Slack se busca en `internal_users`. Si la persona no existe o está **Inactiva**, el bot se lo dice y no muestra datos.
- **Alcance:** se calcula con `resolveCommercialScopeForUser`, en `src/modules/access/commercial-scope-core.server.ts`. Es la misma regla que usa la plataforma.
- **Empresas y contactos:** cuentan si alguien del alcance es su responsable **o** la creó. Es la misma regla que Empresas y Contactos.
- **Prospectos:** el responsable efectivo es el asignado o, si no hay, el dueño o creador de la búsqueda. Es la misma regla que «Por revisar».
- **Los filtros de Claude sólo acotan:** el responsable que pide se cruza con el alcance (`intersectOptionalUserIds`) y nunca lo amplía.
- **Corte de visibilidad:** se aplica igual que en la plataforma (`SELLUP_VISIBLE_SINCE`). Lo anterior a la entrega no aparece en Contactos ni en Uso de IA.
- **Pruebas:** `__tests__/slack-assistant-scope.test.ts` ejecuta las consultas reales contra una base falsa y comprueba el filtro exacto para vendedor, líder y administrador.

**No escribe nada.** Si alguien le pide una acción, el bot remite a la pantalla de SellUp correspondiente.

**Memoria:** antes de responder, lee los mensajes anteriores del hilo o de la conversación directa: hasta 12 y no más de 6 horas atrás. Ignora los avisos con botones.

**Enlaces:** llevan a la pantalla exacta, por ejemplo Por revisar con el país ya filtrado, Descartadas, la ficha de la empresa, una búsqueda resaltada, Uso de IA, Usuarios, el Catálogo de fuentes o Presupuesto.

Cada pregunta queda en **Uso de IA** como «Asistente de Slack · Responder una pregunta por Slack (Claude)».

## Configuración (una sola vez)

1. **Vercel:** agrega `SLACK_SIGNING_SECRET` en Production. El valor está en api.slack.com/apps › SellUp › Basic Information › Signing Secret.
2. **Slack › App Home:** activa **Messages Tab** y marca «Allow users to send Slash commands and messages from the messages tab».
3. **Slack › Event Subscriptions:**
   - Request URL: `https://sell-up-sage.vercel.app/api/integrations/slack/events`
   - Eventos del bot: `message.im` y `app_mention`.

## Código

- **Ruta:** `src/app/api/integrations/slack/events/route.ts`. Verifica la firma, responde 200 al instante y procesa en `after()`.
- **Carpeta:** `src/server/slack-assistant/`.
  - `events.ts`, `signature.ts` y `conversation.ts`: entrada y memoria.
  - `tools.ts` y `tool-types.ts`: herramientas por rol.
  - `query-helpers.ts`: reglas puras.
  - `data-source.server.ts`: datos comerciales con alcance.
  - `admin-data-source.server.ts`: datos de administración.
  - `links.ts`: enlaces directos.
  - `run.ts`: conversación con Claude.
  - `handle-question.server.ts`: el proceso de punta a punta.
