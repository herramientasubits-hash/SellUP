# Agente 3 (Rumbo) · fuentes por país, estilo y contexto

**Fecha:** 19-10-2026 · **Pedido de la dueña:** una investigación robusta y verificable (catálogos por país e industria, fuentes propias de la empresa, LinkedIn y búsqueda general en la web) y mensajes que suenen naturales en cada país.

## Qué hace Rumbo ahora al investigar una empresa

Todas las búsquedas van por Tavily en modo `basic`, que cuesta 1 crédito. Para buscar dentro de ciertos sitios se usa `include_domains`, porque Tavily no admite `site:`. Ningún sitio de estas listas se descarga fuera de la búsqueda.

| Búsqueda | Dónde busca | Para qué |
|---|---|---|
| `noticias` | Toda la web, últimos 12 meses (sin redes, portales de empleo ni directorios) | Lo que le pasó a la empresa, con fecha |
| `talento` | Toda la web (mismos filtros) | Empleo, formación y cultura |
| `prensa` | Medios del sector de la empresa, prensa de negocios del país y prensa regional (modo `news`) | Noticias locales con fecha |
| `medios_talento` | Medios de RR. HH. del país y rankings de empleadores, como Merco, GPTW o Top Employers (modo `news`) | Premios, programas y cultura |
| `sitio_propio` | Solo el dominio de la empresa (noticias, blog, comunicados, sostenibilidad) | Lo que la empresa cuenta de sí misma |
| `linkedin` | Solo el fragmento del buscador de la página de la empresa (`/company/`) | Cultura y talento (nunca se abre linkedin.com) |

**Lo que se ajustó tras medir (banco de 10 empresas, 19-10):**
- Solo el modo `news` de Tavily trae la fecha de publicación. Por eso la prensa y los medios de talento usan ese modo.
- Las vacantes en portales de selección dieron 0 datos en 10 empresas, así que se quitaron.
- Las publicaciones `/posts/` de LinkedIn suelen ser de personas, así que solo se usa la página de la empresa.
- A Claude le llegan como mucho 6 documentos por búsqueda y 24 en total.
- El respaldo de búsqueda web de Claude se enciende cuando no hay ninguna noticia con fecha.
- El registro de uso guarda cuántos datos se propusieron, por qué se descartaron y de qué tipo de fuente venían.

Total por empresa: hasta 6 créditos de Tavily, frente a 2 de antes.

**Interruptor:** con `AGENT3_EXTENDED_RESEARCH=off` en Vercel se vuelve a las dos búsquedas de antes. Si no se define, la búsqueda ampliada queda encendida.

**Decisor:** además de sus búsquedas de siempre, Rumbo lo busca en la prensa y en los medios de RR. HH. de su país, donde salen nombramientos, ponentes y premios. De ahí solo sirve un resultado que nombre a la persona y también a la empresa, para dejar fuera a los homónimos. Lo encontrado se reutiliza durante 14 días; «Investigar de nuevo» lo vuelve a buscar.

**Merco y GPTW:** la empresa se reconoce aunque el nombre no sea idéntico. Por ejemplo, «Davivienda Colombia» coincide con «BANCO DAVIVIENDA». Se compara el núcleo del nombre, sin el país ni prefijos como «Banco» o «Grupo», y nunca por una sola palabra suelta.

## Cuando no hay Tavily (créditos agotados, sin llave o sin presupuesto)

Claude hace el trabajo de Tavily con su búsqueda web.

**Empresa:**
- Hasta 5 búsquedas, sin redes ni portales de empleo, siguiendo el mismo plan de preguntas, con los medios del país por nombre.
- Lee enteros hasta 5 artículos (`web_fetch`).
- Antes de entregar, escribe lo encontrado citando los resultados. Así cada cita (`cited_text`) se puede comprobar.
- La fecha de cada resultado sale de su `page_age`.

**Decisor:**
- 3 búsquedas y 2 lecturas.
- Una frase de su propio perfil de LinkedIn vale aunque no repita su nombre.
- Los directorios de datos personales (rocketreach y similares) nunca son fuente.

Medido el 19-10 en 10 empresas reales, sin escribir nada en Producción:

| | Con Tavily | Sin Tavily (antes) | Sin Tavily (ahora, Haiku) | Sin Tavily (Sonnet) |
|---|---|---|---|---|
| Datos verificados | 70 | 28 | 45–51 | 30 |
| Con fecha | 39 | 11 | 27–32 | 16 |
| Empresas con señal reciente | 8 | 1 | 6 | 4 |
| Empresas con datos del decisor | 5 | 0 | 1 | 0 |
| Costo de investigar | US$0,62 + créditos | US$1,27 | US$2,10–2,46 | US$3,87 |

- **Sonnet no ayuda:** busca menos, entrega menos y cuesta casi el doble. Se queda Haiku.
- **El decisor sigue débil sin Tavily:** casi nunca hay nada público de la persona fuera de LinkedIn, y Tavily sí busca dentro de LinkedIn.
- **Para comparar el respaldo:** `--tavily=off` en el banco (`scripts/agent3/research-eval.mts`); `--extraction-model` prueba otro modelo.

## Catálogo por país

El catálogo está en `src/server/agents/first-call/research-catalog-data.ts`. Los dominios salen de las investigaciones del 19-10-2026. Cada uno se abrió y estaba activo; la gran mayoría mostró una nota fechada en 2025 o 2026, y unos pocos gremios, activos pero sin fecha visible, quedaron marcados en los informes.

| País | Prensa de negocios | Industrias con medio propio | Medios de talento | Fuentes del decisor |
|---|---|---|---|---|
| Argentina (AR) | 9 | 11/12 | 4 | 6 |
| Bolivia (BO) | 11 | 12/12 | 3 | 7 |
| Brasil (BR) | 8 | 12/12 | 5 | 6 |
| Chile (CL) | 7 | 12/12 | 2 | 5 |
| Colombia (CO) | 11 | 12/12 | 11 | 9 |
| Costa Rica (CR) | 8 | 9/12 | 4 | 6 |
| República Dominicana (DO) | 8 | 1/12 | 2 | 5 |
| Ecuador (EC) | 11 | 12/12 | 5 | 8 |
| España (ES) | 6 | 11/12 | 7 | 6 |
| Guatemala (GT) | 8 | 9/12 | 3 | 5 |
| Honduras (HN) | 8 | 6/12 | 3 | 7 |
| México (MX) | 13 | 12/12 | 10 | 11 |
| Nicaragua (NI) | 7 | 7/12 | 1 | 4 |
| Panamá (PA) | 8 | 6/12 | 3 | 6 |
| Perú (PE) | 12 | 12/12 | 6 | 8 |
| Paraguay (PY) | 6 | 7/12 | 2 | 3 |
| El Salvador (SV) | 6 | 4/12 | 2 | 6 |
| Estados Unidos (US) | 8 | 12/12 | 7 | 6 |
| Uruguay (UY) | 4 | 11/12 | 3 | 4 |
| Venezuela (VE) | 11 | 12/12 | 4 | 8 |

Además, en todos los países se busca en prensa regional (Bloomberg Línea, AméricaEconomía, Forbes Centroamérica, BNamericas, Infobae, Expansión) y en rankings de empleadores (Merco, Great Place to Work, Top Employers, DCH, RRHHDigital).

**Dominios descartados al verificar (no entran):**
- Secuestrados o con contenido ajeno: revistadelogistica.com, informepastran.com, cadexco.net, fidagh.org y sna.cl (con enlaces de apuestas).
- Sin DNS o caídos: greatplacetowork.com.gt y greatplacetowork.com.cr, agexport.org.gt (AGEXPORT está en export.com.gt), los gremios cancelados de Nicaragua (COSEP y otros), bpro.com.co y elobservador.cr (el medio está en observador.cr).
- Desactualizados: copal.org.ar, capasu.org.py, aparh.org.py, ser-colombia.org y cifarma.org.py.
- Sin relación con RR. HH.: achipec.org, que es de periodismo científico y no la asociación chilena de RR. HH.

## Estilo por país

Está en `src/server/agents/first-call/country-style.ts`. Sale del estudio de estilo de primer contacto (datos de Gong, Lavender y Hunter; HubSpot España; Hofstede y Erin Meyer) y de las guías de cada país.

- **Igual en todos los países:** el primer contacto va de «usted»; el verificador marca el tuteo y el voseo. También va un hecho concreto de la empresa al inicio, un solo pedido, signos de apertura («¿», «¡») y nada de frases de plantilla («me encantaría», «sinergias», «solución integral», «no dude en»…).
- **Lo que cambia por país:**
  - qué tan directo ser: Argentina y España son directos; Guatemala, el más indirecto;
  - cuánta cortesía antes del motivo;
  - títulos: «doctora» por teléfono en Colombia; Lic./Ing. en México solo si están en el cargo; ningún título en España;
  - el saludo y el permiso: «¿me regala 30 segundos?» en Colombia, «¿me permite…?» en México y en el resto;
  - palabras que en ese país suenan a otro, que el verificador marca. Ejemplos: «platicar» fuera de México y Centroamérica, «licenciado» en Colombia, «agendar» o «celular» en España, «ahorita» en casi todos.

**Pendiente de decisión de la dueña:** en Brasil lo natural es escribir en portugués, y en EE. UU. en inglés (salvo roles regionales de Latinoamérica). Hoy todo sale en español con el tono del país, porque escribir en otro idioma depende de que el vendedor lo hable.

## Normas de formación por país

Están en `src/server/agents/first-call/country-training-context.ts`. Solo entra lo verificado en una fuente oficial o en prensa con fecha:
- México: NOM-035, DC-3, el estímulo del Plan México y la jornada de 40 horas.
- Chile: la franquicia SENCE y la Ley Karin.
- Brasil: la NR-1, con riesgos psicosociales.
- España: FUNDAE y el RD 723/2026.
- Argentina: la Ley Micaela.
- Perú: la Ley 29783 y el reglamento de hostigamiento sexual.
- Ecuador: SECAP.
- Venezuela: INCES.
- Costa Rica: el Convenio 190.
- República Dominicana: la responsabilidad penal de las empresas.
- Paraguay: SINAFOCAL.

Rumbo las usa como contexto o como pregunta, nunca para decir que la empresa incumple. Lo que quedó marcado «por verificar» (aportes de INTECAP, INFOP, INSAFORP e INA, entre otros) no entra hasta confirmarlo.

## Huecos para una segunda pasada

La búsqueda web de las investigaciones se agotó a mitad de la tarea. Quedan pendientes:
- Merco Talento por país (merco.info redirige en bucle).
- La asociación de RR. HH. de Uruguay (ADPU) y la de Bolivia.
- Las normas de Colombia, Centroamérica y Ecuador que quedaron «por verificar».
- Medios de salud en Uruguay y de servicios en Paraguay.
- Más industrias para República Dominicana y El Salvador.
