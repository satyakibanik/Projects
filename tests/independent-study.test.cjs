const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function fixture(){
 const rows=forward=>Array.from({length:24},(_,h)=>({time:`${String(h).padStart(2,'0')}:00`,demand_mw:forward&&h>0?null:100+h,supply_mw:forward&&h>0?null:99+h,generation_mw:forward&&h>0?null:110+h,demand_models:{Ridge:102+h,Trees:105+h},generation_models:{Ridge:113+h,Trees:114+h}}));
 const scores=[];
 for(const window of ['development','confirmation'])for(const target of ['demand','generation'])for(const model of ['Ridge','Trees'])scores.push({window,target,model,selected:model==='Ridge',selection_mae_mw:2,mae_mw:3,rmse_mw:4,wape_pct:5,improvement_vs_weekly_pct:6});
 return {dates:['2026-10-21','2026-10-23'],default_date:'2026-10-23',default_models:{demand:'Trees',generation:'Ridge'},models:{demand:['Ridge','Trees'],generation:['Ridge','Trees']},availability:'D+1 assumed',days:{'2026-10-21':rows(false),'2026-10-23':rows(true)},forward_dates:['2026-10-23'],issued_at:'2026-10-23T02:00:00Z',model_count:27,scores,windows:{development:{start:'2026-09-24',end:'2026-10-21'},confirmation:{start:'2026-08-29',end:'2026-09-09'}}};
}
function load(bundle=fixture()){
 const controls=new Map(['study-date','study-demand','study-generation','study-window','study-rank-target'].map(id=>[id,{events:{},addEventListener(n,handler){this.events[n]=handler}}]));
 const details={open:true};
 const document={addEventListener(){},querySelector(s){return s==='.study-rankings'?details:controls.get(s.slice(1))||{addEventListener(){}}}};
 const c=vm.createContext({document,window:{BEGD_INDEPENDENT_STUDY:bundle,addEventListener(){}},location:{hash:'#realtime'},console});
 const app=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 vm.runInContext(app,c);vm.runInContext(fs.readFileSync(path.join(root,'begd/independent-study.js'),'utf8'),c);
 return {c,controls};
}
test('current-day candidates show all 24 forecasts without inventing future ERP actuals',()=>{
 const {c}=load();const html=vm.runInContext('realTime()',c);
 assert.match(html,/BEGD generated forecasts/);assert.match(html,/Current-day preview · 23 Oct 2026/);
 assert.match(html,/Generation actual · ERP/);assert.doesNotMatch(html,/Generation actual · P4/);
 const rows=vm.runInContext('[...chartData.values()][0].rows',c);
 assert.equal(rows.length,24);assert.equal(rows.filter(r=>r.demand_mw!==null).length,1);
 assert.equal(rows.filter(r=>Number.isFinite(r.demand_forecast_mw)).length,24);
 assert.equal(rows[0].demand_forecast_mw,105);assert.equal(rows[0].generation_forecast_mw,113);
 assert.match(html,/historical publication|D\+1 assumed/);
});
test('changing the date and either candidate preserves the other independent selections',()=>{
 const bundle=fixture(),before=JSON.stringify(bundle),{c,controls}=load(bundle);let renders=0;
 c.rerender=()=>renders++;vm.runInContext('window.BEGDIndependentStudy.bind(rerender)',c);
 controls.get('study-date').events.change({target:{value:'2026-10-21'}});
 controls.get('study-demand').events.change({target:{value:'Ridge'}});
 const html=vm.runInContext('window.BEGDIndependentStudy.render()',c);
 assert.match(html,/Historical comparison · 21 Oct 2026/);assert.match(html,/Demand · Ridge/);assert.match(html,/Generation · Ridge/);
 assert.equal(renders,2);assert.equal(JSON.stringify(bundle),before);
});
test('the optional local comparison is absent in ordinary Pages HTML',()=>{
 const {c}=load(null);assert.equal(c.window.BEGDIndependentStudy,undefined);
 assert.doesNotMatch(vm.runInContext('realTime()',c),/independent-study-panel/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'begd/index.html'),'utf8'),/src="independent-study/);
});
