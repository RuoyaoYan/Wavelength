// Runs the Worker locally on http://localhost:8787 with the log saved to achievements.db.
// node --disable-warning=ExperimentalWarning dev-server.js
import {createServer} from 'node:http';
import worker from './worker.js';
import {openDb} from './sqlite-d1.js';

const env={DB:openDb(new URL('./achievements.db',import.meta.url).pathname)};
const port=Number(process.env.PORT)||8787;
createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const body=chunks.length?Buffer.concat(chunks):undefined;
  const r=await worker.fetch(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body}),env);
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port,()=>console.log(`Achievements API on http://localhost:${port}/achievements`));
