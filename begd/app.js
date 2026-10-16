const $=s=>document.querySelector(s), fmt=(n,d=0)=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d}), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDate=d=>d?new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'}):'unavailable';
const colors={Gas:'#1976b9',Coal:'#759398',HFO:'#c48722',HSD:'#b95442',Hydro:'#347baf',Solar:'#e6de97',Imports:'#acb69a',Wind:'#b5d7da'};
let data, request=0;
let currentDayData=null, currentDayRequest=0, currentDayError=null;
const comparisonData={yesterday:null,tomorrow:null,highest:null}, comparisonRequests={yesterday:0,tomorrow:0,highest:0};
let dispatchChartStyle='line', shedChartStyle='bar'; const dispatchVisibility=new Map();
let chartId=0; const chartData=new Map();
const comparisonSources=()=>[
 ['yesterday',comparisonData.yesterday,'#a77cc1','#81a2cb'],
 ['tomorrow',comparisonData.tomorrow,'#ed8065','#54b9a4'],
 ['highest',comparisonData.highest,'#d9ae70','#d2834b'],
].filter(([,report])=>report);
const dayLabel=day=>({current:'Current day',yesterday:'Yesterday',tomorrow:'Tomorrow',highest:'Highest generation day'}[day]||day);
function comparedRows(baseRows, sources, fields){
 const rows=baseRows.map(row=>({...row})),series=[];
 for(const [day,report,demandColor,generationColor] of sources){
  const byTime=new Map((report.hourly||[]).map(row=>[row.time,row]));
  for(const field of fields){
   const key=`${field.key}_${day}`,family=field.key==='generation_mw'?'generation':field.key==='demand_mw'?'demand':null;series.push({key,name:`${field.name} · ${dayLabel(day)}`,color:field.key==='generation_mw'?generationColor:demandColor,bar:field.bar||false,dash:family==='demand'||field.key==='shed_mw',family,source:day});
   rows.forEach(row=>{const other=byTime.get(row.time);row[key]=other?other[field.key]:null});
  }
 }
 return {rows,series};
}
function metric(label,value,unit,note){return `<div class="metric"><div class="label">${label}</div><div class="value">${value}<span>${unit}</span></div><small>${note}</small></div>`}
function chartScale(rows,series){
 const values=rows.flatMap(r=>series.map(s=>r[s.key])).filter(v=>typeof v==="number"&&Number.isFinite(v));
 if(!values.length)return {min:0,max:1,step:0.25};
 const low=Math.min(...values),high=Math.max(...values),bar=series.some(s=>s.bar);
 const padding=Math.max((high-low)*0.08,Math.abs(high)*0.002,0.5);
 let min=bar?Math.min(0,low):Math.max(low>=0?0:-Infinity,low-padding),max=high+padding;
 const rough=(max-min)/4,power=10**Math.floor(Math.log10(rough));
 const step=[1,2,2.5,5,10].map(n=>n*power).find(n=>n>=rough);
 const boundary=step/5;min=Math.floor(min/boundary)*boundary;max=Math.ceil(max/boundary)*boundary;
 if(max<=min)max=min+step;
 return {min,max,step};
}
function chartLegend(series,balanceLegend,wrapLegend){
 const swatch=s=>`<i class="series-swatch${s.dash?' dashed':''}" style="--series-color:${s.color}"></i>`;
 if(!balanceLegend)return `<div class="legend${wrapLegend?' legend-wrap':''}">${series.map(s=>`<label><input type="checkbox" data-toggle-series="${s.key}" checked>${swatch(s)}<span data-series-label="${esc(s.key)}" tabindex="0">${esc(s.name)}</span></label>`).join('')}</div>`;
 const sources=['selected','yesterday','tomorrow','highest'].filter(source=>series.some(s=>s.source===source));
 const master=(family,label)=>{const items=series.filter(s=>s.family===family),checked=items.filter(s=>dispatchVisibility.get(s.key)!==false).length;return `<label><input type="checkbox" data-toggle-family="${family}" ${checked===items.length?'checked':''}>${label}</label>`};
 const rows=sources.map(source=>`<div class="dispatch-legend-row">${['generation','demand'].map(family=>{const item=series.find(s=>s.source===source&&s.family===family);return item?`<label><input type="checkbox" data-toggle-series="${item.key}" data-series-family="${family}" ${dispatchVisibility.get(item.key)!==false?'checked':''}>${swatch(item)}<span data-series-label="${esc(item.key)}" tabindex="0">${esc(item.name)}</span></label>`:'<span></span>'}).join('')}</div>`).join('');
 return `<div class="legend dispatch-legend"><div class="dispatch-legend-master">${master('generation','All generation')}${master('demand','All demand')}</div><div class="dispatch-legend-rows">${rows}</div></div>`;
}
function chart(rows,series,options={}){
 const selectedStyle=options.styleSetting==='dispatch'?dispatchChartStyle:options.styleSetting==='shed'?shedChartStyle:null;
 const plotSeries=selectedStyle?series.map(item=>({...item,bar:item.pointsOnly?false:selectedStyle==='bar'})):series;
 const W=800,H=250,L=58,R=15,T=14,B=32,scale=chartScale(rows,plotSeries);
 const x=r=>L+(parseInt(r.time)*60+parseInt(r.time.slice(3)))/1380*(W-L-R),y=v=>H-B-(v-scale.min)/(scale.max-scale.min)*(H-T-B);
 const id="plot-"+(++chartId); chartData.set(id,{rows,series:plotSeries,x}); let body='';for(let i=0;i<=4;i++){const v=scale.min+(scale.max-scale.min)*i/4;body+=`<line class="axis" data-tick-line="${i}" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text data-tick-label="${i}" x="${L-8}" y="${y(v)+4}" text-anchor="end">${fmt(v,2)}</text>`}
 for(const h of [0,6,12,18,23])body+=`<text x="${x({time:String(h).padStart(2,'0')+':00'})}" y="${H-7}" text-anchor="middle">${String(h).padStart(2,'0')}:00</text>`;
 const bars=plotSeries.filter(s=>s.bar),barWidth=bars.length>1?Math.min(7,(W-L-R)/(rows.length-1)/bars.length):10;
 for(const s of plotSeries){body+=`<g data-series="${s.key}">`;if(s.bar){const barIndex=bars.indexOf(s),offset=(barIndex-(bars.length-1)/2)*barWidth;for(const [rowIndex,r] of rows.entries()){const value=r[s.key];if(typeof value!=='number')continue;body+=`<rect data-row-index="${rowIndex}" x="${x(r)+offset-barWidth/2}" y="${y(value)}" width="${Math.max(1,barWidth-0.7)}" height="${Math.max(0,H-B-y(value))}" rx="1" fill="${s.color}"><title>${r.time}: ${fmt(value,2)} MW</title></rect>`}}else{const points=s.pointsOnly?'':rows.filter(r=>typeof r[s.key]==='number').map(r=>`${x(r)},${y(r[s.key])}`).join(' ');body+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" ${s.dash?'stroke-dasharray="6 4"':''} points="${points}"/>`;for(const [rowIndex,r] of rows.entries()){if(typeof r[s.key]!=='number')continue;body+=`<circle data-row-index="${rowIndex}" cx="${x(r)}" cy="${y(r[s.key])}" r="${s.pointsOnly?5:3}" fill="${s.color}"><title>${s.name}, ${r.time}: ${fmt(r[s.key],2)} MW</title></circle>`}}body+=`</g>`}
 rows.forEach((r,i)=>{const left=i===0?L:(x(rows[i-1])+x(r))/2,right=i===rows.length-1?W-R:(x(r)+x(rows[i+1]))/2;body+=`<rect class="chart-hit" data-point="${i}" x="${left}" y="${T}" width="${right-left}" height="${H-T-B}" fill="transparent" tabindex="0" role="button" aria-label="${esc(r.time)}: ${esc(series.map(s=>s.name+": "+fmt(r[s.key],2)+" MW").join(", "))}"/>`});
 const styleControl=selectedStyle?`<div class="dispatch-chart-style"><label>Chart style <select data-chart-style="${options.styleSetting}"><option value="line" ${selectedStyle==='line'?'selected':''}>Line chart</option><option value="bar" ${selectedStyle==='bar'?'selected':''}>Bar chart</option></select></label></div>`:'';
 return `<div class="interactive-chart" data-chart="${id}">${styleControl}<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(series.map(s=>s.name).join(" and "))} in megawatts"><title>${esc(series.map(s=>s.name).join(" and "))} in MW</title>${body}<line class="chart-cursor" y1="${T}" y2="${H-B}" hidden/></svg><div class="chart-tooltip" role="status" hidden></div>${chartLegend(series,options.balanceLegend,options.wrapLegend)}<p class="chart-help">Hover, tap, or focus the chart for values. Use the legend to select series.</p></div>`;

}
const panel=(title,subtitle,body,tag='MW')=>`<section class="panel"><div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="tag">${tag}</span></div>${body}</section>`;
function fuelStrip(report,label){return `<div><div class="comparison-strip-label">${label} · ${report.date}</div><div class="composition-strip">${Object.entries(report.fuels).filter(([,v])=>v>0).map(([fuel,value])=>`<div style="width:${value/report.summary.energy_mwh*100}%;background:${colors[fuel]}" title="${fuel}: ${fmt(value/report.summary.energy_mwh*100,1)}%"></div>`).join('')}</div></div>`}
function overview(){
 const s=data.summary,sources=comparisonSources(),dispatch=comparedRows(data.hourly,sources,[{key:'demand_mw',name:'Demand'},{key:'generation_mw',name:'Generation'}]),shed=comparedRows(data.hourly,sources,[{key:'shed_mw',name:'Load shedding',bar:true}]);
 const dispatchRows=dispatch.rows;
 const dispatchSeries=[{key:'demand_mw',name:'Demand · selected day',color:'#c48722',family:'demand',source:'selected',dash:true},{key:'generation_mw',name:'Generation · selected day',color:'#1976b9',family:'generation',source:'selected'},...dispatch.series];
 const shedSeries=[{key:'shed_mw',name:'Load shedding · selected day',color:'#b95442',bar:true,dash:true},...shed.series.map(series=>({...series,bar:true}))];
 const fuelSources=[['Selected day',data],...sources.map(([day,report])=>[dayLabel(day),report])];
 return `<div class="dispatch-layout"><section class="dispatch-main"><div class="dispatch-heading"><span class="section-number">01 / SYSTEM DISPATCH</span><span class="tag">MW · BST</span></div><h2 class="dispatch-title">Demand and generation</h2>${chart(dispatchRows,dispatchSeries,{balanceLegend:true,styleSetting:'dispatch'})}<div class="dispatch-bottom"><span>00:00 — 23:00</span><p>Hourly demand and dispatched generation. Use the legend to compare selected and adjacent operating days.</p></div></section><aside class="dispatch-readings"><div class="section-number">DAILY TOTALS & PEAKS</div>${metric("Evening peak demand",fmt(s.peak_demand_mw),"MW","Generation side · 19:30")}${metric("Peak generation",fmt(s.peak_generation_mw),"MW","Includes cross-border imports")}${metric("Energy not served",fmt(s.unserved_mwh/1000,2),"GWh","Published daily energy total")}${metric("Energy generated",fmt(s.energy_mwh/1000,2),"GWh","Published total · including imports")}</aside></div><div class="energy-band"><div><div class="section-number">02 / ENERGY COMPOSITION</div><h2>Fuel mix</h2><p>Share of reported daily energy</p></div><div class="composition"><div class="comparison-strips">${fuelSources.map(([label,report])=>fuelStrip(report,label)).join('')}</div><div class="composition-key">${Object.entries(data.fuels).map(([f,v])=>`<div><i style="background:${colors[f]}"></i><span>${f}</span><strong>${v>0&&v/s.energy_mwh*100<0.1?"&lt;0.1":fmt(v/s.energy_mwh*100,1)}<small>%</small></strong></div>`).join('')}</div></div></div><div class="grid lower-grid">${panel("Reported load shedding","Power curtailed at each published reading",chart(shed.rows,shedSeries,{styleSetting:'shed'}))}${panel("Operating statistics","Additional published operating figures",`<div class="context-reading"><span>Maximum temperature</span><strong>${fmt(s.temperature_c,1)} °C</strong></div><div class="context-reading"><span>Imported energy share</span><strong>${fmt(s.import_mwh/s.energy_mwh*100,1)}%</strong></div><div class="context-reading"><span>Plant / import entries</span><strong>${fmt(data.plants.length)}</div><div class="context-reading"><span>Operating regions</span><strong>${data.regions.length}</strong></div>`,`REPORT NOTES`)}</div>`
}
let selectedPlantName=null,plantStatusFilter='all';
const normalizedPlantName=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const basePlantName=name=>normalizedPlantName(name).replace(/(?:gas|hsd|hfo|diesel|coal)$/,'');
function matchPlant(items,name){return items?.find(item=>normalizedPlantName(item.name)===normalizedPlantName(name))||items?.find(item=>basePlantName(item.name)===basePlantName(name))}
function plantUnits(){return data.plant_units?.length?data.plant_units:data.plants.map(plant=>({...plant,status:plant.peak_mw>0?'running':'no-output',hourly:[]}))}
function plants(){const units=plantUnits();return `<section class="panel full plants-panel"><div class="panel-head"><div><h2>All plants</h2><p>GenLog hourly output for every generating unit named in the report</p></div><span class="tag">${units.length} GENERATING UNITS</span></div><div class="plant-filters" id="plant-status-filter" aria-label="Filter plants by output"><button type="button" class="plant-filter active" data-status="all">All</button><button type="button" class="plant-filter" data-status="running">Generating</button><button type="button" class="plant-filter" data-status="no-output">No output</button></div><div class="toolbar"><input id="plant-search" type="search" placeholder="Search a plant, e.g. Payra, Ghorasal, Solar…" aria-label="Search power plants"></div><p class="count" id="plant-count"></p><div class="plant-layout"><ul class="plant-list" id="plant-list" aria-label="Generating units"></ul><section class="plant-detail" id="plant-detail" aria-live="polite"><p class="plant-detail-empty">Select a plant to see its 24-hour output and daily figures.</p></section></div><p class="note">Hourly output, peak, and daily energy come from GenLog. “No output” describes the reported readings and does not establish an outage.</p></section>`}
function updatePlants(){
 const units=plantUnits(),query=$('#plant-search').value.trim().toLowerCase();
 const rows=units.filter(plant=>(plantStatusFilter==='all'||plant.status===plantStatusFilter)&&plant.name.toLowerCase().includes(query)).sort((a,b)=>(b.peak_mw??-1)-(a.peak_mw??-1));
 const running=units.filter(plant=>plant.status==='running').length;
 $('#plant-count').textContent=`${rows.length} shown · ${running} generating · ${units.length-running} with no reported output`;
 const list=$('#plant-list');
 list.innerHTML=rows.map(plant=>`<li data-plant="${encodeURIComponent(plant.name)}" class="${plant.name===selectedPlantName?'active':''}" tabindex="0" role="button" aria-pressed="${plant.name===selectedPlantName}"><span>${esc(plant.name)}</span><span class="peak">${plant.status==='no-output'?'<span class="plant-status-badge">0 MW</span>':`${fmt(plant.utilization_ratio_pct??plant.utilization_pct,0)}%`}</span></li>`).join('')||'<li class="plant-empty">No plants match these filters.</li>';
 list.querySelectorAll('[data-plant]').forEach(item=>{
  const select=()=>showPlantDetail(decodeURIComponent(item.dataset.plant));
  item.addEventListener('click',select);
  item.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select()}});
 });
 if(rows.some(plant=>plant.name===selectedPlantName))showPlantDetail(selectedPlantName);
 else if(rows.length)showPlantDetail(rows[0].name);
 else $('#plant-detail').innerHTML='<p class="plant-detail-empty">No plant is selected.</p>';
}
function showPlantDetail(name){
 const plant=plantUnits().find(item=>item.name===name);if(!plant)return;
 selectedPlantName=name;
 const list=$('#plant-list');list?.querySelectorAll('[data-plant]').forEach(item=>{const active=decodeURIComponent(item.dataset.plant)===name;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});
 const status=plant.status==='running'?'Generating':'No output reported';
 const rows=(plant.hourly||[]).map(point=>({time:point.time,output_selected:point.mw}));
 const series=[{key:'output_selected',name:`Selected report · ${shortDate(data.date)}`,color:'#147d58'}];
 for(const [day,report,color] of [['yesterday',comparisonData.yesterday,'#a77cc1'],['tomorrow',comparisonData.tomorrow,'#54b9a4'],['highest',comparisonData.highest,'#d2834b']]){
  if(!report)continue;
  const match=(report.plant_units||[]).find(unit=>normalizedPlantName(unit.name)===normalizedPlantName(name));
  if(!match?.hourly?.length)continue;
  const key=`output_${day}`,byTime=new Map(match.hourly.map(point=>[point.time,point.mw]));
  rows.forEach(row=>{row[key]=byTime.get(row.time)??null});
  series.push({key,name:`${dayLabel(day)} · ${shortDate(report.date)}`,color});
 }
 const curve=rows.length?chart(rows,series):'<p class="plant-detail-empty">Hourly GenLog readings are unavailable for this report.</p>';
 const p2=matchPlant(data.plants,name),forecast=matchPlant(data.forecast?.plants,name);
 const present=plant.present_capacity_mw??p2?.present_capacity_mw??p2?.capacity_mw;
 const reportedInstalled=plant.installed_capacity_mw??p2?.installed_capacity_mw??forecast?.capacity_mw;
 const hasInstalled=Number.isFinite(Number(reportedInstalled))&&Number(reportedInstalled)>0;
 const installed=hasInstalled?Number(reportedInstalled):(Number.isFinite(Number(present))&&Number(present)>0?Number(present):null);
 const installedFallback=!hasInstalled&&installed!=null;
 const hourlyValues=(plant.hourly||[]).filter(point=>typeof point.mw==='number');
 const peak=plant.peak_generation_mw??plant.peak_mw??(hourlyValues.length?Math.max(...hourlyValues.map(point=>point.mw)):null);
 const energy=plant.energy_mwh??p2?.energy_mwh;
 const operatingHours=plant.operating_hours??hourlyValues.filter(point=>point.time.endsWith(':00')&&point.mw>0).length;
 const capacityFactor=installed>0&&energy!=null?energy/(installed*24)*100:null;
 const puf=installed>0&&energy!=null&&operatingHours>0?energy/(installed*operatingHours)*100:null;
 const utilizationRatio=installed>0&&peak!=null?peak/installed*100:null;
 const fuel=plant.fuel??forecast?.fuel??'—',producer=plant.producer??forecast?.producer??p2?.producer??'—';
 const math=(latex,body)=>`<math class="plant-formula" display="block" alttext="${esc(latex)}" aria-label="${esc(latex)}" data-latex="${esc(latex)}"><mrow>${body}</mrow></math>`;
 const cfFormula=math(String.raw`Capacity Factor = \frac{Actual Energy Generated}{Installed Capacity × Total Hours (24)} × 100%`,`<mtext>Capacity Factor =</mtext><mfrac><mtext>Actual Energy Generated</mtext><mrow><mo>(</mo><mtext>Installed Capacity</mtext><mo>×</mo><mtext>Total Hours (24)</mtext><mo>)</mo></mrow></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const pufFormula=math(String.raw`Plant Utilization Factor (PUF) = \frac{Energy Produced}{Installed Capacity × Actual Operating Hours} × 100%`,`<mtext>Plant Utilization Factor (PUF) =</mtext><mfrac><mtext>Energy Produced</mtext><mrow><mo>(</mo><mtext>Installed Capacity</mtext><mo>×</mo><mtext>Actual Operating Hours</mtext><mo>)</mo></mrow></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const ratioFormula=math(String.raw`Utilization Ratio = \frac{Maximum Plant Output (MW)}{Installed Capacity (MW)} × 100%`,`<mtext>Utilization Ratio =</mtext><mfrac><mtext>Maximum Plant Output (MW)</mtext><mtext>Installed Capacity (MW)</mtext></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const reading=(title,value,unit,description,note='',formulaMarkup='')=>`<div><span class="plant-metric-title" tabindex="0" aria-label="${esc(title)}">${esc(title)}<span class="plant-tooltip" role="tooltip"><span class="plant-tooltip-description">${esc(description)}${note?` ${esc(note)}`:''}</span>${formulaMarkup}</span></span><strong>${value}${unit?` ${unit}`:''}</strong>${note&&title==='Installed Capacity'?`<small>${esc(note)}</small>`:''}</div>`;
 const installedSource=installedFallback?'P2 · Present Capacity (Installed Capacity unavailable)':'P2 · Installed Capacity';
 const sources=`<div class="plant-source-note"><h4>DATA SOURCES</h4><ul><li><strong>Installed Capacity:</strong> ${installedSource}; fallback value is also shown as Present capacity</li><li><strong>Present capacity:</strong> P2 · Present Capacity</li><li><strong>Peak Generation today, Energy generated today, operating hours:</strong> GenLog · hourly readings, Total KWH</li><li><strong>Capacity Factor / Utilization:</strong> calculated from GenLog · Total KWH and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Plant Utilization Factor (PUF):</strong> calculated from GenLog · Total KWH, hourly readings and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Utilization ratio:</strong> calculated from GenLog · maximum hourly reading and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Fuel, Producer:</strong> Forecast · Fuel, Producer</li></ul></div>`;
 $('#plant-detail').innerHTML=`<div class="plant-detail-heading"><div><h3>${esc(name)}</h3><span class="plant-status ${plant.status==='running'?'is-running':''}">${status}</span></div><span class="tag">GENLOG · MW / BST</span></div><p class="plant-metric-date">Metrics for operating day ${esc(shortDate(data.date))}</p><div class="plant-metrics">${reading('Installed Capacity',fmt(installed,1),'MW','Maximum rated output of the plant’s installed equipment.',installedFallback?'Data unavailable, using present capacity value.':'')}${reading('Present capacity',fmt(present,1),'MW','Output capacity currently available from the plant.')}${reading('Peak Generation today',fmt(peak,1),'MW','Highest output recorded at any reading time today.')}${reading('Capacity Factor / Utilization',fmt(capacityFactor,1),'%','Actual energy generated compared with the energy the plant could generate at installed capacity continuously for 24 hours.','',cfFormula)}${reading('Plant Utilization Factor (PUF)',fmt(puf,1),'%','Energy produced compared with installed capacity during the hours when the plant was operating.',`Actual operating hours: ${operatingHours}; the number of hourly readings when the plant was not at zero.`,pufFormula)}${reading('Utilization ratio',fmt(utilizationRatio,1),'%','Peak output recorded for this plant compared with its installed capacity.','',ratioFormula)}${reading('Energy generated today',fmt(energy,1),'MWh','Total electrical energy produced over the operating day.')}${reading('Fuel',esc(fuel),'','Fuel type recorded for the plant.')}${reading('Producer',esc(producer),'','Company or agency listed as the plant producer.')}</div><div class="plant-output-chart">${curve}</div>${sources}`;
 setupCharts('plants');
}
function regions(){
 const sources=comparisonSources(),reports=[['Selected day',data],...sources.map(([day,report])=>[day,report])];
 const maxEnergy=Math.max(...reports.flatMap(([,report])=>report.regions.map(region=>region.energy_mwh)));
 const cards=data.regions.map(region=>{
  const bars=sources.map(([day,report])=>{
   const match=report.regions.find(item=>item.name===region.name),energy=match?.energy_mwh||0,color=day==='yesterday'?'#a77cc1':day==='tomorrow'?'#54b9a4':'#d2834b';
   return `<div class="region-compare-row"><div class="region-compare-head"><span>${dayLabel(day)}</span><strong>${fmt(energy/1000,2)} GWh</strong></div><div class="track"><div class="fill" style="background:${color};width:${energy/maxEnergy*100}%"></div></div></div>`;
  }).join('');
  return `<section class="panel region-card"><div class="panel-head"><h3>${esc(region.name)}</h3><span class="tag">${fmt(region.energy_mwh/data.summary.energy_mwh*100,1)}% of energy</span></div><div class="label">Daily generation · includes assigned imports</div><div class="value">${fmt(region.energy_mwh/1000,2)}<span>GWh</span></div><div class="track"><div class="fill" style="background:var(--green);width:${region.energy_mwh/maxEnergy*100}%"></div></div>${bars?`<div class="region-compare">${bars}</div>`:''}<div class="mini"><span>Evening demand</span><strong>${fmt(region.demand_mw)} MW</strong></div><div class="mini"><span>Reported load shedding</span><strong>${fmt(region.shed_mw)} MW</strong></div></section>`;
 }).join('');
 const fuelHead=Object.keys(data.fuels).map(fuel=>`<th class="num">${fuel}</th>`).join('');
 const fuelRows=data.regions.map(region=>`<tr><td class="name">${esc(region.name)}</td>${Object.values(region.fuels).map(value=>`<td class="num">${fmt(value/1000,2)}</td>`).join('')}</tr>`).join('');
 const fuelTable=`<div class="table-wrap"><table><thead><tr><th>Region</th>${fuelHead}</tr></thead><tbody>${fuelRows}</tbody></table></div><p class="note">Demand and load shedding are regional evening-peak snapshots at 19:30. Do not compare their sum directly with generation-side national demand.</p>`;
 return `<div class="region-grid">${cards}</div>${panel('Regional fuel mix','Published daily energy by operating region',fuelTable,'GWh')}`;
}
function importMatch(report,name){
 const exact=report.imports.find(item=>item.name===name);if(exact)return exact;
 const token=name.toLowerCase().match(/bheramara|tripura|adani|nepal|hvdc/)?.[0];
 return token?report.imports.find(item=>item.name.toLowerCase().includes(token)):null;
}
function imports(){
 const s=data.summary,sources=comparisonSources();
 const graphs=data.imports.map(item=>{
  const rows=item.hourly.map(row=>({...row})),series=[{key:'mw',name:'Reported import · selected day',color:'#347baf'}];
  for(const [day,report,color] of sources){const match=importMatch(report,item.name),byTime=new Map((match?.hourly||[]).map(row=>[row.time,row]));const key=`mw_${day}`;rows.forEach(row=>row[key]=byTime.get(row.time)?.mw??null);series.push({key,name:`Reported import · ${dayLabel(day)}`,color})}
  return panel(esc(item.name),`${fmt(item.energy_mwh/1000,2)} GWh imported during the day`,chart(rows,series))
 });
 return `<div class="metrics">${metric('Total imported energy',fmt(s.import_mwh/1000,2),'GWh','Included in national energy total')}${metric('Share of total energy',fmt(s.import_mwh/s.energy_mwh*100,1),'%','Imported / national reported energy')}${metric('Import routes',data.imports.length,'','Bheramara · Tripura · Adani · Nepal')}${metric('Domestic energy',fmt((s.energy_mwh-s.import_mwh)/1000,2),'GWh','National total less imports')}</div><div class="grid">${graphs.join('')}</div><p class="note">Route energy comes from GenLog’s published Total KWH row. Route curves, daily energy totals and the selected-day curve come from the chosen workbook.</p>`
}
function realTime(){
 if(!currentDayData)return `<section class="panel full"><p id="current-status" role="status">${currentDayError?'ERP readings unavailable. Retrying shortly.':'Fetching latest ERP readings…'}</p></section>`;
 const latest=currentDayData.source_dates||{},today=shortDate(currentDayData.today_date||currentDayData.date),rows=(currentDayData.demand_hourly||[]),generation=(currentDayData.generation_hourly||[]),routes=currentDayData.imports||[];
 const dateFor=key=>latest[key]?shortDate(latest[key]):'No data for today';
 const demandPanel=rows.length?panel('Demand, supply & load shedding',`Demand/supply ERP page · ${dateFor('demand')} · ${rows.length} readings`,chart(rows,[{key:'demand_mw',name:'Demand',color:'#c48722'},{key:'generation_mw',name:'Generation',color:'#1976b9'},{key:'shed_mw',name:'Load shedding',color:'#b95442',dash:true}])):'';
 const fuelSeries=[['total_mw','Total generation','#263238'],['gas_mw','Gas',colors.Gas],['liquid_mw','Liquid fuel',colors.HFO],['coal_mw','Coal',colors.Coal],['hydro_mw','Hydro',colors.Hydro],['solar_mw','Solar',colors.Solar],['wind_mw','Wind',colors.Wind]].map(([key,name,color])=>({key,name,color}));
 const generationPanel=generation.length?panel('Generation by source',`Generation ERP page · ${dateFor('generation')} · ${generation.length} readings`,chart(generation,fuelSeries)):'';
 const availableRoutes=routes.filter(route=>route.hourly?.length),routeColors=['#347baf','#c48722','#b95442','#36a77b'];
 const importTimes=[...new Set(availableRoutes.flatMap(route=>route.hourly.map(row=>row.time)))].sort();
 const importRows=importTimes.map(time=>({time,...Object.fromEntries(availableRoutes.map((route,index)=>[`import_${index}`,route.hourly.find(row=>row.time===time)?.mw??null]))}));
 const importSeries=availableRoutes.map((route,index)=>({key:`import_${index}`,name:route.name,color:routeColors[index%routeColors.length]}));
 const importsPanel=availableRoutes.length?panel('Cross-border imports',`ERP import and generation pages · ${today} · ${availableRoutes.length} routes`,chart(importRows,importSeries,{wrapLegend:true})):'';
 const updated=currentDayData.updated_at?new Date(currentDayData.updated_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}):'—';
 const panels=`${demandPanel}${generationPanel}${importsPanel}`;
 return `<p class="note" id="current-status" role="status">Today only · ${esc(today)} Bangladesh time · refreshed ${esc(updated)}. Only sources with readings dated today are shown. Refreshes every three minutes.</p>${panels?`<div class="grid realtime-grid">${panels}</div>`:'<p class="note">No ERP readings are available for today.</p>'}<p class="note">Sources: ${(currentDayData.source_urls||[]).map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener">${['Demand / supply / load shedding','Generation by source','India imports'][i]||'ERP source'}</a>`).join(' · ')}</p>`
}
function substations(){
 const rows=data.substations||[],volts=data.voltages||[];
 const classes=[...new Set(volts.map(v=>v.voltage_class))];
 return `<div class="metrics">${metric('Substations reporting load',rows.length,'','P3 · daily maximum load')}${metric('Highest served load',fmt(Math.max(...rows.map(r=>r.load_mw)),1),'MW','Across listed grid substations')}${metric('Voltage classes',classes.length,'','400 kV · 230 kV · 132 kV')}${metric('Voltage readings',volts.length,'','Maximum and minimum by station')}</div><section class="panel full"><div class="panel-head"><div><h2>Maximum substation load</h2><p>Daily maximum served load and the reported time of each station’s peak</p></div><span class="tag">P3 · MW</span></div><div class="toolbar"><input id="substation-search" type="search" placeholder="Search substations" aria-label="Search substations"><select id="substation-sort" aria-label="Sort substation loads"><option value="load_mw">Highest load ↓</option><option value="name">Station name A–Z</option></select></div><p class="count" id="substation-count"></p><div class="table-wrap"><table><thead><tr><th>Substation</th><th class="num">Maximum load MW</th><th>Peak time · BST</th></tr></thead><tbody id="substation-rows"></tbody></table></div><p class="note">Source: P3, “Maximum Load Served by Different Grid Sub-Stations.” The time is each station’s reported daily maximum, not necessarily the national peak hour.</p></section><section class="panel full"><div class="panel-head"><div><h2>Substation voltage range</h2><p>Daily maximum and minimum voltage recorded by voltage class</p></div><span class="tag">VOLTAGE · KV</span></div><div class="toolbar"><input id="voltage-search" type="search" placeholder="Search substations" aria-label="Search voltage substations"><select id="voltage-class" aria-label="Filter voltage class"><option value="">All voltage classes</option>${classes.map(v=>`<option>${esc(v)}</option>`).join('')}</select></div><p class="count" id="voltage-count"></p><div class="table-wrap"><table><thead><tr><th>Substation</th><th>Class</th><th class="num">Maximum kV</th><th>Time</th><th class="num">Minimum kV</th><th>Time</th></tr></thead><tbody id="voltage-rows"></tbody></table></div></section>`
}
function updateSubstations(){
 if(!$('#substation-rows'))return;
 const query=$('#substation-search').value.toLowerCase(),sort=$('#substation-sort').value;
 const rows=(data.substations||[]).filter(r=>r.name.toLowerCase().includes(query)).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):b.load_mw-a.load_mw);
 $('#substation-count').textContent=`${rows.length} of ${(data.substations||[]).length} substations`;
 $('#substation-rows').innerHTML=rows.map(r=>`<tr><td class="name">${esc(r.name)}</td><td class="num">${fmt(r.load_mw,1)}</td><td>${esc(r.time)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">No substations match this search.</td></tr>';
 const voltageQuery=$('#voltage-search').value.toLowerCase(),voltageClass=$('#voltage-class').value;
 const voltageRows=(data.voltages||[]).filter(r=>(!voltageClass||r.voltage_class===voltageClass)&&r.name.toLowerCase().includes(voltageQuery)).sort((a,b)=>a.voltage_class.localeCompare(b.voltage_class)||a.name.localeCompare(b.name));
 $('#voltage-count').textContent=`${voltageRows.length} of ${(data.voltages||[]).length} readings`;
 $('#voltage-rows').innerHTML=voltageRows.map(r=>`<tr><td class="name">${esc(r.name)}</td><td>${esc(r.voltage_class)}</td><td class="num">${fmt(r.max_kv)}</td><td>${esc(r.max_time)}</td><td class="num">${fmt(r.min_kv)}</td><td>${esc(r.min_time)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">No voltage records match these filters.</td></tr>';
}
function operations(){
 const op=data.operations||{},flows=op.ewic||[],eastWest=op.east_west||{};
 const flowSeries=[{key:'ishwardi_ghorashal',name:'Ishurdi–Ghorashal',color:'#1976b9'},{key:'sirajganj_sreepur',name:'Sirajganj–Sreepur',color:'#c48722'},{key:'gopalganj_aminbazar',name:'Gopalganj–Aminbazar',color:'#b95442'}];
 const shutdownTable=(rows,label)=>`<section class="panel"><div class="panel-head"><div><h2>${label}</h2><p>Unavailable generation capacity listed in P1</p></div><span class="tag">${rows.length} UNITS</span></div><div class="table-wrap"><table><thead><tr><th>Power station / unit</th><th class="num">Capacity MW</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.name)}</td><td class="num">${fmt(r.capacity_mw,1)}</td></tr>`).join('')||'<tr><td colspan="2" class="empty">No entries reported.</td></tr>'}</tbody></table></div></section>`;
 const events=(op.events||[]);
 const eventTable=`<section class="panel full"><div class="panel-head"><div><h2>Daily event log</h2><p>Outage, restoration, and operating notes from the report</p></div><span class="tag">${events.length} EVENTS</span></div><div class="table-wrap"><table><thead><tr><th>Outage / event time</th><th>Restoration</th><th>Description</th></tr></thead><tbody>${events.map(e=>`<tr><td>${esc(e.outage_time)}</td><td>${esc(e.restoration_time)}</td><td class="remarks">${esc(e.description)}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">No event entries reported.</td></tr>'}</tbody></table></div></section>`;
 return `<div class="metrics">${metric('Planned shutdown capacity',fmt((op.planned_shutdowns||[]).reduce((n,r)=>n+r.capacity_mw,0),1),'MW',`${(op.planned_shutdowns||[]).length} reported units`)}${metric('Forced shutdown capacity',fmt((op.forced_shutdowns||[]).reduce((n,r)=>n+r.capacity_mw,0),1),'MW',`${(op.forced_shutdowns||[]).length} reported units`)}${metric('East → west energy',fmt(eastWest.energy_east_to_west_kwh/1000,2),'MWh','P1 daily total')}${metric('West → east energy',fmt(eastWest.energy_west_to_east_kwh/1000,2),'MWh','P1 daily total')}</div><div class="grid">${shutdownTable(op.planned_shutdowns||[],'Planned shutdowns')}${shutdownTable(op.forced_shutdowns||[],'Forced shutdowns')}</div>${panel('East–west interconnector flows','Hourly active power on three EWIC circuits · positive = west to east, negative = east to west',chart(flows,flowSeries,{wrapLegend:true}))}<div class="grid lower-grid">${panel('Power flow summary','P1 reported transfer totals and peak values',`<div class="context-reading"><span>Peak flow · west to east</span><strong>${fmt(eastWest.peak_west_to_east_mw)} MW</strong></div><div class="context-reading"><span>Maximum flow · west to east</span><strong>${fmt(eastWest.max_west_to_east_mw)} MW</strong></div><div class="context-reading"><span>Largest listed circuit flow</span><strong>${fmt(Math.max(...flows.flatMap(r=>flowSeries.map(s=>Math.abs(r[s.key]||0)))),0)} MW</strong></div>`,'P1 + EWIC')}${panel('Event log guide','Source interpretation',`<p>Entries retain the report’s outage and restoration times. Wrapped descriptions from adjacent workbook rows are joined. Blank time or restoration values remain shown as em dashes where the workbook did not report a value.</p><p class="note">Source sheet: P1, “Status of unavailable Power Plant” and “Event Summary.”</p>`,'P1')}</div>${eventTable}`
}
function forecast(){
 const totals=(data.forecast||{}).totals||{},rows=data.forecast?.plants||[];
 const tableRows=rows.map(r=>`<tr><td class="name">${esc(r.name)}</td><td>${esc(r.fuel)}</td><td>${esc(r.producer)}</td><td class="num">${fmt(r.capacity_mw,1)}</td><td class="num">${fmt(r.forecast_day_mw,1)}</td><td class="num">${fmt(r.forecast_evening_mw,1)}</td><td class="num">${fmt(r.effective_day_mw,1)}</td><td class="num">${fmt(r.effective_evening_mw,1)}</td><td class="remarks">${esc(r.remarks)}</td></tr>`).join('');
 return `<div class="metrics">${metric('Forecast available · day peak',fmt(totals.forecast_day_mw),'MW','All generating units')}${metric('Forecast available · evening peak',fmt(totals.forecast_evening_mw),'MW','All generating units')}${metric('Effective available · day peak',fmt(totals.effective_day_mw),'MW','After report adjustments')}${metric('Effective available · evening peak',fmt(totals.effective_evening_mw),'MW','After report adjustments')}</div><section class="panel full"><div class="panel-head"><div><h2>Generation availability forecast</h2><p>Day and evening peak values by generating unit</p></div><span class="tag">FORECAST · MW</span></div><div class="toolbar"><input id="forecast-search" type="search" placeholder="Search plant, fuel, producer, or remark" aria-label="Search forecast units"><select id="forecast-fuel" aria-label="Filter fuel"><option value="">All fuels</option>${[...new Set(rows.map(r=>r.fuel))].sort().map(f=>`<option>${esc(f)}</option>`).join('')}</select></div><p class="count" id="forecast-count"></p><div class="table-wrap"><table><thead><tr><th>Power station / unit</th><th>Fuel</th><th>Producer</th><th class="num">Capacity MW</th><th class="num">Forecast day</th><th class="num">Forecast evening</th><th class="num">Effective day</th><th class="num">Effective evening</th><th>Remarks</th></tr></thead><tbody id="forecast-rows">${tableRows}</tbody></table></div><p class="note">Source: Forecast sheet. Forecast available generation and effective available generation are the workbook’s published values. This view does not estimate future output.</p></section>`
}
function updateForecast(){
 if(!$('#forecast-rows'))return;
 const query=$('#forecast-search').value.toLowerCase(),fuel=$('#forecast-fuel').value;
 const rows=(data.forecast?.plants||[]).filter(r=>(!fuel||r.fuel===fuel)&&[r.name,r.fuel,r.producer,r.remarks].join(' ').toLowerCase().includes(query));
 $('#forecast-count').textContent=`${rows.length} of ${(data.forecast?.plants||[]).length} generating units`;
 $('#forecast-rows').innerHTML=rows.map(r=>`<tr><td class="name">${esc(r.name)}</td><td>${esc(r.fuel)}</td><td>${esc(r.producer)}</td><td class="num">${fmt(r.capacity_mw,1)}</td><td class="num">${fmt(r.forecast_day_mw,1)}</td><td class="num">${fmt(r.forecast_evening_mw,1)}</td><td class="num">${fmt(r.effective_day_mw,1)}</td><td class="num">${fmt(r.effective_evening_mw,1)}</td><td class="remarks">${esc(r.remarks)}</td></tr>`).join('')||'<tr><td colspan="9" class="empty">No units match these filters.</td></tr>';
}
function render(){if(!data)return;chartData.clear();const view=location.hash.slice(1)||'overview';const valid=['overview','plants','regions','imports','realtime','substations','operations','forecast'].includes(view)?view:'overview';const live=valid==='realtime';document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+valid));$('#title').textContent={overview:'National overview',plants:'Power plants',regions:'Regional data',imports:'Cross-border imports',realtime:'Real time',substations:'Substations',operations:'Operations detail',forecast:'Generation forecast'}[valid];const reportDate=data.published_date||data.date;const dateLabel=d=>new Date(d+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Dhaka'});$('#subtitle').textContent=live?'ERP readings for today only · Bangladesh time':`Operating date ${dateLabel(data.date)} · Report published ${dateLabel(reportDate)} · All times Bangladesh time`;$('#date').closest('label').hidden=live;$('#date-status').hidden=live;$('#day-sources').hidden=live;$('#download').hidden=live;document.querySelector('.header-meta .status').textContent=live?'ERP LIVE READINGS':'DAILY OPERATING REPORT';$('#content').innerHTML=({overview,plants,regions,imports,realtime:realTime,substations,operations,forecast}[valid])();$('#source').textContent=live?'Source: ERP rows dated today in Bangladesh time; see per-panel availability below.':`Source: Power Grid ERP · ${data.report_name||data.source_file} · Operating date: ${data.date}`;setupCharts(valid);if(valid==='plants'){$('#plant-search').addEventListener('input',updatePlants);$('#plant-status-filter').querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{plantStatusFilter=button.dataset.status;$('#plant-status-filter').querySelectorAll('[data-status]').forEach(item=>item.classList.toggle('active',item===button));updatePlants()}));updatePlants()}if(valid==='substations'){['substation-search','substation-sort','voltage-search','voltage-class'].forEach(id=>$('#'+id).addEventListener('input',updateSubstations));updateSubstations()}if(valid==='forecast'){['forecast-search','forecast-fuel'].forEach(id=>$('#'+id).addEventListener('input',updateForecast));updateForecast()}}
async function load(reportId){const id=++request;try{const r=await fetch(`/api/report?id=${encodeURIComponent(reportId)}`,{cache:'no-store'});if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error||'Report could not be loaded')}const next=await r.json();if(id!==request)return false;if(data&&data.report_id!==next.report_id){for(const day of ['yesterday','tomorrow','highest']){comparisonRequests[day]++;comparisonData[day]=null;$(`#${day}-status`).textContent=$(`#source-${day}`).checked?'Loading…':'Off'}}data=next;$('#error').hidden=true;render();for(const day of ['yesterday','tomorrow','highest'])if($(`#source-${day}`).checked&&$(`#${day}-status`).textContent==='Waiting for report')loadComparison(day);return true}catch(e){if(id!==request)return false;$('#error').hidden=false;$('#error').textContent=e.message;$('#content').innerHTML='';return false}}
async function loadComparison(day){
 const checkbox=$(`#source-${day}`),status=$(`#${day}-status`),id=++comparisonRequests[day];
 if(!checkbox.checked){comparisonData[day]=null;status.textContent='Off';if(data)render();return}
 if(!data){status.textContent='Waiting for report';return}
 const reportId=data.report_id;status.textContent='Loading…';
 try{const url=day==='highest'?'/api/highest-generation':`/api/neighbor?id=${encodeURIComponent(reportId)}&offset=${day==='yesterday'?-1:1}`;const response=await fetch(url,{cache:'no-store'});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'No report found')};const report=await response.json();if(id!==comparisonRequests[day]||!data||data.report_id!==reportId)return;comparisonData[day]=report;const maximum=report.maximum_generation;status.textContent=day==='highest'&&maximum?`Loaded · ${report.date} · ${fmt(maximum.generation_mw)} MW at ${maximum.time}`:`Loaded · ${report.date}`;render()}
 catch(error){if(id!==comparisonRequests[day]||!data||data.report_id!==reportId)return;comparisonData[day]=null;status.textContent='Unavailable';render()}
}
async function loadCurrentDay(){
 const id=++currentDayRequest;
 try{const response=await fetch('/api/current-day',{cache:'no-store'});if(!response.ok){const body=await response.json().catch(()=>({}));throw Error(body.error||'Live readings unavailable')}const next=await response.json();if(id!==currentDayRequest)return;currentDayData=next;currentDayError=null;if(data&&location.hash==='#realtime')render()}
 catch(error){if(id!==currentDayRequest)return;currentDayData=null;currentDayError=error;if(data&&location.hash==='#realtime')render()}
}
loadCurrentDay();window.setInterval(loadCurrentDay,180000);
$('#source-yesterday').addEventListener('change',()=>loadComparison('yesterday'));$('#source-tomorrow').addEventListener('change',()=>loadComparison('tomorrow'));
$('#source-highest').addEventListener('change',()=>loadComparison('highest'));
$('#date').addEventListener('change',async e=>{const status=$('#date-status'),previous=status.textContent;status.textContent='Loading selected report…';const loaded=await load(e.target.value);if(loaded){await Promise.all(['yesterday','tomorrow','highest'].filter(day=>$(`#source-${day}`).checked).map(loadComparison))}status.textContent=previous});window.addEventListener('hashchange',render);$('#download').addEventListener('click',()=>{if(!data)return;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download=`begd-${data.date}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)});
async function refreshDateList(){try{const r=await fetch('/api/reports',{cache:'no-store'});if(!r.ok)throw Error('Power Grid report dates could not be loaded');const archive=await r.json(),reports=archive.reports||[],select=$('#date'),selected=select.value;const label=d=>new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});if(document.activeElement!==select&&reports.length){select.innerHTML=reports.map(report=>`<option value="${esc(report.id)}">${esc(label(report.published_date))} · ${esc(report.name)}</option>`).join('');if(selected&&reports.some(report=>report.id===selected))select.value=selected;else if(!data){select.value=reports[0].id;await load(reports[0].id)}}if(archive.error)$('#date-status').textContent=`${archive.error} Loaded ${fmt(archive.count)} reports.`;else if(archive.complete)$('#date-status').textContent=`${fmt(archive.count)} reports · from 31 Jan 2025`;else $('#date-status').textContent=`Loading report dates · ${fmt(archive.pages_loaded)} of ${fmt(archive.page_count)} pages`;if(!archive.complete&&!archive.error)window.setTimeout(refreshDateList,2500)}catch(e){$('#error').hidden=false;$('#error').textContent=e.message;$('#date-status').textContent='Report archive unavailable'}}refreshDateList();
