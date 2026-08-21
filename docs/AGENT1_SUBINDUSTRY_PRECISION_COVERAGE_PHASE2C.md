# AGENT1-SUBINDUSTRY-PRECISION-COVERAGE-1 · PHASE 2C

**Ola 1 — nueve rule-sets de precisión en `confirm_only`.**
Estado: **9 de 9 candidatas registradas. Cobertura de precisión 2/73 → 11/73 (15.07 %).**
Ninguna en `full`. Las dos reglas históricas conservan **el 100 % de sus decisiones**.

Fases previas:
[PHASE 1](AGENT1_SUBINDUSTRY_PRECISION_COVERAGE_PHASE1.md) (PR #264, docs-only) ·
[PHASE 2A](AGENT1_SUBINDUSTRY_PRECISION_COVERAGE_PHASE2A.md) (PR #265, `8bb51c45`) ·
[PHASE 2B](AGENT1_SUBINDUSTRY_PRECISION_COVERAGE_PHASE2B.md) (PR #266, `7c2c784a`).

Base de esta fase: `origin/main` = `7c2c784a`.

---

## 1. Resultado

| | antes | después |
|---|--:|--:|
| Reglas de precisión | 2 | **11** |
| en `full` | 2 | 2 |
| en `confirm_only` | 0 | **9** |
| Cobertura de precisión | 2/73 (2.74 %) | **11/73 (15.07 %)** |
| Subindustrias sin mapeo | 71 | 62 |
| Cobertura de búsqueda | 73/73 | 73/73 (sin cambios) |

```
CANDIDATES_EVALUATED = 9
REGISTERED_NEW       = 9
DEFERRED             = 0
```

Las nueve alcanzaron `PRECISION_READY_CONFIRM_ONLY`. **No se bajó el estándar para
llegar a nueve**: dos de ellas obligaron a corregir el diseño antes de pasar (§ 4), y
el objetivo declarado del encargo era «hasta 9», no «9».

---

## 2. El hallazgo que cambió el diseño: los nombres del encargo no son los del catálogo

Cinco de las nueve candidatas se nombraron en el encargo con una abreviatura que **no
existe en el catálogo activo**. Lectura de sólo lectura de `active_industry_catalog`
en Producción (catálogo `1.0.0`, `e4675daf-…`):

| Encargo | Nombre canónico REAL | Industria padre |
|---|---|---|
| Banca Tradicional | `Banca Tradicional` ✅ | Servicios Financieros |
| **Farmacias Cadena** | `Farmacias Cadena y Retail de Salud` | Retail y Consumo |
| Medicina Prepagada y EPS | `Medicina Prepagada y EPS` ✅ | Salud |
| Universidades e Institutos Privados | `Universidades e Institutos Privados` ✅ | Educación |
| Ciberseguridad | `Ciberseguridad` ✅ | Tecnología |
| **Redes Hospitalarias** | `Redes Hospitalarias y Clínicas` | Salud |
| **Laboratorios Clínicos** | `Laboratorios Clínicos y Diagnóstico` | Salud |
| **Fabricantes de Alimentos y Bebidas** | `Fabricantes de Alimentos y Bebidas (FMCG)` | Retail y Consumo |
| **Escuelas de Negocios** | `Escuelas de Negocios y Formación Ejecutiva` | Educación |

**Por qué no es cosmético.** Desde PHASE 2A la identidad de precisión se resuelve por
**igualdad exacta** (id → canónico normalizado → alias explícito → `null`,
fail-closed). El wizard envía el nombre canónico del catálogo. Una regla declarada
como `Farmacias Cadena` **no resolvería nunca**: sería código muerto que aparenta
cobertura sin producir ni una confirmación, y el ratchet de cobertura la contaría.

Dos consecuencias de contenido, no sólo de forma:

- **`Redes Hospitalarias y Clínicas`** incluye clínicas. El § 15 del encargo pedía no
  asumir que «cualquier clínica individual» pertenece a la subindustria; el catálogo
  dice lo contrario — las clínicas están en la etiqueta. La regla las admite, y lo que
  se excluye es el hospital público, el proveedor y la clínica veterinaria.
- **`Escuelas de Negocios y Formación Ejecutiva`** incluye la formación ejecutiva. Por
  eso `executive education` / `formación ejecutiva` son anclas legítimas y no una
  invasión de «Formación Corporativa», que es una subindustria distinta.

---

## 3. Por qué las nueve son `confirm_only`, y qué implica en cómo están escritas

En `confirm_only` sólo la rama POSITIVA cruza al plano operativo. `ambiguous` y
`rejected` quedan como diagnóstico y **abstienen**. Eso invierte el coste de
equivocarse:

| | efecto |
|---|---|
| falso **negativo** | **gratis** — la regla se abstiene y la corrida queda exactamente como si no existiera |
| falso **positivo** | **cuesta** — `confirmed` puede contar hacia el objetivo |

De ahí la asimetría deliberada de las nueve reglas: **anclas estrechas, listas
negativas generosas**. Un término dudoso nunca es ancla; va a
`broadProviderIndustries` (sólo puede producir ambiguo) o a
`conflictingBusinessModels` (con ancla, ambiguo). Ampliar una lista negativa no puede
crear una confirmación falsa; ampliar las anclas sí.

Ninguna regla de la Ola 1 se promociona a `full` en este PR (§ 25), y el ratchet de la
suite falla si alguien lo intenta.

---

## 4. El defecto REAL que la fase encontró y corrigió

**La industria PADRE de Apollo confirmaba a la subindustria hija.**

`classifyDeclaredIndustry` comprueba las anclas contra la industria declarada, y el
matcher casa **subsecuencias de tokens**. Apollo asigna `hospital & health care` a
**toda** la salud: hospitales, EPS, laboratorios, farmacias. Con `hospital` como ancla
de una sola palabra, esa industria padre —por sí sola, sin ninguna otra señal—
confirmaba `Redes Hospitalarias y Clínicas`. Un laboratorio clínico, una EPS o una
cadena de farmacias quedaban confirmados como red hospitalaria.

Es exactamente el parent-only que los §§ 13, 15 y 17 prohíben, y habría producido
falsos positivos que **cuentan hacia el objetivo**.

**Corrección:** las anclas de `Redes Hospitalarias y Clínicas` son **sólo compuestas**
—`red hospitalaria`, `grupo hospitalario`, `hospital privado`, `clinica privada`,
`centro medico`, `hospital network`—, que son además las formas que el catálogo
publica como alias y términos. `hospital` y `clinica` a secas están fuera.

Coste aceptado y declarado: «Hospital San Vicente» en el nombre comercial ya no
confirma. En `confirm_only` ese falso negativo es inerte.

### El mismo defecto, del otro lado — y este estaba activo en tres reglas

Las listas de modelo de negocio (`exclusive`, `conflicting`) se comprueban contra
**todos** los campos clasificadores, **incluida la industria**. Así que un término
negativo de una sola palabra que sea token de la industria padre **bloquea todas las
confirmaciones** de su propia regla.

Medido: `Laboratorios Clínicos y Diagnóstico` declaraba `hospital` como conflicto. Un
laboratorio clínico cuya industria Apollo es `hospital & health care` —la
clasificación **más probable** para un laboratorio— entraba en conflicto **consigo
mismo**: con ancla quedaba `ambiguous`, y la regla no podía confirmar a nadie por esa
vía. Lo mismo, latente, en `Farmacias Cadena y Retail de Salud` y en
`Medicina Prepagada y EPS`.

**Corrección:** en las tres, los negativos de salud pasaron a forma compuesta
(`red hospitalaria`, `grupo hospitalario`, `hospital privado`, `clinica privada`,
`centro medico`). La regla derivada, que las nueve cumplen:

> Ningún término de una sola palabra que sea token de una industria AMPLIA de la
> propia regla puede aparecer en sus anclas ni en sus listas de modelo de negocio.

La suite lo fija por regla con un caso «industria PADRE + ancla ⇒ confirma» y otro
«industria PADRE sola ⇒ NO confirma».

---

## 5. Términos y alias que NO se promovieron (§§ 4 y 5)

`precisionAliases` está **vacío en las nueve**. Alias publicados revisados y
**rechazados** como identidad, uno a uno:

| Alias | Por qué no |
|---|---|
| `banco`, `bank` | una sola palabra genérica: «banco de alimentos», «banco de sangre». → AMPLIAS |
| `EPS` | tres letras; colisiona con poliestireno expandido y con *earnings per share*. Ni alias ni ancla |
| `CPG`, `FMCG alimentos`, `consumo masivo` | nombran la CATEGORÍA, no la fabricación (§ 17). → AMPLIAS |
| `protección de datos` | lo usan despachos de abogados y consultoras de cumplimiento tanto como las firmas de seguridad |
| `cybersecurity`, `infosec`, `seguridad informática` | inequívocos, pero entran como **anclas** (evidencia), no como identidad de la regla |
| `hospital privado`, `red hospitalaria` | entran como **anclas**; como identidad resolverían una etiqueta que el wizard no envía |

También fuera, por medición y no por gusto:

- **`SOC`** — casa dentro de «SOC 2», que cualquier SaaS declara.
- **`security`, `seguridad`, `software`, `IT`** — AMPLIAS (§ 14).
- **`laboratorio`, `laboratory`** — AMPLIAS (§ 16).
- **`higher education`, `education management`** — AMPLIAS (§ 13).
- **`professional training & coaching`** — el ÚNICO valor de proveedor observado para
  Escuelas de Negocios, y Prod lo reparte entre **tres** subindustrias (Formación
  Corporativa, Escuelas de Negocios, Certificación B2B). → AMPLIA (§ 7).

**Los `keyword` del catálogo son frases de consulta**, no anclas («droguerías cadena
retail farmacia», «corporativo banca empresas», «grupo hospitalario clínicas»).
Ninguna se promovió entera. Donde se extrajo un fragmento —`grupo hospitalario`,
`red de laboratorios`, `escuela de negocios`— fue por revisión manual del fragmento,
no partiendo la frase en tokens.

---

## 6. Vocabulario de proveedor (§ 7)

Sólo un valor observado en Prod respalda una regla de la Ola 1 con autoridad
`provider_industry`: **`banking`**, para Banca Tradicional. Es el positivo más fuerte
de la ola.

La separación que el § 7 exigía queda así:

| valor | tratamiento en Banca Tradicional |
|---|---|
| `banking` | **ancla** — confirma |
| `retail banking`, `commercial banking` | **ancla** (contienen `banking`) |
| `investment banking` | **contradictorio** + en conflicto |
| `capital markets` | **contradictorio** + en conflicto |
| `investment management` | **contradictorio** + en conflicto |
| `financial services` | **AMPLIO** — nunca confirma por sí solo |

Trampa evitada y documentada en el código: **`retail` a secas NO puede ser
contradictorio de Banca**, porque es token de `retail banking`, que es un POSITIVO.
Declararlo rechazaría a toda la banca minorista. Igual con `internet`, token de
«internet banking».

Para las otras ocho **no hay vocabulario de proveedor útil observado**, y la regla se
apoya en anclas textuales específicas. Queda declarado como límite. Dos usan un valor
estándar de Apollo verificable por su forma: `computer & network security`
(Ciberseguridad, vía el ancla `network security`) y `food production` (FMCG).

---

## 7. Paridad de las dos reglas `full` (§§ 1 y 22)

El arnés de paridad de PR #266 vivía en un scratchpad de sesión y **no está**. Se
reconstruyó uno nuevo, determinista, restringido por contrato a las etiquetas de las
dos reglas vigentes más etiquetas que ninguna ola mapea — **ninguna de las nueve
candidatas aparece**, porque si apareciera la diferencia sería el cambio buscado y el
arnés dejaría de medir regresión.

Cobertura del volcado, por candidato y por decisión:

- 16.384 comprobaciones del matcher puro (128 términos × 128 términos)
- 14.336 assessments (8 etiquetas × 14 campos del proveedor × 128 términos), cada uno
  con su metadata persistida, su pliegue sectorial sobre los 4 estados base, su
  `resolveCandidateSubindustryRequirement` y su elegibilidad hacia el objetivo
- 2.048 evaluaciones ANY-OF (128 combinaciones y permutaciones × 16 fixtures)
- 128 saneamientos de la lista pedida
- registro de identidad, claves de anclas y estructura de las dos reglas

```
TOTAL_RECORDS            32.901
BASELINE_GOLDEN_SHA      bbebebfb1c6c6ac9c2b95e73926e30dcbd2748c0ce09a6dc7db6232c487593c8   (cobertura 2/73)
POST_WAVE_GOLDEN_SHA     9bd56dc1afe0780d2bc03d443ffc5ff10363487ee04e015c6868d36da4097cab   (cobertura 11/73)

DECISION_ONLY_SHA        5f27fedef4e9c884b27f97657a669b4b5222463366ed3f53b6f83ccacf2d4a3f
                         IDÉNTICO antes y después · 32.898 registros
DECISION_DIFFERENCES     0
```

**Los ÚNICOS 2 registros que cambian son la declaración de cobertura** (`mapped_names`
y `counts`: 2 → 11). Todo lo demás —matcher, assessments, metadata, pliegue,
requirement, elegibilidad, ANY-OF, saneamiento, identidad, estructura— es **byte a
byte idéntico**. Cero fixtures existentes debilitadas.

Honestidad sobre el SHA histórico: **32.901 ≠ 49.973 y `bbebebfb…` ≠ `b49e8912…`**.
Son arneses distintos con enumeraciones distintas; el SHA absoluto no es comparable
entre ellos. Lo que prueba la regresión es la comparación BEFORE/AFTER **dentro** de
este arnés, y por eso el § 1 pedía no depender del SHA histórico. La cobertura de
partida sí se reprodujo de forma independiente: **2/73**.

---

## 8. Las nueve reglas

Todas: `mode: 'confirm_only'`, `precisionAliases: []`, `subindustryId: null`,
`catalogVersionId: null`, `anchorFamilies: null` (ninguna es etiqueta compuesta).

| Subindustria | Positivo más fuerte | Hermanas declaradas negativas | Parent-only que NO confirma |
|---|---|---|---|
| **Banca Tradicional** | `banking` (observado en Prod) | investment banking · capital markets · investment management · brokerage · neobank · core banking software | `financial services`, `finance`, `banca`, `banco`, `bank` |
| **Farmacias Cadena y Retail de Salud** | `cadena de farmacias`, `droguería` | laboratorio farmacéutico · distribuidor farmacéutico · farmacia hospitalaria · fabricante de medicamentos · red hospitalaria | `retail`, `pharmaceuticals`, `health care` |
| **Medicina Prepagada y EPS** | `medicina prepagada`, `entidad promotora de salud`, `ISAPRE` | seguro de vida · corredor de seguros · red hospitalaria · laboratorio clínico · reaseguro | `insurance`, `hospital & health care`, `health insurance` |
| **Universidades e Institutos Privados** | `universidad`, `institución de educación superior` | universidad corporativa · escuela de negocios · instituto técnico · universidad pública · edtech | `education`, `higher education`, `education management` |
| **Ciberseguridad** | `computer & network security` (vía `network security`), `ciberseguridad` | vigilancia privada · IT services · security & investigations · antivirus de consumo · integrador de sistemas | `software`, `information technology`, `security`, `seguridad` |
| **Redes Hospitalarias y Clínicas** | `red hospitalaria`, `grupo hospitalario` (**sólo compuestas**) | laboratorio clínico · EPS · cadena de farmacias · hospital público · software hospitalario · clínica veterinaria | `hospital & health care`, `health care`, `medical practice` |
| **Laboratorios Clínicos y Diagnóstico** | `laboratorio clínico`, `clinical laboratory` | laboratorio farmacéutico · red hospitalaria · universidad · laboratorio de investigación · laboratorio de alimentos | `laboratory`, `laboratorio`, `hospital & health care` |
| **Fabricantes de Alimentos y Bebidas (FMCG)** | `food production`, `fabricante de alimentos` | supermercado · distribuidor de alimentos · restaurantes · importador · agricultura | `food and beverages`, `consumer goods`, `manufacturing`, `consumo masivo`, `fmcg`, `cpg` |
| **Escuelas de Negocios y Formación Ejecutiva** | `escuela de negocios`, `business school`, `executive MBA` | formación corporativa · corporate training · universidad · plataforma LMS · consultora de gestión | `professional training & coaching`, `education`, `higher education` |

### Fronteras que se sostienen explícitamente

- **FMCG ⟷ Supermercados / Tiendas por Departamento (§ 17).** `food production` y
  `fabricante de alimentos` son hoy contradicciones declaradas de «Tiendas por
  Departamento». Un fabricante pedido junto a ella queda **rechazado** por esa regla
  `full` y **confirmado** por la nueva; el ANY-OF resuelve a `confirmed`, que es el
  desenlace correcto y el caso que el § 20 exige probar.
- **Escuelas de Negocios ⟷ Formación Corporativa (§§ 18 y 21).** Formación
  Corporativa sigue **sin mapeo por decisión**. Sus términos se declaran en conflicto
  en la regla de Escuelas para que la superposición **abstenga** en vez de confirmar.
- **Redes Hospitalarias ⟷ Laboratorios ⟷ EPS ⟷ Farmacias.** Las cuatro comparten la
  industria padre `hospital & health care`. Cada una declara a las otras tres como
  negativas en forma compuesta (§ 4).

---

## 9. `Formación Corporativa` sigue fuera (§ 21)

`Formación Corporativa y Corporate Training` **no está registrada**. Sigue siendo
buscable y revisable, y no obtiene mapeo de precisión, ni auto-confirmación, ni conteo
hacia el objetivo.

Es la subindustria con **más demanda observada sin mapear** —13 búsquedas reales, la
más pedida de las 71— y el catálogo la marca «competencia o referente de UBITS». La
decisión de dejarla fuera es de la dueña del producto, no del diseño, y está fijada
por dos ratchets.

Efecto secundario útil: es ahora el ejemplo canónico de «cubierta por búsqueda, sin
precisión» en tres suites que antes usaban `Ciberseguridad` — que dejó de servir
porque la Ola 1 le dio regla.

---

## 10. Observabilidad (§ 24)

Todo lo que el § 24 pide para analizar una corrida live y decidir la promoción a
`full` **ya es observable**, sin campos nuevos:

| Necesidad | Dónde |
|---|---|
| veredicto DIAGNÓSTICO (`confirmed`/`ambiguous`/`rejected`) | `subindustry_match`, y por selección en `per_requested_subindustry_evaluations` |
| contribución OPERATIVA (contribuir / abstenerse) | `projectOperationalSubindustryVerdict` |
| `matchedRequestedSubindustry` | `matched_requested_subindustry` |
| señales usadas | `subindustry_evidence[]` (término + campo exacto + fuente) |
| motivo | `verdict_reason`, `classification_source`, `disqualifying_signals` |
| motivo de revisión, ambigua vs rechazada | `subindustryBlockingReason` |

**`precision_mode` NO se persiste, y es deliberado.** El modo es code-owned y vive en
el registro versionado en git; persistirlo crearía un **segundo source of truth** que
podría divergir del registro tras una promoción a `full` —justo lo que el § 24
prohíbe— y rompería la paridad byte a byte que el § 22 exige. No hace falta: el
metadata ya nombra la regla que confirmó y su veredicto, y el modo se lee del
registro. Hay una prueba que fija esta ausencia como decisión, no como olvido.

---

## 11. Lo que esta fase NO hace

- No promociona ninguna regla a `full` (§ 25).
- No registra `Formación Corporativa` (§ 21).
- No promueve ningún alias del catálogo a identidad de precisión (§ 5).
- No lee `subindustry_rules.configuration` en runtime, no cambia `execution_layer`, no
  edita el catálogo `1.0.0`, no publica reglas (§ 26).
- No añade migraciones ni toca RLS/privilegios.
- No toca los topes de la corrida (search ≤ 2, resultados/ronda ≤ 10, crudos ≤ 20,
  enrichments ≤ 5, créditos ≤ 25).
- No toca el evaluador ni el resolvedor: **cero líneas** de lógica nueva. Las nueve
  reglas son datos que el evaluador genérico ya sabía interpretar, que era la promesa
  de PHASE 2B.
- No toca `record_origin`, el candidate writer, LinkedIn/`employee_count`,
  presupuesto, provider routing, HubSpot ni Agente 2A.

---

## 12. Archivos

| Archivo | Cambio |
|---|---|
| `src/server/agents/prospecting-toolkit/apollo-subindustry-precision-rule-sets.ts` | **+9 rule-sets** `confirm_only`; el registro concatena la Ola 1 DESPUÉS de las dos `full` para no mover su orden |
| `src/server/agents/prospecting-toolkit/__tests__/agent1-subindustry-precision-wave1-1.test.ts` | **nuevo** — 117 pruebas |
| `src/server/agents/prospecting-toolkit/__tests__/fixtures/sellup-subindustry-catalog-names.ts` | `SELLUP_SUBINDUSTRIES_WITH_PRECISION_{FULL,CONFIRM_ONLY,MAPPING}` |
| `…/__tests__/agent1-subindustry-precision-ruleset-registry-1.test.ts` | ratchets 2 → 11; modos por regla |
| `…/__tests__/agent1-subindustry-precision-mixed-mode-anyof-1.test.ts` | § 15: 2 `full` intactas + 9 `confirm_only` |
| `…/__tests__/agent1-subindustry-key-resolution-hardening-1.test.ts` | cobertura 11/73, 62 sin mapeo; ejemplo sin mapeo → Formación Corporativa |
| `…/__tests__/agent1-catalog-source-of-truth-addendum-1.test.ts` | ejemplo sin precisión → Formación Corporativa |
| `…/__tests__/agent1-multi-subindustry-catalog-coverage-addendum-1.test.ts` | ídem, + prueba de que Ciberseguridad sí obtuvo precisión sin alterar discovery |
| `package.json` | `test:a1-subindustry-precision-wave1` |
| `.github/workflows/automatic-routing-tests.yml` | el paso entra al check obligatorio |

**Cero** cambios en el evaluador, el resolvedor, el runner o el contrato de
completitud.

---

## 13. Verificación

```
test:a1-subindustry-precision-wave1                424 pruebas · 424 pass · 0 fail
test:a1-subindustry-precision-ruleset-registry     339 pruebas · 339 pass · 0 fail
test:a1-subindustry-key-resolution-hardening       368 pruebas · 368 pass · 0 fail
test:a1-multi-subindustry-query-drafting-anyof     286 pruebas · 286 pass · 0 fail
test:a1-multi-subindustry-request-observability     76 pruebas ·  76 pass · 0 fail
test:agent2a:automatic-routing                      50 pruebas ·  50 pass · 0 fail

typecheck   sin errores
eslint      0 errores · 0 warnings NUEVOS (2 preexistentes, confirmados contra la base)
build       producción OK
```

---

## 14. Seguridad

```
Apollo               0 llamadas
Tavily               0 llamadas
Lusha                0 llamadas
Escrituras en Prod   0        (sólo lecturas de catálogo, SELECT)
HubSpot              0
Presupuesto          0 cambios
Créditos             0
Migraciones          0
QA live              ninguna
Flags                ninguno activado
```

Todo el módulo es puro: sin I/O, sin env, sin reloj.

---

## 15. Lo que sigue

**No** es promoción a `full`. Antes hace falta una corrida controlada que produzca
`confirmed` reales de estas nueve y revisión humana de cada uno
(`false_confirm_rate = 0` es el criterio del § 13 de PHASE 1). La observabilidad del
§ 10 es exactamente lo que esa revisión necesita leer.

Pendiente y declarado:

- **Ola 2** (14 candidatas de PHASE 1) tras validar la Ola 1.
- **Phase C2** — `catalogVersionId` sigue `null`; cargar `subindustry_rules` en runtime
  va después de validar la Ola 1 code-owned.
- **Vocabulario de proveedor** — sólo 10 etiquetas observadas en Prod, ninguna de
  `organizations_search`. Ocho de las nueve reglas no tienen valor de proveedor
  observado que las respalde.
- **Formación Corporativa** — decisión de producto, no de diseño.
