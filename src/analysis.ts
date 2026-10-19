import { sql, TABLES } from './db';
import { RULES, type Severity } from './rules';

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface Column {
  name: string;
  type: string; // DATA_TYPE de MySQL: int, varchar, date, datetime, decimal…
  nullable: boolean;
  auto: boolean; // AUTO_INCREMENT: no se pide al agregar datos
}

const MAX_ROWS = 100;
const MAX_IMPORT_ROWS = 1000;

export class UserError extends Error {}

export async function runFindings(): Promise<Finding[]> {
  return Promise.all(
    RULES.map(async (r) => {
      const rows = (await sql.unsafe(r.sql)) as Record<string, unknown>[];
      return {
        id: r.id,
        title: r.title,
        severity: r.severity,
        description: r.description,
        recommendation: r.recommendation,
        count: rows.length,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows: rows.slice(0, MAX_ROWS),
      };
    }),
  );
}

export async function tableCounts() {
  return Promise.all(
    TABLES.map(async (t) => {
      const [row] = await sql.unsafe(`SELECT COUNT(*) AS n FROM \`${t}\``);
      return { name: t, rows: Number(row.n) };
    }),
  );
}

const assertTable = (name: string) => {
  if (!(TABLES as readonly string[]).includes(name)) throw new UserError('tabla no permitida');
};

export async function columnsOf(table: string): Promise<Column[]> {
  assertTable(table);
  const rows = (await sql.unsafe(
    `SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS nullable, EXTRA AS extra
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [table],
  )) as { name: string; type: string; nullable: string; extra: string }[];
  return rows.map((r) => ({
    name: String(r.name),
    type: String(r.type).toLowerCase(),
    nullable: r.nullable === 'YES',
    auto: /auto_increment/i.test(String(r.extra ?? '')),
  }));
}

/** SELECT con fechas ya formateadas como texto (evita problemas de zona horaria en el cliente). */
export async function tableRows(table: string, limit = 200) {
  const cols = await columnsOf(table);
  const select = cols
    .map((c) =>
      c.type === 'date'
        ? `DATE_FORMAT(\`${c.name}\`, '%Y-%m-%d') AS \`${c.name}\``
        : c.type === 'datetime' || c.type === 'timestamp'
          ? `DATE_FORMAT(\`${c.name}\`, '%Y-%m-%d %H:%i:%s') AS \`${c.name}\``
          : `\`${c.name}\``,
    )
    .join(', ');
  return (await sql.unsafe(`SELECT ${select} FROM \`${table}\` ORDER BY 1 DESC LIMIT ${Math.min(Math.max(limit, 1), 1000)}`)) as Record<string, unknown>[];
}

/** '' → NULL; "2026-05-01T10:30" (datetime-local) → "2026-05-01 10:30:00". */
export function normalizeValue(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') throw new UserError('valores no válidos: solo texto, número o vacío');
  const s = v.trim();
  if (s === '') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(s);
  return m ? `${m[1]} ${m[2]}:${m[3] ?? '00'}` : s;
}

/** Inserta una o varias filas en una sola sentencia (atómico). Devuelve cuántas se insertaron. */
export async function insertRows(table: string, rows: unknown): Promise<number> {
  assertTable(table);
  if (!Array.isArray(rows) || rows.length === 0) throw new UserError('no hay filas para insertar');
  if (rows.length > MAX_IMPORT_ROWS) throw new UserError(`máximo ${MAX_IMPORT_ROWS} filas por importación`);
  const allowed = new Map((await columnsOf(table)).filter((c) => !c.auto).map((c) => [c.name, c]));

  const keys = Object.keys(rows[0] ?? {});
  if (!keys.length) throw new UserError('la primera fila no tiene columnas');
  const unknown = keys.filter((k) => !allowed.has(k));
  if (unknown.length) throw new UserError(`columnas desconocidas: ${unknown.join(', ')}`);

  const params: (string | number | null)[] = [];
  rows.forEach((r, i) => {
    if (typeof r !== 'object' || r === null) throw new UserError(`fila ${i + 1} inválida`);
    for (const k of keys) params.push(normalizeValue((r as Record<string, unknown>)[k]));
  });
  const one = `(${keys.map(() => '?').join(', ')})`;
  try {
    await sql.unsafe(
      `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')}) VALUES ${rows.map(() => one).join(', ')}`,
      params,
    );
  } catch (e) {
    // Errores de MySQL (columna obligatoria, FK inexistente, duplicado…) → mensaje para el usuario
    throw new UserError((e as Error).message);
  }
  return rows.length;
}
