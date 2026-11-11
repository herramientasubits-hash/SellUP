# Asistente de SellUp en Slack

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

## Acciones con confirmación (fase 2)

El bot **propone** y la persona **confirma con un botón**. Claude nunca ejecuta nada por su cuenta.

| Acción | Qué hace al confirmar | La misma acción que… |
|---|---|---|
| `proponer_aprobar` | Aprueba prospectos de «Por revisar»: pasan a Empresas y se crean o enlazan en HubSpot | el botón «Aprobar» de Prospectos (`approveAndConvertPendingReviewCandidateAction`) |
| `proponer_descartar` | Descarta con **motivo obligatorio** (catálogo de motivos; «otro» exige detalle) | «Descartar» de Prospectos (`discardPendingReviewCandidateAction`) |
| `proponer_asignar` | Asigna prospectos o empresas a una persona activa | «Asignar a…» (`assignCandidatesToUser` / `assignAccountsToUser`) |

**Cómo funciona:**
1. **Propuesta:** el bot encuentra los elementos por nombre, NIT, dominio, búsqueda o país, **sólo dentro del alcance** de quien pregunta, y publica un mensaje con **Confirmar** y **Cancelar**.
   - Máximo 25 elementos por propuesta.
   - Marca los posibles duplicados y lo que ya está en HubSpot: al confirmar, la persona confirma también esas advertencias, como en el panel.
2. **Quién puede confirmar:** **sólo quien pidió** y dentro de **30 minutos**. Si otra persona pulsa, sólo ella recibe el aviso y el mensaje no cambia.
3. **Ejecución:** con **la sesión de esa persona**, una sesión prestada de un solo uso (`src/lib/supabase/borrowed-session.server.ts`, el mismo mecanismo que la búsqueda masiva en el servidor). Así las acciones de la plataforma aplican **sus** permisos (por ejemplo, un vendedor no aprueba posibles duplicados), registran la auditoría a **su** nombre, sincronizan HubSpot y avisan a quien recibe una asignación.
4. **Resultado:** se **lee de la base**, no sólo de la respuesta de la acción, y reemplaza el mensaje con los botones. Un segundo clic no repite nada.

Cualquier otra acción (cambiar estados, buscar empresas, pedir teléfonos, Rumbo…) todavía no se hace por Slack: el bot remite a la pantalla de SellUp.

**Memoria:** antes de responder, lee los mensajes anteriores del hilo o de la conversación directa: hasta 12 y no más de 6 horas atrás. Ignora los avisos con botones.

**Enlaces:** llevan a la pantalla exacta, por ejemplo Por revisar con el país ya filtrado, Descartadas, la ficha de la empresa, una búsqueda resaltada, Uso de IA, Usuarios, el Catálogo de fuentes o Presupuesto.

Cada pregunta queda en **Uso de IA** como «Asistente de Slack · Responder una pregunta por Slack (Claude)».

### Más acciones con confirmación

| Acción | Quién | Qué hace al confirmar |
|---|---|---|
| `proponer_recordatorio` | Cualquiera, a su equipo (administrador: a cualquiera) | Le manda a la persona, de tu parte, lo que tiene por revisar (con datos del momento) y tu nota |
| `proponer_etapa` | Responsable (alcance) | Mueve empresas de etapa con motivo (`moveAccountStage`, como el Flujo de prospección) |
| `proponer_nota` | Responsable (alcance) | Deja una nota en la ficha (`moveAccountStage` con nota, misma etapa) |
| `proponer_acceso` | Sólo administradores | Activa o desactiva accesos (`bulkReactivate` / `bulkSuspend`; al activar llega el Slack de «ya puedes entrar») |
| `proponer_rumbo` | Responsable (alcance) | Rumbo prepara el primer contacto de UNA empresa: canales elegidos (llamada por defecto), objetivo «conseguir reunión», sus 2 contactos principales. Gasta IA |
| `proponer_buscar_contactos` | Responsable (alcance) | Busca contactos de hasta 3 empresas (Apollo → Lusha). Gasta créditos |

**Quedan fuera de Slack, a propósito:**
- **Lanzar búsquedas de empresas nuevas.** Necesita los criterios del catálogo y la reserva de presupuesto del asistente; el bot explica cómo hacerlo en SellUp.
- **Pedir teléfonos.** Las guardas del código sólo permiten revelar teléfonos desde sus archivos dedicados.

## Guía de uso (`ayuda_sellup`)

Son 20 fichas escritas desde el código, en `src/server/slack-assistant/help/topics/`:
- importar, buscar y sus modos, búsqueda masiva, competidores, proveedores, árbol, búsquedas y lotes por ID;
- revisar, descartadas, contactos, LinkedIn o correo, teléfonos;
- Rumbo, Flujo de prospección, Uso de IA, presupuesto, solicitudes de créditos, usuarios, ROI y el propio asistente.

**Cómo se usan:**
- El bot responde **sólo** con estas fichas. Si no hay ficha, dice que no está documentado y no inventa.
- **Por rol:** a quien no puede usar la función le dice quién la usa, sin darle los pasos.
- **Por interruptores:** cada ficha declara sus flags (`requiere`). Si alguno está apagado en Prod, el bot responde que la función no está activa.
- **Guarda:** `slack-assistant-help.test.ts` exige que toda «etiqueta» citada exista tal cual en su archivo. Si se renombra un botón, la prueba falla.

## Avisos por Slack

Todos llegan también a la campanita, con un botón a la pantalla.

| Aviso | A quién | Cuándo | Interruptor |
|---|---|---|---|
| Te asignaron empresas o prospectos | Quien recibe | Al asignar (en la plataforma o desde Slack) | `SELLUP_SLACK_NOTIFICATIONS=off` apaga todos |
| Solicitud de créditos, con botones **Dar N créditos** y **Rechazar** | Aprobadores | Al abrirse la solicitud | ídem |
| Respuesta a tu solicitud | Quien pidió | Al decidirse | ídem |
| Tu búsqueda terminó o falló (empresas o contactos) | Quien la lanzó | Al cerrar la corrida, si duró 45 s o más; una vez | ídem |
| Proveedor sin créditos o con la llave rechazada | Administradores | En el momento, una vez al día por proveedor | `SELLUP_SLACK_COST_ALERTS=off` |
| Proveedor pasó el 80 % o el 100 % de la cuota del mes, con el día proyectado de agotamiento | Administradores | Proceso diario, 8:15 a. m. de Bogotá; una vez por umbral y mes | `SELLUP_SLACK_COST_ALERTS=off` |
| Tus empresas por revisar | Quien lo tenga encendido en Configuración | Lunes a viernes, 8:15 a. m. | Configuración › Avisos de Slack (apagado por defecto) |
| Boletín (diario, semanal, mensual, trimestral) | Según Configuración (semanal: admin, líderes, managers) | 8:15 a. m. del día que toca | Configuración › Avisos de Slack |

**Detalles técnicos:**
- **Proceso diario:** los avisos programados corren en el cron de las 8:15 (`apollo-round-continuation`), porque los 2 crons del plan están ocupados. Sólo corren si `SLACK_SIGNING_SECRET` existe.
- **Botones de créditos:** al pulsarlos se decide con la sesión de quien pulsa, usando `decideCreditApproval`, que comprueba que sea aprobador o administrador.
- **Presupuesto:** las alertas **sólo leen**; nunca tocan el presupuesto.

## Configuración › Avisos de Slack (migración 165)

**Reglas por rol y por persona** (tabla `slack_notification_settings`):
- Cada aviso del catálogo (`src/modules/notifications/notification-catalog.ts`) se enciende o apaga por rol, y cada persona puede tener su propia regla.
- **Prioridad:** la regla de la persona, si no la del rol y, si no, el valor por defecto.
- **Alcance:** un aviso que no aplica al rol (por ejemplo, las alertas de consumo para un vendedor) nunca le llega.
- **La campanita no cambia:** estas reglas sólo deciden si el aviso también llega por Slack.

**Boletín:**
- **Frecuencias:** diario (lun–vie, cubre el día hábil anterior; el lunes cubre de viernes a domingo), semanal (lunes, semana anterior), mensual (día 1) y trimestral (1 de enero, abril, julio y octubre). Una persona puede tener varias.
- **Por defecto:** el semanal está encendido para administradores, líderes y managers; el resto, apagado.
- **Contenido:** el equipo de quien lo recibe y, en cascada, el de sus reportes, según el organigrama (`manager_id`). Los sub-equipos son cada reporte directo con toda su cascada.
- **Secciones:**
  - lectura ejecutiva con semáforo;
  - pulso del período contra el anterior (▲▼ y 🟢🔴);
  - tasa de aprobación antes y ahora;
  - embudo (encontradas → aprobadas → con contactos → primer contacto preparado → usado);
  - por equipo, con barras;
  - a quién acompañar (pendientes de más de 7 días y personas sin actividad);
  - cierre.
- **Dinero:** sólo lo ven administradores y líderes; los demás ven créditos.
- **Cuándo se envía:** cada mañana en el cron de las 8:15. Una sola vez por persona, frecuencia y período.
- **Historial:** cada envío queda en `slack_bulletin_deliveries`, con su modelo, para volver a verlo igual.
- **Pantalla:** `/settings/notifications` (sólo administradores), con tres pestañas: «Avisos» (matriz por rol y reglas por persona), «Boletín» (vista previa gráfica de la persona y frecuencia que elijas, y «Enviármelo por Slack») e «Historial».
- **Sin la migración 165 aplicada,** todo sigue funcionando con los valores por defecto y la pantalla avisa que no se puede guardar.
- **Variables que ya no se usan:** `SELLUP_SLACK_DAILY_REMINDERS` y `SELLUP_SLACK_WEEKLY_SUMMARY`. El recordatorio diario y el boletín se encienden desde la pantalla.

## Configuración (una sola vez)

1. **Vercel:** agrega `SLACK_SIGNING_SECRET` en Production. El valor está en api.slack.com/apps › SellUp › Basic Information › Signing Secret.
2. **Slack › App Home:** activa **Messages Tab** y marca «Allow users to send Slash commands and messages from the messages tab».
3. **Slack › Event Subscriptions:**
   - Request URL: `https://sell-up-sage.vercel.app/api/integrations/slack/events`
   - Eventos del bot: `message.im` y `app_mention`.
4. **Slack › Interactivity & Shortcuts** (para los botones de confirmar y de créditos):
   - Interactivity: **On**.
   - Request URL: `https://sell-up-sage.vercel.app/api/integrations/slack/interactions`
   - Save Changes.

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
  - `action-proposal.ts`, `action-resolver.server.ts`, `action-verify.ts` y `execute-action.server.ts`: acciones con confirmación.
- **Ruta de los botones:** `src/app/api/integrations/slack/interactions/route.ts`. Verifica la firma, responde 200 y ejecuta en `after()`.
