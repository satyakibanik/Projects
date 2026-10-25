const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {load,fixture}=require('./helpers/forecast-fixture.cjs');

function live(){
 const {c,controls}=load(fixture());
 const hourly=Array.from({length:24},(_,h)=>({time:String(h).padStart(2,'0')+':00',demand_models:{Trees:105+h,Ridge:102+h,Median:106+h},generation_models:{Median:115+h,Ridge:113+h,Trees:114+h}}));
 const issue={version:'erp-bias-update-v1',date:'2026-10-23',issued_at:'2026-10-23T01:05:00+06:00',targets:{demand:{input_through:'00:00',hourly:[{time:'00:00',forecast_mw:100,original_mw:105},{time:'02:00',forecast_mw:103,original_mw:107}]} }};
 c.live={today_date:'2026-10-23',demand_hourly:[{time:'00:00',demand_mw:100}],generation_hourly:[],imports:[],independent_forecast:{version:'erp-independent-top3-v3',status:'ready',date:'2026-10-23',target_basis:{demand:'ERP substation side',generation:'ERP generation including imports'},issued_at:'2026-10-22T12:00:00Z',hourly},forecast_update:{version:'erp-bias-update-v1',date:'2026-10-23',latest:issue,scores:{demand:{count:0,updated_mae_mw:null,original_mae_mw:null}}}};
 vm.runInContext('currentDayData=live',c);
 return {c,controls};
}

test('future update is a separate curve and does not erase the original midnight error',()=>{
 const {c}=live(),html=vm.runInContext('realTime()',c);
 const demand=vm.runInContext('[...chartData.values()].find(p=>p.series.some(s=>s.key==="demand_updated_mw"))',c);
 assert.ok(demand);assert.equal(demand.rows[0].demand_updated_mw,null);
 assert.equal(demand.rows[0].demand_forecast_mw,105);
 assert.equal(demand.rows[2].demand_updated_mw,103);
 assert.match(html,/ERP update \(future hours\)/);assert.match(html,/Saved update MAE: pending later ERP readings/);
 assert.match(html,/using readings through 00:00/);
 assert.match(html,/BEGD: <strong>5 MW/);
});

test('update scores compare the saved update and original on exactly the same hours',()=>{
 const {c}=live();c.live.forecast_update.scores.demand={count:3,updated_mae_mw:2,original_mae_mw:8};
 const html=vm.runInContext('realTime()',c);
 assert.match(html,/Saved update MAE <strong>2 MW/);
 assert.match(html,/Original on the same 3 hours <strong>8 MW/);
 assert.match(html,/issued before each scored hour/);
});

test('wrong-day, wrong-baseline, malformed and nonfinite update curves are hidden',()=>{
 for(const mutate of [v=>v.date='2026-10-22',v=>v.latest.date='2026-10-22',v=>v.latest.issued_at='invalid',v=>v.latest.targets.demand.hourly[1].original_mw=999,v=>v.latest.targets.demand.hourly[1].forecast_mw=NaN]){
  const {c}=live();mutate(c.live.forecast_update);
  const html=vm.runInContext('realTime()',c);
  assert.doesNotMatch(html,/data-toggle-series="demand_updated_mw"/);
 }
});

test('switching the original model cannot display a correction made for another model',()=>{
 const {c,controls}=live();controls.get('study-demand').events.change({target:{value:'Ridge'}});
 const html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.doesNotMatch(html,/data-toggle-series="demand_updated_mw"/);
 assert.match(html,/Model: Ridge/);
});
