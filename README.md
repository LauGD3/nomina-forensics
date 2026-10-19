# Consola forense · Nómina y Recursos Humanos

Investiga fraude en nómina sobre una base de datos **MySQL 8** (en Docker Compose) y permite **agregar datos** desde la propia interfaz.

| Regla | Detecta |
|---|---|
| paid-after-termination | Pagos a empleados dados de baja |
| payment-other-account | Pago a una cuenta distinta de la registrada |
| unapproved-changes | Cambios sin aprobación o autoaprobados |
| shared-bank-account / ghost-no-activity | Empleados fantasma (cuenta compartida, sin presencia laboral) |
| duplicate-payment | Pagos duplicados en el mismo período |
| salary-spike | Aumentos salariales atípicos (> 30 %) |
| unauthorized-file-access | Expedientes consultados desde áreas no autorizadas |
| mass-download | Descargas masivas de documentos |
| off-hours-changes / off-hours-access | Cambios y accesos fuera de horario laboral |

## Arrancar

Requisitos: [Bun](https://bun.sh) ≥ 1.2.21 (cliente MySQL integrado) y Docker.

```bash
bun install
bun run db:up      # MySQL en localhost:3307, con esquema y datos de ejemplo ya cargados
bun run dev        # abre http://localhost:3000
bun test           # prueba reglas e inserciones contra la BD
```

Otros: `bun run db:reset` (borra el volumen y recarga los datos de ejemplo), `bun run db:down`.
Configuración opcional en `.env` (ver `.env.example`): `DATABASE_URL` (`mysql://usuario:clave@host:3307/nomina`), `PORT`.
Acceso directo a la BD: `docker exec -it nomina-db mysql -uforense -pforense nomina`.

## Agregar datos

Pestaña **Datos (ver y agregar)** → elige la tabla:

- **Un registro:** formulario generado a partir de las columnas reales de la tabla (`*` = obligatoria; fechas con selector).
- **Importar CSV:** sube o pega un CSV; la primera fila son los nombres de columna. Fechas `AAAA-MM-DD`, fecha y hora `AAAA-MM-DD HH:MM:SS`; una celda vacía = `NULL`. Máx. 1000 filas por importación y la carga es **atómica** (si una fila falla no se inserta ninguna).

Los errores de la base (campo obligatorio, `employee_id` inexistente, `national_id` duplicado…) se muestran tal cual en pantalla.
Tras guardar, vuelve a **Hallazgos**: las reglas se recalculan con los datos nuevos.

También por API: `POST /api/tables/employees` con `{"rows":[{"full_name":"…","national_id":"…", …}]}`.

## Cómo está organizado (todo es pequeño a propósito)

```
docker-compose.yml      solo MySQL
db/init/01-schema.sql   tablas
db/init/02-seed.sql     datos SINTÉTICOS con anomalías sembradas (se ejecuta al crear el contenedor)
src/rules.ts            ★ las reglas: cada una es un SELECT (MySQL) + metadatos. Aquí se añade/ajusta todo.
src/analysis.ts         ejecuta reglas, lista tablas/columnas e inserta filas (con validación)
src/server.ts           Bun.serve: API JSON + sirve la web (un solo proceso)
web/App.tsx             interfaz React (hallazgos + explorador de tablas)
web/AddData.tsx         formulario por tabla + importación CSV
tests/rules.test.ts     comprueba cada anomalía sembrada y las inserciones
docs/UML.md             diagramas UML genéricos (Mermaid)
```

Notas de diseño: las columnas de fecha son `DATETIME` en hora local de la empresa (sin zonas horarias) y las consultas devuelven las fechas ya formateadas como texto, para que no cambien según el navegador.

## Usar tus propios datos

- Carga registros con la interfaz (arriba), o
- reemplaza el contenido de `db/init/02-seed.sql` y ejecuta `bun run db:reset`, o
- apunta `DATABASE_URL` a una **copia** de tu base de nómina con las mismas columnas (o adapta los SELECT de `src/rules.ts`).

## Ajustar una regla

Los umbrales están arriba de `src/rules.ts` (`WORK_START`, `WORK_END`, `SALARY_SPIKE`, `MASS_DOWNLOADS_PER_HOUR`, `ALLOWED_DEPARTMENTS`).

## Notas

- Los datos de ejemplo son ficticios; cualquier parecido con personas reales es casual.
- Las reglas son indicios para investigar, no prueba de fraude: confirme cada caso con RR. HH., Finanzas y el empleado.
- Trabaje con copias de la evidencia y respete la normativa de protección de datos personales aplicable.
- **Seguridad:** la app no tiene autenticación y permite *agregar* (no borrar ni editar) datos. No la exponga fuera de su equipo/red de confianza. Las credenciales de `docker-compose.yml` son solo de desarrollo.
- Forense: lo agregado por la interfaz **no** genera registros en `audit_log`; si quiere trazabilidad de quién cargó qué, regístrelo como filas de `audit_log`.
