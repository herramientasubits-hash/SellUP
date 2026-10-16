# Agente 3 — Investigar la empresa y preparar la primera llamada

**Track:** AGENT3 · **Hito:** AGENT3-FIRST-CALL-1 · **Bandera:** `ENABLE_AGENT3_FIRST_CALL` (apagada por defecto) · **Migración:** 153

## Qué es

Es el tercer agente del Sales Engine. La numeración oficial está en el doc 21, § 9 de la estrategia, y en `docs/Source/08`, `09` y `10`. Por decisión de la dueña (16-10), el agente **investiga la empresa él mismo** para la primera llamada. Así absorbe la «inteligencia de cuenta» que el Agente 2/2A, que sólo cubre decisores, nunca construyó.

El vendedor pulsa **«Preparar primera llamada»** en la ficha de la empresa (o «Preparar llamada» en la ficha del contacto), elige decisor, canal, objetivo y, si quiere, un producto. Recibe dos cosas:

1. **Ficha de investigación** (pestaña «Inteligencia»). Contiene hechos con cita literal y fuente, señales con fecha, hipótesis para UBITS y lo que no se encontró. Vale 30 días: otro decisor o canal no paga otra investigación.
2. **Paquete de primera llamada** (pestaña «Primera llamada»). Contiene la razón para llamar, el guion de 45 a 60 segundos, el mensaje corto para el canal, las preguntas, las objeciones con respuesta, el siguiente paso y los avisos de cuidado.

## Cómo funciona

```
Controles (alcance comercial, presupuesto, otra investigación en curso)
→ ¿ficha vigente? sí → redactar
                  no → investigar en cascada:
                       SellUp (clasificación verificada del Agente 1, tamaño, listas curadas, árbol, HubSpot, decisor)
                       → sitio oficial (portada + hasta 5 páginas: nosotros, empleo, prensa, sostenibilidad, sedes)
                       → Tavily: noticias del último año + empleo/talento (2 créditos)
                       → búsqueda web de Claude (≤2) sólo si faltan noticias o página de empleo
                     → Claude extrae hechos con cita → verificador sin IA (la cita tiene que estar en el texto)
→ Claude redacta el paquete → verificador sin IA (cifras con fuente, largo por canal, frases prohibidas,
  sin teléfonos ni correos) → si falla, una corrección → si sigue fallando, «Revisar antes de usar»
→ todo se guarda con su costo; Uso de IA lo muestra como «Agente 3 · Primera llamada»
```

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
| Biblioteca de UBITS (v1, borrador) | `ubits-messaging-library.ts` |
| Ruta | `src/app/api/agent3/first-call/route.ts` (máx. 300 s; las llamadas a Claude se cortan a los 250 s) |
| Lecturas y acciones | `src/modules/speech/actions.ts` |
| Interfaz | `src/components/first-call/*`, ficha de empresa y de contacto |
| Tablas | `account_research_briefs`, `first_call_packs` (migración 153) |

## Reglas que no se negocian

- **Ninguna cifra sin fuente.** Cada número del paquete tiene que estar en un hecho de la ficha o en la biblioteca. Los datos de la ficha sólo pueden repetir las cifras de su cita.
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
| Paquete | ~US$0,05 |

La primera vez cuesta US$0,10 a 0,25 por empresa. Un paquete extra con la ficha vigente cuesta unos US$0,05. `AGENT3_EXTRACTION_MODEL` (opcional) permite usar un modelo más barato para la investigación.

## Pendiente de la dueña

1. **Aprobar la biblioteca de UBITS** (`ubits-messaging-library.ts`): productos, cifras con fuente y respuestas a objeciones. Hoy es un borrador armado con lo que el repo documenta. Su única cifra es un referente de industria (ATD 2026).
2. **Aplicar la migración 153** en Producción y **encender** `ENABLE_AGENT3_FIRST_CALL` en Vercel, primero para una prueba con 10 a 15 empresas reales.
3. Compartir el texto de la Gem de speech y del Skill unificado para afinar las instrucciones.

## Pruebas

- `npm run test:agent3-first-call`: piezas puras y recorrido completo con fuentes y modelo simulados.
- `npm run test:agent3-first-call:postgres`: la 153 en PostgreSQL real, leída como `authenticated`.
