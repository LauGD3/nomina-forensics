import { useEffect, useState } from 'react';
import AddData, { type Column } from './AddData';

type Severity = 'critical' | 'high' | 'medium' | 'low';
interface Finding {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  count: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

const SEV: Record<Severity, string> = { critical: 'Crítico', high: 'Alto', medium: 'Medio', low: 'Bajo' };

/** Formatea cualquier valor de celda (fechas ISO legibles). */
const cell = (v: unknown) => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.replace('T', ' ').slice(0, 19).replace(' 00:00:00', '') : s;
};

function DataTable({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{cell(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsView() {
  const [data, setData] = useState<Finding[] | null>(null);
  const [error, setError] = useState('');
  const [onlyHits, setOnlyHits] = useState(true);

  useEffect(() => {
    fetch('/api/findings')
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setData(j.findings)))
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="error">No se pudo consultar la base de datos: {error}<br />¿Ejecutaste <code>bun run db:up</code>?</p>;
  if (!data) return <p>Analizando…</p>;

  const hits = data.filter((f) => f.count > 0);
  const total = (s: Severity) => hits.filter((f) => f.severity === s).length;
  return (
    <>
      <div className="kpis">
        {(['critical', 'high', 'medium'] as Severity[]).map((s) => (
          <div key={s} className={`kpi ${s}`}><b>{total(s)}</b><span>Reglas de severidad {SEV[s].toLowerCase()}</span></div>
        ))}
        <div className="kpi"><b>{data.length - hits.length}</b><span>Reglas sin hallazgos</span></div>
      </div>
      <label className="check">
        <input type="checkbox" checked={onlyHits} onChange={(e) => setOnlyHits(e.target.checked)} /> Mostrar solo reglas con hallazgos
      </label>
      {data
        .filter((f) => !onlyHits || f.count > 0)
        .map((f) => (
          <details key={f.id} className={`finding ${f.count ? f.severity : 'ok'}`}>
            <summary>
              <span className={`badge ${f.severity}`}>{SEV[f.severity]}</span> {f.title}
              <span className="count">{f.count ? `${f.count} fila(s)` : 'sin hallazgos'}</span>
            </summary>
            <p>{f.description}</p>
            <p><b>Recomendación:</b> {f.recommendation}</p>
            {f.count > 0 && <DataTable columns={f.columns} rows={f.rows} />}
            {f.count > f.rows.length && <p className="muted">Mostrando {f.rows.length} de {f.count}.</p>}
          </details>
        ))}
    </>
  );
}

function TablesView() {
  const [tables, setTables] = useState<{ name: string; rows: number }[]>([]);
  const [name, setName] = useState('employees');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [tick, setTick] = useState(0); // se incrementa al agregar datos para recargar

  useEffect(() => {
    fetch('/api/tables').then((r) => r.json()).then(setTables).catch(() => {});
  }, [tick]);
  useEffect(() => {
    fetch(`/api/tables/${name}`).then((r) => r.json()).then((j) => setRows(Array.isArray(j) ? j : [])).catch(() => setRows([]));
  }, [name, tick]);
  useEffect(() => {
    fetch(`/api/tables/${name}/columns`).then((r) => r.json()).then((j) => setColumns(Array.isArray(j) ? j : [])).catch(() => setColumns([]));
  }, [name]);

  return (
    <>
      <div className="tabs">
        {tables.map((t) => (
          <button key={t.name} className={t.name === name ? 'active' : ''} onClick={() => setName(t.name)}>
            {t.name} <em>{t.rows}</em>
          </button>
        ))}
      </div>
      {columns.length > 0 && <AddData table={name} columns={columns} onDone={() => setTick((n) => n + 1)} />}
      <p className="muted">Últimas {rows.length} filas (más recientes primero).</p>
      {rows.length > 0 && <DataTable columns={Object.keys(rows[0])} rows={rows} />}
    </>
  );
}

export default function App() {
  const [tab, setTab] = useState<'findings' | 'tables'>('findings');
  return (
    <div className="app">
      <h1>Consola forense · Nómina y RR. HH.</h1>
      <p className="muted">Empleados fantasma · cambios no autorizados · accesos anómalos a expedientes</p>
      <nav>
        <button className={tab === 'findings' ? 'active' : ''} onClick={() => setTab('findings')}>Hallazgos</button>
        <button className={tab === 'tables' ? 'active' : ''} onClick={() => setTab('tables')}>Datos (ver y agregar)</button>
      </nav>
      {tab === 'findings' ? <FindingsView /> : <TablesView />}
    </div>
  );
}
