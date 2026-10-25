/* Frozen daily forecasts and separately issued ERP updates. Rendering never fits a model. */
(function(){
 const bundle=window.BEGD_INDEPENDENT_STUDY;
 if(!bundle)return;
 const catalog=bundle.catalog,targets=['demand','generation'];
 const ranked=target=>catalog.rankings[target].slice(0,3);
 const names=target=>ranked(target).map(r=>r.model);
 const best=Object.fromEntries(targets.map(t=>[t,names(t)[0]]));
 let selectedDate=null,expanded=true,choices={...best};
 const options=(values,selected,label=v=>v)=>values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 function validForecast(value,day){
  return value?.version==='erp-independent-top3-v3'&&value.status==='ready'&&value.date===day&&
   value.target_basis?.demand==='ERP substation side'&&value.target_basis?.generation==='ERP generation including imports'&&
   Array.isArray(value.hourly)&&value.hourly.length===24&&value.hourly.every((r,h)=>r?.time===String(h).padStart(2,'0')+':00'&&
    targets.every(t=>names(t).every(n=>finite(r[t+'_models']?.[n]))));
 }
 function context(liveOnly=false){
  const live=typeof currentDayData==='undefined'?null:currentDayData;
  const report=typeof data==='undefined'?null:data;
  const reportScenario=report?.forecast?.scenario_date;
  const dates=[...new Set([...bundle.dates,...Object.keys(live?.forecast_history||{}),...(live?.today_date?[live.today_date]:[]),...(reportScenario?[reportScenario]:[])])].sort();
  const date=liveOnly?live?.today_date:dates.includes(selectedDate)?selectedDate:live?.today_date||bundle.default_date;
  const models=liveOnly?best:choices,history=live?.forecast_history?.[date],sameDay=Boolean(live&&live.today_date===date);
  const candidate=sameDay?live.independent_forecast:history?.forecast;
  const forecast=validForecast(candidate,date)?candidate:null,base=bundle.days[date]||[];
  const demand=new Map(((sameDay?live.demand_hourly:history?.demand_hourly)||[]).map(r=>[r.time,r]));
  const generation=new Map(((sameDay?live.generation_hourly:history?.generation_hourly)||[]).map(r=>[r.time,r]));
  const generationDemand=new Map(((sameDay?live.generation_side_demand_hourly:history?.generation_side_demand_hourly)||[]).map(r=>[r.time,r]));
  const reportPgcb=reportScenario&&reportScenario===date?{date,hourly:report.forecast.demand_hourly,published_date:report.published_date,source_url:report.source_url}:null;
  const pgcbCandidate=sameDay?live.pgcb_forecast:history?.pgcb_forecast;
  const pgcb=[pgcbCandidate,reportPgcb,bundle.pgcb_forecasts?.[date]].find(p=>p&&p.date===date&&Array.isArray(p.hourly))||
   (date&&bundle.pgcb_forecasts?.[date]?.date===date?bundle.pgcb_forecasts[date]:null);
  const pgcbRows=new Map((pgcb?.hourly||[]).map(r=>[r.time,r]));
  const actual=(value,fallback)=>finite(value)?value:finite(fallback)?fallback:null;
  const rows=Array.from({length:24},(_,h)=>{
   const time=String(h).padStart(2,'0')+':00',original=base.find(r=>r.time===time)||{},d=demand.get(time),g=generation.get(time),p=pgcbRows.get(time);
   return {time,demand_mw:actual(d?.demand_mw,sameDay?null:original.demand_mw),
    generation_mw:actual(g?.total_mw,sameDay?null:original.generation_mw),
    demand_generation_side_mw:actual(generationDemand.get(time)?.demand_mw,null),
    demand_forecast_mw:actual(forecast?.hourly[h].demand_models[models.demand],original.demand_models?.[models.demand]),
    generation_forecast_mw:actual(forecast?.hourly[h].generation_models[models.generation],original.generation_models?.[models.generation]),
    pgcb_demand_mw:pgcb?.date===date?actual(p?.demand_mw,original.pgcb_demand_mw):null,
    pgcb_generation_mw:pgcb?.date===date?actual(p?.generation_mw,original.pgcb_generation_mw):null};
  });
  const candidateUpdate=sameDay?live.forecast_update:history?.forecast_update;
  const update=candidateUpdate?.version==='erp-bias-update-v1'&&candidateUpdate.date===date?candidateUpdate:null;
  const latest=update?.latest&&update.latest.date===date?update.latest:null;
  for(const target of targets){
   if(models[target]!==best[target]||!forecast)continue;
   const revised=new Map((latest?.targets?.[target]?.hourly||[]).map(r=>[r.time,r]));
   for(const row of rows){
    const point=revised.get(row.time),hour=Date.parse(date+'T'+row.time+':00+06:00');
    row[target+'_updated_mw']=finite(point?.forecast_mw)&&point.original_mw===row[target+'_forecast_mw']&&hour>Date.parse(latest.issued_at)?point.forecast_mw:null;
   }
  }
  return {date,dates,rows,models,pgcb,forecast,update,forecastReason:candidate?.reason||history?.forecast_error||'',issued:forecast?.issued_at||(bundle.forward_dates.includes(date)?bundle.issued_at:null)};
 }
 function matchedError(rows,actualKey,forecastKey){
  const paired=rows.filter(r=>finite(r[actualKey])&&finite(r[forecastKey]));
  const mae=paired.length?paired.reduce((sum,r)=>sum+Math.abs(r[actualKey]-r[forecastKey]),0)/paired.length:null;
  return {mae,count:paired.length};
 }
 function score(rows,actualKey,forecastKey,label='Day MAE'){
  const {mae,count}=matchedError(rows,actualKey,forecastKey);
  return `<p class="study-scores">${label}${count&&count<24?' · partial':''} <strong>${mae===null?'—':fmt(mae,1)+' MW'}</strong><span class="note">${count}/24 matched hours</span></p>`;
 }
 function compactScores(rows,target,hasPgcb){
  const begd=matchedError(rows,target+'_mw',target+'_forecast_mw');
  const pgcb=matchedError(rows,target==='demand'?'demand_generation_side_mw':'generation_mw','pgcb_'+target+'_mw');
  const shared=begd.count===pgcb.count;
  const value=(name,result)=>`<span>${name}: <strong>${result.mae===null?'—':fmt(result.mae,1)+' MW'}</strong>${shared?'':` <small>(${result.count}/24)</small>`}</span>`;
  const note=!hasPgcb?'No matching PGCB scenario.':target==='demand'&&!pgcb.count?'PGCB MAE unavailable: no generation-side actuals in this snapshot.':'';
  return `<div class="compact-scores"><p class="mae-caption">Day MAE (${shared?begd.count+'/24 matched hours':'matched hours'})</p><p class="mae-values">${value('PGCB',pgcb)}${value('BEGD',begd)}</p>${note?`<p class="note mae-note">${note}</p>`:''}</div>`;
 }
 function modelDescription(target,name){
  const info=catalog.model_info[name]||{},members=info.constituents||[];
  return `<div class="model-description"><p class="note"><strong>${target==='demand'?'Demand':'Generation'} · ${esc(name)}.</strong> ${esc(info.description||'')}</p>${members.length?`<details class="model-members"><summary>Constituent models (${members.length})</summary><p class="note">${members.map(esc).join(' · ')}</p></details>`:''}</div>`;
 }
 function updateSummary(ctx,target){
  if(ctx.models[target]!==best[target])return '';
  const result=ctx.update?.scores?.[target],latest=ctx.update?.latest,inputs=latest?.targets?.[target];
  const count=Number.isInteger(result?.count)&&result.count>=0&&result.count<=24?result.count:0;
  const scored=count&&finite(result.updated_mae_mw)&&finite(result.original_mae_mw);
  const values=scored?`<p class="study-scores">Saved update MAE <strong>${fmt(result.updated_mae_mw,1)} MW</strong><span>Original on the same ${count} hours <strong>${fmt(result.original_mae_mw,1)} MW</strong></span></p>`:'<p class="note">Saved update MAE: pending later ERP readings.</p>';
  const issued=inputs?`Updated ${esc(new Date(latest.issued_at).toLocaleTimeString('en-GB',{timeZone:'Asia/Dhaka',hour:'2-digit',minute:'2-digit'}))} BST using readings through ${esc(inputs.input_through)}. `:'';
  const limitations=target==='generation'?'This generation update is a statistical correction; it does not model plant availability, dispatch schedules, import schedules or ramp constraints.':'Hourly ERP readings can arrive late; their timing and resolution differ from control-room telemetry.';
  const method=`<details class="model-members update-method"><summary>Method, operator precedent &amp; limitations</summary><p class="note">BEGD includes an experimental intraday bias-adjustment layer informed by recent ERP observations. It follows the operational principle of refreshing short-term forecasts as observations arrive. Its parameters and accuracy are evaluated independently.</p><p class="note">The correction uses 80% of the median error from up to three consecutive readings, fades with a six-hour half-life and is capped at 15% of the original forecast. These are experimental settings.</p><p class="note">Operational examples: <a href="https://www.iso-ne.com/static-assets/documents/rules_proceds/operating/sysop/cr_ops/crop_25004.pdf#page=4" target="_blank" rel="noopener">ISO New England forecast adjustment procedure</a>; <a href="https://bpmcm.caiso.com/BPM%20Document%20Library/Market%20Operations/BPM_for_Market%20Operations_V101_Redline.pdf#page=379" target="_blank" rel="noopener">CAISO real-time load forecasting, §7.8.1.3</a>; <a href="https://www.ercot.com/files/docs/2018/05/22/Hurricane_Harvey_Event_Analysis_Report.pdf#page=8" target="_blank" rel="noopener">ERCOT use of recent actual load, §6.3</a>. These examples support the updating principle; they do not validate BEGD's formula or establish PGCB/NLDC endorsement.</p><p class="note">${limitations} The initial four-hour replay is diagnostic. Reliability requires prospective evaluation across many operating days and forecast horizons.</p></details>`;
  return `<div class="forecast-update-summary"><p class="note"><strong>Experimental ERP forecast update.</strong> ${issued}${inputs?'The additional curve covers future hours only.':'A future curve requires at least two consecutive ERP readings, with the latest no more than three hours old.'}</p>${values}<p class="note">Update errors use saved predictions issued before each scored hour. The original day forecast and its MAE stay unchanged.</p>${method}</div>`;
 }
 function subplots(ctx,liveOnly){
  const {date,rows,models,forecastReason}=ctx;
  return targets.map(target=>{
   const label=target==='demand'?'Demand · substation side':'Generation · ERP';
   const series=[{key:target+'_mw',name:target==='demand'?'Demand actual · ERP substation side':'Generation actual · ERP',color:target==='demand'?'#b46c13':'#3678ad',marker:target==='demand'?'circle':'square'},
    {key:target+'_forecast_mw',name:`BEGD - ${target==='demand'?'Demand (Substation side)':'Generation'} - Model: ${models[target]}`,color:target==='demand'?'#c77e21':'#488ec5',marker:target==='demand'?'diamond':'triangle-down',family:'forecast',defaultVisible:true,dashArray:target==='demand'?'3 4':'8 4'}];
   if(rows.some(r=>finite(r[target+'_updated_mw'])))series.push({key:target+'_updated_mw',name:'BEGD - '+(target==='demand'?'Demand':'Generation')+' · ERP update (future hours)',color:target==='demand'?'#b85c3f':'#955bb0',marker:'plus',family:'forecast',defaultVisible:true,dashArray:'2 3'});
   const hasPgcb=rows.some(r=>finite(r['pgcb_'+target+'_mw']));
   if(hasPgcb){
    if(target==='demand'&&rows.some(r=>finite(r.demand_generation_side_mw)))series.push({key:'demand_generation_side_mw',name:'Demand actual · generation side (PGCB scoring)',color:'#8a6b41',marker:'plus'});
    series.push({key:'pgcb_'+target+'_mw',name:target==='demand'?'PGCB - Demand (Generation side)':'PGCB - Generation',color:target==='demand'?'#cc8528':'#6098c5',marker:target==='demand'?'triangle':'cross',family:'published',defaultVisible:true,dashArray:'8 3 2 3'});
   }
   const missing=!rows.some(r=>finite(r[target+'_forecast_mw']));
   const control=liveOnly?'':`<label>${target==='demand'?'Demand model · substation side':'Generation model · ERP'}<select id="study-${target}" aria-label="Independent ${target} model">${options(names(target),models[target],name=>`#${ranked(target).find(r=>r.model===name).rank} · ${name}`)}</select></label>`;
   const pgcbScore=liveOnly?'':`<div class="pgcb-score">${score(rows,target==='demand'?'demand_generation_side_mw':'generation_mw','pgcb_'+target+'_mw','PGCB day MAE')}${!hasPgcb?'<p class="note">No matching PGCB scenario.</p>':target==='demand'?'<p class="note">Generation-side demand basis. BEGD demand MAE uses substation-side actuals.</p>':''}${hasPgcb&&target==='demand'&&!rows.some(r=>finite(r.demand_generation_side_mw))?'<p class="note">Matching generation-side demand actuals are not available yet.</p>':''}</div>`;
   return `<section class="forecast-subplot" data-forecast-target="${target}" aria-labelledby="${liveOnly?'today':'forecast'}-${target}-title"><h3 id="${liveOnly?'today':'forecast'}-${target}-title">${label}</h3><div class="forecast-subplot-controls">${control}${liveOnly?compactScores(rows,target,hasPgcb):score(rows,target+'_mw',target+'_forecast_mw')}</div>${pgcbScore}${missing?`<p class="note" role="status">BEGD forecast unavailable for ${esc(shortDate(date))}${forecastReason?' · '+esc(forecastReason):''}.</p>`:''}${chart(rows,series,{forecastLegend:{combine:true,title:'Forecasts'},key:(liveOnly?'today-forecast:':'independent-study:')+date+':'+target})}${ctx.update?updateSummary(ctx,target):''}${liveOnly?'':modelDescription(target,models[target])}</section>`;
  }).join('');
 }
 function issueNote({date,forecast,issued}){
  return `${forecast?.publication_kind==='retrospective'?'Retrospective reconstruction: generated after the operating day began; not a forecast issued in advance. ':''}${issued?`Issued ${esc(new Date(issued).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}))} BST. `:''}${!forecast&&bundle.forward_dates.includes(date)?'This study forecast was issued after the operating day began. ':''}Future actual readings remain blank.`;
 }
 function renderToday(){
  const ctx=context(true);if(!ctx.date)return '';
  return `<section class="panel independent-study-panel today-forecast-panel" id="today-forecast-panel" aria-labelledby="today-forecast-title"><div class="panel-head"><div><h2 id="today-forecast-title">Today's BEGD &amp; PGCB forecasts</h2><p>Operating date · ${esc(shortDate(ctx.date))} · Bangladesh time · top-ranked BEGD model per target</p></div><a href="#forecast">All dates &amp; models →</a></div><div class="forecast-body"><div class="forecast-subplots">${subplots(ctx,true)}</div><p class="note">${issueNote(ctx)} Models are ranked by the study evaluation, not today's partial results. PGCB scenarios use the matching operating date; PGCB demand is generation-side demand.</p></div></section>`;
 }
 function render(){
  const ctx=context(),{date,dates,pgcb}=ctx,index=dates.indexOf(date),limits=catalog.window;
  const summary=`<summary class="forecast-summary"><h2 id="study-title">BEGD generated forecasts</h2><span>Operating date · ${esc(shortDate(date))} · ${expanded?'Collapse':'Expand'}</span></summary>`;
  if(!expanded)return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title">${summary}</details>`;
  const pgcbNote=pgcb?.date===date?`PGCB scenario for ${esc(shortDate(date))}${pgcb.published_date?' · published '+esc(shortDate(pgcb.published_date)):''}${/^https:\/\/erp\.powergrid\.gov\.bd\//.test(pgcb.source_url||'')?` · <a href="${esc(pgcb.source_url)}" target="_blank" rel="noopener">source workbook</a>`:''}.`:`No matching PGCB hourly scenario is available for ${esc(shortDate(date))}.`;
  return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title" open>${summary}<div class="forecast-body"><div class="study-controls"><label>Operating date · Bangladesh time<div class="forecast-date-navigation"><button type="button" id="study-previous" aria-label="Previous forecast operating day" ${index<=0?'disabled':''}>←</button><select id="study-date" aria-label="Independent forecast operating day">${options([...dates].reverse(),date,shortDate)}</select><button type="button" id="study-next" aria-label="Next forecast operating day" ${index>=dates.length-1?'disabled':''}>→</button></div></label></div><div class="forecast-subplots">${subplots(ctx,false)}</div><p class="note">Top three per target by evaluation MAE, ${esc(shortDate(limits.start))} – ${esc(shortDate(limits.end))}; rank 1 is selected initially. Rankings are retrospective. Demand uses ERP substation-side demand; generation uses ERP generation including imports. PGCB scenarios are excluded from model inputs.</p><p class="note">${pgcbNote} PGCB demand MAE uses generation-side ERP or workbook P4 actuals, never substation demand. PGCB generation MAE uses ERP generation actuals. Each MAE uses only matching hourly readings; the demand scores have different measurement bases.</p><p class="note">${issueNote(ctx)} ${esc(bundle.availability)}</p></div></details>`;
 }
 function bind(rerender){
  document.querySelector('#independent-study-panel')?.addEventListener('toggle',event=>{if(expanded!==event.target.open){expanded=event.target.open;rerender()}});
  document.querySelector('#study-date')?.addEventListener('change',event=>{if(context().dates.includes(event.target.value)){selectedDate=event.target.value;rerender()}});
  for(const target of targets)document.querySelector('#study-'+target)?.addEventListener('change',event=>{if(names(target).includes(event.target.value)){choices[target]=event.target.value;rerender()}});
  for(const [id,direction] of [['study-previous',-1],['study-next',1]])document.querySelector('#'+id)?.addEventListener('click',()=>{
   const {dates,date}=context(),next=dates[dates.indexOf(date)+direction];
   if(next){selectedDate=next;rerender();document.querySelector('#'+id)?.focus({preventScroll:true})}
  });
 }
 window.BEGDIndependentStudy={render,renderToday,bind};
})();
