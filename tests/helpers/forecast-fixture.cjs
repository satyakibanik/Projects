const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function fixture(){
 const rows=forward=>Array.from({length:24},(_,h)=>({time:`${String(h).padStart(2,'0')}:00`,demand_mw:forward&&h>0?null:100+h,generation_mw:forward&&h>0?null:110+h,pgcb_demand_mw:forward?null:120+h,pgcb_generation_mw:forward?null:119+h,demand_models:{Ridge:102+h,Trees:105+h,Median:106+h,Fourth:999},generation_models:{Ridge:113+h,Trees:114+h,Median:115+h,Fourth:999}}));
 const ranking=names=>names.map((model,i)=>({model,rank:i+1,mae_mw:3+i}));
 return {dates:['2026-10-21','2026-10-23'],default_date:'2026-10-23',days:{'2026-10-21':rows(false),'2026-10-23':rows(true)},pgcb_forecasts:{'2026-10-21':{date:'2026-10-21',published_date:'2026-10-21',source_url:'https://erp.powergrid.gov.bd/web/files/download?location=5171.xlsx'}},forward_dates:['2026-10-23'],issued_at:'2026-10-23T02:00:00Z',availability:'D+1 assumed',catalog:{rankings:{demand:ranking(['Trees','Ridge','Median']),generation:ranking(['Median','Ridge','Trees'])},model_info:{Trees:{description:'Weighted ensemble.',constituents:['Ridge enriched','SVR weather']},Median:{description:'Pointwise median.',constituents:['Ridge enriched','CatBoost MAE']}},window:{start:'2026-09-24',end:'2026-10-21'}}};
}
function load(bundle=fixture()){
 const controls=new Map(['independent-study-panel','study-date','study-demand','study-generation','study-previous','study-next'].map(id=>[id,{events:{},focus(){},addEventListener(n,handler){this.events[n]=handler}}]));
 const document={addEventListener(){},querySelector:s=>controls.get(s.slice(1))||{addEventListener(){}}};
 const c=vm.createContext({document,window:{BEGD_INDEPENDENT_STUDY:bundle,addEventListener(){}},location:{hash:'#realtime'},console});
 const app=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 vm.runInContext(app,c);vm.runInContext(fs.readFileSync(path.join(root,'begd/independent-study.js'),'utf8'),c);
 c.rerender=()=>{};vm.runInContext('window.BEGDIndependentStudy?.bind(rerender)',c);
 const open=()=>controls.get('independent-study-panel').events.toggle({target:{open:true}});
 return {c,controls,open};
}
module.exports={load,fixture};
