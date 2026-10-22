const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const bundle={reports:[{id:'1'}],failures:[],generated_at:'now',reports_by_id:{'1':{date:'2026-01-31'},'2':{date:'2026-02-01'}},reports_by_operating_date:{'2026-02-01':'2'},current_day:{today_date:'2026-02-01'},highest_generation:{report_id:'2'}};
function api(data=bundle,upstream){
 const calls=[];
 const window={BEGD_STATIC_DATA:data,location:{href:'https://example.test/Projects/begd/',origin:'https://example.test'},fetch:async(...args)=>{calls.push(args);return upstream?upstream(...args):new Response('upstream')},setTimeout:(_,delay)=>assert.equal(delay,3600000)};
 vm.runInNewContext(fs.readFileSync(path.join(root,'begd/static-api.js'),'utf8'),{window,URL,Response});
 return {fetch:window.fetch,calls};
}
test('report archive metadata',async()=>{const r=await api().fetch('/api/reports');const d=await r.json();assert.equal(d.count,1);assert.equal(d.complete,true);assert.equal(d.updated_at,'now');assert.match(r.headers.get('content-type'),/application\/json/)});
test('report lookup and missing ID',async()=>{const {fetch}=api();assert.deepEqual(await(await fetch('/api/report?id=1')).json(),bundle.reports_by_id['1']);assert.equal((await fetch('/api/report?id=missing')).status,404)});
test('operating-day neighbor crosses month boundary',async()=>{assert.deepEqual(await(await api().fetch('/api/neighbor?id=1&offset=1')).json(),bundle.reports_by_id['2'])});
test('invalid or unavailable neighbors',async()=>{for(const q of ['id=1&offset=0','id=1&offset=-1','id=missing&offset=1'])assert.equal((await api().fetch('/api/neighbor?'+q)).status,404)});
test('current day and highest generation',async()=>{for(const [route,key] of [['highest-generation','highest_generation']])assert.deepEqual(await(await api().fetch('/api/'+route)).json(),bundle[key])});
test('missing data responses',async()=>{assert.equal((await api(null).fetch('/api/reports')).status,503);assert.equal((await api({...bundle,highest_generation:null}).fetch('/api/highest-generation')).status,404)});
test('unknown routes',async()=>assert.equal((await api().fetch('/api/unknown')).status,404));
test('external and asset fetch preserve options',async()=>{const {fetch,calls}=api(),options={cache:'no-store'};await fetch('https://other.test/api/report',options);await fetch('style.css',options);assert.equal(calls.length,2);assert.equal(calls[0][1],options)});
test('Request input supported',async()=>assert.equal((await api().fetch(new Request('https://example.test/api/report?id=1'))).status,200));
test('archive parser failures are not exposed to the dashboard',async()=>assert.equal((await(await api({...bundle,failures:['broken']}).fetch('/api/reports')).json()).error,null));
test('all browser scripts parse',()=>{for(const name of fs.readdirSync(path.join(root,'begd')).filter(n=>n.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,'begd',name),'utf8'),{filename:name})});
test('HTML local asset references exist',()=>{for(const page of ['index.html','begd/index.html'])for(const m of fs.readFileSync(path.join(root,page),'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)){const target=m[1].split(/[?#]/)[0];if(!target||/^(?:https?:|data:|\/)/.test(target))continue;assert.ok(fs.existsSync(path.resolve(root,path.dirname(page),target)),`${page}: ${target}`)}});
test('exact operating-date archive lookup never falls back to a neighboring or publication date',async()=>{
 const {fetch}=api();assert.deepEqual(await(await fetch('/api/report?date=2026-02-01')).json(),bundle.reports_by_id['2']);
 for(const date of ['2026-01-31','2026-02-02','invalid'])assert.equal((await fetch('/api/report?date='+date)).status,404);
});

test('current-day polling fetches new published snapshots without reloading the page',async()=>{
 let revision=0;const fresh=()=>({today_date:'2026-02-01',updated_at:`2026-02-01T0${revision}:00:00Z`,demand_hourly:[{time:`0${revision}:00`,demand_mw:10+revision}],generation_hourly:[],imports:[]});
 const a=api({...bundle,current_day:fresh()},async()=>new Response(JSON.stringify(fresh())));
 for(revision=1;revision<=2;revision++){const data=await(await a.fetch('/api/current-day')).json();assert.equal(data.demand_hourly[0].time,`0${revision}:00`);assert.equal(data.snapshot_refresh_failed,false);}
 assert.equal(a.calls.length,2);assert.equal(a.calls[0][0],'https://example.test/Projects/begd/current-day.json');assert.equal(a.calls[0][1].cache,'no-store');
});
test('current-day refresh keeps valid readings on malformed/missing snapshots and rejects older artifacts',async()=>{
 const current={today_date:'2026-02-01',updated_at:'2026-02-01T03:00:00Z',demand_hourly:[{time:'03:00'}],generation_hourly:[],imports:[]};
 const replies=[new Response(JSON.stringify({...current,updated_at:'2026-02-01T02:00:00Z',demand_hourly:[]})),new Response('{}'),new Response('',{status:404}),new Response(JSON.stringify({...current,updated_at:'2026-02-01T04:00:00Z',error:'ERP unavailable',demand_hourly:[]}))];
 const a=api({...bundle,current_day:current},async()=>replies.shift());
 for(let i=0;i<4;i++){const data=await(await a.fetch('/api/current-day')).json();assert.deepEqual(data.demand_hourly,current.demand_hourly);assert.equal(data.snapshot_refresh_failed,i>0);}
});
