import index from '../web/index.html';
import { columnsOf, insertRows, runFindings, tableCounts, tableRows, UserError } from './analysis';

// JSON.stringify no soporta bigint (los COUNT de MySQL pueden llegar así).
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Req = Bun.BunRequest<string>;
const guard = (fn: (req: Req) => Promise<Response>) => async (req: Req) => {
  try {
    return await fn(req);
  } catch (e) {
    const user = e instanceof UserError;
    return json({ error: (e as Error).message }, user ? 400 : 500);
  }
};

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== 'production',
  routes: {
    '/': index,
    '/api/findings': guard(async () => json({ generatedAt: new Date().toISOString(), findings: await runFindings() })),
    '/api/tables': guard(async () => json(await tableCounts())),
    '/api/tables/:name/columns': guard(async (req) => json(await columnsOf(req.params.name))),
    '/api/tables/:name': {
      GET: guard(async (req) => json(await tableRows(req.params.name))),
      // Cuerpo: { "rows": [ { "columna": "valor", ... }, ... ] }
      POST: guard(async (req) => {
        const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
        const inserted = await insertRows(req.params.name, body?.rows);
        return json({ inserted }, 201);
      }),
    },
  },
});

console.log(`Consola de nómina en ${server.url}`);
