/* Dated BPDB costs and explicitly calculated estimates from preceding fuel rates. */
(function(root){
 const colors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Oil:'#e58b38',Hydro:'#59a14f',Solar:'#c59d1c',Imports:'#b07aa1',Wind:'#76b7b2',Renewable:'#59a14f'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 const amount=value=>value.toLocaleString('en-BD',{maximumFractionDigits:2});
 const dateLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 let bundle=null,pending=null,loadFailed=false;
 function valid(row){return !row?.calculated&&/^\d{4}-\d{2}-\d{2}$/.test(row?.date)&&row.currency==='BDT'&&finite(row.total_bdt)&&row.costs_bdt&&Object.values(row.costs_bdt).every(finite)&&Object.keys(row.costs_bdt).length>=3&&Math.abs(Object.values(row.costs_bdt).reduce((a,b)=>a+b,0)-row.total_bdt)<=Math.max(8,Object.keys(row.costs_bdt).length);}
 function setData(value){loadFailed=false;averageCache.clear();bundle={...value,days:[...new Map((value?.days||[]).filter(valid).map(row=>[row.date,row])).values()]};}
 async function load(){
  if(bundle)return bundle;
  if(!pending)pending=fetch('costs-data.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('BPDB costs unavailable');return response.json()}).then(value=>{if(!Array.isArray(value.days))throw Error('Invalid BPDB costs');setData(value);return bundle}).catch(()=>{loadFailed=true;return null}).finally(()=>{pending=null});
  return pending;
 }
 function forDate(date){return bundle?.days.find(row=>row.date===date)||null;}
 const averageWindows=[7,30,60,90,365],averageCache=new Map();
 const shiftDate=(date,offset)=>new Date(Date.parse(date+'T00:00:00Z')+offset*86400000).toISOString().slice(0,10);
 function averageCosts(endDate,days=30){
  const key=endDate+':'+days;if(averageCache.has(key))return averageCache.get(key);
  const start=shiftDate(endDate,1-days),fuels={};
  for(const row of bundle?.days||[]){
   if(row.date<start||row.date>endDate)continue;
   for(const [name,cost] of Object.entries(row.costs_bdt)){
    const energy=row.generation_kwh?.[name];
    if(!finite(cost)||!finite(energy)||energy<=0)continue;
    const value=fuels[name]||(fuels[name]={cost_bdt:0,energy_kwh:0,days:0});
    value.cost_bdt+=cost;value.energy_kwh+=energy;value.days++;
   }
  }
  for(const value of Object.values(fuels))value.rate=value.cost_bdt/value.energy_kwh;
  const result={start,end:endDate,window_days:days,fuels};averageCache.set(key,result);return result;
 }
 function calculatedCosts(report){
  if(!report?.date)return null;
  const reported=forDate(report.date);if(reported)return reported;
  // Strictly preceding calendar days: never use the target day or future costs.
  const basis=averageCosts(shiftDate(report.date,-1),30),costs_bdt={},generation_kwh={},missing=[];
  for(const name of ['Gas','Coal','HFO','HSD','Hydro','Solar','Imports','Wind']){
   const energy=report.fuels?.[name];
   if(!finite(energy)){missing.push(name+' (generation unavailable)');continue;}
   generation_kwh[name]=energy*1000;
   if(energy===0)costs_bdt[name]=0;
   else if(basis.fuels[name])costs_bdt[name]=energy*1000*basis.fuels[name].rate;
   else missing.push(name+' (30-day rate unavailable)');
  }
  const total=Object.values(costs_bdt).reduce((sum,value)=>sum+value,0),energy=Object.values(generation_kwh).reduce((sum,value)=>sum+value,0);
  return {date:report.date,currency:'BDT',calculated:true,partial:missing.length>0,missing,
   unavailable:!Object.entries(generation_kwh).some(([name,value])=>value>0&&finite(costs_bdt[name]))&&(missing.length>0||!Object.keys(generation_kwh).length),
   total_bdt:total,costs_bdt,generation_kwh,rate_basis:basis,
   production_cost_per_kwh:!missing.length&&energy>0?total/energy:null,
   source_url:report.source_url,source_label:'Calculated from 30-day BPDB fuel rates and Power Grid P1 fuel energy'};
 }
 function averagePanel(rows,plot,days=30){
  if(!rows.length)return '';
  const rateRows=rows.map(row=>({date:row.date,cost_rates:averageCosts(shiftDate(row.date,-1),days)}));
  const names=Object.keys(colors).filter(name=>rateRows.some(row=>row.cost_rates.fuels[name]));
  const layers=names.map(name=>({name,color:colors[name],value:row=>row.cost_rates.fuels[name]?.rate,
   formatValue:(value,row)=>`BDT ${value.toFixed(4)}/kWh · ${row.cost_rates.fuels[name].days}/${days} reported days`}));
  const last=rateRows.at(-1).cost_rates;
  const table=`<div class="table-wrap"><table class="bpdb-average-table"><caption>Average rates ending ${esc(dateLabel(last.end))}</caption><thead><tr><th>Fuel type</th><th>Average BDT/kWh</th><th>Matched days</th></tr></thead><tbody>${names.map(name=>{const value=last.fuels[name];return `<tr><th scope="row">${fuelIcon(name)}${esc(name)}</th><td>${value?value.rate.toFixed(4):'—'}</td><td>${value?value.days:0}/${days}</td></tr>`}).join('')}</tbody></table></div>`;
  return `<div class="bpdb-average-panel"><div class="panel-head"><div><h3>Average cost per kWh by fuel type</h3><p>Energy-weighted averages · BDT/kWh</p></div><div class="trends-unit-control" role="group" aria-label="Fuel cost averaging window">${averageWindows.map(count=>`<button type="button" data-cost-average-days="${count}" aria-pressed="${count===days}">${count}d</button>`).join('')}</div></div>${plot(rateRows,layers,'Average cost per kWh by fuel type','BDT/kWh',false,{key:'bpdb-unit-cost',nonNegative:true,tickDecimals:2})}${table}<p class="note">Each point = total reported cost ÷ matching reported generation (kWh) for that fuel in the preceding ${days} calendar days, ending the day before the point's operating date. Only dates with both a valid cost and positive matching generation are included; coverage is shown per fuel. Missing rates remain gaps. For calculated daily costs, the fixed 30-day window ends the day before the selected operating date. Rates describe the categories published by BPDB.</p></div>`;
 }
 function series(){return [{name:'Reported total',color:'#427f81',width:2.6,value:row=>{const value=forDate(row.date)?.total_bdt;return finite(value)?value/1e7:null},formatValue:value=>'BDT '+amount(value*1e7)},...Object.entries(colors).map(([name,color])=>({name,color,defaultVisible:false,value:row=>{const value=forDate(row.date)?.costs_bdt[name];return finite(value)?value/1e7:null},formatValue:value=>'BDT '+amount(value*1e7)}))];}
 function trendPanel(rows,plot,options={}){
  const reported=rows.map(row=>forDate(row.date)).filter(Boolean),total=reported.reduce((sum,row)=>sum+row.total_bdt,0);
  const last=reported.at(-1),scopes=new Set(reported.map(row=>row.scope));
  const summary=reported.length?`<strong>BDT ${amount(total/1e7)} crore</strong> across ${reported.length} / ${rows.length} days · latest cost: ${esc(dateLabel(last.date))}`:`0 / ${rows.length} days with validated BPDB costs`;
  return `<section class="panel full bpdb-cost-trend"><div class="panel-head"><div><h2>Cost of consumed fuel</h2><p>${summary}</p></div><div class="bpdb-trend-controls"><span class="tag">BDT · DAILY</span><label><input type="checkbox" data-cost-trendline ${options.trendline?'checked':''}>Linear trendline</label><small>Shown for one selected layer</small></div></div>${plot(rows,series().filter(series=>series.name==='Reported total'||reported.some(row=>Object.hasOwn(row.costs_bdt,series.name))),'Cost of consumed fuel','BDT crore',false,{key:'bpdb-cost',nonNegative:true,groupLayers:true,fitTrend:options.trendline})}<p class="note">Bangladeshi taka · 1 crore = 10,000,000 BDT. Hover or focus for exact BDT amounts; select a generation type in the legend. Source: <a href="https://misc.bpdb.gov.bd/daily-generation-archive" target="_blank" rel="noopener">BPDB Page 1 PDFs</a>. Published as “Cost of the Consumed Fuel”, “Fuel cost”, or “Production Cost (Tk.)”. Production-cost totals can include imports and renewables. Categories follow each source: Oil and Renewable are not split into inferred components. ${scopes.size>1?'This window spans consumed-fuel and production-cost definitions; totals are not necessarily like-for-like. ':''}Totals cover reported days only; missing dates remain gaps. BPDB PDFs may arrive 1–2 days late; dates come from the printed report.</p>${averagePanel(rows,plot,options.averageDays||30)}</section>`;
 }
 const icons={Imports:'import-export.png',Coal:'coal.png',Gas:'gas-factory.png',HFO:'HFO.png',HSD:'HSD.png',Hydro:'hydroelectricity.png',Solar:'solar.png',Wind:'wind-energy.png'};
 let tableSort={key:'share',direction:'desc'};
 function fuelIcon(name){return icons[name]?`<img class="bpdb-fuel-icon" src="plant-icons/${icons[name]}" alt="">`:`<i class="bpdb-cost-dot" style="background:${colors[name]||'#758c99'}"></i>`;}
 function importPanel(date,plot){
  const start=shiftDate(date,-364),rows=Array.from({length:365},(_,i)=>{const day=shiftDate(start,i),cost=forDate(day)?.costs_bdt?.Imports;return {date:day,time:dateLabel(day),day:i,import_cost_crore:finite(cost)?cost/1e7:null}});
  const reported=rows.filter(row=>finite(row.import_cost_crore));
  const summary=reported.length?`${reported.length} / 365 days reported · latest ${dateLabel(reported.at(-1).date)}`:loadFailed?'Cost data unavailable. Reload to retry.':'No reported import costs in this window.';
  return `<section class="panel full"><div class="panel-head"><div><h2>Cost of electricity imports</h2><p>${esc(summary)}</p></div><span class="tag">BDT CRORE · DAILY</span></div>${plot(rows,[{key:'import_cost_crore',name:'Total import cost',color:colors.Imports,fuelIcon:'import-export.png'}],{key:'imports:cost',unit:'BDT crore',xKey:'day',xMax:364,preserveGaps:true,xTicks:[0,91,182,273,364].map(day=>({day,label:dateLabel(rows[day].date)}))})}<p class="note">365 calendar days through ${esc(dateLabel(date))}. Source: <a href="https://misc.bpdb.gov.bd/daily-generation-archive" target="_blank" rel="noopener">BPDB Page 1 PDFs</a>, reported Imports category. Missing dates remain gaps. 1 crore = 10,000,000 BDT. Individual route costs are not available in this dataset; the total is not allocated between routes. Published production costs may differ from full purchase expenditure.</p></section>`;
 }
 async function mountImports(date,plot,bind){
  await load();
  const host=document.getElementById('bpdb-import-cost');
  if(host?.dataset.costDate!==date)return;
  host.innerHTML=importPanel(date,plot);bind();
 }
 function costRate(row,name){const energy=row.generation_kwh?.[name],cost=row.costs_bdt?.[name];return finite(cost)&&finite(energy)&&energy>0?cost/energy:null;}
 function breakdown(row){const sum=Object.values(row.costs_bdt).reduce((a,b)=>a+b,0);return Object.keys(row.calculated?row.generation_kwh:row.costs_bdt).map(name=>{const cost=row.costs_bdt[name];return {name,cost:finite(cost)?cost:null,share:finite(cost)?(sum>0?cost/sum*100:0):null,rate:row.calculated?row.rate_basis.fuels[name]?.rate??null:costRate(row,name)};});}
 function sortBreakdown(entries,sort=tableSort){return [...entries].sort((a,b)=>{
  const av=a[sort.key],bv=b[sort.key];
  if(av==null||bv==null)return av==null?(bv==null?a.name.localeCompare(b.name):1):-1;
  const result=typeof av==='string'?av.localeCompare(bv):av-bv;
  return (sort.direction==='asc'?result:-result)||a.name.localeCompare(b.name);
 });}
 function rateText(rate){return rate==null?'Not available':`BDT ${rate.toFixed(3)}/kWh`;}
 function sliceInfo(entry){return `${entry.name}: BDT ${amount(entry.cost)} · ${entry.share.toFixed(2)}% · ${rateText(entry.rate)}`;}
 function sortHeader(key,label){const active=tableSort.key===key;return `<th scope="col" aria-sort="${active?(tableSort.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" data-cost-sort="${key}" aria-label="Sort by ${label}${active?', currently '+tableSort.direction+'ending':''}">${label}<span aria-hidden="true">${active?(tableSort.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button></th>`;}
 function piePanel(date,estimate=null){
  const row=forDate(date)||estimate;
  if(!row)return '';
  const entries=breakdown(row).sort((a,b)=>(b.share??-1)-(a.share??-1)),sum=entries.reduce((n,e)=>n+(e.cost||0),0);
  let angle=-Math.PI/2;
  const slices=entries.filter(entry=>entry.cost>0).map(entry=>{
   const {name,cost}=entry,end=angle+cost/sum*2*Math.PI,x=120+100*Math.cos(angle),y=120+100*Math.sin(angle),ex=120+100*Math.cos(end),ey=120+100*Math.sin(end);
   const shape=cost===sum?`<circle cx="120" cy="120" r="100" fill="${colors[name]||'#758c99'}"/>`:`<path d="M120,120 L${x},${y} A100,100 0 ${end-angle>Math.PI?1:0},1 ${ex},${ey} Z" fill="${colors[name]||'#758c99'}"/>`;
   angle=end;return `<g tabindex="0" role="img" data-cost-slice="${esc(name)}" aria-label="${esc(sliceInfo(entry))}">${shape}</g>`;
  }).join('');
  const source=/^https:\/\/misc\.bpdb\.gov\.bd\//.test(row.source_url||'')?`<a href="${esc(row.source_url)}" target="_blank" rel="noopener">BPDB Page 1 PDF</a>`:'BPDB Page 1 PDF';
  const perKwh=finite(row.production_cost_per_kwh)?`<span>${row.calculated?'Calculated cost per kWh':'Production cost per kWh'} <strong>BDT ${row.production_cost_per_kwh.toFixed(5)}/kWh</strong></span>`:'';
  const table=`<table class="bpdb-cost-table"><caption class="visually-hidden">${row.calculated?'Calculated':'Reported'} daily cost by generation type in BDT</caption><thead><tr>${sortHeader('name','Generation type')}${sortHeader('cost','Cost (BDT)')}${sortHeader('share','Share')}${sortHeader('rate','Cost / kWh')}</tr></thead><tbody>${sortBreakdown(entries).map(entry=>`<tr data-cost-row="${esc(entry.name)}"><th scope="row">${fuelIcon(entry.name)}${esc(entry.name)}</th><td>${entry.cost==null?'Unavailable':amount(entry.cost)}</td><td>${entry.share==null?'—':entry.share.toFixed(2)+'%'}</td><td>${entry.rate==null?'<span title="Matching positive energy is unavailable">—</span>':entry.rate.toFixed(3)}</td></tr>`).join('')}</tbody></table>`;
  const credits='<details class="bpdb-icon-credits"><summary>Fuel icon credits · Flaticon</summary><p>Same icons as Power plants: Coal · Magnific; Gas · Andy Horvath; HFO · alekseyvanin; HSD · Iconjam; Hydro · Iconfromus; Solar · Mutualism; Wind · Magnific. <a href="https://www.flaticon.com/" target="_blank" rel="noopener">Flaticon</a>.</p></details>';
  const calculation=row.calculated?`<p class="note bpdb-calculated-note"><strong>CALCULATED${row.partial?' · PARTIAL':''}</strong> · BPDB has no reported costs for ${esc(dateLabel(date))}. Each fuel's selected-day energy (Power Grid P1 daily fuel totals, MWh × 1,000) × its preceding 30-day energy-weighted average BDT/kWh. Rate window: ${esc(row.rate_basis.start)} – ${esc(row.rate_basis.end)}. Reported BPDB costs replace this estimate when available.${row.partial?' Unavailable: '+esc(row.missing.join('; '))+'. The subtotal and pie shares cover priced fuels only.':''}</p><details class="bpdb-rate-basis"><summary>30-day rates and generation used</summary><div class="table-wrap"><table class="bpdb-average-table"><caption>30-day rate coverage used in this calculation</caption><thead><tr><th>Fuel type</th><th>Generation (kWh)</th><th>Average BDT/kWh</th><th>Matched days / 30</th></tr></thead><tbody>${Object.keys(row.generation_kwh).map(name=>`<tr><th>${esc(name)}</th><td>${amount(row.generation_kwh[name])}</td><td>${row.rate_basis.fuels[name]?.rate.toFixed(4)??'—'}</td><td>${row.rate_basis.fuels[name]?.days??0}/30</td></tr>`).join('')}</tbody></table></div></details>`:'';
  return `<section class="panel full bpdb-cost-panel${row.calculated?' is-calculated':''}"><div class="panel-head"><div><h2>Fuel cost by generation type</h2><p>${row.calculated?'Calculated daily cost':'Reported daily cost'} · ${esc(dateLabel(date))} · Bangladeshi taka (BDT)</p></div><span class="tag">${row.calculated?'CALCULATED · 30D RATES':'BPDB · PAGE 1'}</span></div>${calculation}<div class="bpdb-cost-summary"><span>${row.calculated?(row.partial?'Calculated subtotal':'Total calculated cost'):'Total reported cost'} <strong>${row.unavailable?'Unavailable':'BDT '+amount(row.total_bdt)}</strong></span>${perKwh}</div><div class="bpdb-cost-layout"><div class="bpdb-pie-wrap"><svg class="bpdb-cost-pie" viewBox="0 0 240 240" role="group" aria-label="${row.calculated?'Calculated':'Reported'} cost share by generation type in BDT">${slices}</svg><div class="bpdb-pie-tooltip" id="bpdb-pie-tooltip" role="tooltip" hidden></div></div><div class="table-wrap">${table}</div></div>${row.calculated?'<p class="note">Source: Power Grid selected-day P1 fuel energy and validated BPDB historical cost/energy pairs. Calculated costs are kept separate from reported BPDB history and do not enter the averages.</p>':`<p class="note">Cost / kWh (BDT) = each category’s cost ÷ its matching energy in the same BPDB PDF. Energy totals are rounded to 0.01 MKWh; these category rates are calculated. Zero or missing energy is shown as —. Hover, tap, or focus a pie slice for the same breakdown.</p><p class="note">Source: ${source} · “${esc(row.source_label)}” · printed operating date ${esc(date)}${row.archive_date?' · archive date '+esc(row.archive_date):''}. These are the source’s reported costs; this chart does not establish full operating expenditure or profit. Categories remain as published.</p>`}${credits}</section>`;
 }
 function costDateFor(reportDate,preferred,report){
  const dates=(bundle?.days||[]).filter(row=>row.total_bdt>0).map(row=>row.date).sort();
  if(report?.date===reportDate&&bundle)dates.push(reportDate);
  if(dates.includes(preferred))return preferred;
  if(dates.includes(reportDate))return reportDate;
  return dates.filter(date=>date<=reportDate).at(-1)||dates.at(-1)||null;
 }
 function dayPanel(reportDate,preferred,report){
  const date=costDateFor(reportDate,preferred,report);
  if(!date)return `<section class="panel full bpdb-cost-panel"><div class="panel-head"><div><h2>Fuel cost by generation type</h2><p>Energy curve operating date · ${esc(dateLabel(reportDate))}</p></div><span class="tag">BPDB · PAGE 1</span></div><p class="note" role="status">${!bundle&&!loadFailed?'Loading BPDB cost reports…':'No validated BPDB cost breakdown is available for this date. BPDB reports may arrive later than Power Grid reports.'} <a href="https://misc.bpdb.gov.bd/daily-generation-archive" target="_blank" rel="noopener">BPDB daily archive</a></p></section>`;
  const estimate=date===report?.date&&!forDate(date)?calculatedCosts(report):null;
  const notice=estimate?'CALCULATED costs for the energy curve operating date; using preceding 30-day BPDB rates.':date===reportDate?'Costs match the energy curve operating date.':`${forDate(reportDate)?'':`Costs for the energy curve date (${dateLabel(reportDate)}) are unavailable. `}Showing a separate BPDB cost report for ${dateLabel(date)}; the energy curve above remains on ${dateLabel(reportDate)}.`;
  const dates=[...new Set([...bundle.days.filter(row=>row.total_bdt>0).map(row=>row.date),...(report?.date&&!forDate(report.date)?[report.date]:[])])].sort().reverse();
  return `<div class="bpdb-cost-date-controls"><p class="note" role="status">${esc(notice)}</p><label>Cost report operating date <select data-cost-date-picker aria-label="Cost report operating date">${dates.map(day=>`<option value="${day}" ${day===date?'selected':''}>${esc(dateLabel(day))}${day===report?.date&&!forDate(day)?' (calculated)':''}</option>`).join('')}</select></label></div>`+piePanel(date,estimate);
 }
 function bindDay(host,reportDate,report){
  const date=costDateFor(reportDate,host.querySelector('[data-cost-date-picker]')?.value,report);
  const picker=host.querySelector('[data-cost-date-picker]');
  if(picker)picker.addEventListener('change',()=>{
   host.innerHTML=dayPanel(reportDate,picker.value,report);bindDay(host,reportDate,report);
   host.querySelector('[data-cost-date-picker]')?.focus({preventScroll:true});
  });
  if(!host.dataset.costSortBound){
   host.dataset.costSortBound='true';
   host.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-cost-sort]');if(!button)return;
    const key=button.dataset.costSort;
    if(!['name','cost','share','rate'].includes(key))return;
    tableSort={key,direction:tableSort.key===key?(tableSort.direction==='asc'?'desc':'asc'):(key==='name'?'asc':'desc')};
    const selectedDate=host.querySelector('[data-cost-date-picker]')?.value;
    host.innerHTML=dayPanel(reportDate,selectedDate,report);bindDay(host,reportDate,report);
    host.querySelector(`[data-cost-sort="${key}"]`)?.focus({preventScroll:true});
   });
  }
  const row=forDate(date)||(date===report?.date?calculatedCosts(report):null),tip=host.querySelector('.bpdb-pie-tooltip');if(!row||!tip)return;
  const entries=breakdown(row);
  const hide=()=>{tip.hidden=true;host.querySelectorAll('[data-cost-row]').forEach(el=>el.classList.remove('is-highlighted'));};
  host.querySelectorAll('[data-cost-slice]').forEach(slice=>{
   const entry=entries.find(e=>e.name===slice.dataset.costSlice);
   const show=event=>{
    tip.innerHTML=`<strong>${fuelIcon(entry.name)}${esc(entry.name)}</strong><div>Cost <b>BDT ${amount(entry.cost)}</b></div><div>Share <b>${entry.share.toFixed(2)}%</b></div><div>Cost / kWh <b>${esc(rateText(entry.rate))}</b></div>`;
    tip.hidden=false;slice.setAttribute('aria-describedby','bpdb-pie-tooltip');
    const rect=slice.getBoundingClientRect(),box=tip.getBoundingClientRect(),x=event?.clientX??rect.right,y=event?.clientY??rect.top;
    tip.style.left=Math.max(8,Math.min(x+14,root.innerWidth-box.width-8))+'px';tip.style.top=Math.max(8,Math.min(y+14,root.innerHeight-box.height-8))+'px';
    host.querySelectorAll('[data-cost-row]').forEach(el=>el.classList.toggle('is-highlighted',el.dataset.costRow===entry.name));
   };
   slice.addEventListener('pointerenter',show);slice.addEventListener('pointermove',show);slice.addEventListener('pointerdown',show);slice.addEventListener('focus',()=>show());slice.addEventListener('pointerleave',hide);slice.addEventListener('blur',hide);slice.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});
  });
 }
 async function mountDay(date,report){
  await load();
  const host=document.getElementById('bpdb-day-cost');
  if(host?.dataset.costDate===date){host.innerHTML=dayPanel(date,undefined,report);bindDay(host,date,report);}
 }
 root.BEGDCosts={importPanel,mountImports,icons,fuelIcon,load,setData,valid,forDate,series,trendPanel,averageCosts,calculatedCosts,averagePanel,piePanel,dayPanel,costDateFor,mountDay,costRate,breakdown,sortBreakdown,bindDay};
})(window);
