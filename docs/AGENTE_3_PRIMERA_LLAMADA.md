# Agente 3 — Investigar la empresa y preparar el primer contacto

**Track:** AGENT3 · **Hito:** AGENT3-FIRST-CALL-1 · **Bandera:** `ENABLE_AGENT3_FIRST_CALL` (apagada por defecto) · **Migración:** 153

## Qué es

Es el tercer agente del Sales Engine. La numeración oficial está en el doc 21, § 9 de la estrategia, y en `docs/Source/08`, `09` y `10`. Por decisión de la dueña (16-10), el agente **investiga la empresa él mismo** para la primera llamada. Así absorbe la «inteligencia de cuenta» que el Agente 2/2A, que sólo cubre decisores, nunca construyó.

El vendedor pulsa **«Preparar primer contacto»** y el agente se abre en el panel «Agente IA» (el mismo de los Agentes 1 y 2A). Elige, con casillas:

- **decisores** (hasta 5, o «Sin decisor»);
- **canales** (llamada, WhatsApp, correo, LinkedIn);
- el **objetivo**;
- **productos de UBITS** (los del menú de la plataforma, o «El que mejor conecte»).

Todo queda en una sola pestaña de la empresa, **«Primer contacto»**:

1. **La investigación**: hechos con cita literal y fuente, señales con fecha, hipótesis para UBITS y lo que no se encontró. Vale 30 días: otro decisor o canal no paga otra investigación.
2. **Lo preparado y lo que falta**: una tabla decisor × canal. Cada celda vacía prepara justo eso, y «Preparar lo que falta» marca todo lo pendiente.
3. **Las preparaciones, agrupadas por decisor**: la razón para contactarlo hoy, el guion (sólo en llamada), el mensaje del canal, las preguntas, las objeciones con respuesta, el siguiente paso y los avisos. Cada una admite «Otra versión» (opcional: qué se quiere distinto), y la anterior se conserva.

## Cómo funciona

```
Controles (alcance comercial, presupuesto, otra investigación en curso)
→ ¿ficha vigente? sí → redactar
                  no → estado «Investigación en curso» → investigar en cascada:
                       SellUp (clasificación verificada del Agente 1, tamaño, listas curadas, árbol, HubSpot)
                       → sitio oficial (portada + hasta 5 páginas: nosotros, empleo, prensa, sostenibilidad, sedes)
                       → Tavily: noticias del último año + empleo/talento (2 créditos)
                       → búsqueda web de Claude (≤2) sólo si faltan noticias o página de empleo
                     → Claude extrae hechos con cita → verificador sin IA (la cita tiene que estar en el texto)
→ por cada decisor elegido (de a 2 en paralelo): UNA llamada al redactor con su cargo, los canales y los productos
  → un mensaje por canal, todos con el mismo ángulo → verificador sin IA por canal → si falla, una corrección
  → una preparación por decisor × canal (el costo de la llamada se reparte entre sus canales)
→ con al menos una preparación: estado «Lista para contacto» (el estado sólo avanza, nunca retrocede)
→ todo se guarda con su costo; Uso de IA lo muestra como «Agente 3 · Primer contacto»
```

**Ejemplo:** 2 decisores × 3 canales = 1 investigación + 2 llamadas al redactor = 6 preparaciones.

Principio (el mismo del Agente 1): **el modelo propone, las herramientas verifican y la persona decide.**

## Archivos

| Pieza | Dónde |
|---|---|
| Orquestador (sin E/S) | `src/server/agents/first-call/run-first-call.ts` |
| Dependencias reales | `src/server/agents/first-call/run-first-call.server.ts` |
| Hechos internos | `internal-facts.ts` |
| Páginas del sitio | `site-pages.ts`, `research-documents.ts` |
| Noticias (Tavily) | `news-search.ts` |
| Investigación: instrucciones y verificación | `research-prompt.ts`, `research-verifier.ts` |
| Redacción: instrucciones y verificación | `writer-prompt.ts`, `pack-verifier.ts` |
| Cifras con fuente | `numbers.ts` |
| Biblioteca de UBITS (v2, borrador: productos del menú de la plataforma) | `ubits-messaging-library.ts` |
| Estado de la empresa | `account-status.ts` (sólo avanza) |
| Asistente (pasos, cobertura, pedido) | `src/modules/speech/first-contact-wizard.ts` |
| Ruta | `src/app/api/agent3/first-call/route.ts` (máx. 300 s; las llamadas a Claude se cortan a los 250 s) |
| Lecturas y acciones | `src/modules/speech/actions.ts` |
| Interfaz | `src/components/first-call/*` (panel del agente, pestaña «Primer contacto»), ficha de empresa y de contacto |
| Tablas | `account_research_briefs`, `first_call_packs` (migración 153) |

## Dónde está conectado

Con la bandera encendida, el agente se ofrece donde se actúa sobre una empresa o un contacto. Siempre abre el mismo panel «Agente IA» y el resultado vive en la pestaña «Primer contacto».

| Lugar | Qué hay |
|---|---|
| Página de la empresa | «Preparar primer contacto» en la cabecera y la pestaña «Primer contacto» (los enlaces viejos `?tab=inteligencia` y `?tab=primera-llamada` llegan ahí) |
| Panel lateral de la empresa | En el pie, todo a la derecha: «Más acciones», «Preparar primer contacto» y «Buscar contactos». El panel se cierra y se abre el agente (nunca dos paneles a la vez); «Ver el primer contacto» lo vuelve a abrir en esa pestaña |
| Lista de Empresas | «Preparar primer contacto» en el menú de la fila y en la barra de selección (una empresa) |
| Lista de Contactos | En el menú de la fila (ese decisor ya marcado) y en la barra de selección: **varios decisores de la misma empresa** (hasta 5) |
| Panel y página del contacto | «Preparar primer contacto» (lleva a la empresa con ese decisor elegido) |
| **Pipeline** | Etapa 3: estado, datos con fuente, fuentes, vigencia, resumen, «Qué encontró» por pregunta, hipótesis con su producto y preguntas sin respuesta. Etapa 4: decisores preparados, preparaciones, usadas y para revisar; cada decisor con sus canales (lista, revisar o falta) y productos; «Preparar lo que falta» y «Preparar otro». La barra de acciones y «Mover de etapa» también abren el agente |
| Etapa actual y filtros del Pipeline | Una empresa con una preparación usable cuenta como «Lista para contacto» (etapa «Preparación y contacto»), aunque se haya preparado antes de que el agente moviera el estado solo |
| Actividad, pestaña «Agentes» e historial del Pipeline | Lo que hizo el agente y lo que se hizo con su resultado |
| Uso de IA | «Por agente» con selector (chips y tarjetas). El Agente 1 ya no tiene pestaña propia: al elegirlo aparece su panel (`?agente=agent1`; `?tab=agente-1` sigue funcionando) |
| Presupuesto y créditos | Créditos de Tavily (1 por búsqueda básica si Tavily no informa), costo con la tarifa vigente (sin tarifa queda «desconocido», nunca 0) y la verificación de presupuesto de Tavily |

**El estado ya no se cambia a mano.** El menú «Más acciones» de la empresa y el menú de la fila ya no traen «Cambiar estado» ni «Marcar como…». El Agente 3 deja «Investigación en curso» al empezar a investigar y «Lista para contacto» con la primera preparación. Lo registra en el historial como un cambio de estado de quien lo pidió, con `by: 'agent3'`.

Desde la lista de Empresas no se ofrece en acciones **masivas** sobre varias empresas: cada una gasta su propia investigación.

## Reglas que no se negocian

- **Ninguna cifra sin fuente.** Cada número de un texto tiene que estar en los hechos que **ese texto cita**, o en la biblioteca. Así no se cuela una comparación entre hechos que miden cosas distintas. Los datos de la ficha sólo pueden repetir las cifras de su cita.
- **Nada de experiencia inventada.** Frases como «trabajamos con bancos como ustedes», «nuestros clientes…» o «casos de éxito» quedan marcadas para revisar.
- Si se conoce el nombre del decisor, el mensaje lo saluda por su nombre; «[nombre]» sólo aparece si falta.
- Los dolores se escriben como pregunta o hipótesis, nunca como hecho.
- **No se usan** Computrabajo, Indeed ni LinkedIn automatizado (decisión del 08-10). Del decisor sólo se usa información profesional pública.
- No envía mensajes ni escribe en HubSpot (HubSpot sólo se lee).
- No investiga en automático: sólo cuando alguien pulsa el botón. Respeta el tope de «Presupuesto y créditos» de Anthropic y de Tavily.

## Costo estimado

| Concepto | Estimado |
|---|---|
| Lectura del sitio | Gratis |
| Tavily (2 búsquedas `basic`) | 2 créditos |
| Investigación con el modelo activo | US$0,05 a 0,15 |
| Búsquedas web de Claude, sólo si hacen falta | US$0,01 c/u |
| Cada decisor (todos sus canales en una llamada) | ~US$0,015 a 0,05 |

La primera vez cuesta US$0,10 a 0,25 por empresa. Cada decisor más, con la ficha vigente, cuesta unos US$0,015 a 0,05.

La corrida real de Davivienda (17-10) costó **US$0,098**: investigación US$0,084 en 35 s y preparación US$0,014 en 20 s. `AGENT3_EXTRACTION_MODEL` (opcional) permite usar un modelo más barato para la investigación.

## Revisión de la primera corrida real (Davivienda, 17-10)

**Lo bueno**

- Encontró la señal correcta: la integración de Scotiabank (Colombia, Costa Rica y Panamá), con cuatro noticias.
- Encontró los programas de talento del informe anual 2025 (Academia Vibra, 15.000 personas; Techcamp).
- El guion usó esos datos y nombró el programa de la empresa.
- 11 datos con fuente, 12 fuentes y 6 descartados por no tener cita verificable.

**Lo que salió mal y se corrigió en este cambio**

| Qué pasó | Corrección |
|---|---|
| «Pasó de 509 a 653 sucursales»: compara dos fuentes que miden cosas distintas (oficinas en Colombia frente a la región tras la integración) | Las cifras de un texto deben estar en los hechos que ese texto cita, y la regla está en las instrucciones |
| «Trabajamos con bancos que pasaron por lo mismo», «bancos como ustedes»: experiencia de UBITS que nadie respalda | El verificador lo marca y las instrucciones lo prohíben |
| «Buenos días [nombre]» aunque el decisor era Fabián Martínez | El verificador lo marca y las instrucciones piden saludar por el nombre |
| Una objeción nombró «SAP SuccessFactors», que no está en la ficha | Las instrucciones prohíben nombrar herramientas de la empresa que no estén en la ficha |
| El informe anual (ir.davivienda.com) quedó como «Noticia» | Un subdominio de la empresa es «Sitio oficial · Informe» o «Publicación» |
| «Tamaño registrado: 25000» | «Unos 25.000 empleados (tamaño registrado en SellUp)» |
| La integración quedó como «tamaño» y la señal reciente fue el recinto DAVIarena (dato de Wikipedia, sin fecha) | Reglas para clasificar: una adquisición o integración es la señal reciente; la señal reciente necesita una fuente con fecha; se prefiere lo que sirve para hablar con RR. HH. sobre patrocinios y eventos |
| La educación financiera para obreros de la construcción quedó como «talento» | Formar a clientes o comunidades no es talento de la empresa |

## Pendiente de la dueña

1. **Aprobar la biblioteca de UBITS** (`ubits-messaging-library.ts`): productos, cifras con fuente y respuestas a objeciones.
   - Los productos ya siguen el menú de la plataforma: Selección, Aprendizaje, Desempeño y cultura, Herramientas. «Créditos» no se ofrece.
   - La frase de cada módulo es un borrador escrito a partir de su nombre: hay que confirmarla.
   - «Orbit» no está incluido: falta saber qué es.
   - La única cifra es un referente de industria (ATD 2026).
2. (Hecho 16-10) Migración 153 aplicada y `ENABLE_AGENT3_FIRST_CALL` encendida. Falta la prueba con 10 a 15 empresas reales.
3. Compartir el texto de la Gem de speech y del Skill unificado para afinar las instrucciones.

## Pruebas

- `npm run test:agent3-first-call`: piezas puras, la cascada con varias selecciones, el verificador con los casos de Davivienda, el asistente y la cobertura, y el recorrido completo con fuentes y modelo simulados.
- `npm run test:agent3-first-call:postgres`: la 153 en PostgreSQL real, leída como `authenticated`.
- `npm run test:ui-experience`: incluye las pantallas del Pipeline con el agente (`pipeline-first-call-runtime`) y el panel de la empresa.
