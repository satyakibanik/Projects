const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {load,fixture:archive}=require('./helpers/forecast-fixture.cjs');
function fixture(c,forecastDate='2026-10-23'){
 c.fixture={today_date:'2026-10-23',source_dates:{generation:'2026-10-23',demand:'2026-10-23'},generation_hourly:[{time:'00:00',total_mw:14000}],demand_hourly:[{time:'00:00',demand_mw:14500,supply_mw:14490,shed_mw:10}],imports:[],independent_forecast:{version:'erp-independent-top3-v3',status:'ready',date:forecastDate,target_basis:{demand:'ERP substation side',generation:'ERP generation including imports'},issued_at:'2026-10-22T17:00:00Z',hourly:Array.from({length:24},(_,h)=>({time:String(h).padStart(2,'0')+':00',demand_models:{Trees:13500+h,Ridge:13400+h,Median:13300+h},generation_models:{Median:14000+h,Ridge:13900+h,Trees:13800+h}}))}};
 vm.runInContext('currentDayData=fixture',c);
}
function live(){const bundle=archive();bundle.days={};bundle.pgcb_forecasts={};const state=load(bundle);fixture(state.c);return state}
function plot(c){return vm.runInContext('[...chartData.values()].filter(p=>p.series.some(s=>s.key==="demand_forecast_mw")).at(-1)',c)}
test('first panel is wholly substation-side, with reported shedding and no ERP generation or forecast layers',()=>{
 const {c}=live();const html=vm.runInContext('realTime()',c),models=vm.runInContext('[...chartData.values()].filter(p=>p.syncGroup)',c);
 assert.equal(models.length,2);assert.deepEqual(Array.from(models[0].series,s=>s.key),['demand_mw','supply_mw']);
 assert.equal(models[0].rows[0].supply_mw,14490);assert.equal(models[1].rows[0].shed_mw,10);
 assert.match(html,/demand − supply/);assert.doesNotMatch(html.split('id="independent-study-panel"')[0],/Generation · realtime|forecasted_demand_mw|independent_generation_mw/);
 assert.deepEqual(Array.from(models[0].rows,r=>r.time),Array.from(models[1].rows,r=>r.time));
});
test('expanded live forecast has all 24 horizons while future demand and generation actuals stay absent',()=>{
 const {c,open}=live();open();const html=vm.runInContext('realTime()',c),model=plot(c);
 assert.equal(model.rows.length,24);assert.equal(model.rows.filter(r=>r.demand_mw!==null).length,1);assert.equal(model.rows.filter(r=>r.generation_mw!==null).length,1);
 assert.equal(model.rows.filter(r=>Number.isFinite(r.demand_forecast_mw)).length,24);assert.equal(model.series.some(s=>s.key==='supply_mw'),false);
 assert.match(html,/Issued/);assert.match(html,/Demand forecast · Trees/);
});
test('wrong-day, partial, nonfinite and generation-side legacy forecasts cannot masquerade as ranked ERP forecasts',()=>{
 for(const mutate of [v=>v.date='2026-10-22',v=>v.hourly.pop(),v=>v.hourly[0]=null,v=>v.hourly[0].demand_models.Trees=NaN,v=>v.target_basis.demand='P4 generation side',v=>v.version='erp-independent-seven-v2']){
  const {c,open}=live();mutate(c.fixture.independent_forecast);open();const html=vm.runInContext('realTime()',c);
  assert.ok(plot(c).rows.every(r=>r.demand_forecast_mw===null));assert.match(html,/not available for this operating date/);
 }
});
test('PGCB curves match the forecast operating date and ignore the workbook selected in other tabs',()=>{
 const {c,open}=live();open();vm.runInContext("data={forecast:{date:'2026-10-23',demand_hourly:[{time:'00:00',demand_mw:99999}]}}",c);
 assert.doesNotMatch(vm.runInContext('realTime()',c),/data-toggle-series="pgcb_/);
 c.fixture.pgcb_forecast={date:'2026-10-22',hourly:[{time:'00:00',demand_mw:99999}]};
 assert.doesNotMatch(vm.runInContext('realTime()',c),/data-toggle-series="pgcb_/);
 c.fixture.pgcb_forecast={date:'2026-10-23',hourly:[{time:'00:00',demand_mw:15000,generation_mw:14900}]};
 assert.match(vm.runInContext('realTime()',c),/Demand · PGCB/);assert.equal(plot(c).rows[0].pgcb_demand_mw,15000);
});
test('live refresh preserves the selected ranked model and legend visibility',()=>{
 const {c,controls,open}=live();open();controls.get('study-demand').events.change({target:{value:'Ridge'}});
 vm.runInContext("chartVisibility.set('independent-study:2026-10-23|generation_forecast_mw',false)",c);
 vm.runInContext('realTime()',c);const before=plot(c).rows[0].demand_forecast_mw;
 c.fixture.demand_hourly.push({time:'01:00',demand_mw:14400,supply_mw:14390,shed_mw:10});vm.runInContext('realTime()',c);
 assert.equal(plot(c).rows[0].demand_forecast_mw,before);assert.equal(plot(c).rows[1].demand_mw,14400);
 assert.equal(plot(c).series.find(s=>s.key==='generation_forecast_mw').defaultVisible,false);
});
