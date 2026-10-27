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

test('category cost per kWh uses matching energy and never divides by zero or borrows another fuel',()=>{
 const api=load(),sample={...row,generation_kwh:{Gas:2000000,Coal:10000000,Oil:0}};
 assert.equal(api.costRate(sample,'Gas'),5);assert.equal(api.costRate(sample,'Coal'),5);assert.equal(api.costRate(sample,'Oil'),null);assert.equal(api.costRate(sample,'Solar'),null);assert.equal(api.costRate(row,'Gas'),null);
 api.setData({days:[sample]});const html=api.piePanel(row.date);assert.match(html,/5.000/);assert.match(html,/plant-icons\/gas-factory.png/);assert.match(html,/data-cost-slice="Gas"/);assert.match(html,/role="tooltip" hidden/);
 for(const key of ['name','cost','share','rate'])assert.match(html,new RegExp(`data-cost-sort="${key}"`));
});
test('all cost table sorts are numeric with unavailable rates last in both directions',()=>{
 const api=load(),entries=[{name:'Gas',cost:9,share:9,rate:null},{name:'Coal',cost:100,share:100,rate:9},{name:'Solar',cost:0,share:0,rate:0}];
 assert.equal(api.sortBreakdown(entries)[0].name,'Coal');
 assert.equal(api.sortBreakdown(entries,{key:'rate',direction:'asc'})[0].name,'Solar');
 assert.equal(api.sortBreakdown(entries,{key:'rate',direction:'desc'}).at(-1).name,'Gas');
 assert.equal(api.sortBreakdown(entries,{key:'name',direction:'asc'})[0].name,'Coal');
});
test('cost legend groups individual fuels independently from the reported total',()=>{
 const api=load(),window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,Date,Map,Set});
 const html=window.BEGDTrends.plot([{date:row.date}],api.series(),'Cost of consumed fuel','BDT crore',false,{key:'bpdb-cost',groupLayers:true});
 assert.match(html,/data-trend-group="bpdb-cost"/);assert.match(html,/Individual fuel types/);
 const fieldset=html.slice(html.indexOf('<fieldset'),html.indexOf('</fieldset>'));assert.doesNotMatch(fieldset,/Reported total/);assert.match(fieldset,/Gas/);
});
test('linear trend uses calendar distance and excludes missing days; only one layer may display a fit',()=>{
 const window={addEventListener(){}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),{window,Date,Map,Set});
 const api=window.BEGDTrends,rows=[{date:'2026-01-01',v:10},{date:'2026-01-02'},{date:'2026-01-03',v:14}],series={name:'Gas',color:'#123',value:r=>r.v};
 const fit=api.linearTrend(rows,series);assert.equal(fit.slope,2);assert.equal(fit.count,2);assert.equal(fit.value(rows[1]),12);
 assert.match(api.plot(rows,[series],'Cost','BDT',false,{fitTrend:true}),/data-cost-trendline-path/);
 assert.doesNotMatch(api.plot(rows,[series,{...series,name:'Coal'}],'Cost','BDT',false,{fitTrend:true}),/data-cost-trendline-path/);
 assert.doesNotMatch(api.plot(rows,[series],'Cost','BDT',false,{fitTrend:false}),/data-cost-trendline-path/);
 assert.equal(api.linearTrend(rows.slice(0,1),series),null);
});
test('Energy Curve keeps dated costs discoverable when the selected report is newer than BPDB',()=>{
 const api=load();api.setData({days:[row]});const html=api.dayPanel('2026-10-26');
 assert.match(html,/Costs for the energy curve date \(26 Oct 2026\) are unavailable/);
 assert.match(html,/separate BPDB cost report for 25 Oct 2026/);assert.match(html,/energy curve above remains on 26 Oct 2026/);
 assert.match(html,/data-cost-date-picker/);assert.match(html,/value="2026-10-25" selected/);assert.match(html,/Fuel cost by generation type/);assert.match(html,/50,000,000/);
 assert.equal(api.forDate('2026-10-26'),null);assert.equal(api.piePanel('2026-10-26'),'');
});
test('cost-date selector prefers a matching report and allows explicit older or newer dates',()=>{
 const api=load();api.setData({days:[row,{...row,date:'2026-10-24'}]});
 assert.equal(api.costDateFor('2026-10-24'),'2026-10-24');assert.equal(api.costDateFor('2026-10-26'),'2026-10-25');
 assert.equal(api.costDateFor('2026-10-24','2026-10-25'),'2026-10-25');assert.equal(api.costDateFor('2026-10-26','bad'),'2026-10-25');
 assert.match(api.dayPanel('2026-10-25'),/Costs match the energy curve operating date/);
 assert.doesNotMatch(api.dayPanel('2026-10-25','2026-10-24'),/are unavailable/);
 assert.match(api.dayPanel('2026-10-26','2026-10-24'),/value="2026-10-24" selected/);
});
test('an outage or empty cost dataset produces a visible explanation rather than a missing section',async()=>{
 const api=load({fetch:async()=>({ok:false})});await api.load();
 assert.match(api.dayPanel('2026-10-26'),/No validated BPDB cost breakdown/);
 api.setData({days:[]});assert.match(api.dayPanel('2026-10-26'),/Fuel cost by generation type/);
});
const rateRow=(date,cost,energy,extra={})=>({date,currency:'BDT',total_bdt:cost,costs_bdt:{Gas:cost,Coal:0,Oil:0},generation_kwh:{Gas:energy},...extra});
const energyReport=(date,fuels={})=>({date,fuels:{Gas:0,Coal:0,HFO:0,HSD:0,Hydro:0,Solar:0,Imports:0,Wind:0,...fuels}});
test('fuel averages weight matching energy and enforce exact calendar boundaries for every supported period',()=>{
 const api=load();api.setData({days:[rateRow('2026-09-25',10000,1),rateRow('2026-09-26',10,1),rateRow('2026-10-25',90,30),rateRow('2026-10-26',10000,1)]});
 const avg=api.averageCosts('2026-10-25',30);
 assert.equal(avg.start,'2026-09-26');assert.equal(avg.fuels.Gas.days,2);assert.equal(avg.fuels.Gas.cost_bdt,100);assert.equal(avg.fuels.Gas.energy_kwh,31);assert.equal(avg.fuels.Gas.rate,100/31);assert.notEqual(avg.fuels.Gas.rate,6.5);
 for(const days of [7,30,60,90,365]){
  const end='2026-10-25',start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
  assert.equal(api.averageCosts(end,days).start,start);
 }
});
test('calculated daily costs use preceding 30 days, multiply selected-day MWh by 1000, and never enter reported history',()=>{
 const api=load();api.setData({days:[rateRow('2026-09-25',9999,1),rateRow('2026-09-26',10,1),rateRow('2026-10-25',90,30),rateRow('2026-10-27',9999,1)]});
 const report=energyReport('2026-10-26',{Gas:2}),value=api.calculatedCosts(report);
 assert.equal(value.calculated,true);assert.equal(value.partial,false);assert.ok(Math.abs(value.total_bdt-2000*100/31)<1e-9);assert.equal(value.generation_kwh.Gas,2000);
 assert.equal(value.rate_basis.start,'2026-09-26');assert.equal(value.rate_basis.end,'2026-10-25');assert.equal(value.rate_basis.fuels.Gas.days,2);assert.equal(api.forDate(report.date),null);
 const html=api.dayPanel(report.date,undefined,report);assert.match(html,/CALCULATED · 30D RATES/);assert.match(html,/Total calculated cost/);assert.match(html,/26 Oct 2026 \(calculated\)/);assert.doesNotMatch(html,/Reported daily cost · 26 Oct/);
 assert.equal(api.valid(value),false);api.setData({days:[value,rateRow('2026-10-25',20,10)]});assert.equal(api.averageCosts('2026-10-26',30).fuels.Gas.days,1);
});
test('positive generation without a fuel rate stays unavailable and calculated subtotal is explicitly partial',()=>{
 const api=load();api.setData({days:[rateRow('2026-10-25',50,10)]});const report=energyReport('2026-10-26',{Gas:1,Coal:2});
 const result=api.calculatedCosts(report);assert.equal(result.costs_bdt.Gas,5000);assert.equal(result.costs_bdt.Coal,undefined);assert.equal(result.total_bdt,5000);assert.equal(result.partial,true);assert.equal(result.production_cost_per_kwh,null);
 const html=api.dayPanel(report.date,undefined,report);assert.match(html,/CALCULATED · PARTIAL/);assert.match(html,/Calculated subtotal/);assert.match(html,/Coal \(30-day rate unavailable\)/);assert.match(html,/Unavailable/);
 api.setData({days:[]});assert.equal(api.calculatedCosts(report).unavailable,true);assert.match(api.dayPanel(report.date,undefined,report),/<strong>Unavailable<\/strong>/);
 const zero=api.calculatedCosts(energyReport(report.date));assert.equal(zero.total_bdt,0);assert.equal(zero.unavailable,false);assert.equal(zero.partial,false);
});
test('missing, nonfinite or zero historical generation cannot produce a rate, and absent current energy is never zero-filled',()=>{
 const api=load();api.setData({days:[rateRow('2026-10-20',10,0),rateRow('2026-10-21',10,-1),rateRow('2026-10-22',10,NaN),rateRow('2026-10-23',10,null),rateRow('2026-10-24',0,10)]});
 const avg=api.averageCosts('2026-10-25',30);assert.equal(avg.fuels.Gas.days,1);assert.equal(avg.fuels.Gas.rate,0);assert.equal(avg.fuels.Coal,undefined);
 const result=api.calculatedCosts({date:'2026-10-26',fuels:{Gas:null}});assert.equal(result.generation_kwh.Gas,undefined);assert.equal(result.costs_bdt.Gas,undefined);assert.equal(result.partial,true);assert.equal(result.unavailable,true);
});
test('reported costs override calculation when published, cache invalidates, and duplicate operating dates count once',()=>{
 const api=load(),report=energyReport('2026-10-26',{Gas:2});api.setData({days:[rateRow('2026-10-25',10,2)]});assert.equal(api.calculatedCosts(report).total_bdt,10000);
 const reported=rateRow('2026-10-26',25,10);api.setData({days:[rateRow('2026-10-25',10,2),rateRow('2026-10-25',20,2),reported]});
 assert.equal(api.calculatedCosts(report),reported);assert.equal(api.averageCosts('2026-10-25',30).fuels.Gas.days,1);assert.equal(api.averageCosts('2026-10-25',30).fuels.Gas.rate,10);
 assert.match(api.dayPanel(report.date,undefined,report),/Reported daily cost/);assert.doesNotMatch(api.dayPanel(report.date,undefined,report),/CALCULATED · 30D RATES/);
});
test('second cost chart uses independently keyed per-fuel rates and selectable averaging periods',()=>{
 const api=load(),calls=[];api.setData({days:[rateRow('2026-10-24',10,2),rateRow('2026-10-25',30,3)]});
 const html=api.trendPanel([{date:'2026-10-25'},{date:'2026-10-26'}],(...args)=>{calls.push(args);return '<svg/>'},{averageDays:7});
 assert.equal(calls.length,2);assert.equal(calls[0][5].key,'bpdb-cost');assert.equal(calls[1][5].key,'bpdb-unit-cost');assert.equal(calls[1][3],'BDT/kWh');
 const [rows,layers]=calls[1];assert.equal(layers.find(s=>s.name==='Gas').value(rows[1]),8);assert.equal(rows[1].cost_rates.end,'2026-10-25');
 for(const days of [7,30,60,90,365])assert.match(html,new RegExp(`data-cost-average-days="${days}"`));
 assert.match(html,/data-cost-average-days="7" aria-pressed="true"/);assert.match(html,/Average cost per kWh by fuel type/);
});
