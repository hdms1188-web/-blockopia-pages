const headers={
  'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store',
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'content-type',
  'access-control-allow-methods':'GET,POST,OPTIONS'
};

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const cleanName=value=>String(value||'冒険者').replace(/[<>\r\n\t]/g,'').trim().slice(0,20)||'冒険者';
const rowToRecord=row=>({
  id:String(row.id),
  name:cleanName(row.name),
  timeMs:Number(row.timeMs),
  seed:Number(row.seed),
  finishedAt:Number(row.finishedAt),
  version:Number(row.version)||1,
  valid:true
});
const database=context=>context.env?.RTA_DB;

export const onRequestOptions=()=>new Response(null,{status:204,headers});

export async function onRequestGet(context){
  const db=database(context);if(!db)return json({error:'RTA_DB binding is not configured',records:[]},503);
  try{
    const result=await db.prepare('SELECT id, name, time_ms AS timeMs, seed, finished_at AS finishedAt, version FROM rta_records ORDER BY time_ms ASC, finished_at ASC LIMIT 100').all();
    const records=(result.results||[]).map(rowToRecord);
    return json({records,worldRecord:records[0]||null,provider:'cloudflare-d1'});
  }catch(error){
    console.error('Blockopia RTA GET failed',error);return json({error:'ranking unavailable',records:[]},503);
  }
}

export async function onRequestPost(context){
  const db=database(context);if(!db)return json({error:'RTA_DB binding is not configured'},503);
  const length=Number(context.request.headers.get('content-length')||0);if(length>4096)return json({error:'payload too large'},413);
  let input;try{input=await context.request.json();}catch{return json({error:'invalid json'},400);}
  const name=cleanName(input.name),timeMs=Math.floor(Number(input.timeMs)),seed=Math.floor(Number(input.seed)),version=Math.floor(Number(input.version)||1);
  if(!Number.isFinite(timeMs)||timeMs<60000||timeMs>604800000)return json({error:'invalid time'},400);
  if(!Number.isSafeInteger(seed)||Math.abs(seed)>2147483647)return json({error:'invalid seed'},400);
  if(version!==1)return json({error:'unsupported version'},400);
  const id=crypto.randomUUID(),finishedAt=Date.now();
  try{
    await db.prepare('INSERT INTO rta_records (id, name, time_ms, seed, finished_at, version) VALUES (?, ?, ?, ?, ?, ?)').bind(id,name,timeMs,seed,finishedAt,version).run();
    const position=await db.prepare('SELECT COUNT(*) AS count FROM rta_records WHERE time_ms < ? OR (time_ms = ? AND finished_at <= ?)').bind(timeMs,timeMs,finishedAt).first();
    const record={id,name,timeMs,seed,finishedAt,version,valid:true};
    return json({ok:true,record,rank:Number(position?.count)||1,provider:'cloudflare-d1'},201);
  }catch(error){
    console.error('Blockopia RTA POST failed',error);return json({error:'record could not be saved'},503);
  }
}
