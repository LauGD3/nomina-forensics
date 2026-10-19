import { useState } from 'react';

export interface Column {
  name: string;
  type: string;
  nullable: boolean;
  auto: boolean;
}

/** Parser CSV mínimo (comillas dobles, comas y saltos de línea). La primera fila es el encabezado. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x !== '')) rows.push(row);
  const [head, ...rest] = rows;
  return head ? rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] ?? '']))) : [];
}

const inputType = (t: string) =>
  t === 'date' ? 'date' : t === 'datetime' || t === 'timestamp' ? 'datetime-local' : /int|decimal|numeric|float|double/.test(t) ? 'number' : 'text';

async function post(table: string, rows: unknown[]) {
  const res = await fetch(`/api/tables/${table}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? 'error desconocido');
  return j.inserted as number;
}

export default function AddData({ table, columns, onDone }: { table: string; columns: Column[]; onDone: () => void }) {
  const [mode, setMode] = useState<'form' | 'csv'>('form');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [csv, setCsv] = useState('');
  const fields = columns.filter((c) => !c.auto);

  const run = async (rows: unknown[]) => {
    try {
      const n = await post(table, rows);
      setMsg({ ok: true, text: `✔ ${n} fila(s) agregada(s) a ${table}` });
      onDone();
      return true;
    } catch (e) {
      setMsg({ ok: false, text: `✖ ${(e as Error).message}` });
      return false;
    }
  };

  return (
    <section className="add">
      <h3>Agregar datos a <code>{table}</code></h3>
      <div className="tabs">
        <button className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>Un registro</button>
        <button className={mode === 'csv' ? 'active' : ''} onClick={() => setMode('csv')}>Importar CSV</button>
      </div>

      {mode === 'form' ? (
        <form
          key={table}
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const data = Object.fromEntries(fields.map((c) => [c.name, (f.elements.namedItem(c.name) as HTMLInputElement).value]));
            if (await run([data])) f.reset();
          }}
        >
          {fields.map((c) => (
            <label key={c.name}>
              <span>{c.name}{!c.nullable && ' *'} <small>({c.type})</small></span>
              <input name={c.name} type={inputType(c.type)} step={c.type === 'decimal' ? '0.01' : undefined} required={!c.nullable} />
            </label>
          ))}
          <button type="submit">Guardar</button>
        </form>
      ) : (
        <div className="csv">
          <p className="muted">
            Primera fila = nombres de columna. Columnas de esta tabla: <code>{fields.map((c) => c.name).join(',')}</code>.
            Fechas <code>AAAA-MM-DD</code>, fecha y hora <code>AAAA-MM-DD HH:MM:SS</code>. Máx. 1000 filas.
          </p>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} placeholder={fields.map((c) => c.name).join(',')} />
          <button
            onClick={async () => {
              const rows = parseCsv(csv);
              if (!rows.length) return setMsg({ ok: false, text: '✖ El CSV no tiene filas de datos' });
              if (await run(rows)) setCsv('');
            }}
          >
            Importar
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'okmsg' : 'error'}>{msg.text}</p>}
    </section>
  );
}
