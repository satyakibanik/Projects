/* On-demand plant and substation history within Long-term trends. */
(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=value=>Number.isFinite(value)?value.toLocaleString('en-US',{maximumFractionDigits:2}):'—';
 const fmtPU=value=>Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3}):'—';
 const nominal=label=>{const match=/^(400|230|132)\s*kV$/i.exec(String(label||'').trim());return match?Number(match[1]):null};
 const perUnit=(value,label)=>Number.isFinite(value)&&nominal(label)?value/nominal(label):null;
 const metrics={
  plants:[
   {id:'capacity',label:'Capacity by day',unit:'MW',fields:['installed_capacity_mw','present_capacity_mw'],names:['Installed capacity','Present capacity'],note:'P2 installed and present capacity. Missing installed capacity stays blank; present capacity is not substituted.'},
   {id:'peak_generation_mw',label:'Peak generation',unit:'MW',note:'Maximum observed GenLog output; P2 published peak is used for plants without a GenLog record.'},
   {id:'capacity_factor_pct',label:'Capacity factor',unit:'%',note:'Published daily energy ÷ (installed capacity × 24 hours) × 100. Missing energy or installed capacity stays blank.'},
   {id:'puf_pct',label:'Plant Utilization Factor (PUF)',unit:'%',note:'Published daily energy ÷ (installed capacity × estimated operating hours) × 100. Operating hours count positive hourly readings; this is an estimate, not measured running duration. Requires all 24 hourly samples. Zero running hours gives no PUF.'},
   {id:'utilization_ratio_pct',label:'Utilisation ratio',unit:'%',note:'Peak output ÷ installed capacity × 100. Missing installed capacity stays blank.'}
  ],
  substations:[
   {id:'load_mw',label:'Maximum served load',unit:'MW',note:'Published P3 daily maximum served load. This is station-level load; it is repeated across the station’s voltage-class rows and must not be summed across those rows.'},
   {id:'voltage_range',label:'Voltage range (min–max)',unit:'p.u.',fields:['min_kv','max_kv'],names:['Minimum voltage','Maximum voltage'],note:'The shaded band spans each day’s reported minimum and maximum, divided by this row’s nominal voltage class. It does not show intraday trajectories or allowable limits. The dashed line marks nominal voltage (1 p.u.). Hover or focus for both readings with original kV in brackets. Missing days remain gaps.'}
  ]
 };
 const state={plants:{id:null,metric:'capacity',days:30,search:''},substations:{id:null,metric:'load_mw',days:30,search:''}};
 let index=null,indexPending=null;
 const records=new Map();
 async function read(url){const response=await fetch(url);if(!response.ok)throw Error('Historical data unavailable');return response.json()}
 function calendar(entity,end,count){
  const dates=new Map((entity.days||[]).map(row=>[row.date,row]));
  const last=Date.parse(end+'T00:00:00Z');
  return Array.from({length:count},(_,i)=>{const date=new Date(last-(count-1-i)*86400000).toISOString().slice(0,10);return dates.get(date)||{date}});
 }
 function latest(meta,end,count){return meta.last_date>=new Date(Date.parse(end+'T00:00:00Z')-(count-1)*86400000).toISOString().slice(0,10)?meta.latest:null}
 function tableMetrics(kind){return kind==='plants'?metrics.plants:[metrics.substations[0],
  {id:'min_kv',select:'voltage_range',label:'Minimum voltage',unit:'p.u.'},
  {id:'max_kv',select:'voltage_range',label:'Maximum voltage',unit:'p.u.'}]}
 function metricAvailable(meta,metric,end,days){
  if(!meta||(metric.unit==='p.u.'&&!nominal(meta.voltage_class)))return false;
  const start=new Date(Date.parse(end+'T00:00:00Z')-(days-1)*86400000).toISOString().slice(0,10);
  return (metric.fields||[metric.id]).some(field=>meta.available_through
   ?meta.available_through[field]>=start&&meta.available_through[field]<=end
   :Number.isFinite(latest(meta,end,days)?.[field]));
 }
 function availableMetrics(kind,meta,end,days){return metrics[kind].filter(metric=>metricAvailable(meta,metric,end,days))}
 function filtered(kind){const needle=state[kind].search.toLowerCase();return index[kind].filter(row=>(row.name+' '+(row.voltage_class||'')).toLowerCase().includes(needle))}
 function rowHTML(kind,meta){
  const choice=state[kind],row=latest(meta,index.end_date,choice.days);
  const name=meta.name+(kind==='substations'?' · '+(meta.voltage_class||'Load only'):'');
  const cell=(metric)=>{
   const voltage=metric.unit==='p.u.',value=metric.id==='capacity'?row?fmt(row.installed_capacity_mw)+' / '+fmt(row.present_capacity_mw):'—':voltage?fmtPU(perUnit(row?.[metric.id],meta.voltage_class)):fmt(row?.[metric.id]);
   const detail=voltage&&Number.isFinite(perUnit(row?.[metric.id],meta.voltage_class))?`${value} p.u. [${fmt(row[metric.id])} kV]`:value+' '+metric.unit;
   const enabled=metricAvailable(meta,metric,index.end_date,choice.days),selectedMetric=metric.select||metric.id;
   return `<td><button type="button" data-history-select="${meta.id}" data-history-metric="${selectedMetric}" ${enabled?'':'disabled'} title="${esc(enabled?detail:'No reported values in this window')}" aria-label="${esc(name)} · ${metric.label}: ${detail}. ${enabled?'View trend':'No reported values in this window'}" aria-pressed="${choice.id===meta.id&&choice.metric===selectedMetric}">${value}</button></td>`;
  };
  const enabled=availableMetrics(kind,meta,index.end_date,choice.days).length>0;
  return `<tr data-selected="${choice.id===meta.id}"><th scope="row"><button type="button" class="history-entity-name" data-history-select="${meta.id}" ${enabled?'':'disabled title="No reported values in this window"'} aria-pressed="${choice.id===meta.id}">${esc(name)}</button></th><td class="history-date">${row?esc(row.date):'No record in window'}</td>${tableMetrics(kind).map(cell).join('')}</tr>`;
 }
 function tableHTML(kind){
  const rows=filtered(kind);
  return rows.map(row=>rowHTML(kind,row)).join('')||`<tr><td colspan="${tableMetrics(kind).length+2}" class="empty">No matching ${kind==='plants'?'plants':'substations'}.</td></tr>`;
 }
 function plantMetricGuide(){
  const formula=(label,numerator,denominator)=>`<math display="block" aria-label="${esc(label)}"><mrow><mfrac><mtext>${esc(numerator)}</mtext><mtext>${esc(denominator)}</mtext></mfrac><mo>×</mo><mn>100</mn><mo>%</mo></mrow></math>`;
  return `<details class="history-metric-guide"><summary>About these plant metrics</summary><p>These definitions follow the Power plants tab. Each point describes one operating day.</p><dl>
   <dt>Capacity by day · MW</dt><dd><strong>Installed capacity</strong> is the maximum rated output of the plant’s installed equipment. <strong>Present capacity</strong> is the plant’s currently available output capacity recorded for that day. The chart shows both values from P2 separately.</dd>
   <dt>Peak generation · MW</dt><dd>The highest plant output observed at any published reading time during the day. This uses GenLog readings, or the P2 published peak for a plant without a GenLog record. A sampled peak may miss a higher output between readings.</dd>
   <dt>Capacity factor · %</dt><dd>Actual daily energy generated compared with the energy the plant could generate at installed capacity continuously for all 24 hours. It measures use of installed capacity across the entire day.${formula('Daily energy in MWh divided by installed capacity in MW times 24 hours, multiplied by 100 percent','Daily energy (MWh)','Installed capacity (MW) × 24 hours')}</dd>
   <dt>Plant Utilization Factor (PUF) · %</dt><dd>Energy produced compared with the energy the plant could generate at installed capacity during the hours when it was operating. Unlike capacity factor, its denominator uses operating hours rather than all 24 hours.${formula('Daily energy in MWh divided by installed capacity in MW times estimated operating hours, multiplied by 100 percent','Daily energy (MWh)','Installed capacity (MW) × Estimated operating hours')}Here, operating hours are estimated by counting positive on-the-hour GenLog readings. They are not measured running duration. PUF requires all 24 hourly samples and is unavailable when the estimated operating hours are zero.</dd>
   <dt>Utilisation ratio · %</dt><dd>The plant’s peak output compared with its installed capacity. This compares power at the observed peak, whereas capacity factor and PUF use daily energy.${formula('Peak output in MW divided by installed capacity in MW, multiplied by 100 percent','Peak output (MW)','Installed capacity (MW)')}</dd>
  </dl><p class="note">Daily energy uses published MWh totals. History ratios require reported installed capacity; present capacity is not substituted when installed capacity is missing. Missing values remain gaps, and metrics with no readings in the selected window are disabled.</p></details>`;
 }
 function shell(kind){
  const label=kind==='plants'?'Plant':'Substation',choice=state[kind];
  return `<section class="panel full entity-history" id="${kind}-history" data-entity-history="${kind}" aria-labelledby="${kind}-history-title"><div class="panel-head"><div><h2 id="${kind}-history-title">${label} history</h2><p>Choose a ${label.toLowerCase()} and a metric to explore daily history.</p></div><div class="trends-unit-control" role="group" aria-label="${label} history window">${[30,90,365].map(days=>`<button type="button" data-history-days="${days}" aria-pressed="${choice.days===days}">${days}d</button>`).join('')}</div></div><p class="note">Windows end on ${esc(index.end_date)}. Table values are each entity’s latest available record within the selected window; the record date is shown. Missing days remain gaps.</p><label class="history-search">Find ${kind==='plants'?'plant':'substation'}<input type="search" data-history-search aria-label="Search ${label.toLowerCase()} history" placeholder="Search by name${kind==='substations'?' or voltage class':''}" value="${esc(choice.search)}"></label><p class="note" data-history-count role="status"></p><div class="history-table-scroll" tabindex="0" role="region" aria-label="Scrollable ${label.toLowerCase()} history table"><table><caption class="visually-hidden">${label} history selector. Click a name or metric value to view a trend. ${kind==='plants'?'Capacity values are installed / present MW.':'Voltage values are in per unit; either voltage opens the combined minimum–maximum band.'}</caption><thead><tr><th scope="col">${label}${kind==='substations'?' / voltage class':''}</th><th scope="col">Record date</th>${tableMetrics(kind).map(metric=>`<th scope="col">${metric.label}<small>${metric.id==='capacity'?'Installed / present MW':metric.unit}</small></th>`).join('')}</tr></thead><tbody data-history-rows>${tableHTML(kind)}</tbody></table></div><div class="history-metric-control" role="group" aria-label="${label} history metric">${metrics[kind].map(metric=>`<button type="button" data-history-metric-choice="${metric.id}" aria-pressed="${choice.metric===metric.id}">${metric.label}</button>`).join('')}</div><div class="history-chart" data-history-chart aria-live="polite"></div>${kind==='plants'?plantMetricGuide():''}</section>`;
 }
 function bindRows(section,kind){
  section.querySelectorAll('[data-history-select]').forEach(button=>button.addEventListener('click',()=>{
   if(button.disabled)return;
   state[kind].id=button.dataset.historySelect;
   if(button.dataset.historyMetric)state[kind].metric=button.dataset.historyMetric;
   selection(section,kind);drawChart(section,kind);
  }));
 }
 function selection(section,kind){
  const choice=state[kind];
  const meta=index[kind].find(row=>row.id===choice.id),available=availableMetrics(kind,meta,index.end_date,choice.days);
  if(!available.some(metric=>metric.id===choice.metric))choice.metric=available[0]?.id||null;
  section.querySelectorAll('[data-history-select]').forEach(button=>{
   const selected=button.dataset.historySelect===choice.id;
   button.setAttribute('aria-pressed',String(selected&&(!button.dataset.historyMetric||button.dataset.historyMetric===choice.metric)));
   button.closest('tr').dataset.selected=String(selected);
  });
  section.querySelectorAll('[data-history-metric-choice]').forEach(button=>{
   button.disabled=!available.some(metric=>metric.id===button.dataset.historyMetricChoice);
   button.title=button.disabled?'No reported values in this window':'';
   button.setAttribute('aria-pressed',String(button.dataset.historyMetricChoice===choice.metric));
  });
  section.querySelectorAll('[data-history-days]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.historyDays)===choice.days)));
 }
 function table(section,kind){
  section.querySelector('[data-history-rows]').innerHTML=tableHTML(kind);
  section.querySelector('[data-history-count]').textContent=`${filtered(kind).length} of ${index[kind].length} ${kind==='plants'?'plants':'station / voltage-class records'}`;
  bindRows(section,kind);selection(section,kind);
 }
 async function drawChart(section,kind){
  selection(section,kind);
  const choice={...state[kind]},host=section.querySelector('[data-history-chart]'),meta=index[kind].find(row=>row.id===choice.id);
  root.BEGDTrends.releaseCharts(host);
  if(!meta){host.innerHTML='<p class="empty">No entities are available in this build.</p>';return}
  const token=kind+':'+choice.id+':'+choice.metric+':'+choice.days;
  host.dataset.request=token;
  if(!choice.metric){host.innerHTML='<p class="note">No metrics are available for this entity in the selected window.</p>';return}
  host.innerHTML='<p role="status">Loading daily history…</p>';
  try{
   const cacheKey=kind+'/'+choice.id;
   if(!records.has(cacheKey))records.set(cacheKey,read('entity-history/'+cacheKey+'.json').catch(error=>{records.delete(cacheKey);throw error}));
   const entity=await records.get(cacheKey);
   if(!section.isConnected||host.dataset.request!==token)return;
   const metric=metrics[kind].find(item=>item.id===choice.metric),rows=calendar(entity,index.end_date,choice.days);
   const fields=metric.fields||[metric.id],names=metric.names||[metric.label];
   const voltage=metric.unit==='p.u.';
   const series=fields.map((field,i)=>({name:names[i],color:i?'#d88931':'#4e9acb',dash:voltage&&i===1,value:row=>voltage?perUnit(row[field],meta.voltage_class):row[field],
    ...(voltage?{formatValue:(value,row)=>`${fmtPU(value)} p.u. [${fmt(row[field])} kV]`}:{})}));
   const coverage=series.map(s=>s.name+': '+rows.filter(row=>Number.isFinite(s.value(row))).length+'/'+choice.days+' days reported').join(' · ');
   const title=meta.name+(meta.voltage_class?' · '+meta.voltage_class:'')+' — '+metric.label;
   const last=rows.filter(row=>fields.some(field=>Number.isFinite(row[field]))).at(-1),source=last&&index.sources[last.date];
   const url=source?.source_url;
   const link=typeof url==='string'&&/^https:\/\/erp\.powergrid\.gov\.bd\//.test(url)?` · <a href="${esc(url)}" target="_blank" rel="noopener">Source workbook (${esc(last.date)})</a>`:'';
   const band=voltage?{low:series[0].value,high:series[1].value,color:'#4e9acb'}:null;
   host.innerHTML=`<h3>${esc(title)}</h3><p class="note">${rows[0].date} – ${rows.at(-1).date} · ${esc(coverage)}</p><div class="history-series-key">${series.map(s=>`<span><i style="background:${s.color}"></i>${esc(s.name)} (${metric.unit})</span>`).join('')}</div>`+root.BEGDTrends.plot(rows,series,title,metric.unit,false,{key:'entity-'+kind,hideLegend:true,fitExtent:true,nonNegative:true,...(voltage?{tickDecimals:3,band,reference:{value:1,label:'Nominal · 1 p.u.'}}:{})})+`<p class="note history-method">${esc(metric.note)}${link}</p>`;
   root.BEGDTrends.setupTooltips(host);
  }catch(error){
   if(!section.isConnected||host.dataset.request!==token)return;
   host.innerHTML='<p role="status">This history could not be loaded.</p><button type="button" data-history-retry>Retry history</button>';
   host.querySelector('[data-history-retry]').addEventListener('click',()=>drawChart(section,kind));
  }
 }
 async function mount(host){
  if(!host)return;
  host.innerHTML='<section class="panel full"><p role="status">Loading plant and substation histories…</p></section>';
  try{
   if(!indexPending)indexPending=read('entity-history/index.json').then(value=>{
    if(value.version!==1||!Array.isArray(value.plants)||!Array.isArray(value.substations))throw Error('Invalid history index');
    index=value;return value;
   }).catch(error=>{indexPending=null;throw error});
   await indexPending;
   if(!host.isConnected)return;
   if(!index.end_date){host.innerHTML='<p class="note">No plant or substation history is available.</p>';return}
   for(const kind of ['plants','substations'])if(!index[kind].some(row=>row.id===state[kind].id))state[kind].id=index[kind][0]?.id||null;
   host.innerHTML=shell('plants')+shell('substations');
   for(const kind of ['plants','substations']){
    const section=host.querySelector(`[data-entity-history="${kind}"]`);
    table(section,kind);
    section.querySelector('[data-history-search]').addEventListener('input',event=>{state[kind].search=event.target.value;table(section,kind)});
    section.querySelectorAll('[data-history-days]').forEach(button=>button.addEventListener('click',()=>{state[kind].days=Number(button.dataset.historyDays);table(section,kind);drawChart(section,kind)}));
    section.querySelectorAll('[data-history-metric-choice]').forEach(button=>button.addEventListener('click',()=>{if(button.disabled)return;state[kind].metric=button.dataset.historyMetricChoice;selection(section,kind);drawChart(section,kind)}));
    drawChart(section,kind);
   }
  }catch(error){
   if(!host.isConnected)return;
   host.innerHTML='<section class="panel full"><h2>Plant & substation history</h2><p role="status">Historical entity data could not be loaded.</p><button type="button" data-history-index-retry>Retry histories</button></section>';
   host.querySelector('[data-history-index-retry]').addEventListener('click',()=>mount(host));
  }
 }
 root.BEGDEntityHistory={mount,calendar,latest,metrics,nominal,perUnit,metricAvailable,availableMetrics,tableMetrics};
})(window);
