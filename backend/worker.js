// Achievement log for the Game Portal: a Cloudflare Worker in front of a D1 (SQLite) table.
// GET  /achievements  -> {items:[...newest first], best:{wavelength:<top co-op score>}}
// POST /achievements  -> stores one unlock. Ids are made by the game, so a retried post is stored once.
export const TYPES={wavelength:['record','sync','comeback','tug'],imposter:['framed','actor','sharp']};
const MAX_NAMES=12,MAX_NAME=20,LIST_LIMIT=200;
const CORS={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'};
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json',...CORS}});

const names=a=>Array.isArray(a)?[...new Set(a.map(n=>String(n??'').trim().slice(0,MAX_NAME)).filter(Boolean))].slice(0,MAX_NAMES):[];
// Returns a clean row, or a string saying what is wrong.
export function clean(b){
  if(!b||typeof b!=='object')return 'body must be a JSON object';
  const id=String(b.id??'');if(!/^[\w:.-]{6,80}$/.test(id))return 'bad id';
  if(!TYPES[b.game]||!TYPES[b.game].includes(b.type))return 'unknown achievement';
  const row={id,game:b.game,type:b.type,score:null,lead:names(b.lead),others:names(b.others),victims:names(b.victims)};
  if(!row.lead.length)return 'lead needs at least one name';
  if(b.type==='record'){const s=Number(b.score);if(!Number.isInteger(s)||s<1||s>1000)return 'bad score';row.score=s}
  return row;
}
const fromDb=r=>({id:r.id,game:r.game,type:r.type,at:r.at,score:r.score,lead:JSON.parse(r.lead),others:JSON.parse(r.others),victims:JSON.parse(r.victims)});
const best=async db=>(await db.prepare("SELECT MAX(score) AS s FROM achievements WHERE game='wavelength' AND type='record'").first())?.s??0;

export default {
  async fetch(req,env){
    const url=new URL(req.url);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
    if(url.pathname!=='/achievements')return json({error:'not found'},404);
    const db=env.DB;
    if(req.method==='GET'){
      const {results}=await db.prepare('SELECT * FROM achievements ORDER BY at DESC LIMIT ?').bind(LIST_LIMIT).all();
      return json({items:results.map(fromDb),best:{wavelength:await best(db)}});
    }
    if(req.method!=='POST')return json({error:'method not allowed'},405);
    let body;try{body=await req.json()}catch(e){return json({error:'body must be JSON'},400)}
    const row=clean(body);if(typeof row==='string')return json({error:row},400);
    // A co-op score only goes in the log when it beats every earlier record.
    if(row.type==='record'&&row.score<=await best(db))return json({ok:true,stored:false,reason:'not a record'});
    const r=await db.prepare('INSERT OR IGNORE INTO achievements (id,game,type,at,score,lead,others,victims) VALUES (?,?,?,?,?,?,?,?)')
      .bind(row.id,row.game,row.type,Date.now(),row.score,JSON.stringify(row.lead),JSON.stringify(row.others),JSON.stringify(row.victims)).run();
    return json({ok:true,stored:r.meta.changes>0});
  }
};
