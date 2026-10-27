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
 function trendPanel(rows,plot){
  const reported=rows.map(row=>forDate(row.date)).filter(Boolean),total=reported.reduce((sum,row)=>sum+row.total_bdt,0);
  const last=reported.at(-1),scopes=new Set(reported.map(row=>row.scope));
  const summary=reported.length?`<strong>BDT ${amount(total/1e7)} crore</strong> across ${reported.length} / ${rows.length} days · latest cost: ${esc(dateLabel(last.date))}`:`0 / ${rows.length} days with validated BPDB costs`;
  return `<section class="panel full bpdb-cost-trend"><div class="panel-head"><div><h2>Cost of consumed fuel</h2><p>${summary}</p></div><span class="tag">BDT · DAILY</span></div>${plot(rows,series().filter(series=>series.name==='Reported total'||reported.some(row=>Object.hasOwn(row.costs_bdt,series.name))),'Cost of consumed fuel','BDT crore',false,{key:'bpdb-cost',nonNegative:true})}<p class="note">Bangladeshi taka · 1 crore = 10,000,000 BDT. Hover or focus for exact BDT amounts; select a generation type in the legend. Source: <a href="https://misc.bpdb.gov.bd/daily-generation-archive" target="_blank" rel="noopener">BPDB Page 1 PDFs</a>. Published as “Cost of the Consumed Fuel”, “Fuel cost”, or “Production Cost (Tk.)”. Production-cost totals can include imports and renewables. Categories follow each source: Oil and Renewable are not split into inferred components. ${scopes.size>1?'This window spans consumed-fuel and production-cost definitions; totals are not necessarily like-for-like. ':''}Totals cover reported days only; missing dates remain gaps. BPDB PDFs may arrive 1–2 days late; dates come from the printed report.</p></section>`;
 }
 function piePanel(date){
  const row=forDate(date);
  if(!row||row.total_bdt<=0)return '';
  const entries=Object.entries(row.costs_bdt).sort((a,b)=>b[1]-a[1]);
  const sum=entries.reduce((n,[,v])=>n+v,0);
  let angle=-Math.PI/2;
  const slices=entries.filter(([,value])=>value>0).map(([name,value])=>{
   const end=angle+value/sum*2*Math.PI,x=120+100*Math.cos(angle),y=120+100*Math.sin(angle),ex=120+100*Math.cos(end),ey=120+100*Math.sin(end);
   const label=`${name}: BDT ${amount(value)} · ${(value/sum*100).toFixed(2)}%`;
   const shape=value===sum?`<circle cx="120" cy="120" r="100" fill="${colors[name]||'#758c99'}"/>`:`<path d="M120,120 L${x},${y} A100,100 0 ${end-angle>Math.PI?1:0},1 ${ex},${ey} Z" fill="${colors[name]||'#758c99'}"/>`;
   angle=end;return `<g tabindex="0" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${shape}</g>`;
  }).join('');
  const source=/^https:\/\/misc\.bpdb\.gov\.bd\//.test(row.source_url||'')?`<a href="${esc(row.source_url)}" target="_blank" rel="noopener">BPDB Page 1 PDF</a>`:'BPDB Page 1 PDF';
  const perKwh=finite(row.production_cost_per_kwh)?`<span>Production cost per kWh <strong>BDT ${row.production_cost_per_kwh.toFixed(5)}/kWh</strong></span>`:'';
  return `<section class="panel full bpdb-cost-panel"><div class="panel-head"><div><h2>Fuel cost by generation type</h2><p>Reported daily cost · ${esc(dateLabel(date))} · Bangladeshi taka (BDT)</p></div><span class="tag">BPDB · PAGE 1</span></div><div class="bpdb-cost-summary"><span>Total reported cost <strong>BDT ${amount(row.total_bdt)}</strong></span>${perKwh}</div><div class="bpdb-cost-layout"><svg class="bpdb-cost-pie" viewBox="0 0 240 240" role="group" aria-label="Reported cost share by generation type in BDT">${slices}</svg><div class="table-wrap"><table><caption class="visually-hidden">Reported daily cost by generation type in BDT</caption><thead><tr><th scope="col">Generation type</th><th scope="col">Cost (BDT)</th><th scope="col">Share</th></tr></thead><tbody>${entries.map(([name,value])=>`<tr><th scope="row"><i class="bpdb-cost-dot" style="background:${colors[name]||'#758c99'}"></i>${esc(name)}</th><td>${amount(value)}</td><td>${(value/sum*100).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div></div><p class="note">Source: ${source} · “${esc(row.source_label)}” · printed operating date ${esc(date)}${row.archive_date?' · archive date '+esc(row.archive_date):''}. These are the source’s reported costs; this chart does not establish full operating expenditure or profit. Categories remain as published.</p></section>`;
 }
 async function mountDay(date){
  await load();
  const host=document.getElementById('bpdb-day-cost');
  if(host?.dataset.costDate===date)host.innerHTML=piePanel(date);
 }
 root.BEGDCosts={load,setData,valid,forDate,series,trendPanel,piePanel,mountDay};
})(window);
