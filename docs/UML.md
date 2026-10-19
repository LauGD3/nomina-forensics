# Diagramas UML (genéricos)

Mermaid: se ve en GitHub/GitLab, VS Code (Markdown Preview Mermaid) o <https://mermaid.live>. Ajústalos leyendo `db/init/01-schema.sql`, `src/rules.ts` y `web/App.tsx`.

## 1. Casos de uso

```mermaid
flowchart LR
  A([Analista forense])
  Au([Auditor interno])
  subgraph Consola forense de nómina
    U1(Revisar hallazgos)
    U2(Ver evidencia de una regla)
    U3(Explorar tablas de la BD)
    U4(Añadir o ajustar reglas SQL)
    U5(Agregar un registro)
    U6(Importar CSV)
  end
  A --> U1 & U2 & U3 & U4 & U5 & U6
  Au --> U1 & U2
  U6 -. similar a .-> U5
  U2 -. extiende .-> U1
```

## 2. Componentes / despliegue

```mermaid
flowchart LR
  subgraph Navegador
    React[web/App.tsx\nReact]
  end
  subgraph Bun[Proceso Bun · src/server.ts]
    API[Rutas /api/*]
    An[analysis.ts]
    R[rules.ts\nreglas SQL]
  end
  subgraph Docker[Docker Compose]
    PG[(MySQL 8.0\nnomina)]
    Init[[db/init/*.sql]]
  end
  React -->|fetch JSON| API --> An --> R
  An -->|Bun.sql / mysql| PG
  Init -.crea esquema y datos.-> PG
```

## 3. Modelo de datos (clases / ER)

```mermaid
classDiagram
  class employees {
    id PK
    full_name
    national_id
    department
    bank_account
    address
    salary
    hire_date
    termination_date
    created_by
  }
  class payroll_payments {
    id PK
    employee_id FK
    period
    gross
    net
    bank_account
    paid_at
  }
  class attendance { id PK; employee_id FK; ts }
  class file_access {
    id PK
    ts; user_name; user_department
    employee_id FK
    doc_type; action; ip
  }
  class audit_log {
    id PK
    ts; actor; action
    table_name; record_id
    field; old_value; new_value
    approved_by
  }
  employees "1" --> "*" payroll_payments
  employees "1" --> "*" attendance
  employees "1" --> "*" file_access
  audit_log ..> employees : record_id
```

## 4. Clases de la aplicación

```mermaid
classDiagram
  class Rule {
    id; title; severity
    description; recommendation
    sql
  }
  class Finding {
    id; title; severity
    count; columns[]; rows[]
  }
  class Analysis {
    runFindings()
    tableCounts()
    tableRows(name)
    columnsOf(name)
    insertRows(name, rows)
  }
  Analysis ..> Rule : ejecuta RULES
  Analysis --> Finding : produce
```

## 5. Secuencia: cargar hallazgos

```mermaid
sequenceDiagram
  actor Analista
  participant UI as React (App.tsx)
  participant S as server.ts
  participant A as analysis.ts
  participant DB as Postgres
  Analista->>UI: Abre la consola
  UI->>S: GET /api/findings
  S->>A: runFindings()
  loop por cada regla en RULES
    A->>DB: sql.unsafe(rule.sql)
    DB-->>A: filas de evidencia
  end
  A-->>S: Finding[]
  S-->>UI: JSON
  UI-->>Analista: KPIs y reglas con evidencia
```

## 6. Secuencia: agregar datos (formulario o CSV)

```mermaid
sequenceDiagram
  actor Analista
  participant UI as AddData.tsx
  participant S as server.ts
  participant A as analysis.ts
  participant DB as MySQL
  UI->>S: GET /api/tables/:name/columns
  S->>A: columnsOf(name)
  A->>DB: information_schema.COLUMNS
  DB-->>UI: columnas (tipo, obligatoria, auto)
  Analista->>UI: Rellena el formulario o pega un CSV
  UI->>S: POST /api/tables/:name {rows}
  S->>A: insertRows(name, rows)
  A->>A: validar tabla y columnas, normalizar valores
  A->>DB: INSERT ... VALUES (?,?), (?,?) (una sentencia)
  alt éxito
    DB-->>UI: 201 {inserted: n}
    UI-->>Analista: ✔ n fila(s) agregada(s) y tabla recargada
  else error de MySQL (FK, NOT NULL, duplicado)
    DB-->>UI: 400 {error}
    UI-->>Analista: ✖ mensaje de la base
  end
```

## 7. Actividad: añadir una regla

```mermaid
flowchart TD
  A([Nueva sospecha]) --> B[Escribir SELECT que devuelva la evidencia]
  B --> C[Probarlo con psql contra la BD]
  C --> D[Añadir objeto a RULES en src/rules.ts]
  D --> E[Añadir caso en tests/rules.test.ts]
  E --> F{bun test pasa?}
  F -- no --> B
  F -- sí --> G([La UI la muestra sola])
```
