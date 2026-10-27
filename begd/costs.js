/* BPDB reported daily costs. Match printed operating dates; never borrow a day. */
(function(root){
 const colors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Oil:'#e58b38',Hydro:'#59a14f',Solar:'#c59d1c',Imports:'#b07aa1',Wind:'#76b7b2',Renewable:'#59a14f'};
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 const amount=value=>value.toLocaleString('en-BD',{maximumFractionDigits:2});
 const dateLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
 let bundle=null,pending=null;
 function valid(row){return /^\d{4}-\d{2}-\d{2}$/.test(row?.date)&&row.currency==='BDT'&&finite(row.total_bdt)&&row.costs_bdt&&Object.values(row.costs_bdt).every(finite)&&Object.keys(row.costs_bdt).length>=3&&Math.abs(Object.values(row.costs_bdt).reduce((a,b)=>a+b,0)-row.total_bdt)<=Math.max(8,Object.keys(row.costs_bdt).length);}
 function setData(value){bundle={...value,days:(value?.days||[]).filter(valid)};}
 async function load(){
  if(bundle)return bundle;
  if(!pending)pending=fetch('costs-data.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('BPDB costs unavailable');return response.json()}).then(value=>{if(!Array.isArray(value.days))throw Error('Invalid BPDB costs');setData(value);return bundle}).catch(()=>null).finally(()=>{pending=null});
  return pending;
 }
 function forDate(date){return bundle?.days.find(row=>row.date===date)||null;}
 function series(){return [{name:'Reported total',color:'#427f81',width:2.6,value:row=>{const value=forDate(row.date)?.total_bdt;return finite(value)?value/1e7:null},formatValue:value=>'BDT '+amount(value*1e7)},...Object.entries(colors).map(([name,color])=>({name,color,defaultVisible:false,value:row=>{const value=forDate(row.date)?.costs_bdt[name];return finite(value)?value/1e7:null},formatValue:value=>'BDT '+amount(value*1e7)}))];}
 function trendPanel(rows,plot,options={}){
  const reported=rows.map(row=>forDate(row.date)).filter(Boolean),total=reported.reduce((sum,row)=>sum+row.total_bdt,0);
  const last=reported.at(-1),scopes=new Set(reported.map(row=>row.scope));
  const summary=reported.length?`<strong>BDT ${amount(total/1e7)} crore</strong> across ${reported.length} / ${rows.length} days · latest cost: ${esc(dateLabel(last.date))}`:`0 / ${rows.length} days with validated BPDB costs`;
  return `<section class="panel full bpdb-cost-trend"><div class="panel-head"><div><h2>Cost of consumed fuel</h2><p>${summary}</p></div><div class="bpdb-trend-controls"><span class="tag">BDT · DAILY</span><label><input type="checkbox" data-cost-trendline ${options.trendline?'checked':''}>Linear trendline</label><small>Shown for one selected layer</small></div></div>${plot(rows,series().filter(series=>series.name==='Reported total'||reported.some(row=>Object.hasOwn(row.costs_bdt,series.name))),'Cost of consumed fuel','BDT crore',false,{key:'bpdb-cost',nonNegative:true,groupLayers:true,fitTrend:options.trendline})}<p class="note">Bangladeshi taka · 1 crore = 10,000,000 BDT. Hover or focus for exact BDT amounts; select a generation type in the legend. Source: <a href="https://misc.bpdb.gov.bd/daily-generation-archive" target="_blank" rel="noopener">BPDB Page 1 PDFs</a>. Published as “Cost of the Consumed Fuel”, “Fuel cost”, or “Production Cost (Tk.)”. Production-cost totals can include imports and renewables. Categories follow each source: Oil and Renewable are not split into inferred components. ${scopes.size>1?'This window spans consumed-fuel and production-cost definitions; totals are not necessarily like-for-like. ':''}Totals cover reported days only; missing dates remain gaps. BPDB PDFs may arrive 1–2 days late; dates come from the printed report.</p></section>`;
 }
 const icons={Coal:'coal.png',Gas:'gas-factory.png',HFO:'HFO.png',HSD:'HSD.png',Hydro:'hydroelectricity.png',Solar:'solar.png',Wind:'wind-energy.png'};
 let tableSort={key:'share',direction:'desc'};
 function fuelIcon(name){return icons[name]?`<img class="bpdb-fuel-icon" src="plant-icons/${icons[name]}" alt="">`:`<i class="bpdb-cost-dot" style="background:${colors[name]||'#758c99'}"></i>`;}
 function costRate(row,name){const energy=row.generation_kwh?.[name],cost=row.costs_bdt?.[name];return finite(cost)&&finite(energy)&&energy>0?cost/energy:null;}
 function breakdown(row){const sum=Object.values(row.costs_bdt).reduce((a,b)=>a+b,0);return Object.entries(row.costs_bdt).map(([name,cost])=>({name,cost,share:cost/sum*100,rate:costRate(row,name)}));}
 function sortBreakdown(entries,sort=tableSort){return [...entries].sort((a,b)=>{
  const av=a[sort.key],bv=b[sort.key];
  if(av==null||bv==null)return av==null?(bv==null?a.name.localeCompare(b.name):1):-1;
  const result=typeof av==='string'?av.localeCompare(bv):av-bv;
  return (sort.direction==='asc'?result:-result)||a.name.localeCompare(b.name);
 });}
 function rateText(rate){return rate==null?'Not available':`BDT ${rate.toFixed(3)}/kWh`;}
 function sliceInfo(entry){return `${entry.name}: BDT ${amount(entry.cost)} · ${entry.share.toFixed(2)}% · ${rateText(entry.rate)}`;}
 function sortHeader(key,label){const active=tableSort.key===key;return `<th scope="col" aria-sort="${active?(tableSort.direction==='asc'?'ascending':'descending'):'none'}"><button type="button" data-cost-sort="${key}" aria-label="Sort by ${label}${active?', currently '+tableSort.direction+'ending':''}">${label}<span aria-hidden="true">${active?(tableSort.direction==='asc'?' ↑':' ↓'):' ↕'}</span></button></th>`;}
 function piePanel(date){
  const row=forDate(date);
  if(!row||row.total_bdt<=0)return '';
  const entries=breakdown(row).sort((a,b)=>b.share-a.share),sum=entries.reduce((n,e)=>n+e.cost,0);
  let angle=-Math.PI/2;
  const slices=entries.filter(entry=>entry.cost>0).map(entry=>{
   const {name,cost}=entry,end=angle+cost/sum*2*Math.PI,x=120+100*Math.cos(angle),y=120+100*Math.sin(angle),ex=120+100*Math.cos(end),ey=120+100*Math.sin(end);
   const shape=cost===sum?`<circle cx="120" cy="120" r="100" fill="${colors[name]||'#758c99'}"/>`:`<path d="M120,120 L${x},${y} A100,100 0 ${end-angle>Math.PI?1:0},1 ${ex},${ey} Z" fill="${colors[name]||'#758c99'}"/>`;
   angle=end;return `<g tabindex="0" role="img" data-cost-slice="${esc(name)}" aria-label="${esc(sliceInfo(entry))}">${shape}</g>`;
  }).join('');
  const source=/^https:\/\/misc\.bpdb\.gov\.bd\//.test(row.source_url||'')?`<a href="${esc(row.source_url)}" target="_blank" rel="noopener">BPDB Page 1 PDF</a>`:'BPDB Page 1 PDF';
  const perKwh=finite(row.production_cost_per_kwh)?`<span>Production cost per kWh <strong>BDT ${row.production_cost_per_kwh.toFixed(5)}/kWh</strong></span>`:'';
  const table=`<table class="bpdb-cost-table"><caption class="visually-hidden">Reported daily cost by generation type in BDT</caption><thead><tr>${sortHeader('name','Generation type')}${sortHeader('cost','Cost (BDT)')}${sortHeader('share','Share')}${sortHeader('rate','Cost / kWh')}</tr></thead><tbody>${sortBreakdown(entries).map(entry=>`<tr data-cost-row="${esc(entry.name)}"><th scope="row">${fuelIcon(entry.name)}${esc(entry.name)}</th><td>${amount(entry.cost)}</td><td>${entry.share.toFixed(2)}%</td><td>${entry.rate==null?'<span title="Matching positive energy is unavailable">—</span>':entry.rate.toFixed(3)}</td></tr>`).join('')}</tbody></table>`;
  const credits='<details class="bpdb-icon-credits"><summary>Fuel icon credits · Flaticon</summary><p>Same icons as Power plants: Coal · Magnific; Gas · Andy Horvath; HFO · alekseyvanin; HSD · Iconjam; Hydro · Iconfromus; Solar · Mutualism; Wind · Magnific. <a href="https://www.flaticon.com/" target="_blank" rel="noopener">Flaticon</a>.</p></details>';
  return `<section class="panel full bpdb-cost-panel"><div class="panel-head"><div><h2>Fuel cost by generation type</h2><p>Reported daily cost · ${esc(dateLabel(date))} · Bangladeshi taka (BDT)</p></div><span class="tag">BPDB · PAGE 1</span></div><div class="bpdb-cost-summary"><span>Total reported cost <strong>BDT ${amount(row.total_bdt)}</strong></span>${perKwh}</div><div class="bpdb-cost-layout"><div class="bpdb-pie-wrap"><svg class="bpdb-cost-pie" viewBox="0 0 240 240" role="group" aria-label="Reported cost share by generation type in BDT">${slices}</svg><div class="bpdb-pie-tooltip" id="bpdb-pie-tooltip" role="tooltip" hidden></div></div><div class="table-wrap">${table}</div></div><p class="note">Cost / kWh (BDT) = each category’s cost ÷ its matching energy in the same BPDB PDF. Energy totals are rounded to 0.01 MKWh; these category rates are calculated. Zero or missing energy is shown as —. Hover, tap, or focus a pie slice for the same breakdown.</p><p class="note">Source: ${source} · “${esc(row.source_label)}” · printed operating date ${esc(date)}${row.archive_date?' · archive date '+esc(row.archive_date):''}. These are the source’s reported costs; this chart does not establish full operating expenditure or profit. Categories remain as published.</p>${credits}</section>`;
 }
 function bindDay(host,date){
  if(!host.dataset.costSortBound){
   host.dataset.costSortBound='true';
   host.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-cost-sort]');if(!button)return;
    const key=button.dataset.costSort;
    if(!['name','cost','share','rate'].includes(key))return;
    tableSort={key,direction:tableSort.key===key?(tableSort.direction==='asc'?'desc':'asc'):(key==='name'?'asc':'desc')};
    host.innerHTML=piePanel(date);bindDay(host,date);
    host.querySelector(`[data-cost-sort="${key}"]`)?.focus({preventScroll:true});
   });
  }
  const row=forDate(date),tip=host.querySelector('.bpdb-pie-tooltip');if(!row||!tip)return;
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
 async function mountDay(date){
  await load();
  const host=document.getElementById('bpdb-day-cost');
  if(host?.dataset.costDate===date){host.innerHTML=piePanel(date);bindDay(host,date);}
 }
 root.BEGDCosts={load,setData,valid,forDate,series,trendPanel,piePanel,mountDay,costRate,breakdown,sortBreakdown,bindDay};
})(window);
