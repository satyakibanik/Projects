(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const label=d=>new Date(d+'T08:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
 const series=[['domestic','Domestic gas','#21856c'],['lng','Regasified LNG','#bd7921'],['total','Total including LNG','#4f82cf']];
 const powerSeries=[['power_demand','Reported gas demand','#9a678e'],['power_supply','Gas supplied','#21856c']];
 const windows=['daily','7','30','60','90','365','all'];
 let bundle,pending,chartSequence=0;
 const charts=new Map();
 let hiddenLayers=new Set();
 const span=(start,end)=>Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
 function selectRows(rows,end,range){
  const start=range==='all'?-Infinity:Date.parse(end+'T00:00:00Z')-(Number(range)-1)*86400000;
  return rows.filter(r=>r.date<=end&&Date.parse(r.date+'T00:00:00Z')>=start);
 }
 function difference(primary,check){return primary&&check?primary.total-check.total:null;}
 function pointTitle(row){return row.label||row.year||label(row.date);}
 function tooltipHTML(row,fields,unit='MMCFD',precision=1){
  return `<strong>${esc(pointTitle(row))}</strong>${fields.map(([key,name,color])=>`<div><span><i style="background:${esc(row.color||color)}"></i>${esc(name)}</span><b>${fmt(row[key],precision)} ${esc(unit)}</b></div>`).join('')}`;
 }
 function plot(rows,fields,{bars=false,annual=false,categorical=false,unit='MMCFD',chartKey='',hidden=hiddenLayers}={}){
  if(!rows.length)return '<p class="fuel-empty">No verified reports in this window. Choose another end date or a longer range.</p>';
  const W=950,H=290,L=130,R=28,T=24,B=48,precision=annual?3:1;
  const id='fuel-chart-'+chartSequence++,key=chartKey||id,title=fields.map(f=>f[1]).join(', ');
  const layers=categorical?rows.map(r=>({id:key+':'+r.layerKey,name:r.label,color:r.color||fields[0][2]})):fields.map(([field,name,color])=>({id:key+':'+field,name,color}));
  const hiddenSet=new Set(hidden);
  if(categorical)rows=rows.filter(r=>!hiddenSet.has(key+':'+r.layerKey));
  else fields=fields.filter(([field])=>!hiddenSet.has(key+':'+field));
  const active=rows.length>0&&fields.length>0;
  charts.set(id,{rows,fields,unit,precision,layers,key});
  let svg='';
  if(active){
   const max=Math.max(1,...rows.flatMap(r=>fields.map(([field])=>Number.isFinite(r[field])?r[field]:0)))*1.12;
   const first=Date.parse(rows[0].date),last=Date.parse(rows.at(-1).date),multiYear=last-first>365*86400000;
   const x=(r,i)=>annual||categorical||bars?L+(i+.5)*(W-L-R)/rows.length:L+(last===first?.5:(Date.parse(r.date)-first)/(last-first))*(W-L-R);
   const y=value=>H-B-value/max*(H-T-B);
   for(let i=0;i<=4;i++){const value=max*i/4,yy=y(value);svg+=`<line class="fuel-grid" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-10}" y="${yy+4}" text-anchor="end">${annual&&value>=1000000?fmt(value/1000000,1)+'m':annual&&value>=1000?fmt(value/1000,0)+'k':fmt(value,0)}</text>`;}
   fields.forEach(([field,name,color],j)=>{
    let prev=null;
    rows.forEach((r,i)=>{if(!Number.isFinite(r[field])){prev=null;return;}const xx=x(r,i),yy=y(r[field]);
     if(bars){const w=Math.min(180,(W-L-R)/rows.length*.68/fields.length);svg+=`<rect x="${xx+(j-fields.length/2)*w}" y="${yy}" width="${w-2}" height="${H-B-yy}" fill="${esc(r.color||color)}"><title>${esc(pointTitle(r))} · ${esc(name)}: ${fmt(r[field],precision)} ${esc(unit)}</title></rect>`;}
     else{if(prev&&Date.parse(r.date)-Date.parse(prev.date)===86400000)svg+=`<line x1="${x(prev,i-1)}" y1="${y(prev[field])}" x2="${xx}" y2="${yy}" stroke="${color}" stroke-width="2.5"/>`;svg+=`<circle cx="${xx}" cy="${yy}" r="3.8" fill="${color}"><title>${esc(pointTitle(r))} · ${esc(name)}: ${fmt(r[field])} ${esc(unit)}</title></circle>`;prev=r;}
    });
   });
   const stride=Math.max(1,Math.ceil(rows.length/(annual?2:4)));
   rows.forEach((r,i)=>{if((i%stride===0&&(i===0||rows.length-1-i>stride*.65))||i===rows.length-1)svg+=`<text x="${x(r,i)}" y="${H-17}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}">${esc(annual?r.year:categorical?r.year:multiYear?r.date.slice(0,7):r.date.slice(5))}</text>`;});
   rows.forEach((r,i)=>{
    const xx=x(r,i),left=i?(x(rows[i-1],i-1)+xx)/2:L,right=i<rows.length-1?(xx+x(rows[i+1],i+1))/2:W-R;
    const description=pointTitle(r)+': '+fields.map(([field,name])=>name+' '+fmt(r[field],precision)+' '+unit).join('; ');
    svg+=`<rect class="fuel-chart-hit" data-fuel-point="${i}" data-fuel-x="${xx}" x="${left}" y="${T}" width="${right-left}" height="${H-B-T}" fill="transparent" tabindex="${i===0?'0':'-1'}" role="img" aria-label="${esc(description)}"/>`;
   });
  }else svg='<text class="fuel-no-layers" x="475" y="120" text-anchor="middle">No layers selected</text><text class="fuel-no-layers" x="475" y="180" text-anchor="middle">Select a layer below</text>';
  const actions=['gas-source','coal-production'].includes(key)?'':`<div class="fuel-layer-actions">${key==='gas-distribution'?'':'<span>Chart layers</span>'}<button type="button" data-fuel-layers="all" data-fuel-chart-id="${id}">All</button><button type="button" data-fuel-layers="none" data-fuel-chart-id="${id}">None</button></div>`;
  return `<div class="fuel-chart" data-fuel-chart="${id}"><svg viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(title)} in ${esc(unit)}"><text x="${L}" y="14">${esc(unit.toUpperCase())}</text>${svg}<line class="fuel-cursor" x1="0" x2="0" y1="${T}" y2="${H-B}" hidden/></svg><div class="fuel-tooltip" role="tooltip" hidden></div></div><div class="fuel-layer-controls" data-fuel-controls="${esc(key)}" role="group" aria-label="${esc(title)} layers">${actions}<div class="fuel-legend">${layers.map(layer=>`<label><input type="checkbox" data-fuel-layer="${esc(layer.id)}" ${hiddenSet.has(layer.id)?'':'checked'}><i style="background:${esc(layer.color)}"></i>${esc(layer.name)}</label>`).join('')}</div></div><p class="fuel-chart-help">Hover, tap or focus the chart to inspect visible layers.</p>`;
 }
 function bindTooltips(){
  document.querySelectorAll('[data-fuel-chart]').forEach(chart=>{
   const model=charts.get(chart.dataset.fuelChart),tip=chart.querySelector('.fuel-tooltip'),cursor=chart.querySelector('.fuel-cursor');
   const hide=()=>{tip.hidden=true;cursor.setAttribute('hidden','');};
   const show=event=>{
    const hit=event.target.closest?.('[data-fuel-point]');if(!hit)return;
    const row=model.rows[Number(hit.dataset.fuelPoint)];if(!row)return;
    tip.innerHTML=tooltipHTML(row,model.fields,model.unit,model.precision);tip.hidden=false;
    const x=Number(hit.dataset.fuelX);cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);cursor.removeAttribute('hidden');
    const box=chart.getBoundingClientRect(),anchor=Number.isFinite(event.clientX)?event.clientX-box.left:x/950*box.width;
    tip.style.left=(box.width<600?6:Math.max(6,Math.min(anchor+12,box.width-312)))+'px';
   };
   chart.addEventListener('pointermove',show);chart.addEventListener('pointerdown',show);chart.addEventListener('focusin',show);
   chart.addEventListener('pointerleave',hide);chart.addEventListener('focusout',hide);
   chart.addEventListener('keydown',event=>{
    if(event.key==='Escape'){hide();return;}
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const hit=event.target.closest?.('[data-fuel-point]');if(!hit)return;
    event.preventDefault();const current=Number(hit.dataset.fuelPoint),next=event.key==='Home'?0:event.key==='End'?model.rows.length-1:Math.max(0,Math.min(model.rows.length-1,current+(event.key==='ArrowRight'?1:-1)));
    chart.querySelectorAll('[data-fuel-point]').forEach(point=>point.setAttribute('tabindex',Number(point.dataset.fuelPoint)===next?'0':'-1'));
    chart.querySelector(`[data-fuel-point="${next}"]`)?.focus({preventScroll:true});
   });
  });
 }
 function historyNote(all,rows,end,range,fields){
  const available=all.filter(r=>fields.every(([key])=>Number.isFinite(r[key]))),first=available[0]?.date,last=available.at(-1)?.date;
  if(!first)return '<p class="fuel-note">No source history is available for these measures.</p>';
  const expected=range==='all'?span(first,end):range==='daily'?1:Number(range);
  const means=fields.map(([key,name])=>`${esc(name)}: ${fmt(rows.length?rows.reduce((sum,r)=>sum+r[key],0)/rows.length:NaN)} MMCFD`).join(' · ');
  return `<div class="fuel-history-note">${rows.some(r=>r.date_basis)?`<p>${rows.filter(r=>r.date_basis).length} reporting dates use the PDF heading together with its embedded month/year title and matching creation date; source details retain that provenance.</p>`:''}<p><strong>Available history: ${label(first)}–${label(last)}</strong> · ${available.length} published daily reports spanning ${span(first,last)} calendar days. Earlier dates are unavailable in this saved dataset.</p><p>This window: ${rows.length} of ${expected} calendar days reported${rows.length?` · ${label(rows[0].date)}–${label(rows.at(-1).date)}`:''} · ${Math.max(0,expected-rows.length)} missing days. Missing values are not estimated; lines connect consecutive reporting days only.</p><p>Daily averages for reported days in this window · ${means}. All values are 24-hour average gas rates; each period ends at 08:00 Bangladesh time.</p></div>`;
 }
 function table(rows){return `<div class="fuel-table"><table><caption>Published daily values · MMCFD · dates mark the end of the 24-hour period</caption><thead><tr><th scope="col">Period ending</th><th scope="col">Domestic</th><th scope="col">LNG</th><th scope="col">Total supply</th><th scope="col">Power demand</th><th scope="col">Power supply</th><th scope="col">Report</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><th scope="row">${label(r.date)}</th>${['domestic','lng','total','power_demand','power_supply'].map(k=>`<td>${fmt(r[k])}</td>`).join('')}<td><a target="_blank" rel="noopener noreferrer" href="${esc(r.url)}">PDF ↗</a></td></tr>`).join('')}</tbody></table></div>`;}
 function sourceCheck(row){
  const check=bundle.checks.find(r=>r.date===row.date),delta=difference(row,check);
  return `<details class="fuel-panel"><summary>Gas sources, cross-checks & reporting periods</summary><h3>Petrobangla × GTCL</h3>${check?.extraction_method==='ocr'?'<p>GTCL national totals were read from a scanned report using OCR and checked against its nine production components. No power-sector value was extracted from that scan.</p>':''}${row.date_basis?`<p>The report heading has an incomplete date. Its embedded workbook title (${esc(row.date_evidence.pdf_title)}) supplies the month/year, corroborated by the PDF creation date. The <a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">original report ↗</a> retains that evidence.</p>`:''}${check?`<p>Period ending ${label(row.date)}: Petrobangla <strong>${fmt(row.total)}</strong> · GTCL <strong>${fmt(check.total,4)}</strong> · difference <strong>${fmt(delta,4)} MMCFD</strong>. ${Math.abs(delta)<=.05001?'National total agrees at Petrobangla’s published precision.':'National totals differ beyond rounding.'} <a href="${esc(check.url)}" target="_blank" rel="noopener noreferrer">GTCL report ↗</a></p>${Number.isFinite(check.power_supply)?`<p>Power-sector gas supply: Petrobangla <strong>${fmt(row.power_supply)}</strong> · GTCL <strong>${fmt(check.power_supply,3)} MMCFD</strong>. These published allocations differ; they are not substituted between sources.</p>`:'<p>No readable power-sector total was extracted from this GTCL report. Its national gas total can still be compared.</p>'}`:'<p>No GTCL check stored for this date. The Petrobangla value remains unverified by a second publisher.</p>'}<div class="fuel-table"><table><caption>All saved GTCL reports · MMCFD</caption><thead><tr><th>Period end</th><th>Petrobangla total</th><th>GTCL total</th><th>Difference</th></tr></thead><tbody>${bundle.checks.slice().reverse().flatMap(c=>{const g=bundle.gas.find(r=>r.date===c.date);return [`<tr><th><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${label(c.date)} ↗</a></th><td>${fmt(g?.total)}</td><td>${fmt(c.total,4)}</td><td>${fmt(difference(g,c),4)}</td></tr>`]}).join('')}</tbody></table></div><p><a href="${esc(bundle.sources.petrobangla)}" target="_blank" rel="noopener noreferrer">Petrobangla</a> is primary for national production, LNG and sector allocation. Its <a href="https://petrobangla.org.bd/" target="_blank" rel="noopener noreferrer">homepage headline</a> is a latest-period check, not a historical breakdown. <a href="${esc(bundle.sources.gtcl)}" target="_blank" rel="noopener noreferrer">GTCL</a> is provisional/operational and uses greater precision. Agreement on national totals does not mean fields, capacity, well counts or allocations match. Transmission throughput is not national production.</p><p><a href="${esc(bundle.sources.emrd)}" target="_blank" rel="noopener noreferrer">EMRD</a> provides a rounded summary; without a clearly matched reporting period it is not spliced into this series.</p><p>Reports cover 08:00 to 08:00 Bangladesh time and are indexed by period end, not upload date. Petrobangla uses MMCFD (million cubic feet per day); GTCL’s MMSCF over the same 24-hour period is numerically comparable as a daily average, subject to the publishers’ measurement conventions. Gas supply includes LNG send-out, not LNG cargo volume. Values are not converted to MW or MWh.</p><p>New reports are collected during each site build. Failed downloads or unrecognized layouts preserve saved data. The 365-day and long-term controls do not imply complete history.</p></details>`;
 }
 function gasView(end,range){
  const row=bundle.gas.find(r=>r.date===end),rows=range==='daily'?[row]:selectRows(bundle.gas,end,range);
  const age=Math.max(0,Math.floor((Date.now()-Date.parse(end+'T08:00:00+06:00'))/86400000));
  const production=[['state','State companies','State','#21856c'],['ioc','International operators','IOCs','#4f82cf'],['lng','Regasified LNG','LNG','#bd7921']].map(([key,name,short,color])=>({date:end,label:name,year:short,value:row[key],color,layerKey:key}));
  const allocation=[['power_supply','Power plants','Power'],['fertilizer_supply','Fertilizer factories','Fertilizer'],['others','Other consumers','Others']].map(([key,name,short])=>({date:end,label:name,year:short,value:row[key],layerKey:key}));
  return `<div class="fuel-toolbar"><div><span class="fuel-eyebrow">01 / DAILY GAS SNAPSHOT</span><h2>${end===bundle.gas.at(-1).date?'Latest available day':'Selected reporting day'}</h2></div><label>Gas period ending<select id="fuel-date" aria-label="Gas period ending">${bundle.gas.slice().reverse().map(r=>`<option value="${r.date}" ${r.date===end?'selected':''}>${label(r.date)}</option>`).join('')}</select></label></div>
   <p class="fuel-coverage" role="status"><strong>${label(end)} · ${age} day${age===1?'':'s'} since period end</strong> · Saved official data, not live gas telemetry.${bundle.source_status?.some(s=>s.status!=='ok')?' Latest collection is incomplete; saved reports retained.':''}</p>
   <div class="fuel-kpis">${[['Total gas supply',row.total,'Including regasified LNG'],['Domestic gas',row.domestic,'State companies + international operators'],['Regasified LNG',row.lng,fmt(100*row.lng/row.total)+'% of total gas supply'],['Gas supplied to power',row.power_supply,fmt(100*row.power_supply/row.power_demand)+'% of reported gas demand']].map(([title,value,note])=>`<div class="fuel-kpi"><div>${title}</div><strong>${fmt(value)} <small>MMCFD</small></strong><p>${note}</p></div>`).join('')}</div>
   <div class="fuel-columns"><section class="fuel-panel"><div class="fuel-panel-title"><h2>Gas supply by source</h2><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Daily report ↗</a></div>${plot(production,[['value','Gas supplied','#21856c']],{bars:true,categorical:true,chartKey:'gas-source'})}<p class="fuel-note">State companies: ${fmt(row.state)} · international operators: ${fmt(row.ioc)} · regasified LNG: ${fmt(row.lng)} MMCFD. Domestic production sums the published state and IOC subtotals; rounding can leave a 0.1 MMCFD difference.</p></section><section class="fuel-panel"><h2>Where the gas went</h2>${plot(allocation,[['value','Gas distributed','#21856c']],{bars:true,categorical:true,chartKey:'gas-distribution'})}<p class="fuel-note">Power plants: ${fmt(row.power_supply)} · fertilizer: ${fmt(row.fertilizer_supply)} · others: ${fmt(row.others)} MMCFD. Distribution total: ${fmt(row.distribution_total)} MMCFD. Published distribution and production totals can differ; this is not a calculated system loss.</p></section></div>
   <section class="fuel-panel"><span class="fuel-eyebrow">02 / GAS HISTORY</span><h2>Gas supply over time</h2><div class="fuel-windows" role="group" aria-label="Gas time window">${windows.map(v=>`<button type="button" data-fuel-window="${v}" aria-pressed="${range===v}">${v==='daily'?'Daily':v==='all'?'Long term':v+'d'}</button>`).join('')}</div><p class="fuel-note">The selected window applies to both time-series charts below. Daily snapshot above remains the selected reporting day.</p>${plot(rows,series,{chartKey:'gas-supply'})}${historyNote(bundle.gas,rows,end,range,series)}</section>
   <section class="fuel-panel"><span class="fuel-eyebrow">03 / POWER-SECTOR GAS HISTORY</span><h2>Gas supply & demand in the power sector</h2>${plot(rows,powerSeries,{chartKey:'gas-power'})}${historyNote(bundle.gas,rows,end,range,powerSeries)}<p class="fuel-note">${fmt(row.power_demand-row.power_supply)} MMCFD below reported power-sector gas demand on ${label(end)}. This gas gap is not an estimate of electricity load shedding.</p></section>
   <details class="fuel-panel" id="fuel-daily-table"><summary>Daily gas data · ${rows.length} report${rows.length===1?'':'s'}</summary>${table(rows)}<button type="button" id="fuel-csv">Download this window as CSV</button></details>${sourceCheck(row)}`;
 }
 function coalView(){
  const rows=bundle.coal,latest=rows.at(-1);
  if(!latest)return '<p class="fuel-empty">No verified annual coal production records are available.</p>';
  const total=rows.reduce((sum,r)=>sum+r.tonnes,0),peak=rows.reduce((best,r)=>r.tonnes>best.tonnes?r:best);
  return `<section class="fuel-panel"><div class="fuel-panel-title"><div><span class="fuel-eyebrow">DOMESTIC COAL · ANNUAL</span><h2>Annual Barapukuria coal production</h2></div><a href="${esc(bundle.sources.coal)}" target="_blank" rel="noopener noreferrer">BCMCL source ↗</a></div><p>FY ${latest.year}: <strong>${fmt(latest.tonnes,3)} metric tonnes</strong>. Fiscal years run July–June.</p>${plot(rows,[['tonnes','Coal mined','#8c789c']],{bars:true,annual:true,unit:'metric tonnes',chartKey:'coal-production'})}<div class="fuel-history-note"><p><strong>Available history: FY ${esc(rows[0].year)} through FY ${esc(latest.year)}</strong> · ${rows.length} annual production records. This source publishes fiscal-year mine production; daily and monthly coal series are not available here.</p><p>Total across these fiscal years: ${fmt(total,3)} metric tonnes · highest annual production: ${fmt(peak.tonnes,3)} metric tonnes in FY ${esc(peak.year)}. Construction-period production is excluded.</p><p>Annual mine output, not coal stocks, imports or power-plant consumption. The annual chart is independent of gas dates and time windows.</p></div></section><details class="fuel-panel" id="fuel-coal-table"><summary>Annual Barapukuria coal production data · ${rows.length} fiscal years</summary><div class="fuel-table"><table><caption>Annual mine production · metric tonnes · July–June fiscal years</caption><thead><tr><th scope="col">Fiscal year</th><th scope="col">Metric tonnes</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><th scope="row">${esc(r.year)}</th><td>${fmt(r.tonnes,3)}</td></tr>`).join('')}</tbody></table></div></details>`;
 }
 async function mount(){
  if(location.hash!=='#fuel')return;
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#fuel'));
  document.querySelector('#title').textContent='Fuel';
  document.querySelector('#subtitle').textContent='Natural gas supply & domestic coal production';
  ['report-date-controls','date-status','day-sources','error'].forEach(id=>document.getElementById(id).hidden=true);
  document.querySelector('.header-meta .status').textContent='FUEL · OFFICIAL REPORTS';
  if(!bundle){
   document.querySelector('#content').innerHTML='<p role="status">Loading verified fuel reports…</p>';
   try{pending ||= fetch('fuel-data.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json()});bundle=await pending;if(!bundle.gas?.length||!Array.isArray(bundle.coal))throw Error();}
   catch{pending=null;bundle=null;if(location.hash==='#fuel')document.querySelector('#content').innerHTML='<p role="alert">Fuel reports could not be loaded. <button id="fuel-retry" type="button">Retry</button></p>';document.querySelector('#fuel-retry')?.addEventListener('click',mount);return;}
  }
  if(location.hash!=='#fuel')return;
  draw();
 }
 function draw(focusTab=false){
  charts.clear();chartSequence=0;
  hiddenLayers=new Set((new URLSearchParams(location.search).get('fuelHide')||'').split(',').filter(key=>/^(gas-source|gas-distribution|gas-supply|gas-power|coal-production):[a-z_]+$/.test(key)));
  const params=new URLSearchParams(location.search),range=windows.includes(params.get('fuelWindow'))?params.get('fuelWindow'):'30',tab=params.get('fuelType')==='coal'?'coal':'gas';
  const end=bundle.gas.some(r=>r.date===params.get('fuelDate'))?params.get('fuelDate'):bundle.gas.at(-1).date;
  const previous=new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  document.querySelector('#subtitle').textContent=tab==='gas'?`Gas period: ${label(previous)} 08:00 → ${label(end)} 08:00 · Bangladesh time (UTC+06:00)`:'Coal · annual Barapukuria mine production · July–June fiscal years';
  root.BEGDDataStatus?.set('fuel',[{label:'Fuel collection attempted',value:bundle.last_attempt_at}]);
  document.querySelector('#source').textContent=tab==='gas'?'Gas: Petrobangla daily production and distribution reports; GTCL provisional operational cross-checks. Gas dates are independent of electricity workbook dates.':'Coal: BCMCL annual Barapukuria mine production. Daily coal data is not provided by this source.';
  document.querySelector('#content').innerHTML=`<div class="fuel-dashboard"><div class="fuel-tabs" role="tablist" aria-label="Fuel type">${['gas','coal'].map(type=>`<button type="button" id="fuel-tab-${type}" role="tab" data-fuel-type="${type}" aria-selected="${tab===type}" aria-controls="fuel-panel-${type}" tabindex="${tab===type?'0':'-1'}">${type==='gas'?'Gas':'Coal'}</button>`).join('')}</div><div class="fuel-tab-panel" role="tabpanel" id="fuel-panel-${tab}" aria-labelledby="fuel-tab-${tab}">${tab==='gas'?gasView(end,range):coalView()}</div><div role="tabpanel" id="fuel-panel-${tab==='gas'?'coal':'gas'}" aria-labelledby="fuel-tab-${tab==='gas'?'coal':'gas'}" hidden></div></div>`;
  document.querySelectorAll('[data-fuel-type]').forEach(button=>{
   button.addEventListener('click',()=>update('fuelType',button.dataset.fuelType,true));
   button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const type=event.key==='Home'?'gas':event.key==='End'?'coal':tab==='gas'?'coal':'gas';update('fuelType',type,true);});
  });
  document.querySelectorAll('[data-fuel-window]').forEach(button=>button.addEventListener('click',()=>{const value=button.dataset.fuelWindow;update('fuelWindow',value);document.querySelector(`[data-fuel-window="${value}"]`)?.focus({preventScroll:true});}));
  document.querySelector('#fuel-date')?.addEventListener('change',event=>update('fuelDate',event.target.value));
  document.querySelector('#fuel-csv')?.addEventListener('click',()=>{
   const rows=range==='daily'?[bundle.gas.find(r=>r.date===end)]:selectRows(bundle.gas,end,range),keys=['date','domestic','lng','total','power_demand','power_supply','fertilizer_demand','fertilizer_supply','others','distribution_total','url'];
   const csv=keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r[k]).join(',')).join('\n');
   const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=url;a.download=`begd-fuel-${end}-${range}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  document.querySelectorAll('[data-fuel-layer]').forEach(input=>input.addEventListener('change',()=>{
   const key=input.dataset.fuelLayer;input.checked?hiddenLayers.delete(key):hiddenLayers.add(key);saveLayers();document.querySelector(`[data-fuel-layer="${key}"]`)?.focus({preventScroll:true});
  }));
  document.querySelectorAll('[data-fuel-layers]').forEach(button=>button.addEventListener('click',()=>{
   const model=charts.get(button.dataset.fuelChartId),action=button.dataset.fuelLayers;
   model.layers.forEach(layer=>action==='all'?hiddenLayers.delete(layer.id):hiddenLayers.add(layer.id));saveLayers();
   document.querySelector(`[data-fuel-controls="${model.key}"] [data-fuel-layers="${action}"]`)?.focus({preventScroll:true});
  }));
  bindTooltips();
  if(focusTab)document.querySelector('#fuel-tab-'+tab)?.focus({preventScroll:true});
 }
 function saveLayers(){const u=new URL(location.href);if(hiddenLayers.size)u.searchParams.set('fuelHide',[...hiddenLayers].sort().join(','));else u.searchParams.delete('fuelHide');history.replaceState(history.state,'',u);draw();}
 function update(key,value,focusTab=false){const u=new URL(location.href);u.searchParams.set(key,value);history.replaceState(null,'',u);draw(focusTab);}
 root.BEGDFuel={mount,selectRows,difference};
 if(typeof module!=='undefined')module.exports={selectRows,difference,plot,tooltipHTML,historyNote};
 if(typeof document!=='undefined'){
  window.addEventListener('popstate',()=>{if(location.hash==='#fuel')mount();});
  if(location.hash==='#fuel')mount();
 }
})(typeof window==='undefined'?globalThis:window);
