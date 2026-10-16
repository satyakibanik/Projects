const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path');
const root=path.resolve(__dirname,'..');
const bundle={reports:[{id:'1'}],failures:[],generated_at:'now',reports_by_id:{'1':{date:'2026-01-31'},'2':{date:'2026-02-01'}},reports_by_operating_date:{'2026-02-01':'2'},current_day:{today_date:'2026-02-01'},highest_generation:{report_id:'2'}};
function api(data=bundle){
 const calls=[];
 const window={BEGD_STATIC_DATA:data,location:{href:'https://example.test/Projects/begd/',origin:'https://example.test'},fetch:async(...args)=>{calls.push(args);return new Response('upstream')},setTimeout:(_,delay)=>assert.equal(delay,3600000)};
 vm.runInNewContext(fs.readFileSync(path.join(root,'begd/static-api.js'),'utf8'),{window,URL,Response});
 return {fetch:window.fetch,calls};
}
test('report archive metadata',async()=>{const r=await api().fetch('/api/reports');const d=await r.json();assert.equal(d.count,1);assert.equal(d.complete,true);assert.equal(d.updated_at,'now');assert.match(r.headers.get('content-type'),/application\/json/)});
test('report lookup and missing ID',async()=>{const {fetch}=api();assert.deepEqual(await(await fetch('/api/report?id=1')).json(),bundle.reports_by_id['1']);assert.equal((await fetch('/api/report?id=missing')).status,404)});
test('operating-day neighbor crosses month boundary',async()=>{assert.deepEqual(await(await api().fetch('/api/neighbor?id=1&offset=1')).json(),bundle.reports_by_id['2'])});
test('invalid or unavailable neighbors',async()=>{for(const q of ['id=1&offset=0','id=1&offset=-1','id=missing&offset=1'])assert.equal((await api().fetch('/api/neighbor?'+q)).status,404)});
test('current day and highest generation',async()=>{for(const [route,key] of [['current-day','current_day'],['highest-generation','highest_generation']])assert.deepEqual(await(await api().fetch('/api/'+route)).json(),bundle[key])});
test('missing data responses',async()=>{assert.equal((await api(null).fetch('/api/reports')).status,503);assert.equal((await api({...bundle,highest_generation:null}).fetch('/api/highest-generation')).status,404)});
test('unknown routes',async()=>assert.equal((await api().fetch('/api/unknown')).status,404));
test('external and asset fetch preserve options',async()=>{const {fetch,calls}=api(),options={cache:'no-store'};await fetch('https://other.test/api/report',options);await fetch('style.css',options);assert.equal(calls.length,2);assert.equal(calls[0][1],options)});
test('Request input supported',async()=>assert.equal((await api().fetch(new Request('https://example.test/api/report?id=1'))).status,200));
test('partial archive reports failures',async()=>assert.match((await(await api({...bundle,failures:['broken']}).fetch('/api/reports')).json()).error,/Skipped 1/));
test('all browser scripts parse',()=>{for(const name of fs.readdirSync(path.join(root,'begd')).filter(n=>n.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(root,'begd',name),'utf8'),{filename:name})});
test('HTML local asset references exist',()=>{for(const page of ['index.html','begd/index.html'])for(const m of fs.readFileSync(path.join(root,page),'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)){const target=m[1].split(/[?#]/)[0];if(!target||/^(?:https?:|data:|\/)/.test(target))continue;assert.ok(fs.existsSync(path.resolve(root,path.dirname(page),target)),`${page}: ${target}`)}});
