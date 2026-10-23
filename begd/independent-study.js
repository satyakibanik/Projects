/* Dated, frozen ERP forecasts. Rendering never fits or calibrates a model. */
(function(){
 const bundle=window.BEGD_INDEPENDENT_STUDY;
 if(!bundle)return;
 const catalog=bundle.catalog;
 const targets=['demand','generation'];
 const ranked=target=>catalog.rankings[target].slice(0,3);
 const names=target=>ranked(target).map(r=>r.model);
 let selectedDate=null,expanded=false;
 let choices=Object.fromEntries(targets.map(t=>[t,names(t)[0]]));
 const options=(values,selected,label=v=>v)=>values.map(v=>`<option value="${esc(v)}"${v===selected?' selected':''}>${esc(label(v))}</option>`).join('');
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 function validForecast(value,day){
  return value?.version==='erp-independent-top3-v3'&&value.status==='ready'&&value.date===day&&
   value.target_basis?.demand==='ERP substation side'&&value.target_basis?.generation==='ERP generation including imports'&&
   Array.isArray(value.hourly)&&value.hourly.length===24&&value.hourly.every((r,h)=>r?.time===String(h).padStart(2,'0')+':00'&&
    targets.every(t=>names(t).every(n=>finite(r[t+'_models']?.[n]))));
 }
 function context(){
  const live=typeof currentDayData==='undefined'?null:currentDayData;
  const dates=[...new Set([...bundle.dates,...Object.keys(live?.forecast_history||{}),...(live?.today_date?[live.today_date]:[])])].sort();
  const date=dates.includes(selectedDate)?selectedDate:live?.today_date||bundle.default_date;
  const history=live?.forecast_history?.[date];
  const candidate=date===live?.today_date?live.independent_forecast:history?.forecast;
  const forecast=validForecast(candidate,date)?candidate:null;
  const base=bundle.days[date]||[];
  const sameDay=live?.today_date===date;
  const demand=new Map(((sameDay?live.demand_hourly:history?.demand_hourly)||[]).map(r=>[r.time,r]));
  const generation=new Map(((sameDay?live.generation_hourly:history?.generation_hourly)||[]).map(r=>[r.time,r]));
  const pgcbCandidate=sameDay?live.pgcb_forecast:history?.pgcb_forecast;
  const pgcb=pgcbCandidate?.date===date&&Array.isArray(pgcbCandidate.hourly)?pgcbCandidate:bundle.pgcb_forecasts?.[date];
  const pgcbRows=new Map((pgcb?.date===date&&Array.isArray(pgcb.hourly)?pgcb.hourly:[]).map(r=>[r.time,r]));
  const rows=Array.from({length:24},(_,h)=>{
   const time=String(h).padStart(2,'0')+':00',original=base.find(r=>r.time===time)||{},d=demand.get(time),g=generation.get(time),p=pgcbRows.get(time);
   const actual=(value,fallback)=>finite(value)?value:finite(fallback)?fallback:null;
   return {time,demand_mw:actual(d?.demand_mw,sameDay?null:original.demand_mw),
    generation_mw:actual(g?.total_mw,sameDay?null:original.generation_mw),
    demand_forecast_mw:actual(forecast?.hourly[h].demand_models[choices.demand],original.demand_models?.[choices.demand]),
    generation_forecast_mw:actual(forecast?.hourly[h].generation_models[choices.generation],original.generation_models?.[choices.generation]),
    pgcb_demand_mw:pgcb?.date===date?actual(p?.demand_mw,original.pgcb_demand_mw):null,
    pgcb_generation_mw:pgcb?.date===date?actual(p?.generation_mw,original.pgcb_generation_mw):null};
  });
  return {date,dates,rows,pgcb,forecast,issued:forecast?.issued_at||(bundle.forward_dates.includes(date)?bundle.issued_at:null)};
 }
 function modelDescription(target){
  const name=choices[target],info=catalog.model_info[name]||{},members=info.constituents||[];
  return `<div class="model-description"><p class="note"><strong>${target==='demand'?'Demand':'Generation'} · ${esc(name)}.</strong> ${esc(info.description||'')}</p>${members.length?`<details class="model-members"><summary>Constituent models (${members.length})</summary><p class="note">${members.map(esc).join(' · ')}</p></details>`:''}</div>`;
 }
 function render(){
  const {date,dates,rows,pgcb,forecast,issued}=context();
  const index=dates.indexOf(date);
  const summary=`<summary class="forecast-summary"><h2 id="study-title">BEGD generated forecasts</h2><span>Operating date · ${esc(shortDate(date))} · ${expanded?'Collapse':'Expand'}</span></summary>`;
  if(!expanded)return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title">${summary}</details>`;
  const series=[
   {key:'demand_mw',name:'Demand actual · ERP substation side',color:'#b46c13',marker:'circle'},
   {key:'generation_mw',name:'Generation actual · ERP',color:'#3678ad',marker:'square'},
   {key:'demand_forecast_mw',name:`Demand forecast · ${choices.demand}`,color:'#c77e21',marker:'diamond',family:'forecast',defaultVisible:true,dashArray:'3 4'},
   {key:'generation_forecast_mw',name:`Generation forecast · ${choices.generation}`,color:'#488ec5',marker:'triangle-down',family:'forecast',defaultVisible:true,dashArray:'8 4'},
   ...(rows.some(r=>finite(r.pgcb_demand_mw))?[{key:'pgcb_demand_mw',name:'Demand · PGCB (generation side)',color:'#cc8528',marker:'triangle',family:'published',defaultVisible:true,dashArray:'8 3 2 3'}]:[]),
   ...(rows.some(r=>finite(r.pgcb_generation_mw))?[{key:'pgcb_generation_mw',name:'Generation · PGCB',color:'#6098c5',marker:'cross',family:'published',defaultVisible:true,dashArray:'8 3 2 3'}]:[])
  ];
  const pgcbNote=pgcb?.date===date?`PGCB scenario for ${esc(shortDate(date))}${pgcb.published_date?' · published '+esc(shortDate(pgcb.published_date)):''}${/^https:\/\/erp\.powergrid\.gov\.bd\//.test(pgcb.source_url||'')?` · <a href="${esc(pgcb.source_url)}" target="_blank" rel="noopener">source workbook</a>`:''}. PGCB demand is generation-side and is not scored against ERP substation demand.`:`No matching PGCB hourly scenario is available for ${esc(shortDate(date))}.`;
  const limits=catalog.window;
  const subplots=targets.map(target=>{
   const entry=ranked(target).find(r=>r.model===choices[target]);
   const label=target==='demand'?'Demand · substation side':'Generation · ERP';
   const selectedSeries=series.filter(s=>s.key.startsWith(target+'_')||s.key==='pgcb_'+target+'_mw');
   const missing=!rows.some(r=>finite(r[target+'_forecast_mw']));
   return `<section class="forecast-subplot" data-forecast-target="${target}" aria-labelledby="forecast-${target}-title"><h3 id="forecast-${target}-title">${label}</h3><div class="forecast-subplot-controls"><label>${target==='demand'?'Demand model · substation side':'Generation model · ERP'}<select id="study-${target}" aria-label="Independent ${target} model">${options(names(target),choices[target],name=>{const r=ranked(target).find(r=>r.model===name);return `#${r.rank} · ${name}`})}</select></label><p class="study-scores">Evaluation MAE <strong>${fmt(entry.mae_mw,1)} MW</strong></p></div>${missing?'<p class="note" role="status">Ranked forecasts are not available for this operating date yet.</p>':''}${chart(rows,selectedSeries,{forecastLegend:'BEGD generated forecast',publishedLegend:target==='demand'?'PGCB published scenario · generation side':'PGCB published scenario',key:'independent-study:'+date+':'+target})}${modelDescription(target)}</section>`;
  }).join('');
  return `<details class="panel independent-study-panel" id="independent-study-panel" aria-labelledby="study-title" open>${summary}<div class="forecast-body"><div class="study-controls"><label>Operating date · Bangladesh time<div class="forecast-date-navigation"><button type="button" id="study-previous" aria-label="Previous forecast operating day" ${index<=0?'disabled':''}>←</button><select id="study-date" aria-label="Independent forecast operating day">${options([...dates].reverse(),date,shortDate)}</select><button type="button" id="study-next" aria-label="Next forecast operating day" ${index>=dates.length-1?'disabled':''}>→</button></div></label></div><div class="forecast-subplots">${subplots}</div><p class="note">Top three per target by evaluation MAE, ${esc(shortDate(limits.start))} – ${esc(shortDate(limits.end))}; rank 1 is selected initially. Rankings are retrospective. Demand uses ERP substation-side demand; generation uses ERP generation including imports. PGCB scenarios are excluded from model inputs.</p><p class="note">${pgcbNote}</p><p class="note">${issued?`Issued ${esc(new Date(issued).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}))} BST. `:''}${!forecast&&bundle.forward_dates.includes(date)?'This study forecast was issued after the operating day began. ':''}Future actual readings remain blank. ${esc(bundle.availability)}</p></div></details>`;

 }
 function bind(rerender){
  document.querySelector('#independent-study-panel')?.addEventListener('toggle',event=>{
   if(expanded===event.target.open)return;
   expanded=event.target.open;rerender();
  });
  const update=()=>{rerender()};
  document.querySelector('#study-date')?.addEventListener('change',event=>{
   if(!context().dates.includes(event.target.value))return;
   selectedDate=event.target.value;update();
  });
  for(const target of targets)document.querySelector('#study-'+target)?.addEventListener('change',event=>{
   if(!names(target).includes(event.target.value))return;
   choices[target]=event.target.value;update();
  });
  for(const [id,direction] of [['study-previous',-1],['study-next',1]])document.querySelector('#'+id)?.addEventListener('click',()=>{
   const {dates,date}=context(),next=dates[dates.indexOf(date)+direction];
   if(next){selectedDate=next;update();document.querySelector('#'+id)?.focus({preventScroll:true})}
  });
 }
 window.BEGDIndependentStudy={render,bind};
})();
