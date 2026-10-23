const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function app(){
 const source=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 const c=vm.createContext({document:{addEventListener(){},querySelector(){return {addEventListener(){}}}},window:{addEventListener(){}},location:{hash:'#realtime'},console});
 vm.runInContext(source,c);return c;
}
function fixture(c,forecastDate='2026-10-23'){
 c.fixture={today_date:'2026-10-23',source_dates:{generation:'2026-10-23',demand:'2026-10-23'},generation_hourly:[{time:'00:00',total_mw:14000}],demand_hourly:[{time:'00:00',demand_mw:14500,shed_mw:0}],imports:[],
  independent_forecast:{status:'ready',date:forecastDate,issued_at:'2026-10-22T17:00:00Z',max_actual_input_date:'2026-10-21',issue_timing:'before operating day',hourly:Array.from({length:24},(_,h)=>({time:String(h).padStart(2,'0')+':00',generation_mw:13000+h*100,demand_mw:13500+h*100}))}};
 vm.runInContext('currentDayData=fixture',c);
}
test('one live reading still exposes two complete independent curves, off by default',()=>{
 const c=app();fixture(c);const html=vm.runInContext('realTime()',c);
 assert.match(html,/>Forecast<\/label>/);assert.match(html,/Independent median ensemble/);assert.match(html,/Independent mean ensemble/);
 assert.doesNotMatch(html,/forecasted previous day/);
 const main=vm.runInContext('[...chartData.values()].find(m=>m.series.some(s=>s.key==="independent_generation_mw"))',c);
 assert.equal(main.rows.length,24);
 assert.equal(main.rows.filter(r=>r.total_mw!==null).length,1);
 for(const key of ['independent_generation_mw','independent_demand_mw']){
  assert.equal(main.rows.filter(r=>Number.isFinite(r[key])).length,24);
  assert.equal(main.series.find(s=>s.key===key).defaultVisible,false);
  assert.match(html,new RegExp('data-series="'+key+'" style="display:none"'));
 }
 assert.doesNotMatch(html,/data-toggle-family="forecast" checked/);
});
test('wrong-day or partial independent forecasts cannot leak into today',()=>{
 const c=app();fixture(c,'2026-10-22');let html=vm.runInContext('realTime()',c);
 assert.doesNotMatch(html,/data-toggle-series="independent_/);
 fixture(c);c.fixture.independent_forecast.hourly.pop();html=vm.runInContext('realTime()',c);
 assert.doesNotMatch(html,/data-toggle-series="independent_/);assert.match(html,/not available/);
 fixture(c);c.fixture.independent_forecast.hourly=Array(24).fill(null);c.fixture.pgcb_forecast={date:'2026-10-23',hourly:{}};
 html=vm.runInContext('realTime()',c);assert.doesNotMatch(html,/data-toggle-series="independent_/);assert.match(html,/substation side/);
});
test('PGCB is absent when unavailable, dates must match, and selected workbook is irrelevant',()=>{
 const c=app();fixture(c);
 vm.runInContext("data={forecast:{date:'2026-10-23',demand_hourly:[{time:'00:00',demand_mw:99999}]}}",c);
 let html=vm.runInContext('realTime()',c);
 assert.doesNotMatch(html,/data-toggle-series="forecasted_demand_mw"/);assert.match(html,/No matching PGCB/);
 c.fixture.pgcb_forecast={date:'2026-10-22',hourly:[{time:'00:00',demand_mw:99999}]};
 html=vm.runInContext('realTime()',c);assert.doesNotMatch(html,/data-toggle-series="forecasted_demand_mw"/);
 c.fixture.pgcb_forecast={date:'2026-10-23',published_date:'2026-10-23',report_name:'23 October workbook',hourly:[{time:'00:00',demand_mw:15000}]};
 html=vm.runInContext('realTime()',c);assert.match(html,/Demand · PGCB published scenario/);
 const model=vm.runInContext('[...chartData.values()].filter(m=>m.series.some(s=>s.key==="forecasted_demand_mw")).at(-1)',c);
 assert.equal(model.series.find(s=>s.key==='forecasted_demand_mw').defaultVisible,false);
 assert.equal(model.rows[0].forecasted_demand_mw,15000);
});
test('forecast visibility remains selected across refresh and both plots keep matching timestamps',()=>{
 const c=app();fixture(c);
 vm.runInContext("chartVisibility.set('realtime:total_mw|independent_generation_mw',true)",c);
 vm.runInContext('realTime()',c);
 const models=vm.runInContext('[...chartData.values()].filter(m=>m.syncGroup)',c);
 assert.equal(models[0].series.find(s=>s.key==='independent_generation_mw').defaultVisible,true);
 assert.equal(models[0].series.find(s=>s.key==='independent_demand_mw').defaultVisible,false);
 assert.deepEqual(models[0].rows.map(r=>r.time),models[1].rows.map(r=>r.time));
});
