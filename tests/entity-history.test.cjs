const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function api(){const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/entity-history.js'),'utf8'),{window,Map,Date});return window.BEGDEntityHistory}
test('entity windows include 30/90/365 calendar days, leap day, zero and gaps',()=>{
 for(const days of [30,90,365]){
  const rows=api().calendar({days:[{date:'2024-02-29',load_mw:0}]},'2024-03-01',days);
  assert.equal(rows.length,days);assert.equal(rows.at(-1).date,'2024-03-01');
  assert.equal(rows.at(-2).load_mw,0);assert.equal(rows.at(-3).load_mw,undefined);
 }
});
test('table latest values do not leak outside the selected window',()=>{
 const h=api(),meta={last_date:'2026-09-24',latest:{load_mw:20}};
 assert.equal(h.latest(meta,'2026-10-24',30),null);
 assert.equal(h.latest(meta,'2026-10-24',90).load_mw,20);
});
test('entity metrics retain their distinct units and both capacity series',()=>{
 const h=api();assert.equal(h.metrics.plants.length,5);assert.equal(h.metrics.substations.length,2);
 assert.equal(h.metrics.plants[0].fields.join(','),'installed_capacity_mw,present_capacity_mw');
 assert.equal(h.metrics.substations.map(metric=>metric.unit).join(','),'MW,p.u.');
 assert.equal(h.tableMetrics('substations').length,3);
 assert.equal(h.metrics.substations[1].fields.join(','),'min_kv,max_kv');
 assert.match(h.metrics.plants.find(metric=>metric.id==='puf_pct').note,/Requires all 24 hourly samples/);
});
test('availability uses any valid day in the selected window, rather than just the last record',()=>{
 const h=api(),metric=h.metrics.plants.find(m=>m.id==='puf_pct');
 const meta={last_date:'2026-10-24',latest:{puf_pct:null},available_through:{puf_pct:'2026-09-01'}};
 assert.equal(h.metricAvailable(meta,metric,'2026-10-24',30),false);
 assert.equal(h.metricAvailable(meta,metric,'2026-10-24',90),true);
 meta.available_through.puf_pct='2026-09-25';assert.equal(h.metricAvailable(meta,metric,'2026-10-24',30),true);
 meta.available_through={};assert.equal(h.metricAvailable(meta,metric,'2026-10-24',365),false);
});
test('voltage-only, load-only and unknown-class stations expose only usable metrics',()=>{
 const h=api(),end='2026-10-24';
 const voltage={voltage_class:'132 kV',available_through:{min_kv:end,max_kv:end}};
 assert.equal(h.availableMetrics('substations',voltage,end,30).map(m=>m.id).join(','),'voltage_range');
 const load={voltage_class:'',available_through:{load_mw:end}};
 assert.equal(h.availableMetrics('substations',load,end,30).map(m=>m.id).join(','),'load_mw');
 voltage.voltage_class='Unknown';assert.equal(h.availableMetrics('substations',voltage,end,30).length,0);
});
test('zero output is still selectable and either capacity series makes capacity available',()=>{
 const h=api(),end='2026-10-24',meta={last_date:end,latest:{peak_generation_mw:0,present_capacity_mw:0}};
 assert.equal(h.metricAvailable(meta,h.metrics.plants[0],end,30),true);
 assert.equal(h.metricAvailable(meta,h.metrics.plants[1],end,30),true);
});
test('station voltage uses its own nominal class with no guesses for unknown classes',()=>{
 const h=api();
 assert.equal(h.perUnit(122,'132 kV'),122/132);assert.equal(h.perUnit(230,'230 kV'),1);assert.equal(h.perUnit(380,'400 kV'),0.95);
 assert.equal(h.perUnit(132,''),null);assert.equal(h.perUnit(null,'132 kV'),null);assert.equal(h.perUnit(110,'110 kV'),null);
});
test('Up/Down navigation retains the selected metric and skips rows without that metric',()=>{
 const h=api(),end='2026-10-24',puf=h.metrics.plants.find(m=>m.id==='puf_pct');
 const rows=[{id:'a',available_through:{puf_pct:end}},{id:'b',available_through:{peak_generation_mw:end}},{id:'c',available_through:{puf_pct:end}}];
 assert.equal(h.stepEntity(rows,'a',1,puf,end,30).id,'c');
 assert.equal(h.stepEntity(rows,'c',-1,puf,end,30).id,'a');
 assert.equal(h.stepEntity(rows,'a',-1,puf,end,30),null);
 assert.equal(h.stepEntity(rows,'c',1,puf,end,30),null);
 assert.equal(puf.id,'puf_pct');
});
test('keyboard traversal respects filtered ordering, absent selections and active date windows',()=>{
 const h=api(),end='2026-10-24',puf=h.metrics.plants.find(m=>m.id==='puf_pct');
 const rows=[{id:'c',available_through:{puf_pct:'2026-09-01'}},{id:'a',available_through:{puf_pct:end}}];
 assert.equal(h.stepEntity(rows,'hidden',1,puf,end,30).id,'a');
 assert.equal(h.stepEntity(rows,'hidden',1,puf,end,90).id,'c');
 assert.equal(h.stepEntity(rows,'hidden',-1,puf,end,30).id,'a');
 assert.equal(h.stepEntity(rows,'a',-1,puf,end,30),null);
 assert.equal(h.stepEntity(rows,'a',-1,puf,end,90).id,'c');
 assert.equal(h.stepEntity([],null,1,puf,end,30),null);
 assert.equal(h.stepEntity(rows,'a',0,puf,end,30),null);
 assert.equal(h.stepEntity(rows,'a',1,null,end,30),null);
});
test('voltage navigation skips load-only and unknown-class rows',()=>{
 const h=api(),end='2026-10-24',metric=h.metrics.substations.find(m=>m.id==='voltage_range');
 const rows=[{id:'a',voltage_class:'132 kV',available_through:{min_kv:end,max_kv:end}},
  {id:'load',voltage_class:'',available_through:{load_mw:end}},
  {id:'unknown',voltage_class:'Unknown',available_through:{min_kv:end}},
  {id:'b',voltage_class:'230 kV',available_through:{min_kv:end,max_kv:end}}];
 assert.equal(h.stepEntity(rows,'a',1,metric,end,30).id,'b');
 assert.equal(h.stepEntity(rows,'b',-1,metric,end,30).id,'a');
});
