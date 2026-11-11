# Asistente de SellUp en Slack — fase 1 (sólo consulta)

Cualquier persona **activa** en SellUp puede escribirle por mensaje directo al bot de SellUp en Slack, o mencionarlo en un canal (`@SellUp …`). El bot le responde con datos de SellUp.

## Qué responde

El bot lee con los mismos permisos que la persona tiene en SellUp:

- **Administrador:** ve toda la plataforma.
- **Líder o manager:** ve lo suyo y lo de su equipo (su grupo y sus reportes).
- **Vendedor o Growth:** ve sólo lo suyo.

| Herramienta | Qué lee |
|---|---|
| `mi_resumen` | Empresas activas por estado, prospectos por revisar, búsquedas en curso y contactos. |
| `buscar_empresas` | Empresas por nombre, dominio o NIT: estado, país, industria, responsable y número de contactos. |
| `contactos_de_empresa` | Contactos de una empresa: nombre, cargo, correo, teléfono y LinkedIn. |
| `ultimas_busquedas` | Búsquedas recientes: estado, país, industria, meta y candidatos por estado. |
| `uso_de_ia` | Consultas y costo por proveedor: hoy, últimos 7 días o el mes en curso (hora de Bogotá). |

**No escribe nada.** Si alguien le pide crear, aprobar, descartar, asignar o buscar empresas nuevas, el bot explica que eso se hace en SellUp y comparte el enlace. Las acciones con confirmación serán la fase 2.

Cada pregunta queda registrada en **Uso de IA** con su costo, como «Asistente de Slack · Responder una pregunta por Slack (Claude)». El costo esperado es de US$0,01 a US$0,05 por pregunta.

Si Claude no tiene saldo, el bot responde: «No pude responder. Claude se quedó sin créditos…».

## Configuración (una sola vez)

1. **Vercel:** agrega la variable `SLACK_SIGNING_SECRET` en Production. El valor está en api.slack.com/apps › SellUp › Basic Information › App Credentials › Signing Secret.
2. **Slack › App Home:** activa **Messages Tab** y marca «Allow users to send Slash commands and messages from the messages tab».
3. **Slack › Event Subscriptions** (sólo con el código ya desplegado en Prod):
   1. Enable Events: **On**.
   2. Request URL: `https://sell-up-sage.vercel.app/api/integrations/slack/events`. Debe aparecer **Verified**.
   3. En *Subscribe to bot events*, agrega `message.im` y `app_mention`.
   4. Pulsa **Save Changes**. Si Slack pide reinstalar la app, acepta.

## Cómo funciona

- **Ruta:** `src/app/api/integrations/slack/events/route.ts`. Verifica la firma de Slack, responde 200 al instante y atiende la pregunta en `after()`. Los reintentos de Slack (`x-slack-retry-num`) se ignoran. Esta ruta está excluida del proxy de sesión; la protege la firma.
- **Código:** `src/server/slack-assistant/`.
  - `events.ts`: qué pide cada evento.
  - `signature.ts`: verificación de la firma.
  - `tools.ts`: herramientas de sólo lectura.
  - `run.ts`: conversación con Claude.
  - `data-source.server.ts`: consultas filtradas por alcance.
  - `handle-question.server.ts`: el proceso de punta a punta.
- **Identidad:** el correo de Slack (`users.info`) se busca en `internal_users`. Si la persona no existe o está inactiva, el bot se lo dice y no responde datos.
- **Alcance:** `resolveCommercialScopeForUser`, en `src/modules/access/commercial-scope-core.server.ts`. Es la misma regla de la plataforma, sin depender de una sesión.
