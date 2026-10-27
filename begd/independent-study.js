/* Dated, frozen ERP forecasts. Rendering never fits or calibrates a model. */
(function(){
 const bundle=window.BEGD_INDEPENDENT_STUDY;
 if(!bundle)return;
 const catalog=bundle.catalog,targets=['demand','generation'];
 const ranked=target=>catalog.rankings[target].slice(0,3);
 const names=target=>ranked(target).map(r=>r.model);
 const best=Object.fromEntries(targets.map(t=>[t,names(t)[0]]));
 let selectedDate=null,expanded=true,todayExpanded=false,choices={...best};
 const options=(values,selected,label=v=>v)=>values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 function validForecast(value,day){
  return value?.version==='erp-independent-top3-v3'&&value.status==='ready'&&value.date===day&&
   value.target_basis?.demand==='ERP substation side'&&value.target_basis?.generation==='ERP generation including imports'&&
   Array.isArray(value.hourly)&&value.hourly.length===24&&value.hourly.every((r,h)=>r?.time===String(h).padStart(2,'0')+':00'&&
    targets.every(t=>names(t).every(n=>finite(r[t+'_models']?.[n]))));
 }
 function context(liveOnly=false,operatingDate=null){
  const live=typeof currentDayData==='undefined'?null:currentDayData;
  const report=typeof data==='undefined'?null:data;
  const reportScenario=report?.forecast?.scenario_date;
  const dates=[...new Set([...bundle.dates,...Object.keys(live?.forecast_history||{}),...(live?.today_date?[live.today_date]:[]),...(reportScenario?[reportScenario]:[])])].sort();
  const date=operatingDate||(liveOnly?live?.today_date:dates.includes(selectedDate)?selectedDate:live?.today_date||bundle.default_date);
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
  return {date,dates,rows,models,pgcb,forecast,forecastReason:candidate?.reason||history?.forecast_error||'',issued:forecast?.issued_at||(bundle.forward_dates.includes(date)?bundle.issued_at:null)};
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
 function subplots(ctx,liveOnly,previous=null){
  const {date,rows,models,forecastReason}=ctx;
  return targets.map(target=>{
   const label=target==='demand'?'Demand · substation side':'Generation · ERP';
   const series=[{key:target+'_mw',name:target==='demand'?'Demand actual · ERP substation side':'Generation actual · ERP',color:target==='demand'?'#b46c13':'#3678ad',marker:target==='demand'?'circle':'square'},
    {key:target+'_forecast_mw',name:`BEGD - ${target==='demand'?'Demand (Substation side)':'Generation'} - Model: ${models[target]}`,color:target==='demand'?'#c77e21':'#488ec5',marker:target==='demand'?'diamond':'triangle-down',family:'forecast',defaultVisible:true,dashArray:target==='demand'?'3 4':'8 4'}];
   const hasPgcb=rows.some(r=>finite(r['pgcb_'+target+'_mw']));
   const plotHasPgcb=hasPgcb||(liveOnly&&previous?.rows.some(r=>finite(r['pgcb_'+target+'_mw'])));
   if(plotHasPgcb){
    if(target==='demand'&&(rows.some(r=>finite(r.demand_generation_side_mw))||(liveOnly&&previous?.rows.some(r=>finite(r.demand_generation_side_mw)))))series.push({key:'demand_generation_side_mw',name:'Demand actual · generation side (PGCB scoring)',color:'#8a6b41',marker:'plus'});
    series.push({key:'pgcb_'+target+'_mw',name:target==='demand'?'PGCB - Demand (Generation side)':'PGCB - Generation',color:target==='demand'?'#cc8528':'#6098c5',marker:target==='demand'?'triangle':'cross',family:'published',defaultVisible:true,dashArray:'8 3 2 3'});
   }
   const missing=!rows.some(r=>finite(r[target+'_forecast_mw']));
   const control=liveOnly?'':`<label>${target==='demand'?'Demand model · substation side':'Generation model · ERP'}<select id="study-${target}" aria-label="Independent ${target} model">${options(names(target),models[target],name=>`#${ranked(target).find(r=>r.model===name).rank} · ${name}`)}</select></label>`;
   const pgcbScore=liveOnly?'':`<div class="pgcb-score">${score(rows,target==='demand'?'demand_generation_side_mw':'generation_mw','pgcb_'+target+'_mw','PGCB day MAE')}${!hasPgcb?'<p class="note">No matching PGCB scenario.</p>':target==='demand'?'<p class="note">Generation-side demand basis. BEGD demand MAE uses substation-side actuals.</p>':''}${hasPgcb&&target==='demand'&&!rows.some(r=>finite(r.demand_generation_side_mw))?'<p class="note">Matching generation-side demand actuals are not available yet.</p>':''}</div>`;
   const plotOptions={forecastLegend:{combine:true,title:'Forecasts'},key:(liveOnly?'today-forecast:':'independent-study:')+date+':'+target};
   const plot=liveOnly?realtimePlot(rows,series,previous?.rows||[],plotOptions):chart(rows,series,plotOptions);
   return `<section class="forecast-subplot" data-forecast-target="${target}" aria-labelledby="${liveOnly?'today':'forecast'}-${target}-title"><h3 id="${liveOnly?'today':'forecast'}-${target}-title">${label}</h3><div class="forecast-subplot-controls">${control}${liveOnly?compactScores(rows,target,hasPgcb):score(rows,target+'_mw',target+'_forecast_mw')}</div>${pgcbScore}${missing?`<p class="note" role="status">BEGD forecast unavailable for ${esc(shortDate(date))}${forecastReason?' · '+esc(forecastReason):''}.</p>`:''}${plot}${liveOnly?'':modelDescription(target,models[target])}</section>`;
  }).join('');
 }
 function issueNote({date,forecast,issued}){
  return `${forecast?.publication_kind==='retrospective'?'Retrospective reconstruction: generated after the operating day began; not a forecast issued in advance. ':''}${issued?`Issued ${esc(new Date(issued).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}))} BST. `:''}${!forecast&&bundle.forward_dates.includes(date)?'This study forecast was issued after the operating day began. ':''}Future actual readings remain blank.`;
 }
 function renderToday(){
  const ctx=context(true);if(!ctx.date)return '';
  const previous=realtimeYesterday?context(true,realtimeYesterdayDate()):null;
  return `<details class="panel independent-study-panel today-forecast-panel" id="today-forecast-panel" aria-labelledby="today-forecast-title"${todayExpanded?' open':''}><summary class="forecast-summary"><h2 id="today-forecast-title">Today's BEGD &amp; PGCB forecasts</h2><span>Operating date · ${esc(shortDate(ctx.date))} · ${todayExpanded?'Collapse':'Expand'}</span></summary><div class="forecast-body"><p class="note">Bangladesh time · top-ranked BEGD model per target · <a href="#forecast">All dates &amp; models →</a></p><div class="forecast-subplots">${subplots(ctx,true,previous)}</div>${previous?'<p class="note">Yesterday’s matching actuals and issued forecasts appear before today. MAE scores above use today’s matched hours only.</p>':''}<p class="note">${issueNote(ctx)} Models are ranked by the study evaluation, not today's partial results. PGCB scenarios use the matching operating date; PGCB demand is generation-side demand.</p></div></details>`;
 }
 function render(){
  const ctx=context(),{date,dates,pgcb}=ctx,index=dates.indexOf(date),limits=catalog.window;
  const summary=`<summary class="forecast-summary"><h2 id="study-title">BEGD generated forecasts</h2><span>Operating date · ${esc(shortDate(date))} · ${expanded?'Collapse':'Expand'}</span></summary>`;
  if(!expanded)return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title">${summary}</details>`;
  const pgcbNote=pgcb?.date===date?`PGCB scenario for ${esc(shortDate(date))}${pgcb.published_date?' · published '+esc(shortDate(pgcb.published_date)):''}${/^https:\/\/erp\.powergrid\.gov\.bd\//.test(pgcb.source_url||'')?` · <a href="${esc(pgcb.source_url)}" target="_blank" rel="noopener">source workbook</a>`:''}.`:`No matching PGCB hourly scenario is available for ${esc(shortDate(date))}.`;
  return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title" open>${summary}<div class="forecast-body"><div class="study-controls"><label>Operating date · Bangladesh time<div class="forecast-date-navigation"><button type="button" id="study-previous" aria-label="Previous forecast operating day" ${index<=0?'disabled':''}>←</button><select id="study-date" aria-label="Independent forecast operating day">${options([...dates].reverse(),date,shortDate)}</select><button type="button" id="study-next" aria-label="Next forecast operating day" ${index>=dates.length-1?'disabled':''}>→</button></div></label></div><div class="forecast-subplots">${subplots(ctx,false)}</div><p class="note">Top three per target by evaluation MAE, ${esc(shortDate(limits.start))} – ${esc(shortDate(limits.end))}; rank 1 is selected initially. Rankings are retrospective. Demand uses ERP substation-side demand; generation uses ERP generation including imports. PGCB scenarios are excluded from model inputs.</p><p class="note">${pgcbNote} PGCB demand MAE uses generation-side ERP or workbook P4 actuals, never substation demand. PGCB generation MAE uses ERP generation actuals. Each MAE uses only matching hourly readings; the demand scores have different measurement bases.</p><p class="note">${issueNote(ctx)} ${esc(bundle.availability)}</p></div></details>`;
 }
 function bind(rerender){
  document.querySelector('#today-forecast-panel')?.addEventListener('toggle',event=>{todayExpanded=event.target.open;const hint=event.target.querySelector('.forecast-summary>span');if(hint)hint.textContent='Operating date · '+shortDate(context(true).date)+' · '+(todayExpanded?'Collapse':'Expand')});
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
