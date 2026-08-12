# AGENT1-APOLLO-HEALTH-DISCOVERY-QUALITY-1 — seguimiento

> Documento de SEGUIMIENTO. Ningún cambio de este hito
> (`AGENT1-APOLLO-BOOTSTRAP-PURCHASE-GATE-THREADING-1`) toca la redacción de
> consultas ni los términos de búsqueda. Se escribe aquí para que el hallazgo no
> se pierda, no para actuar sobre él.

## El hecho

La calidad del descubrimiento de Salud es **VERY_WEAK**, y la prueba es dura:

- **RUN 1** (`f4c8a60f`, subindustrias `Redes Hospitalarias y Clínicas`,
  `Laboratorios Clínicos y Diagnóstico`, `Medicina Prepagada y EPS`)
- **RETEST** (`74a49b01`, con `Laboratorios Clínicos y Diagnóstico` sustituida por
  `Laboratorios Farmacéuticos`)

devolvieron **exactamente las mismas 20 empresas**, con solape 20/20 y 0
diferencias, pese a haber cambiado una de las tres keywords específicas.

Los términos de subindustria son, por tanto, **INERTES**: lo que manda en el OR de
`q_organization_keyword_tags` es `healthcare` / `health` junto a
`organization_locations=colombia`.

Las 20: PwC, AstraZeneca, Novo Nordisk, Huawei, Philip Morris, Deloitte, Chubb,
Kuehne+Nagel, Postobón, Coomeva, BAT, Alpina, Colombina, Amazon, AJE, Cruz Verde,
Gloria (PE), Cushman & Wakefield, Colsubsidio, Davivienda. Alrededor de **15 de 20
son irrelevantes para Salud**.

De los 5 que la selección eligió para enrichment, **3 habrían sido crédito
quemado**: Philip Morris, Deloitte y Kuehne+Nagel. Sólo AstraZeneca y Novo Nordisk
son farmacéuticas reales.

## Por qué NO se arregla en este PR

El bloqueo dominante era arquitectónico: la autorización de bootstrap no llegaba al
gate que guarda la compra, así que la corrida no podía comprar evidencia ni aunque
la cohorte hubiera sido perfecta. Ese defecto se corrige aquí.

Mezclar en el mismo PR un cambio de redacción de consultas haría imposible
atribuir el resultado de la siguiente corrida live a una causa u otra: no se sabría
si mejoró porque ahora se compra o porque se pregunta distinto.

## Alcance del seguimiento

1. Por qué los términos específicos de subindustria no mueven el resultado del
   proveedor, medido sobre el request EFECTIVO, no sobre la hipótesis.
2. Si `healthcare` / `health` deben salir del OR cuando hay términos específicos.
3. Cómo se mide «relevancia de la cohorte» sin gastar otra corrida live.

## Límite adicional observado (no es de este hito)

`Laboratorios Farmacéuticos`, la subindustria que el retest pidió, **no tiene regla
de precisión** (cobertura 11/73 tras #268: 2 `full` + 9 `confirm_only`). Aunque el
enrichment se compre y traiga clasificación, una hija sin regla no puede
confirmarse, así que la vía de admisión de #276 no se activa para ella. La suite
`test:a1-apollo-bootstrap-purchase-gate-threading` fija ese límite como hecho
declarado (§ 9), y su cierre pertenece a la cobertura de Wave 1.
