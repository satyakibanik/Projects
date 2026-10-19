const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const bands=require('../begd/voltage-bands.js'),distribution=require('../begd/voltage-distribution.js');
const rows=[{name:'Station A',voltage_class:'400 kV',min_kv:380,max_kv:410,min_time:'02:00',max_time:'17:30'},
 {name:'Station B',voltage_class:'230 kV',min_kv:218.5,max_kv:241.5,min_time:'03:00',max_time:'18:30'},
 {name:'Station C',voltage_class:'132 kV',min_kv:125.4,max_kv:138.6,min_time:'01:00',max_time:'19:00'}];
test('per-unit readings use each row class; source objects, extrema and times remain intact',()=>{
 const p=bands.prepare(rows);assert.equal(p.excluded.length,0);
 for(const kv of [400,230,132])assert.ok(Math.abs(p.groups.get(kv)[0].min_pu-.95)<1e-12);
 assert.equal(p.groups.get(400)[0].min_time,'02:00');assert.equal(rows[0].min_pu,undefined);
 assert.equal(p.groups.get(230)[0].max_pu,1.05);
});
test('missing, reversed, nonpositive, nonnumeric and unsupported-class values cannot become chart points',()=>{
 const bad=[{voltage_class:'132 kV',min_kv:0,max_kv:140},{voltage_class:'230 kV',min_kv:240,max_kv:220},
 {voltage_class:'400 kV',min_kv:null,max_kv:410},{voltage_class:'132 kV',min_kv:'125',max_kv:140},
 {voltage_class:'400/230 kV',min_kv:390,max_kv:410},{voltage_class:'132 kV',min_kv:125,max_kv:Infinity}];
 const p=bands.prepare(bad);assert.equal(p.excluded.length,6);assert.ok([...p.groups.values()].every(g=>!g.length));
 const html=bands.render(bad,'2026-10-17');assert.match(html,/6 missing \/ invalid/);assert.doesNotMatch(html,/NaN|Infinity/);
});
test('quartiles interpolate and full-range whiskers retain unusual extrema',()=>{
 assert.deepEqual(distribution.summary([4,1,3,2]),{n:4,min:1,q1:1.75,median:2.5,q3:3.25,max:4});
 assert.equal(distribution.summary([0,1,2,3,100]).max,100);assert.equal(distribution.summary([]),null);
 assert.deepEqual(distribution.summary([1]),{n:1,min:1,q1:1,median:1,q3:1,max:1});
});
test('exactly two plots render and the six class/reading summaries reconcile to source observations',()=>{
 const p=bands.prepare(rows),points=[],d=distribution.render([...p.groups.values()],{colors:{400:'purple',230:'teal',132:'orange'},register:(key,r)=>points.push([key,r])});
 assert.equal(points.length,6);assert.equal(new Set(points.map(([key])=>key)).size,6);
 for(const [,item] of points)assert.ok(rows.some(r=>r.name===item.row.name));
 assert.equal((d.html.match(/<tr>/g)||[]).length,7);
 const html=bands.render(rows,'2026-10-17');assert.equal((html.match(/<svg /g)||[]).length,2);
 assert.match(html,/Per-unit voltage bands/);assert.match(html,/box-and-whisker/);assert.match(html,/2026-10-17/);
 assert.doesNotMatch(html,/LOCAL PREVIEW|Largest daily|Minimum vs maximum|operating band<\/h3>/);
});
test('single points, zero-width distributions, empty input and escaped names render finite geometry',()=>{
 const r={name:'Station <A>',voltage_class:'132 kV',min_kv:132,max_kv:132};
 const html=bands.render([r],'2026-01-01');assert.doesNotMatch(html,/NaN|Infinity|Station <A>/);assert.match(html,/Station &lt;A&gt;/);assert.equal(bands.rank(0,1),.5);
 assert.doesNotMatch(bands.render([],'2026-01-02'),/<svg /);
});
function browser(){
 const events={},elements=new Map(),document={addEventListener:(name,fn)=>{events[name]=fn},getElementById:id=>elements.get(id)||null,querySelector:()=>({focus(){}})};
 const c=vm.createContext({document,console});vm.runInContext('window=globalThis',c);
 for(const file of ['voltage-distribution.js','voltage-bands.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../begd',file),'utf8'),c);
 return {events,elements,api:c.BEGDVoltageBands};
}
test('search, class toggles and reset update both plots, and report changes discard old readings',()=>{
 const {events,elements,api}=browser(),fig={innerHTML:''},search={value:''};elements.set('voltage-band-figures',fig);elements.set('voltage-band-search',search);
 api.render(rows,'2026-10-17');events.input({target:{id:'voltage-band-search',value:'Station B'}});
 assert.match(fig.innerHTML,/Station B/);assert.doesNotMatch(fig.innerHTML,/Station A|Station C/);assert.equal((fig.innerHTML.match(/<svg /g)||[]).length,2);
 events.click({target:{closest:s=>s==='[data-vb-class]'?{dataset:{vbClass:'230'}}:null}});assert.doesNotMatch(fig.innerHTML,/<svg /);assert.match(fig.innerHTML,/No voltage records/);
 events.click({target:{closest:s=>s==='#voltage-band-reset'?{}:null}});assert.equal((fig.innerHTML.match(/<svg /g)||[]).length,2);assert.match(fig.innerHTML,/Station A/);assert.equal(search.value,'');
 const next=api.render([{...rows[0],name:'Next report',min_kv:390,max_kv:400}],'2026-10-18');assert.match(next,/Next report/);assert.doesNotMatch(next,/Station A|Station B|Station C/);
});
test('keyboard focus on station marks exposes actual kV, per-unit values and published BST times',()=>{
 const {events,elements,api}=browser(),output={innerHTML:''};elements.set('vb-combined-reading',output);
 api.render(rows,'2026-10-17');events.focusin({target:{closest:()=>({dataset:{vbPoint:'vb-combined-400-0'}})}});
 assert.match(output.innerHTML,/Station A/);assert.match(output.innerHTML,/380 kV/);assert.match(output.innerHTML,/0.950 p.u./);assert.match(output.innerHTML,/02:00 BST/);assert.match(output.innerHTML,/17:30 BST/);
});
