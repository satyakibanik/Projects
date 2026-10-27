const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function load(extra={}){const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/costs.js'),'utf8'),{window,Date,Set,...extra});return window.BEGDCosts;}
const row={date:'2026-10-25',archive_date:'2026-10-26',currency:'BDT',total_bdt:60000000,costs_bdt:{Gas:10000000,Coal:50000000,Oil:0},production_cost_per_kwh:7.45341,source_label:'Production Cost (Tk.)',source_url:'https://misc.bpdb.gov.bd/storage/daily_archive/test.pdf',scope:'production'};
test('pie uses exact operating day only and never substitutes late reports',()=>{
 const api=load();api.setData({days:[row]});assert.equal(api.piePanel('2026-10-26'),'');assert.equal(api.piePanel('2026-10-24'),'');
 const html=api.piePanel('2026-10-25');assert.match(html,/Fuel cost by generation type/);assert.match(html,/50,000,000/);assert.match(html,/83.33%/);assert.match(html,/BDT 7.45341\/kWh/);assert.match(html,/archive date 2026-10-26/);assert.equal((html.match(/<path /g)||[]).length,2);assert.match(html,/>Oil<\/th><td>0<\/td>/);
});
test('all calendar ranges count only validated cost dates and retain gaps',()=>{
 const api=load();api.setData({days:[row]});
 for(const n of [30,60,90,365]){const rows=Array.from({length:n},(_,i)=>({date:new Date(Date.UTC(2026,9,26)-(n-1-i)*86400000).toISOString().slice(0,10)}));const html=api.trendPanel(rows,()=>'<svg/>');assert.match(html,new RegExp(`1 / ${n} days`));assert.match(html,/BDT 6 crore/);assert.match(html,/missing dates remain gaps/);}
 const series=api.series();assert.equal(series[0].value({date:'2026-10-25'}),6);assert.ok(!Number.isFinite(series[0].value({date:'2026-10-26'})));assert.equal(series.find(s=>s.name==='Oil').value({date:'2026-10-25'}),0);assert.equal(series.find(s=>s.name==='HFO').value({date:'2026-10-25'}),null);
});
test('invalid and unreconciled costs never render a pie',()=>{const api=load();for(const bad of [{...row,total_bdt:1},{...row,currency:'USD'},{...row,costs_bdt:{Gas:NaN,Coal:1,Oil:0}}]){api.setData({days:[bad]});assert.equal(api.piePanel(row.date),'');}});
test('async cost response cannot populate a different selected day',async()=>{let resolve;const host={dataset:{costDate:'2026-10-26'},innerHTML:''};const api=load({document:{getElementById:()=>host},fetch:()=>new Promise(r=>resolve=r)});const pending=api.mountDay('2026-10-25');resolve({ok:true,json:async()=>({days:[row]})});await pending;assert.equal(host.innerHTML,'');});
test('unavailable costs do not break the dashboard',async()=>{const api=load({fetch:async()=>({ok:false})});assert.equal(await api.load(),null);assert.equal(api.piePanel(row.date),'');});

test('cost category selections round-trip through shared view URLs without enabling other categories',()=>{
 const window={addEventListener(){}};
 const context={window,URL,Date,Map,Set};
 for(const name of ['costs.js','view-state.js','trends.js'])vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd',name),'utf8'),context);
 const api=window.BEGDViewCodec,state={...api.defaults,trendLayers:[['bpdb-cost|gas',true]],layers:[],custom:[],presets:{}};
 const url=api.encode('https://example.test/#trends',state),decoded=api.decode(url).state;
 window.BEGDTrends.setViewState(decoded);window.BEGDCosts.setData({days:[row]});
 const html=window.BEGDTrends.plot([{date:row.date}],window.BEGDCosts.series(),'Cost of consumed fuel','BDT crore',false,{key:'bpdb-cost'});
 assert.match(html,/data-trend-layer="Gas" data-trend-chart-key="bpdb-cost" checked/);
 assert.doesNotMatch(html,/data-trend-layer="Coal" data-trend-chart-key="bpdb-cost" checked/);
});
