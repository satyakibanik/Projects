(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('en-GB',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const label=d=>new Date(d+'T08:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
 const series=[['domestic','Domestic gas','#21856c'],['lng','Regasified LNG','#bd7921'],['total','Total including LNG','#4f82cf']];
 const windows=['daily','7','30','60','90','365','all'];
 let bundle,pending;
 function selectRows(rows,end,range){
  const start=range==='all'?-Infinity:Date.parse(end+'T00:00:00Z')-(Number(range)-1)*86400000;
  return rows.filter(r=>r.date<=end&&Date.parse(r.date+'T00:00:00Z')>=start);
 }
 function difference(primary,check){return primary&&check?primary.total-check.total:null;}
 function plot(rows,fields,{bars=false,annual=false,unit='MMCFD'}={}){
  if(!rows.length)return '<p class="fuel-empty">No verified reports in this window. Choose another end date or a longer range.</p>';
  const W=950,H=290,L=64,R=22,T=24,B=48;
  const max=Math.max(1,...rows.flatMap(r=>fields.map(([key])=>r[key]||0)))*1.12;
  const first=Date.parse(rows[0].date),last=Date.parse(rows.at(-1).date);
  const x=(r,i)=>annual||bars?L+(i+.5)*(W-L-R)/rows.length:L+(last===first?.5:(Date.parse(r.date)-first)/(last-first))*(W-L-R);
  const y=v=>H-B-v/max*(H-T-B);
  let svg='';
  for(let i=0;i<=4;i++){const value=max*i/4,yy=y(value);svg+=`<line class="fuel-grid" x1="${L}" x2="${W-R}" y1="${yy}" y2="${yy}"/><text x="${L-10}" y="${yy+4}" text-anchor="end">${fmt(value,0)}</text>`;}
  fields.forEach(([key,name,color],j)=>{
   let prev=null;
   rows.forEach((r,i)=>{const xx=x(r,i),yy=y(r[key]);
    if(bars){const w=Math.min(180,(W-L-R)/rows.length*.68/fields.length);svg+=`<rect x="${xx+(j-fields.length/2)*w}" y="${yy}" width="${w-2}" height="${H-B-yy}" fill="${color}"><title>${esc(r.year||r.date)} · ${esc(name)}: ${fmt(r[key],annual?3:1)}</title></rect>`;}
    else{if(prev&&Date.parse(r.date)-Date.parse(prev.date)===86400000)svg+=`<line x1="${x(prev,i-1)}" y1="${y(prev[key])}" x2="${xx}" y2="${yy}" stroke="${color}" stroke-width="2.5"/>`;svg+=`<circle cx="${xx}" cy="${yy}" r="3.8" fill="${color}"><title>${esc(r.date)} · ${esc(name)}: ${fmt(r[key])} MMCFD</title></circle>`;prev=r;}
   });
  });
  const stride=Math.max(1,Math.ceil(rows.length/4));rows.forEach((r,i)=>{if((i%stride===0&&(i===0||rows.length-1-i>stride*.65))||i===rows.length-1)svg+=`<text x="${x(r,i)}" y="${H-17}" text-anchor="middle">${esc(annual?r.year:r.date.slice(5))}</text>`;});
  return `<div class="fuel-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(fields.map(f=>f[1]).join(', '))} in ${esc(unit)}; exact values in the data table below"><text x="${L}" y="14">${esc(unit.toUpperCase())}</text>${svg}</svg></div><div class="fuel-legend">${fields.map(([,name,color])=>`<span><i style="background:${color}"></i>${esc(name)}</span>`).join('')}</div>`;
 }
 function table(rows){return `<div class="fuel-table"><table><caption>Published daily values · MMCFD · dates mark the end of the 24-hour period</caption><thead><tr><th scope="col">Period ending</th><th scope="col">Domestic</th><th scope="col">LNG</th><th scope="col">Total supply</th><th scope="col">Power demand</th><th scope="col">Power supply</th><th scope="col">Report</th></tr></thead><tbody>${rows.slice().reverse().map(r=>`<tr><th scope="row">${label(r.date)}</th>${['domestic','lng','total','power_demand','power_supply'].map(k=>`<td>${fmt(r[k])}</td>`).join('')}<td><a target="_blank" rel="noopener noreferrer" href="${esc(r.url)}">PDF ↗</a></td></tr>`).join('')}</tbody></table></div>`;}
 async function mount(){
  if(location.hash!=='#fuel')return;
  document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#fuel'));
  document.querySelector('#title').textContent='Fuel';
  document.querySelector('#subtitle').textContent='Natural gas supply, power-sector allocation & domestic coal production';
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
 function draw(){
  const params=new URLSearchParams(location.search),range=windows.includes(params.get('fuelWindow'))?params.get('fuelWindow'):'30';
  const end=bundle.gas.some(r=>r.date===params.get('fuelDate'))?params.get('fuelDate'):bundle.gas.at(-1).date;
  const row=bundle.gas.find(r=>r.date===end),rows=range==='daily'?[row]:selectRows(bundle.gas,end,range);
  const check=bundle.checks.find(r=>r.date===end),delta=difference(row,check);
  const previous=new Date(Date.parse(end+'T00:00:00Z')-86400000).toISOString().slice(0,10);
  const age=Math.max(0,Math.floor((Date.now()-Date.parse(end+'T08:00:00+06:00'))/86400000));
  const missing=range==='all'||range==='daily'?null:Number(range)-rows.length;
  document.querySelector('#subtitle').textContent=`Gas period: ${label(previous)} 08:00 → ${label(end)} 08:00 · Bangladesh time (UTC+06:00)`;
  root.BEGDDataStatus?.set('fuel',[{label:'Fuel collection attempted',value:bundle.last_attempt_at}]);
  document.querySelector('#source').textContent='Fuel: Petrobangla daily production and distribution reports; GTCL provisional operational checks; BCMCL annual coal production. Fuel dates are independent of electricity workbook dates.';
  document.querySelector('#content').innerHTML=`<div class="fuel-dashboard">
   <div class="fuel-toolbar"><div class="fuel-windows" role="group" aria-label="Fuel time window">${windows.map(v=>`<button type="button" data-fuel-window="${v}" aria-pressed="${range===v}">${v==='daily'?'Daily':v==='all'?'Long term':v+'d'}</button>`).join('')}</div><label>Gas period ending<select id="fuel-date" aria-label="Gas period ending">${bundle.gas.slice().reverse().map(r=>`<option value="${r.date}" ${r.date===end?'selected':''}>${label(r.date)}</option>`).join('')}</select></label></div>
   <p class="fuel-coverage" role="status"><strong>Saved official reports · ${age} day${age===1?'':'s'} since period end</strong> · ${rows.length} daily report${rows.length===1?'':'s'} shown${missing!==null?` · ${missing} missing day${missing===1?'':'s'} in this window`:''}. Archive: ${label(bundle.gas[0].date)}–${label(bundle.gas.at(-1).date)}. Gaps are not filled.${bundle.source_status?.some(s=>s.status!=='ok')?' Latest collection is incomplete; saved reports retained.':''}</p>
   <div class="fuel-kpis">${[['Total gas supply',row.total,'Including regasified LNG'],['Domestic gas',row.domestic,'State companies + international operators'],['Regasified LNG',row.lng,fmt(100*row.lng/row.total)+'% of total gas supply'],['Gas supplied to power',row.power_supply,fmt(100*row.power_supply/row.power_demand)+'% of reported gas demand']].map(([title,value,note])=>`<div class="fuel-kpi"><div>${title}</div><strong>${fmt(value)} <small>MMCFD</small></strong><p>${note}</p></div>`).join('')}</div>
   <section class="fuel-panel"><div class="fuel-panel-title"><div><span class="fuel-eyebrow">01 / NATURAL GAS</span><h2>${range==='daily'?'Daily supply breakdown':'Gas supply over time'}</h2></div><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Petrobangla report ↗</a></div>${range==='daily'?plot(series.map(([key,name])=>({date:end,year:name,value:row[key]})),[['value','Gas supply','#21856c']],{bars:true,annual:true}):plot(rows,series)}<p class="fuel-note">${range==='daily'?'Total includes domestic gas and LNG; bars are not additive.':'Dots are published daily reports. Lines connect consecutive days only.'} Domestic gas is the sum of published state-company and IOC subtotals; rounding can leave a 0.1 MMCFD difference.</p></section>
   <div class="fuel-columns"><section class="fuel-panel"><span class="fuel-eyebrow">02 / POWER SECTOR</span><h2>Gas demand & supply</h2>${plot(rows,[['power_demand','Reported gas demand','#9a678e'],['power_supply','Gas supplied','#21856c']],{bars:range==='daily'})}<p class="fuel-note">${fmt(row.power_demand-row.power_supply)} MMCFD below reported power-sector gas demand on ${label(end)}. This gap is not an estimate of electricity load shedding.</p></section><section class="fuel-panel"><span class="fuel-eyebrow">03 / DISTRIBUTION</span><h2>Where the gas went</h2><div class="fuel-allocation">${[['Power plants',row.power_supply],['Fertilizer factories',row.fertilizer_supply],['Other consumers',row.others]].map(([name,value])=>`<div><span>${name}</span><strong>${fmt(value)} <small>MMCFD</small></strong><div class="fuel-meter"><i style="width:${Math.min(100,value/row.distribution_total*100)}%"></i></div></div>`).join('')}</div><p class="fuel-note">Distribution total: ${fmt(row.distribution_total)} MMCFD. Published distribution and production totals can differ; they are preserved separately and are not treated as a system-loss calculation.</p></section></div>
   <section class="fuel-panel"><span class="fuel-eyebrow">04 / SOURCE CHECK</span><h2>Petrobangla × GTCL</h2>${check?`<p>Same period ending ${label(end)}: Petrobangla <strong>${fmt(row.total,1)}</strong> · GTCL <strong>${fmt(check.total,4)}</strong> · difference <strong>${fmt(delta,4)} MMCFD</strong>. ${Math.abs(delta)<=.05001?'National total agrees at Petrobangla’s published precision.':'National totals differ beyond rounding.'} <a href="${esc(check.url)}" target="_blank" rel="noopener noreferrer">GTCL PDF ↗</a></p>`:'<p>No GTCL check stored for this date. The Petrobangla value remains unverified by a second publisher.</p>'}${check?`<p>Power-sector gas supply: Petrobangla <strong>${fmt(row.power_supply)}</strong> · GTCL <strong>${fmt(check.power_supply,3)} MMCFD</strong>. These published allocations differ; they are not substituted between sources.</p>`:''}<details><summary>Comparison of all overlapping reports (${bundle.checks.filter(c=>bundle.gas.some(g=>g.date===c.date)).length})</summary><div class="fuel-table"><table><thead><tr><th>Period end</th><th>Petrobangla total</th><th>GTCL total</th><th>Difference · MMCFD</th></tr></thead><tbody>${bundle.checks.slice().reverse().flatMap(c=>{const g=bundle.gas.find(r=>r.date===c.date);return g?[`<tr><th>${label(c.date)}</th><td>${fmt(g.total)}</td><td>${fmt(c.total,4)}</td><td>${fmt(difference(g,c),4)}</td></tr>`]:[]}).join('')}</tbody></table></div></details><p class="fuel-note">GTCL is provisional/operational and uses greater precision. Agreement on the national total does not mean every field, capacity, well count, or allocation matches.</p></section>
   <section class="fuel-panel"><div class="fuel-panel-title"><div><span class="fuel-eyebrow">05 / DOMESTIC COAL · ANNUAL</span><h2>Barapukuria coal production</h2></div><a href="${esc(bundle.sources.coal)}" target="_blank" rel="noopener noreferrer">BCMCL source ↗</a></div><p>FY ${bundle.coal.at(-1)?.year}: <strong>${fmt(bundle.coal.at(-1)?.tonnes,3)} metric tonnes</strong>. Fiscal years run July–June.</p>${plot(bundle.coal.map((r,i)=>({...r,date:String(2005+i)+'-01-01'})),[['tonnes','Coal mined','#8c789c']],{bars:true,annual:true,unit:'metric tonnes'})}<p class="fuel-note">Annual mine output, not coal stocks, imports or power-plant consumption. Independent of the gas time-window controls; no daily coal series is available from this source.</p><details><summary>Annual coal data</summary><div class="fuel-table"><table><thead><tr><th>Fiscal year</th><th>Metric tonnes</th></tr></thead><tbody>${bundle.coal.slice().reverse().map(r=>`<tr><th>${esc(r.year)}</th><td>${fmt(r.tonnes,3)}</td></tr>`).join('')}</tbody></table></div></details></section>
   <section class="fuel-panel"><h2>Daily gas data</h2>${table(rows)}<button type="button" id="fuel-csv">Download this window as CSV</button></section>
   <details class="fuel-panel"><summary>Sources, reliability & reporting periods</summary><p><a href="${esc(bundle.sources.petrobangla)}" target="_blank" rel="noopener noreferrer">Petrobangla</a> is the primary source for national production, LNG and sector allocation. Its <a href="https://petrobangla.org.bd/" target="_blank" rel="noopener noreferrer">homepage headline</a> is useful as a latest-period check, but has no historical breakdown. <a href="${esc(bundle.sources.gtcl)}" target="_blank" rel="noopener noreferrer">GTCL</a> is a secondary check with detailed transmission readings; transmission throughput is not national production.</p><p><a href="${esc(bundle.sources.emrd)}" target="_blank" rel="noopener noreferrer">EMRD</a> provides a rounded summary; without a clearly matched reporting period it is not spliced into this daily series. The supplied BCMCL page reports fiscal-year production only.</p><p>Gas reports cover 08:00 to 08:00 Bangladesh time and are indexed by period end, not website upload date. Petrobangla uses MMCFD (million cubic feet per day); GTCL’s MMSCF over the same 24-hour period is numerically comparable as a daily average, subject to the publishers’ measurement conventions. Gas supply includes LNG send-out, not LNG cargo volume. Values are not converted to MW or MWh.</p><p>New reports are collected during each site build. Failed downloads or unrecognized layouts preserve saved data and are reported above. The 365-day and long-term choices do not imply complete history.</p></details></div>`;
  document.querySelectorAll('[data-fuel-window]').forEach(b=>b.addEventListener('click',()=>update('fuelWindow',b.dataset.fuelWindow)));
  document.querySelector('#fuel-date').addEventListener('change',e=>update('fuelDate',e.target.value));
  document.querySelector('#fuel-csv').addEventListener('click',()=>{const keys=['date','domestic','lng','total','power_demand','power_supply','fertilizer_demand','fertilizer_supply','others','distribution_total','url'];const csv=keys.join(',')+'\n'+rows.map(r=>keys.map(k=>r[k]).join(',')).join('\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.href=url;a.download=`begd-fuel-${end}-${range}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 }
 function update(key,value){const u=new URL(location.href);u.searchParams.set(key,value);history.replaceState(null,'',u);draw();}
 root.BEGDFuel={mount,selectRows,difference};
 if(typeof module!=='undefined')module.exports={selectRows,difference,plot};
 if(typeof document!=='undefined'){
  window.addEventListener('popstate',()=>{if(location.hash==='#fuel')mount();});
  if(location.hash==='#fuel')mount();
 }
})(typeof window==='undefined'?globalThis:window);
