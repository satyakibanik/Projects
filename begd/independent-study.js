/* Optional, local review of the 27 independent ERP models; no model fitting. */
(function(){
 const bundle=window.BEGD_INDEPENDENT_STUDY;
 if(!bundle)return;
 let date=bundle.default_date,windowName='development',rankTarget='demand';
 let demandModel=bundle.default_models.demand,generationModel=bundle.default_models.generation;
 const options=(values,selected,label=v=>v)=>values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
 const score=(target,model)=>bundle.scores.find(r=>r.window===windowName&&r.target===target&&r.model===model);
 function render(){
  const rows=bundle.days[date]?.map(r=>({...r,demand_forecast_mw:r.demand_models[demandModel],generation_forecast_mw:r.generation_models[generationModel]}));
  if(!rows)return '';
  const forward=bundle.forward_dates.includes(date),limits=bundle.windows[windowName];
  const series=[
   {key:'demand_mw',name:'Demand actual · ERP substation side',color:'#c48722'},
   {key:'supply_mw',name:'Supply actual · substation side',color:'#1976b9'},
   {key:'generation_mw',name:'Generation actual · ERP',color:'#263238'},
   {key:'demand_forecast_mw',name:`Demand · ${demandModel}`,color:'#d35b8c',family:'forecast',defaultVisible:true,dashArray:'3 4',noMarkers:true},
   {key:'generation_forecast_mw',name:`Generation · ${generationModel}`,color:'#8961be',family:'forecast',defaultVisible:true,dashArray:'8 4',noMarkers:true}
  ];
  const ranked=bundle.scores.filter(r=>r.window===windowName&&r.target===rankTarget).sort((a,b)=>a.mae_mw-b.mae_mw);
  const ranking=ranked.map((r,i)=>`<tr${r.selected?' class="study-selected"':''}><td>${i+1}</td><td>${esc(r.model)}${r.selected?' <strong>· selected earlier</strong>':''}</td><td class="num">${fmt(r.selection_mae_mw,1)}</td><td class="num">${fmt(r.mae_mw,1)}</td><td class="num">${fmt(r.rmse_mw,1)}</td><td class="num">${fmt(r.wape_pct,2)}%</td><td class="num">${fmt(r.improvement_vs_weekly_pct,1)}%</td></tr>`).join('');
  const stats=['demand','generation'].map(target=>{const s=score(target,target==='demand'?demandModel:generationModel);return `<span>${target==='demand'?'Demand':'Generation'} evaluation MAE <strong>${fmt(s?.mae_mw,1)} MW</strong></span>`}).join('');
  return `<section class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title"><div class="panel-head"><div><h2 id="study-title">BEGD generated forecasts</h2><p>${forward?'Current-day preview':'Historical comparison'} · ${esc(shortDate(date))} · ERP demand and generation · Bangladesh time</p></div><span class="tag">LOCAL REVIEW · ${bundle.model_count} MODELS</span></div><div class="study-controls"><label>Operating day<select id="study-date" aria-label="Independent forecast operating day">${options([...bundle.dates].reverse(),date,shortDate)}</select></label><label>Demand model · substation side<select id="study-demand" aria-label="Independent demand model">${options(bundle.models.demand,demandModel)}</select></label><label>Generation model · ERP<select id="study-generation" aria-label="Independent generation model">${options(bundle.models.generation,generationModel)}</select></label></div><div class="study-scores">${stats}<span>Evaluation: ${esc(shortDate(limits.start))} – ${esc(shortDate(limits.end))}</span></div>${chart(rows,series,{forecastLegend:'BEGD generated forecasts',key:'independent-study:'+date})}<p class="note">Demand forecasts use ERP substation-side demand; generation forecasts use ERP generation including imports. All 19 individual models and 8 ensembles exclude the target-day PGCB scenario. The default models were selected on earlier validation dates.</p><p class="note">${forward?`Issued ${esc(new Date(bundle.issued_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}))} BST, after this operating day began. Future actual readings remain blank. `:''}${esc(bundle.availability)} Historical comparisons remain retrospective; model promotion is pending local review.</p><details class="study-rankings"><summary>Compare all ${bundle.model_count} independent models and ensembles</summary><div class="study-ranking-controls"><label>Evaluation window<select id="study-window" aria-label="Model evaluation window">${options(['development','confirmation'],windowName,v=>v==='development'?'24 Sept – 21 Oct · development':'29 Aug – 9 Sept · earlier period')}</select></label><label>Target<select id="study-rank-target" aria-label="Model ranking target">${options(['demand','generation'],rankTarget,v=>v==='demand'?'Substation demand':'ERP generation')}</select></label></div><p class="note">Selection uses 14 earlier dates with a one-day embargo. The table is ordered by subsequent evaluation MAE; evaluation rank does not choose the default model. Positive improvement means lower MAE than weekly naive.</p><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Model</th><th class="num">Selection MAE MW</th><th class="num">Evaluation MAE MW</th><th class="num">RMSE MW</th><th class="num">WAPE</th><th class="num">Improvement vs weekly</th></tr></thead><tbody>${ranking}</tbody></table></div></details></section>`;
 }
 function bind(rerender){
  const controls=[['study-date',bundle.dates,v=>{date=v}],['study-demand',bundle.models.demand,v=>{demandModel=v}],['study-generation',bundle.models.generation,v=>{generationModel=v}],['study-rank-target',['demand','generation'],v=>{rankTarget=v}],['study-window',['development','confirmation'],v=>{windowName=v}]];
  for(const [id,values,update] of controls)document.querySelector('#'+id)?.addEventListener('change',event=>{
   if(!values.includes(event.target.value))return;
   const open=document.querySelector('.study-rankings')?.open;
   update(event.target.value);rerender();
   const details=document.querySelector('.study-rankings');if(details)details.open=open;
  });
 }
 window.BEGDIndependentStudy={render,bind};
})();
