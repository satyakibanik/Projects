const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const {load,fixture}=require('./helpers/forecast-fixture.cjs');
test('forecast panel is second, initially collapsed and does not construct a hidden chart',()=>{
 const {c}=load();vm.runInContext("currentDayData={today_date:'2026-10-23',demand_hourly:[{time:'00:00',demand_mw:100,supply_mw:99,shed_mw:1}],generation_hourly:[],imports:[]}",c);
 const html=vm.runInContext('realTime()',c);
 assert.ok(html.indexOf('Demand, supply, &amp; load shedding.')<html.indexOf('id="independent-study-panel"'));
 assert.match(html,/<details class="panel independent-study-panel"[^>]*><summary/);
 assert.doesNotMatch(html,/id="study-demand"/);
 assert.equal(vm.runInContext('[...chartData.values()].length',c),2);
});
test('expansion separates demand and generation into subplots with their own model controls',()=>{
 const {c,open}=load();open();const html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 const model=vm.runInContext('[...chartData.values()][0]',c);
 assert.equal(model.rows.length,24);assert.equal(model.rows.filter(r=>r.demand_mw!==null).length,1);
 assert.equal(model.rows.filter(r=>Number.isFinite(r.demand_forecast_mw)).length,24);
 assert.equal(model.rows[0].demand_forecast_mw,105);assert.equal(model.rows[0].generation_forecast_mw,115);
 assert.equal(model.series.some(s=>s.key==='supply_mw'),false);
 const plots=vm.runInContext('[...chartData.values()].slice(-2)',c);
 assert.equal(plots.length,2);
 for(const [index,target] of ['demand','generation'].entries()){
  assert.deepEqual(Array.from(plots[index].series,s=>s.key),[target+'_mw',target+'_forecast_mw']);
  assert.equal(plots[index].rows.length,24);
  const subplot=html.match(new RegExp('<section class="forecast-subplot" data-forecast-target="'+target+'"[^>]*>([^]*?)</section>'))[1];
  assert.match(subplot,new RegExp('id="study-'+target+'"'));
  assert.doesNotMatch(subplot,new RegExp('id="study-'+(target==='demand'?'generation':'demand')+'"'));
  assert.match(subplot,/Evaluation MAE/);assert.match(subplot,/model-description/);
 }
 assert.match(html,/Generation actual · ERP/);assert.match(html,/Operating date/);
 assert.match(html,/D\+1 assumed/);assert.match(html,/Constituent models \(2\)/);assert.match(html,/SVR weather/);
});
test('only three ranked choices are offered for each target, rank one is selected and manual choices persist',()=>{
 const bundle=fixture(),before=JSON.stringify(bundle),{c,controls,open}=load(bundle);open();
 let html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 for(const target of ['demand','generation']){
  const select=html.match(new RegExp('<select id="study-'+target+'"[^>]*>([^]*?)</select>'))[1];
  assert.equal((select.match(/<option /g)||[]).length,3);assert.match(select,/selected>#1/);assert.doesNotMatch(select,/Fourth/);
 }
 controls.get('study-demand').events.change({target:{value:'Ridge'}});
 controls.get('study-date').events.change({target:{value:'2026-10-21'}});
 controls.get('study-generation').events.change({target:{value:'Fourth'}});
 html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.match(html,/Demand forecast · Ridge/);assert.match(html,/Generation forecast · Median/);
 assert.equal(JSON.stringify(bundle),before);
});
test('date arrows skip absent days, stop at either end and retain the open panel',()=>{
 const {c,controls,open}=load();open();
 controls.get('study-previous').events.click();
 let html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.match(html,/21 Oct 2026/);assert.match(html,/id="study-previous"[^>]*disabled/);assert.match(html,/aria-labelledby="study-title" open/);
 controls.get('study-previous').events.click();
 controls.get('study-next').events.click();
 html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.match(html,/23 Oct 2026/);assert.match(html,/id="study-next"[^>]*disabled/);
});
test('PGCB curves require the explicitly matching operating day and preserve their measurement basis',()=>{
 const {c,controls,open}=load();open();
 assert.doesNotMatch(vm.runInContext('window.BEGDIndependentStudy.render()',c),/data-toggle-series="pgcb_/);
 controls.get('study-date').events.change({target:{value:'2026-10-21'}});
 const html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.match(html,/data-toggle-family="published" checked/);assert.match(html,/Demand · PGCB \(generation side\)/);
 assert.match(html,/not scored against ERP substation demand/);assert.match(html,/source workbook/);
 const mismatch=fixture();mismatch.pgcb_forecasts['2026-10-21'].date='2026-10-20';mismatch.default_date='2026-10-21';
 const other=load(mismatch);other.open();assert.doesNotMatch(vm.runInContext('window.BEGDIndependentStudy.render()',other.c),/data-toggle-series="pgcb_/);
});
test('hue families and unique markers remain readable on both chart themes',()=>{
 const bundle=fixture();bundle.default_date='2026-10-21';const {c,open}=load(bundle);open();
 const html=vm.runInContext('window.BEGDIndependentStudy.render()',c),series=vm.runInContext('[...chartData.values()].slice(-2).flatMap(p=>p.series)',c);
 const hue=color=>{const [r,g,b]=color.slice(1).match(/../g).map(s=>parseInt(s,16)/255);const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;return (max===r?(g-b)/delta:max===g?2+(b-r)/delta:4+(r-g)/delta)*60};
 for(const s of series.filter(s=>s.key.includes('demand')))assert.ok(hue(s.color)>25&&hue(s.color)<45);
 for(const s of series.filter(s=>s.key.includes('generation')))assert.ok(hue(s.color)>195&&hue(s.color)<220);
 const luminance=color=>color.slice(1).match(/../g).map(s=>parseInt(s,16)/255).reduce((sum,v,i)=>sum+[.2126,.7152,.0722][i]*(v<=.04045?v/12.92:((v+.055)/1.055)**2.4),0);
 for(const s of series)for(const background of ['#ffffff','#121f2c']){
  const values=[luminance(s.color),luminance(background)].sort((a,b)=>a-b);assert.ok((values[1]+.05)/(values[0]+.05)>=3);
 }
 assert.equal(new Set(series.map(s=>s.marker)).size,6);assert.match(html,/square markers/);assert.match(html,/data-marker="diamond"/);
});
test('the production HTML includes the reviewed archive, panel code and model composition',()=>{
 const html=fs.readFileSync(path.join(root,'begd/index.html'),'utf8');
 assert.match(html,/src="independent-study-data.js/);assert.match(html,/src="independent-study.js/);
 const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(path.join(root,'begd/independent-study-data.js'),'utf8'),c);
 const bundle=c.window.BEGD_INDEPENDENT_STUDY;
 for(const target of ['demand','generation']){
  const ranked=bundle.catalog.rankings[target];assert.equal(ranked.length,3);
  for(const r of ranked)assert.ok(bundle.catalog.model_info[r.model].constituents.length>=7);
  for(const rows of Object.values(bundle.days))for(const row of rows){
   assert.equal(Object.keys(row[target+'_models']).length,3);assert.equal('supply_mw' in row,false);
  }
 }
});
