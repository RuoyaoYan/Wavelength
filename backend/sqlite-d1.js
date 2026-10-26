// A tiny stand-in for Cloudflare's D1 binding, backed by Node's built-in SQLite (Node 22.5+).
// Used by the tests and by dev-server.js; the deployed Worker uses the real D1.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

export function openDb(file=':memory:'){
  const db=new DatabaseSync(file);
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const stmt=(sql,args=[])=>({
    bind:(...a)=>stmt(sql,a),
    first:async()=>db.prepare(sql).get(...args)??null,
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})
  });
  return {prepare:sql=>stmt(sql)};
}
