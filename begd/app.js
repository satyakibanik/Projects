const $=s=>document.querySelector(s), fmt=(n,d=0)=>n==null?'—':Number(n).toLocaleString('en-US',{maximumFractionDigits:d}), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortDate=d=>d?new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'}):'unavailable';
const colors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Imports:'#b07aa1',Wind:'#76b7b2',LiquidFuel:'#9c755f'};
let data, request=0, archiveReports=[], archiveCutoff='';
let currentDayData=null, currentDayRequest=0, currentDayError=null;
const comparisonData={yesterday:null,tomorrow:null,highest:null}, comparisonRequests={yesterday:0,tomorrow:0,highest:0};
let previousForecastReport=null, previousForecastRequest=0;
let dispatchChartStyle='line', shedChartStyle='bar', fuelMixStyle='bar', regionalSnapshotStyle='stacked', enCurveChartStyle='area'; const dispatchVisibility=new Map();
let chartId=0; const chartData=new Map(); let enCurveTableMode='energy';
let selectedRegionalFuel=null;
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
// Use the same SVG geometry for legend samples and their plotted series.
const seriesDash=s=>s.dashArray||(s.dot?'1 5':s.dash?'6 4':'none');
let swatchId=0;
function hatchPattern(id,item,index){
 const size=8+(index%3)*2,angle=[0,45,90,135][index%4];
 return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><rect width="${size}" height="${size}" fill="${item.color}"/><path d="M 0 0 V ${size}" stroke="#fff" stroke-opacity=".48" stroke-width="2"/></pattern>`;
}
function legendSwatch(item,index=0){
 const color=esc(item.color),dash=seriesDash(item);
 const kind=item.hatch?'hatched fill':item.outline?'outline':item.bar||item.area?'solid fill':item.pointsOnly&&!item.connectPoints?'points':item.dot||dash==='2 4'?'dotted line':dash==='8 3 2 3'?'dash-dot line':dash==='none'?'solid line':'dashed line';
 let sample;
 if(item.hatch){const id='legend-hatch-'+(++swatchId);sample=`<defs>${hatchPattern(id,item,index)}</defs><rect x="1" y="1" width="44" height="14" fill="url(#${id})" stroke="${color}"/>`}
 else if(item.outline||item.bar||item.area)sample=`<rect x="1" y="1" width="44" height="14" fill="${item.outline?'none':color}" stroke="${color}" stroke-width="${item.outline?'1.5':'1'}"/>`;
 else sample=`${item.pointsOnly&&!item.connectPoints?'':`<path d="M 2 8 H 44" fill="none" stroke="${color}" stroke-width="2.5" stroke-dasharray="${dash}" ${item.dot?'stroke-linecap="round"':''}/>`}${item.noMarkers?'':[10,23,36].map(x=>`<circle cx="${x}" cy="8" r="${item.pointsOnly?3:2.5}" fill="${color}"/>`).join('')}`;
 return `<svg class="series-swatch" width="46" height="16" viewBox="0 0 46 16" role="img" aria-label="${esc((item.name||'Series')+' · '+kind)}"><title>${esc(kind)}</title>${sample}</svg>`;
}
function chartLegend(series,balanceLegend,wrapLegend,familyLegend){
 const swatch=s=>legendSwatch(s,series.indexOf(s));
 if(familyLegend){
  const family=familyLegend.family,items=series.filter(s=>s.family===family);
  return `<div class="legend family-legend"><label class="family-legend-master"><input type="checkbox" data-toggle-family="${family}" checked>${esc(familyLegend.label||"All sources")}</label><div class="family-legend-items">${items.map(s=>`<label><input type="checkbox" data-toggle-series="${s.key}" data-series-family="${family}" checked>${swatch(s)}<span data-series-label="${esc(s.key)}" tabindex="0">${esc(s.name)}</span></label>`).join('')}</div></div>`;
 }
 if(!balanceLegend){const legendSeries=series.filter(s=>s.key!=='shortage_mw').concat(series.filter(s=>s.key==='shortage_mw'));return `<div class="legend${wrapLegend?' legend-wrap':''}">${legendSeries.map(s=>`<label${s.key==='shortage_mw'?' class="legend-shortage"':''}><input type="checkbox" data-toggle-series="${s.key}" ${s.defaultVisible===false?'':'checked'}>${swatch(s)}<span data-series-label="${esc(s.key)}" tabindex="0">${esc(s.name)}</span></label>`).join('')}</div>`;}
 const sources=['selected','yesterday','tomorrow','highest'].filter(source=>series.some(s=>s.source===source));
 const visible=s=>dispatchVisibility.has(s.key)?dispatchVisibility.get(s.key):s.defaultVisible!==false;
 const master=(family,label)=>{const items=series.filter(s=>s.family===family),checked=items.filter(visible).length;return `<label><input type="checkbox" data-toggle-family="${family}" ${checked===items.length?'checked':''}>${label}</label>`};
 const rows=sources.map(source=>`<div class="dispatch-legend-row">${['generation','demand'].map(family=>{const item=series.find(s=>s.source===source&&s.family===family&&!s.legendOnly);return item?`<label><input type="checkbox" data-toggle-series="${item.key}" data-series-family="${family}" ${visible(item)?'checked':''}>${swatch(item)}<span data-series-label="${esc(item.key)}" tabindex="0">${esc(item.name)}</span></label>`:'<span></span>'}).join('')}</div>`).join('');
 const extras=series.filter(s=>s.legendOnly);
 const extraLabel=s=>`<label><input type="checkbox" data-toggle-series="${s.key}" data-series-family="${s.family}" ${visible(s)?'checked':''}>${swatch(s)}<span data-series-label="${esc(s.key)}" tabindex="0">${esc(s.name)}</span></label>`;
 const extraColumn=family=>`<div class="dispatch-legend-extra-column">${extras.filter(s=>s.family===family).map(extraLabel).join('')}</div>`;
 return `<div class="legend dispatch-legend"><div class="dispatch-legend-master">${master('generation','All generation')}${master('demand','All demand')}</div><div class="dispatch-legend-rows">${rows}</div>${extras.length?`<div class="dispatch-legend-extras">${extraColumn('generation')}${extraColumn('demand')}</div>`:''}</div>`;
}
function chart(rows,series,options={}){
 const unit=options.unit||'MW';
 const selectedStyle=options.styleSetting==='dispatch'?dispatchChartStyle:options.styleSetting==='shed'?shedChartStyle:options.styleSetting==='en-curve'?enCurveChartStyle:null;
 const plotSeries=series.map(item=>({...item,hatch:false,bar:selectedStyle?(!item.pointsOnly&&!item.fixedLine&&selectedStyle==='bar'):item.bar}));
 const W=800,H=250,L=58,R=15,T=14,B=32,visibleForScale=(options.balanceLegend||options.styleSetting==='en-curve')?plotSeries.filter(item=>dispatchVisibility.has(item.key)?dispatchVisibility.get(item.key):item.defaultVisible!==false):plotSeries,scale=chartScale(rows,visibleForScale.length?visibleForScale:plotSeries);
 const x=r=>L+(parseInt(r.time)*60+parseInt(r.time.slice(3)))/1380*(W-L-R),y=v=>H-B-(v-scale.min)/(scale.max-scale.min)*(H-T-B);
 const id="plot-"+(++chartId); chartData.set(id,{rows,series:plotSeries,x,unit,enCurve:options.styleSetting==='en-curve'}); let body='';for(let i=0;i<=4;i++){const v=scale.min+(scale.max-scale.min)*i/4;body+=`<line class="axis" data-tick-line="${i}" x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}"/><text data-tick-label="${i}" x="${L-8}" y="${y(v)+4}" text-anchor="end">${fmt(v,2)}</text>`}
 for(const h of [0,6,12,18,23])body+=`<text x="${x({time:String(h).padStart(2,'0')+':00'})}" y="${H-7}" text-anchor="middle">${String(h).padStart(2,'0')}:00</text>`;
 const bars=plotSeries.filter(s=>s.bar),barWidth=bars.length>1?Math.min(7,(W-L-R)/(rows.length-1)/bars.length):10;
 for(const s of plotSeries){body+=`<g data-series="${s.key}"${options.styleSetting==='en-curve'&&s.defaultVisible===false?' style="display:none"':''}>`;if(s.bar){const barIndex=bars.indexOf(s),offset=(barIndex-(bars.length-1)/2)*barWidth;for(const [rowIndex,r] of rows.entries()){const value=r[s.key];if(typeof value!=='number')continue;body+=`<rect data-row-index="${rowIndex}" x="${x(r)+offset-barWidth/2}" y="${y(value)}" width="${Math.max(1,barWidth-0.7)}" height="${Math.max(0,H-B-y(value))}" rx="1" fill="${s.color}"><title>${r.time}: ${fmt(value,2)} ${unit}</title></rect>`}}else{const points=s.pointsOnly&&!s.connectPoints?'':rows.filter(r=>typeof r[s.key]==='number').map(r=>`${x(r)},${y(r[s.key])}`).join(' ');body+=`<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-dasharray="${seriesDash(s)}" ${s.dot?'stroke-linecap="round"':''} points="${points}"/>`;for(const [rowIndex,r] of rows.entries()){if(typeof r[s.key]!=='number')continue;body+=`<circle data-row-index="${rowIndex}" cx="${x(r)}" cy="${y(r[s.key])}" r="${s.pointRadius??(s.pointsOnly?5:3)}" fill="${s.color}"><title>${s.name}, ${r.time}: ${fmt(r[s.key],2)} ${unit}</title></circle>`}}body+=`</g>`}
 rows.forEach((r,i)=>{const left=i===0?L:(x(rows[i-1])+x(r))/2,right=i===rows.length-1?W-R:(x(r)+x(rows[i+1]))/2;body+=`<rect class="chart-hit" data-point="${i}" x="${left}" y="${T}" width="${right-left}" height="${H-T-B}" fill="transparent" tabindex="0" role="button" aria-label="${esc(r.time)}: ${esc(series.map(s=>s.name+": "+fmt(r[s.key],2)+" "+unit).join(", "))}"/>`});
 const styleControl=selectedStyle?`<div class="dispatch-chart-style"><label>Chart style <select data-chart-style="${options.styleSetting}">${options.styleSetting==='en-curve'?`<option value="area" ${selectedStyle==='area'?'selected':''}>Stacked area</option><option value="line" ${selectedStyle==='line'?'selected':''}>Line chart</option>`:`<option value="line" ${selectedStyle==='line'?'selected':''}>Line chart</option><option value="bar" ${selectedStyle==='bar'?'selected':''}>Bar chart</option>`}</select></label></div>`:'';
 return `<div class="interactive-chart${options.styleSetting==='en-curve'?' en-curve-chart':''}" data-chart="${id}">${styleControl}<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${esc(series.map(s=>s.name).join(" and "))} in ${unit==='%'?'percent':'megawatts'}"><title>${esc(series.map(s=>s.name).join(" and "))} in ${unit}</title>${body}<line class="chart-cursor" y1="${T}" y2="${H-B}" hidden/></svg><div class="chart-tooltip" role="status" hidden></div>${chartLegend(plotSeries,options.balanceLegend,options.wrapLegend,options.familyLegend)}<p class="chart-help">Hover, tap, or focus the chart for values. Use the legend to select series.</p></div>`;

}
const panel=(title,subtitle,body,tag='MW')=>`<section class="panel"><div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div><span class="tag">${tag}</span></div>${body}</section>`;
function fuelStrip(report,label){return `<div class="fuel-report-chart"><div class="comparison-strip-label">${label} · ${report.date}</div>${fuelMixVisualization(report)}<div class="fuel-tooltip" role="status" hidden></div></div>`}
function fuelMixVisualization(report,style=fuelMixStyle){
 const entries=Object.entries(report.fuels).filter(([,value])=>value>0),total=report.summary.energy_mwh;
 if(style==='bar')return '<div class="composition-strip fuel-mix-bar" role="group" aria-label="Fuel mix as a stacked bar">'+entries.map(([fuel,value])=>{const share=value/total;return '<div class="fuel-mix-segment" data-fuel="'+esc(fuel)+'" data-share="'+share+'" data-energy="'+value+'" tabindex="0" role="button" aria-label="'+esc(fuel)+': '+fmt(share*100,1)+'%, '+fmt(value,1)+' MWh" style="width:'+share*100+'%;background:'+colors[fuel]+'"></div>'}).join('')+'</div>';
 const cx=72,cy=72,radius=62,circumference=2*Math.PI*radius;
 if(style==='ring'){
  let offset=0;const arcs=entries.map(([fuel,value])=>{const share=value/total,length=share*circumference,arc='<circle class="fuel-ring-segment fuel-mix-segment" data-fuel="'+esc(fuel)+'" data-share="'+share+'" data-energy="'+value+'" tabindex="0" role="button" aria-label="'+esc(fuel)+': '+fmt(share*100,1)+'%, '+fmt(value,1)+' MWh" cx="'+cx+'" cy="'+cy+'" r="'+radius+'" fill="none" stroke="'+colors[fuel]+'" stroke-width="25" stroke-dasharray="'+length+' '+circumference+'" stroke-dashoffset="'+(-offset*circumference)+'" transform="rotate(-90 72 72)"/>';offset+=share;return arc}).join('');
  return '<svg class="fuel-mix-chart fuel-mix-ring" viewBox="0 0 144 144" role="group" aria-label="Fuel mix ring chart">'+arcs+'<text x="72" y="69" text-anchor="middle" class="fuel-ring-label">TOTAL</text><text x="72" y="84" text-anchor="middle" class="fuel-ring-value">100%</text></svg>';
 }
 let angle=-Math.PI/2;const slices=entries.map(([fuel,value])=>{const share=value/total,end=angle+share*Math.PI*2,x1=cx+radius*Math.cos(angle),y1=cy+radius*Math.sin(angle),x2=cx+radius*Math.cos(end),y2=cy+radius*Math.sin(end),path='M '+cx+' '+cy+' L '+x1+' '+y1+' A '+radius+' '+radius+' 0 '+(share>0.5?1:0)+' 1 '+x2+' '+y2+' Z';angle=end;return '<path class="fuel-mix-segment" data-fuel="'+esc(fuel)+'" data-share="'+share+'" data-energy="'+value+'" tabindex="0" role="button" aria-label="'+esc(fuel)+': '+fmt(share*100,1)+'%, '+fmt(value,1)+' MWh" d="'+path+'" fill="'+colors[fuel]+'" stroke="var(--bg)" stroke-width="1"/>'}).join('');
 return '<svg class="fuel-mix-chart fuel-mix-pie" viewBox="0 0 144 144" role="group" aria-label="Fuel mix pie chart">'+slices+'</svg>';
}
function showFuelTooltip(segment){
 const chart=segment.closest('.fuel-report-chart'),tooltip=chart?.querySelector('.fuel-tooltip');
 if(!tooltip)return;
 const averageMw=Number(segment.dataset.energy)/24,averagePower=averageMw<1?fmt(averageMw*1000,0)+' kW':fmt(averageMw,1)+' MW';
 tooltip.innerHTML='<strong>'+esc(segment.dataset.fuel)+'</strong><span>'+fmt(Number(segment.dataset.share)*100,1)+'%</span><span>'+fmt(Number(segment.dataset.energy),1)+' MWh / day</span><span class="fuel-tooltip-average">'+averagePower+' average over 24 h</span>';
 tooltip.hidden=false;
}
document.addEventListener('pointerover',event=>{const segment=event.target.closest?.('.fuel-mix-segment');if(segment)showFuelTooltip(segment)});
document.addEventListener('pointerout',event=>{const segment=event.target.closest?.('.fuel-mix-segment'),next=event.relatedTarget?.closest?.('.fuel-mix-segment');if(segment&&(!next||next.closest('.fuel-report-chart')!==segment.closest('.fuel-report-chart'))){const tooltip=segment.closest('.fuel-report-chart')?.querySelector('.fuel-tooltip');if(tooltip)tooltip.hidden=true}});
document.addEventListener('focusin',event=>{const segment=event.target.closest?.('.fuel-mix-segment');if(segment)showFuelTooltip(segment)});
document.addEventListener('focusout',event=>{const segment=event.target.closest?.('.fuel-mix-segment'),next=event.relatedTarget?.closest?.('.fuel-mix-segment');if(segment&&(!next||next.closest('.fuel-report-chart')!==segment.closest('.fuel-report-chart'))){const tooltip=segment.closest('.fuel-report-chart')?.querySelector('.fuel-tooltip');if(tooltip)tooltip.hidden=true}});
function overview(){
 const s=data.summary,sources=comparisonSources(),dispatch=comparedRows(data.hourly,sources,[{key:'demand_mw',name:'Demand'},{key:'generation_mw',name:'Generation'}]),shed=comparedRows(data.hourly,sources,[{key:'shed_mw',name:'Load shedding',bar:true}]);
 const previousForecastRows=previousForecastReport?.forecast?.date===data.date?(previousForecastReport.forecast.demand_hourly||[]):[];
 const gridByTime=new Map((data.grid_generation||[]).map(point=>[point.time,point]));
 const forecastByTime=new Map(previousForecastRows.map(point=>[point.time,point]));
 const dispatchRowsByTime=new Map(dispatch.rows.map(row=>[row.time,row]));
 for(const point of [...(data.grid_generation||[]),...previousForecastRows])if(!dispatchRowsByTime.has(point.time))dispatchRowsByTime.set(point.time,{time:point.time,...Object.fromEntries(dispatch.series.map(item=>[item.key,null])),demand_mw:null,generation_mw:null});
 const dispatchRows=[...dispatchRowsByTime.values()].sort((a,b)=>a.time.localeCompare(b.time)).map(row=>{const grid=gridByTime.get(row.time),forecast=forecastByTime.get(row.time);return {...row,east_grid_mw:grid?.east_grid_mw??null,west_grid_mw:grid?.west_grid_mw??null,forecasted_demand_mw:forecast?.demand_mw??null}});
 const dispatchSeries=[{key:'demand_mw',name:'Demand · selected day',color:'#c48722',family:'demand',source:'selected',dash:true},{key:'generation_mw',name:'Generation · selected day',color:'#1976b9',family:'generation',source:'selected'},
  ...(data.grid_generation?.length?[{key:'east_grid_mw',name:'East grid generation',color:'#50a57a',family:'generation',source:'selected',legendOnly:true,defaultVisible:false,fixedLine:true},{key:'west_grid_mw',name:'West grid generation',color:'#a178c2',family:'generation',source:'selected',legendOnly:true,defaultVisible:false,fixedLine:true}]:[]),
  ...(previousForecastRows.length?[{key:'forecasted_demand_mw',name:'Forecasted demand · previous day file',color:'#df6f9b',family:'demand',source:'selected',legendOnly:true,defaultVisible:true,pointsOnly:true,connectPoints:true,dash:true,dot:true,pointRadius:2.5}]:[]),
  ...dispatch.series];
 const shedSeries=[{key:'shed_mw',name:'Load shedding · selected day',color:'#b95442',bar:true,dash:true},...shed.series.map(series=>({...series,bar:true}))];
 const fuelSources=sources.map(([day,report])=>[dayLabel(day),report]);
 const fuelKey=Object.entries(data.fuels).map(([f,v])=>'<div>'+legendSwatch({name:f,color:colors[f],area:true})+'<span>'+esc(f)+'</span><strong>'+(v==null?'—':v>0&&v/s.energy_mwh*100<0.1?'&lt;0.1':fmt(v/s.energy_mwh*100,1))+(v==null?'':'<small>%</small>')+'</strong></div>').join('');
 return `<div class="dispatch-layout"><section class="dispatch-main"><div class="dispatch-heading"><span class="section-number">01 / SYSTEM DISPATCH</span><span class="tag">MW · BST</span></div><h2 class="dispatch-title">Demand and generation</h2>${chart(dispatchRows,dispatchSeries,{balanceLegend:true,styleSetting:'dispatch'})}<div class="dispatch-bottom"><span>00:00 — 23:00</span><p>Generation: ${esc(data.report_name||data.source_file||'daily report')} · P4 (actual) and L-Curve (East/West layers). Demand: P4 (actual) and ${previousForecastReport?esc(previousForecastReport.report_name||previousForecastReport.source_file||'previous day file')+' · Forecast (forecast for '+esc(data.date)+')':'Forecast · previous day file, when available'}.</p></div></section><aside class="dispatch-readings"><div class="section-number">DAILY TOTALS & PEAKS</div>${metric("Evening peak demand",fmt(s.peak_demand_mw),"MW","Generation side · 19:30")}${metric("Peak generation",fmt(s.peak_generation_mw),"MW","Includes cross-border imports")}${metric("Energy not served",fmt(s.unserved_mwh==null?null:s.unserved_mwh/1000,2),"GWh","Published daily energy total")}${metric("Energy generated",fmt(s.energy_mwh/1000,2),"GWh","Published total · including imports")}</aside></div><div class="energy-band"><div class="fuel-mix-heading"><div class="section-number">02 / ENERGY COMPOSITION</div><h2>Fuel mix</h2><p>Share of reported daily energy</p><div class="dispatch-chart-style fuel-chart-style"><label>Chart style <select id="fuel-mix-style" aria-label="Fuel mix chart style"><option value="bar" ${fuelMixStyle==="bar"?"selected":""}>Stacked bar</option><option value="pie" ${fuelMixStyle==="pie"?"selected":""}>Pie chart</option><option value="ring" ${fuelMixStyle==="ring"?"selected":""}>Ring chart</option></select></label></div></div><div class="composition"><div class="fuel-composition-row ${fuelMixStyle==="bar"?"is-bar":"is-circular"}"><div class="composition-key">${fuelKey}</div><div class="fuel-report-charts ${fuelMixStyle==="bar"?"is-bar":"is-circular"}">${fuelStrip(data,'Selected day')}${fuelSources.map(([label,report])=>fuelStrip(report,label)).join('')}</div></div></div></div><div class="grid lower-grid">${panel("Reported load shedding","Power curtailed at each published reading",chart(shed.rows,shedSeries,{styleSetting:'shed'}))}${panel("Operating statistics","Additional published operating figures",`<div class="context-reading"><span>Maximum temperature</span><strong>${fmt(s.temperature_c,1)} °C</strong></div><div class="context-reading"><span>Imported energy share</span><strong>${fmt(s.import_mwh==null?null:s.import_mwh/s.energy_mwh*100,1)}%</strong></div><div class="context-reading"><span>Generating units</span><strong>${fmt(plantUnits().length)}</strong></div><div class="context-reading region-names"><span>Operating regions</span><strong>${esc(data.regions.map(region=>region.name).join(', '))}</strong></div>`,`REPORT NOTES`)}</div>`
}
let selectedPlantName=null,plantSort={key:'peak',direction:'desc'},plantFilters={},plantStatusFilter='all';
const normalizedPlantName=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const basePlantName=name=>normalizedPlantName(name).replace(/(?:gas|hsd|hfo|diesel|coal)$/,'');
function matchPlant(items,name){return items?.find(item=>normalizedPlantName(item.name)===normalizedPlantName(name))||items?.find(item=>basePlantName(item.name)===basePlantName(name))}
function plantUnits(){return data.plant_units?.length?data.plant_units:data.plants.map(plant=>({...plant,status:plant.peak_mw>0?'running':'no-output',hourly:[]}))}
function plantTableValue(plant,key){
 const p2=matchPlant(data.plants,plant.name),forecast=matchPlant(data.forecast?.plants,plant.name);
 if(key==='fuel')return plant.fuel??forecast?.fuel??'—';
 if(key==='region')return p2?.region??plant.region??'—';
 if(key==='producer')return plant.producer??forecast?.producer??p2?.producer??'—';
 if(key==='installed')return plant.installed_capacity_mw??p2?.installed_capacity_mw??forecast?.capacity_mw??null;
 if(key==='present')return plant.present_capacity_mw??p2?.present_capacity_mw??p2?.capacity_mw??null;
 if(key==='peak')return plant.peak_generation_mw??plant.peak_mw??null;
 return plant.name;
}
const plantColumns=[['name','Name'],['fuel','Fuel'],['region','Region'],['producer','Producer'],['installed','Installed cap.'],['present','Present cap.'],['peak','Peak gen. today']];
let currentPlantMap=null;
function plantMapPanel(){return `<section class="panel full plant-map-panel"><div class="panel-head"><div><h2>Power plant locations</h2><p>Plants in the selected report · hover, focus or tap a marker for plant information</p></div></div><p class="note" id="plant-map-summary" role="status">Loading reviewed plant locations…</p><div class="plant-map-layout"><div class="geomap-viewport"><div class="plant-map-frame" id="plant-map-frame"><p class="plant-map-loading">Loading Bangladesh boundary…</p></div><div class="map-controls" aria-label="Plant map controls"><button type="button" data-plant-map-zoom="in" aria-label="Zoom in on power plants">+</button><button type="button" data-plant-map-zoom="out" aria-label="Zoom out on power plants">−</button><button type="button" data-plant-map-reset>Reset</button></div></div><aside class="plant-map-sidebar" id="plant-map-sidebar" aria-live="polite"></aside></div><div class="plant-map-key" id="plant-map-key" aria-label="Plant map fuel colors"></div><p class="plant-map-attribution">Locations: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors · ODbL</a> and reviewed coordinates. Boundaries: <a href="https://github.com/ifahimreza/bangladesh-geojson" target="_blank" rel="noopener">bangladesh-geojson</a> / <a href="https://www.geoboundaries.org/" target="_blank" rel="noopener">geoBoundaries · CC BY 4.0</a>. Only points inside Bangladesh are displayed. Shared sites use a common location.</p></section>`}
async function setupPlantMap(){
 const frame=$('#plant-map-frame');if(!frame)return;
 try{
  const controller=await window.BEGDPlantMap.create({frame,sidebar:$('#plant-map-sidebar'),summary:$('#plant-map-summary'),legend:$('#plant-map-key'),columns:plantColumns,getValue:plantTableValue,onDetails:name=>{selectedPlantName=name;updatePlants();document.querySelector('.plant-expanded')?.scrollIntoView({behavior:'smooth',block:'start'})}});
  if(!frame.isConnected||!controller)return;currentPlantMap=controller;controller.update(filteredPlantRows());
 }catch(error){if(frame.isConnected){frame.innerHTML='<p class="plant-map-loading">Plant locations could not be loaded. The plant table below is still available.</p>';$('#plant-map-summary').textContent='Map unavailable';}console.error(error)}
}
function filteredPlantRows(){return plantUnits().filter(plant=>(plantStatusFilter==='all'||plant.status===plantStatusFilter)&&plantColumns.every(([key])=>String(plantTableValue(plant,key)??'').toLowerCase().includes((plantFilters[key]||'').trim().toLowerCase())))}
function plants(){const units=plantUnits();return `${plantMapPanel()}<section class="panel full plants-panel"><div class="panel-head"><div><h2>Power plants</h2><p>Generating units in the report · click a row to see plant details and hourly output</p></div><span class="tag">${units.length} GENERATING UNITS</span></div><div class="plant-table-toolbar"><div class="plant-filters" id="plant-status-filter" role="group" aria-label="Filter units by output"><button type="button" class="plant-filter${plantStatusFilter==='all'?' active':''}" data-status="all" aria-pressed="${plantStatusFilter==='all'}">All</button><button type="button" class="plant-filter${plantStatusFilter==='running'?' active':''}" data-status="running" aria-pressed="${plantStatusFilter==='running'}">Online</button><button type="button" class="plant-filter${plantStatusFilter==='no-output'?' active':''}" data-status="no-output" aria-pressed="${plantStatusFilter==='no-output'}">Offline units</button></div><p class="count" id="plant-count"></p></div><div class="table-wrap plant-table-wrap"><table class="plant-table" aria-label="Power plants"><thead><tr>${plantColumns.map(([key,label])=>`<th class="${['installed','present','peak'].includes(key)?'num':''}"><button type="button" class="plant-sort" data-sort="${key}" aria-label="Sort by ${label}">${label}<span aria-hidden="true">${plantSort.key===key?(plantSort.direction==='asc'?'↑':'↓'):'↕'}</span></button></th>`).join('')}</tr><tr class="plant-filter-row">${plantColumns.map(([key,label])=>`<th><input type="search" data-filter="${key}" aria-label="Filter ${label}" placeholder="Filter ${label.toLowerCase()}" value="${esc(plantFilters[key]||'')}"></th>`).join('')}</tr></thead><tbody id="plant-rows"></tbody></table></div><p class="note">Capacity and peak generation are shown in MW. Hourly output, peak, and daily energy come from the report’s GenLog readings.</p></section>`}
function updatePlants(){
 const units=plantUnits();
 let rows=filteredPlantRows();
 rows.sort((a,b)=>{const av=plantTableValue(a,plantSort.key),bv=plantTableValue(b,plantSort.key);const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av??'').localeCompare(String(bv??''),undefined,{numeric:true,sensitivity:'base'});return cmp*(plantSort.direction==='asc'?1:-1)});
 if(selectedPlantName&&!rows.some(plant=>plant.name===selectedPlantName))selectedPlantName=null;
 const running=units.filter(plant=>plant.status==='running').length;
 $('#plant-count').textContent=`${rows.length} of ${units.length} generating units · ${running} with reported output · ${units.length-running} with no reported output`;
 $('#plant-rows').innerHTML=rows.map(plant=>{
  const selected=plant.name===selectedPlantName;
  const cells=plantColumns.map(([key])=>{const value=plantTableValue(plant,key),display=['installed','present','peak'].includes(key)?`${fmt(value,1)} MW`:esc(value??'—');return `<td class="${['installed','present','peak'].includes(key)?'num':''} ${key==='name'?'name':''}">${display}</td>`}).join('');
  return `<tr class="plant-row${selected?' active':''}" data-plant="${encodeURIComponent(plant.name)}" tabindex="0" role="button" aria-expanded="${selected}" aria-label="${selected?'Collapse':'Expand'} details for ${esc(plant.name)}">${cells}</tr>${selected?'<tr class="plant-expanded"><td colspan="7"><div class="plant-detail-shell"><div class="plant-detail" id="plant-detail" aria-live="polite"></div></div></td></tr>':''}`
 }).join('')||'<tr><td colspan="7" class="empty">No plants match these filters.</td></tr>';
 $('#plant-rows').querySelectorAll('[data-plant]').forEach(row=>{
  const toggle=()=>{const name=decodeURIComponent(row.dataset.plant);if(selectedPlantName===name){selectedPlantName=null;row.classList.remove('active');row.setAttribute('aria-expanded','false');$('#plant-rows').querySelector('.plant-expanded')?.classList.add('is-closing');window.setTimeout(()=>{if(!selectedPlantName)updatePlants()},190);return}selectedPlantName=name;updatePlants()};
  row.addEventListener('click',toggle);row.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();toggle()}});
 });
 document.querySelectorAll('.plant-table [data-filter]').forEach(input=>{input.oninput=()=>{plantFilters[input.dataset.filter]=input.value;updatePlants()}});
 $('#plant-status-filter').querySelectorAll('[data-status]').forEach(button=>{button.onclick=()=>{plantStatusFilter=button.dataset.status;$('#plant-status-filter').querySelectorAll('[data-status]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});updatePlants()}});
 document.querySelectorAll('.plant-sort').forEach(button=>{button.querySelector('span').textContent=plantSort.key===button.dataset.sort?(plantSort.direction==='asc'?'↑':'↓'):'↕';button.onclick=()=>{const key=button.dataset.sort;plantSort=plantSort.key===key?{key,direction:plantSort.direction==='asc'?'desc':'asc'}:{key,direction:['installed','present','peak'].includes(key)?'desc':'asc'};updatePlants()}});
 currentPlantMap?.update(rows);
 if(selectedPlantName)showPlantDetail(selectedPlantName);
}
function showPlantDetail(name){
 const plant=plantUnits().find(item=>item.name===name);if(!plant)return;
 selectedPlantName=name;
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
 const cfFormula=math(String.raw`\frac{Actual Energy Generated}{Installed Capacity × Total Hours (24)} × 100%`,`<mfrac><mtext>Actual Energy Generated</mtext><mrow><mo>(</mo><mtext>Installed Capacity</mtext><mo>×</mo><mtext>Total Hours (24)</mtext><mo>)</mo></mrow></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const pufFormula=math(String.raw`\frac{Energy Produced}{Installed Capacity × Actual Operating Hours} × 100%`,`<mfrac><mtext>Energy Produced</mtext><mrow><mo>(</mo><mtext>Installed Capacity</mtext><mo>×</mo><mtext>Actual Operating Hours</mtext><mo>)</mo></mrow></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const ratioFormula=math(String.raw`\frac{Maximum Plant Output (MW)}{Installed Capacity (MW)} × 100%`,`<mfrac><mtext>Maximum Plant Output (MW)</mtext><mtext>Installed Capacity (MW)</mtext></mfrac><mo>×</mo><mtext>100%</mtext>`);
 const reading=(title,value,unit,description,note='',formulaMarkup='')=>`<div><span class="plant-metric-title" tabindex="0" aria-label="${esc(title)}">${esc(title)}<span class="plant-tooltip" role="tooltip"><span class="plant-tooltip-description">${esc(description)}${note?` ${esc(note)}`:''}</span>${formulaMarkup}</span></span><strong>${value}${unit?` ${unit}`:''}</strong>${note&&title==='Installed Capacity'?`<small>${esc(note)}</small>`:''}</div>`;
 const installedSource=installedFallback?'P2 · Present Capacity (Installed Capacity unavailable)':'P2 · Installed Capacity';
 const sources=`<div class="plant-source-note"><h4>DATA SOURCES</h4><ul><li><strong>Installed Capacity:</strong> ${installedSource}; fallback value is also shown as Present capacity</li><li><strong>Present capacity:</strong> P2 · Present Capacity</li><li><strong>Peak Generation today, Energy generated today, operating hours:</strong> GenLog · hourly readings, Total KWH</li><li><strong>Capacity Factor / Utilization:</strong> calculated from GenLog · Total KWH and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Plant Utilization Factor (PUF):</strong> calculated from GenLog · Total KWH, hourly readings and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Utilization ratio:</strong> calculated from GenLog · maximum hourly reading and P2 · Installed Capacity (or Present Capacity fallback)</li><li><strong>Fuel, Producer:</strong> Forecast · Fuel, Producer</li></ul></div>`;
 $('#plant-detail').innerHTML=`<div class="plant-detail-heading"><div><h3>${esc(name)}</h3><span class="plant-status ${plant.status==='running'?'is-running':''}">${status}</span></div><span class="tag">GENLOG · MW / BST</span></div><p class="plant-metric-date">Metrics for operating day ${esc(shortDate(data.date))}</p><div class="plant-metrics">${reading('Installed Capacity',fmt(installed,1),'MW','Maximum rated output of the plant’s installed equipment.',installedFallback?'Data unavailable, using present capacity value.':'')}${reading('Present capacity',fmt(present,1),'MW','Output capacity currently available from the plant.')}${reading('Peak Generation today',fmt(peak,1),'MW','Highest output recorded at any reading time today.')}${reading('Capacity Factor / Utilization',fmt(capacityFactor,1),'%','Actual energy generated compared with the energy the plant could generate at installed capacity continuously for 24 hours.','',cfFormula)}${reading('Plant Utilization Factor (PUF)',fmt(puf,1),'%','Energy produced compared with installed capacity during the hours when the plant was operating.',`Actual operating hours: ${operatingHours}; the number of hourly readings when the plant was not at zero.`,pufFormula)}${reading('Utilization ratio',fmt(utilizationRatio,1),'%','Peak output recorded for this plant compared with its installed capacity.','',ratioFormula)}${reading('Energy generated today',fmt(energy,1),'MWh','Total electrical energy produced over the operating day.')}${reading('Fuel',esc(fuel),'','Fuel type recorded for the plant.')}${reading('Producer',esc(producer),'','Company or agency listed as the plant producer.')}</div><div class="plant-output-chart">${curve}</div>${sources}`;
 setupCharts('plants');
}
function regionalFuelBarChart(fuel){
 const rows=(data.regions||[]).map(region=>({name:region.name,value:(Number(region.fuels?.[fuel])||0)/1000})).sort((a,b)=>b.value-a.value||a.name.localeCompare(b.name));
 const W=900,H=340,L=62,R=18,T=22,B=60,plotHeight=H-T-B,plotWidth=W-L-R,maxValue=Math.max(0,...rows.map(row=>row.value)),maxY=maxValue>0?Math.ceil(maxValue/5)*5:5,slot=plotWidth/Math.max(1,rows.length),barWidth=Math.min(52,slot*.62),color=colors[fuel]||'#69d5bc';
 const y=value=>H-B-(value/maxY)*plotHeight;let body='';
 for(let tick=0;tick<=4;tick++){const value=maxY*tick/4,position=y(value);body+='<line class="axis" x1="'+L+'" x2="'+(W-R)+'" y1="'+position+'" y2="'+position+'"/><text x="'+(L-8)+'" y="'+(position+4)+'" text-anchor="end">'+fmt(value,2)+'</text>'}
 rows.forEach((row,index)=>{const center=L+slot*(index+.5),top=y(row.value),barHeight=Math.max(0,H-B-top),x=center-barWidth/2;body+='<rect x="'+x+'" y="'+top+'" width="'+barWidth+'" height="'+barHeight+'" fill="'+color+'"><title>'+esc(row.name)+': '+fmt(row.value,2)+' MKWHr</title></rect><text x="'+center+'" y="'+Math.max(T-4,top-7)+'" text-anchor="middle">'+fmt(row.value,2)+'</text><text x="'+center+'" y="'+(H-B+22)+'" text-anchor="middle">'+esc(row.name)+'</text>'});
 return '<svg class="chart regional-fuel-svg" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(fuel+' generation by region in MKWHr, ranked from highest to lowest')+'">'+body+'</svg>'
}
function regionalSnapshotChart(){
 const reports=[{key:'selected',label:'Selected day · '+shortDate(data.date),report:data,dateColor:'var(--ink)'},...comparisonSources().map(([day,report])=>({key:day,label:dayLabel(day)+' · '+shortDate(report.date),report,dateColor:day==='yesterday'?'#a77cc1':day==='tomorrow'?'#54b9a4':'#d2834b'}))];
 const series=[{key:'generation_mw',name:'Daily generation',color:'#4e79a7'},{key:'demand_mw',name:'Evening demand',color:'#f28e2b'},{key:'shed_mw',name:'Reported load shedding',color:'#e15759'}];
 const pointAttrs=(row,source,item,value)=>' class="regional-snapshot-point" tabindex="0" role="img" data-region="'+esc(row.name)+'" data-report="'+esc(source.label)+'" data-metric="'+item.key+'" data-label="'+esc(item.name)+'" data-value="'+esc(fmt(value,2))+'" aria-label="'+esc(row.name+' · '+source.label+' · '+item.name+': '+fmt(value,2)+' MW')+'"';
 const rows=(data.regions||[]).map(region=>({name:region.name,values:reports.map(source=>{const match=(source.report.regions||[]).find(item=>item.name===region.name);return match?{generation_mw:Number(match.energy_mwh)/24,demand_mw:Number(match.demand_mw)||0,shed_mw:Number(match.shed_mw)||0}:null})}));
 const W=900,H=360,L=68,R=20,T=24,B=66,plotWidth=W-L-R,plotHeight=H-T-B,slot=plotWidth/Math.max(rows.length,1),x=index=>L+slot*(index+.5);
 const maxValue=Math.max(0,...rows.map(row=>regionalSnapshotStyle==='stacked'?row.values.reduce((max,values)=>Math.max(max,values?series.reduce((sum,item)=>sum+(Number(values[item.key])||0),0):0),0):Math.max(0,...row.values.flatMap(values=>values?series.map(item=>values[item.key]).filter(Number.isFinite):[]))));
 const step=Math.max(100,Math.ceil(maxValue/4/100)*100),maxY=step*4,y=value=>H-B-(value/maxY)*plotHeight;
 let body='';
 for(let tick=0;tick<=4;tick++){const value=step*tick,position=y(value);body+='<line class="axis" x1="'+L+'" x2="'+(W-R)+'" y1="'+position+'" y2="'+position+'"/><text x="'+(L-9)+'" y="'+(position+4)+'" text-anchor="end">'+fmt(value)+'</text>'}
 if(regionalSnapshotStyle==='stacked'){
  const pitch=slot*.84/reports.length,barWidth=Math.min(32,pitch*.68);
  rows.forEach((row,index)=>reports.forEach((source,reportIndex)=>{const values=row.values[reportIndex];if(!values)return;const center=x(index)+(reportIndex-(reports.length-1)/2)*pitch;let accumulated=0;for(const item of series){const value=values[item.key];if(!Number.isFinite(value))continue;const top=y(accumulated+value),bottom=y(accumulated),height=Math.max(0,bottom-top);body+='<rect'+pointAttrs(row,source,item,value)+' x="'+(center-barWidth/2)+'" y="'+top+'" width="'+barWidth+'" height="'+height+'" fill="'+item.color+'"></rect>';accumulated+=value}if(accumulated>0)body+='<rect class="regional-snapshot-date-outline" x="'+(center-barWidth/2)+'" y="'+y(accumulated)+'" width="'+barWidth+'" height="'+(y(0)-y(accumulated))+'" fill="none" stroke="'+source.dateColor+'" stroke-width="1.5"><title>'+esc(source.label)+'</title></rect>'}));
 }else{
  reports.forEach((source,reportIndex)=>series.forEach(item=>{const points=rows.flatMap((row,index)=>Number.isFinite(row.values[reportIndex]?.[item.key])?[[index,row.values[reportIndex][item.key]]]:[]);const dash=reportIndex===0?'none':reportIndex===1?'7 5':reportIndex===2?'2 4':'8 3 2 3';body+='<polyline fill="none" stroke="'+item.color+'" stroke-width="'+(reportIndex===0?'2.5':'1.8')+'" stroke-dasharray="'+dash+'" points="'+points.map(([index,value])=>x(index)+','+y(value)).join(' ')+'"/>';points.forEach(([index,value])=>{body+='<circle'+pointAttrs(rows[index],source,item,value)+' cx="'+x(index)+'" cy="'+y(value)+'" r="'+(reportIndex===0?'3.5':'2.8')+'" fill="'+item.color+'"></circle>'})}));
 }
 rows.forEach((row,index)=>{body+='<text x="'+x(index)+'" y="'+(H-B+24)+'" text-anchor="middle">'+esc(row.name)+'</text>'});
 const metricLegend=series.map(item=>'<span class="regional-snapshot-key">'+legendSwatch({...item,bar:regionalSnapshotStyle==='stacked'})+esc(item.name)+'</span>').join('');
 const dateLegend=reports.map((source,index)=>'<span class="regional-snapshot-date-key">'+legendSwatch({name:source.label,color:regionalSnapshotStyle==='stacked'?source.dateColor:'var(--ink)',outline:regionalSnapshotStyle==='stacked',noMarkers:true,dashArray:['none','7 5','2 4','8 3 2 3'][index]})+esc(source.label)+'</span>').join('');
 return '<div class="regional-snapshot-chart-wrap"><div class="regional-snapshot-controls"><label>Chart style <select data-regional-snapshot-style aria-label="Regional data chart style"><option value="line" '+(regionalSnapshotStyle==='line'?'selected':'')+'>Line chart</option><option value="stacked" '+(regionalSnapshotStyle==='stacked'?'selected':'')+'>Stacked bar</option></select></label></div><div class="regional-snapshot-chart-scroll"><svg class="regional-snapshot-chart" viewBox="0 0 '+W+' '+H+'" role="group" aria-label="Regional daily generation, evening demand, and reported load shedding in megawatts for selected and comparison dates"><title>Regional daily generation, evening demand, and reported load shedding in megawatts for selected and comparison dates</title>'+body+'</svg></div><div class="chart-tooltip regional-snapshot-tooltip" role="status" hidden></div><div class="regional-snapshot-legend" aria-label="Chart series">'+metricLegend+dateLegend+'</div><p class="note">Daily generation is shown as 24-hour average MW (regional daily energy divided by 24); evening demand and load shedding are P1 snapshots at 21:00. Comparison reports use the matching region and operating date.</p></div>';
}
function regions(){
 const palette={Rangpur:'#a87930',Rajshahi:'#86e89a',Mymensingh:'#dbe97c',Sylhet:'#d3ad59',Dhaka:'#16c6d7',Cumilla:'#2225d0',Khulna:'#2018a8',Barishal:'#a77a31',Chattogram:'#1599e7'};
 const mapPanel=`<section class="panel full region-map-panel"><div class="panel-head"><div><h2>Operating regions</h2><p>Explore the nine power-planning areas · hover, focus or tap a region for its daily readings</p></div></div><div class="region-map-layout"><div class="geomap-viewport"><div class="region-map-frame" id="region-map-frame" aria-label="Interactive map of Bangladesh operating regions"><div class="region-map-loading" role="status">Loading regional boundaries…</div></div><div class="map-controls" aria-label="Map controls"><button type="button" data-map-zoom="in" aria-label="Zoom in">+</button><button type="button" data-map-zoom="out" aria-label="Zoom out">−</button><button type="button" data-map-reset>Reset</button></div></div><aside class="region-map-detail" id="region-map-detail" aria-live="polite"><span class="region-map-kicker">EXPLORE A REGION</span><h3>Bangladesh</h3><p>Hover, focus or tap a colored region or its name to see the selected day’s operating snapshot.</p></aside></div><div class="region-map-key" aria-label="Operating regions">${data.regions.map(region=>`<button type="button" class="region-key-item" data-map-select="${esc(region.name)}"><i style="--region-color:${palette[region.name]||'#7b8d83'}"></i>${esc(region.name)}</button>`).join('')}</div><p class="note">Nine operating regions based on the local planning map. Drag to pan; use the wheel or buttons to zoom.</p></section>`;
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
 const fuelTable=`<div class="table-wrap"><table><thead><tr><th>Region</th>${fuelHead}</tr></thead><tbody>${fuelRows}</tbody></table></div><p class="note">Demand and load shedding are regional evening-peak snapshots at 21:00, as reported in the P1 sheet. Do not compare their sum directly with generation-side national demand.</p>`;
 const fuelTypes=Object.keys(data.fuels||{});
 if(!selectedRegionalFuel||!fuelTypes.includes(selectedRegionalFuel))selectedRegionalFuel=fuelTypes[0]||null;
 const fuelOptions=fuelTypes.map(fuel=>'<button type="button" class="regional-fuel-option" data-regional-fuel="'+esc(fuel)+'" aria-pressed="'+(fuel===selectedRegionalFuel)+'" style="--fuel-color:'+esc(colors[fuel]||'#a0b1b6')+'">'+legendSwatch({name:fuel,color:colors[fuel]||'#a0b1b6',bar:true})+esc(fuel)+'</button>').join('');
 const fuelExplorer=fuelTypes.length?'<div class="regional-fuel-explorer"><div class="regional-fuel-options" role="group" aria-label="Choose a fuel type">'+fuelOptions+'</div><div class="regional-fuel-visual"><p data-regional-fuel-selected>'+esc(selectedRegionalFuel)+' · generation by region, highest to lowest</p><div data-regional-fuel-chart>'+regionalFuelBarChart(selectedRegionalFuel)+'</div></div></div>':'<p class="empty">No regional fuel data is available.</p>';
 return `${mapPanel}${panel('Regional generation, demand & load shedding','Regional daily generation and 21:00 evening snapshots',regionalSnapshotChart())}<div class="region-grid">${cards}</div>${panel('Regional fuel mix','Published daily energy by operating region',fuelTable,'GWh')}${panel('Regional generation by fuel type','Select a fuel type to compare daily generation across regions',fuelExplorer,'MKWHr')}`;
}
async function setupRegionMap(){
 const frame=$('#region-map-frame');if(!frame)return;
 try{
  const response=await fetch('planning-regions.svg');if(!response.ok)throw Error('Regional boundaries could not be loaded');
  const markup=await response.text();if(!frame.isConnected)return;frame.innerHTML=markup;
  const svg=frame.querySelector('svg'),group=svg?.querySelector('.planning-regions');if(!svg||!group)throw Error('Regional map is unavailable');
  const bounds=group.getBBox(),padding=100;
  const home={x:bounds.x-padding,y:bounds.y-padding,w:bounds.width+padding*2,h:bounds.height+padding*2};
  let view={...home},drag=null,suppressClick=false;
  svg.setAttribute('preserveAspectRatio','xMidYMid meet');
  const detail=$('#region-map-detail'),defaultDetail=detail.innerHTML;
  const clear=()=>{
   frame.querySelectorAll('.planning-region').forEach(path=>{path.classList.remove('is-selected','is-muted');path.setAttribute('aria-pressed','false')});
   document.querySelectorAll('[data-map-select]').forEach(button=>{button.classList.remove('is-active');button.setAttribute('aria-pressed','false')});
   detail.innerHTML=defaultDetail;
  };
  const applyView=()=>svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
  applyView();
  const select=name=>{
   const region=data.regions.find(item=>item.name===name);if(!region)return;
   const slug=name.toLowerCase().replace(/[^a-z0-9]/g,'');
   frame.querySelectorAll('.planning-region').forEach(path=>{path.classList.toggle('is-selected',path.dataset.region===slug);path.classList.toggle('is-muted',path.dataset.region!==slug);path.setAttribute('aria-pressed',String(path.dataset.region===slug))});
   document.querySelectorAll('[data-map-select]').forEach(button=>{button.classList.toggle('is-active',button.dataset.mapSelect===name);button.setAttribute('aria-pressed',String(button.dataset.mapSelect===name))});
   const color=({Rangpur:'#a87930',Rajshahi:'#86e89a',Mymensingh:'#dbe97c',Sylhet:'#d3ad59',Dhaka:'#16c6d7',Cumilla:'#2225d0',Khulna:'#2018a8',Barishal:'#a77a31',Chattogram:'#1599e7'})[name]||'#147d58';
   $('#region-map-detail').innerHTML=`<span class="region-map-kicker">OPERATING REGION</span><h3><i style="--region-color:${color}"></i>${esc(region.name)}</h3><div class="region-map-reading"><span>Daily generation · includes assigned imports</span><strong>${fmt(region.energy_mwh/1000,2)} <small>GWh</small></strong></div><div class="region-map-reading"><span>Evening demand</span><strong>${fmt(region.demand_mw)} <small>MW</small></strong></div><div class="region-map-reading"><span>Reported load shedding</span><strong>${fmt(region.shed_mw)} <small>MW</small></strong></div>`;
  };
  const constrain=(value,size,axis)=>Math.max(home[axis],Math.min(home[axis]+home[size]-view[size],value));
  const mapPoint=event=>new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const zoom=(factor,anchor={x:view.x+view.w/2,y:view.y+view.h/2})=>{const w=Math.max(900,Math.min(home.w,view.w*factor)),h=w*home.h/home.w;view={x:anchor.x-(anchor.x-view.x)*w/view.w,y:anchor.y-(anchor.y-view.y)*h/view.h,w,h};view.x=constrain(view.x,'w','x');view.y=constrain(view.y,'h','y');applyView()};
  frame.querySelectorAll('.planning-region').forEach(path=>{const show=()=>{const region=data.regions.find(item=>item.name.toLowerCase().replace(/[^a-z0-9]/g,'')===path.dataset.region);if(region)select(region.name)};path.addEventListener('pointerenter',show);path.addEventListener('pointerleave',clear);path.addEventListener('blur',clear);path.addEventListener('focus',show);path.addEventListener('click',show);path.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();path.dispatchEvent(new Event('click'))}});path.setAttribute('tabindex','0');path.setAttribute('role','button');path.setAttribute('aria-pressed','false')});
  document.querySelectorAll('[data-map-select]').forEach(button=>{const show=()=>select(button.dataset.mapSelect);button.addEventListener('pointerenter',show);button.addEventListener('pointerleave',clear);button.addEventListener('blur',clear);button.addEventListener('focus',show);button.addEventListener('click',show)});
  document.querySelector('[data-map-zoom="in"]').addEventListener('click',()=>zoom(.72));document.querySelector('[data-map-zoom="out"]').addEventListener('click',()=>zoom(1.38));document.querySelector('[data-map-reset]').addEventListener('click',()=>{view={...home};applyView();clear()});
  svg.addEventListener('wheel',event=>{event.preventDefault();zoom(event.deltaY<0?.82:1.22,mapPoint(event))},{passive:false});
  svg.addEventListener('pointerleave',clear);
  svg.addEventListener('click',event=>{if(!event.target.closest('.planning-region'))clear()});
  frame.addEventListener('keydown',event=>{if(event.key==='Escape')clear()});
  svg.addEventListener('pointerdown',event=>{drag={x:event.clientX,y:event.clientY,viewX:view.x,viewY:view.y,moved:false};});svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>4){drag.moved=true;svg.setPointerCapture(event.pointerId)}const matrix=svg.getScreenCTM();view.x=constrain(drag.viewX-dx/matrix.a,'w','x');view.y=constrain(drag.viewY-dy/matrix.d,'h','y');applyView()});svg.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false}},true);['pointerup','pointercancel'].forEach(type=>svg.addEventListener(type,()=>{if(drag?.moved)suppressClick=true;drag=null}));
 }catch(error){frame.innerHTML='<p class="region-map-error">Regional boundaries could not be loaded. The regional figures below are still available.</p>';console.error(error)}
}
function importMatch(report,name){
 const exact=report.imports.find(item=>item.name===name);if(exact)return exact;
 const token=name.toLowerCase().match(/bheramara|tripura|adani|nepal|hvdc/)?.[0];
 return token?report.imports.find(item=>item.name.toLowerCase().includes(token)):null;
}
function imports(){
 const s=data.summary,sources=comparisonSources();
 const reports=[data,...sources.map(([,report])=>report)];
 const importTimes=[...new Set(reports.flatMap(report=>(report.imports||[]).flatMap(item=>(item.hourly||[]).map(row=>row.time))))].sort();
 const sumImportsAtTime=(report,time)=>{
  const values=(report.imports||[]).flatMap(item=>(item.hourly||[]).filter(row=>row.time===time).map(row=>row.mw)).filter(value=>typeof value==='number'&&Number.isFinite(value));
  return values.length?values.reduce((sum,value)=>sum+value,0):null;
 };
 const totalRows=importTimes.map(time=>({time,total_mw:sumImportsAtTime(data,time)}));
 const totalSeries=[{key:'total_mw',name:'Total imports · selected day',color:'#347baf'}];
 for(const [day,report,color] of sources){
  const key=`total_mw_${day}`;
  totalRows.forEach(row=>{row[key]=sumImportsAtTime(report,row.time)});
  totalSeries.push({key,name:`Total imports · ${dayLabel(day)}`,color});
 }
 const totalPanel=`<section class="panel full"><div class="panel-head"><div><h2>Total imports</h2><p>Combined hourly imports across all reported routes</p></div><span class="tag">MW</span></div>${chart(totalRows,totalSeries)}</section>`;
 const graphs=(data.imports||[]).map(item=>{
  const rows=(item.hourly||[]).map(row=>({...row})),series=[{key:'mw',name:'Reported import · selected day',color:'#347baf'}];
  for(const [day,report,color] of sources){const match=importMatch(report,item.name),byTime=new Map((match?.hourly||[]).map(row=>[row.time,row]));const key=`mw_${day}`;rows.forEach(row=>row[key]=byTime.get(row.time)?.mw??null);series.push({key,name:`Reported import · ${dayLabel(day)}`,color})}
  return panel(esc(item.name),`${fmt(item.energy_mwh/1000,2)} GWh imported during the day`,chart(rows,series))
 });
 return `<div class="metrics">${metric('Total imported energy',fmt(s.import_mwh/1000,2),'GWh','Included in national energy total')}${metric('Share of total energy',fmt(s.import_mwh/s.energy_mwh*100,1),'%','Imported / national reported energy')}${metric('Import routes',(data.imports||[]).length,'','Bheramara · Tripura · Adani · Nepal')}${metric('Domestic energy',fmt((s.energy_mwh-s.import_mwh)/1000,2),'GWh','National total less imports')}</div>${totalPanel}<div class="grid">${graphs.join('')}</div><p class="note">Route energy comes from GenLog’s published Total KWH row. Route curves, total imports, and the selected-day curves come from the chosen workbook.</p>`
}
function realTime(){
 if(!currentDayData)return `<section class="panel full"><p id="current-status" role="status">${currentDayError?'ERP readings unavailable. Retrying shortly.':'Fetching latest ERP readings…'}</p></section>`;
 const latest=currentDayData.source_dates||{},today=shortDate(currentDayData.today_date||currentDayData.date),rows=(currentDayData.demand_hourly||[]),generation=(currentDayData.generation_hourly||[]),routes=currentDayData.imports||[];
 const dateFor=key=>latest[key]?shortDate(latest[key]):'No data for today';
 const forecastDate=currentDayData.today_date||currentDayData.date;
 const forecastRows=data?.forecast?.date===forecastDate?(data.forecast.demand_hourly||[]):[];
 const forecastSource=forecastRows.length?`${data.report_name||data.source_file||'Daily Report'} · Forecast Scenario · ${shortDate(forecastDate)}`:'';
 const combinedRowsByTime=new Map();
 const rowFor=time=>{if(!combinedRowsByTime.has(time))combinedRowsByTime.set(time,{time,total_mw:null,demand_mw:null,shed_mw:null,forecasted_demand_mw:null});return combinedRowsByTime.get(time)};
 for(const row of rows)Object.assign(rowFor(row.time),{demand_mw:row.demand_mw,shed_mw:row.shed_mw});
 for(const row of generation)rowFor(row.time).total_mw=row.total_mw;
 for(const point of forecastRows)rowFor(point.time).forecasted_demand_mw=point.demand_mw;
 const generationChartRows=[...combinedRowsByTime.values()].sort((a,b)=>a.time.localeCompare(b.time));
 const combinedSeries=[
  {key:'total_mw',name:'generation (real time)',color:'#263238'},
  {key:'demand_mw',name:'Demand (real time)',color:'#c48722'},
  {key:'shed_mw',name:'Load shedding (real time)',color:'#b95442',dash:true},
  {key:'forecasted_demand_mw',name:'Demand (forecasted previous day)',color:'#df6f9b',dash:true,dot:true,pointsOnly:true,connectPoints:true,pointRadius:2.5}
 ];
 const generationDate=`Generation ERP page · ${dateFor('generation')} · ${generation.length} readings`;
 const combinedCaption=`Demand/supply ERP page · ${dateFor('demand')} · ${rows.length} readings · ${generationDate}${forecastRows.length?` · ${forecastSource}`:''}`;
 const combinedPanel=rows.length||generation.length?panel('Demand, Generation & load shedding',combinedCaption,chart(generationChartRows,combinedSeries)):'';
 const fuelTypeSeries=[['gas_mw','Gas',colors.Gas],['liquid_mw','Liquid fuel',colors.LiquidFuel],['coal_mw','Coal',colors.Coal],['hydro_mw','Hydro',colors.Hydro],['solar_mw','Solar',colors.Solar],['wind_mw','Wind',colors.Wind]].map(([key,name,color])=>({key,name,color,family:'fuel'}));
 const estimatedShedRows=generationChartRows.map(row=>({...row,estimated_load_shedding_mw:typeof row.total_mw==='number'&&typeof row.forecasted_demand_mw==='number'?Math.max(0,row.forecasted_demand_mw-row.total_mw):null}));
 const estimatedShedSeries=[{key:'estimated_load_shedding_mw',name:'Estimated load shedding',color:'#b95442',bar:true}];
 const estimatedShedPanel=forecastRows.length&&generation.length?panel('Estimated load shedding',`${forecastSource} · forecasted demand minus total generation, floored at zero`,chart(estimatedShedRows,estimatedShedSeries,{styleSetting:'shed'})):'';
 const fuelTypePanel=generation.length?panel('Generation by fuel type',generationDate,chart(generation,fuelTypeSeries,{familyLegend:{family:'fuel',label:'All fuel types'}})):'';
 const availableRoutes=routes.filter(route=>route.hourly?.length),routeColors=['#347baf','#c48722','#b95442','#36a77b'];
 const importTimes=[...new Set(availableRoutes.flatMap(route=>route.hourly.map(row=>row.time)))].sort();
 const importRows=importTimes.map(time=>{
  const values=availableRoutes.map((route,index)=>route.hourly.find(row=>row.time===time)?.mw??null);
  const present=values.filter(value=>typeof value==='number'&&Number.isFinite(value));
  return {time,total_import_mw:present.length?present.reduce((sum,value)=>sum+value,0):null,...Object.fromEntries(values.map((value,index)=>[`import_${index}`,value]))};
 });
 const importSeries=availableRoutes.map((route,index)=>({key:`import_${index}`,name:route.name,color:routeColors[index%routeColors.length],family:'import'}));
 const importCaption=`ERP import and generation pages · ${today} · ${availableRoutes.length} routes`;
 const totalImportsPanel=availableRoutes.length?panel('Total imports',importCaption,chart(importRows,[{key:'total_import_mw',name:'Total imports',color:'#263238'}])):'';
 const importsByRoutePanel=availableRoutes.length?panel('Imports by route',importCaption,chart(importRows,importSeries,{familyLegend:{family:'import',label:'All import routes'},wrapLegend:true})):'';
 const importsByTime=new Map(importRows.map(row=>[row.time,row]));
 const expectedRoutes=['Bheramara HVDC','Tripura','Adani','Nepal'];
 const shareRows=generation.map(row=>{
  const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
  const total=valid(row.total_mw)&&row.total_mw>0?row.total_mw:null;
  const completeImports=expectedRoutes.every(name=>routes.find(route=>route.name===name)?.hourly?.some(point=>point.time===row.time&&valid(point.mw)));
  const imported=importsByTime.get(row.time)?.total_import_mw;
  const renewable=[row.hydro_mw,row.solar_mw,row.wind_mw];
  return {time:row.time,import_dependence_pct:total&&completeImports&&valid(imported)?imported/total*100:null,renewable_share_pct:total&&renewable.every(valid)?renewable.reduce((sum,value)=>sum+value,0)/total*100:null};
 });
 const shareSeries=[{key:'import_dependence_pct',name:'Import dependence (%)',color:'#347baf'},{key:'renewable_share_pct',name:'Renewable share (%)',color:'#36a77b'}];
 const sharePanel=generation.length?panel('Import dependence (%) & renewable share (%)','Hourly share of total generation, including imports · Import dependence = total imports / total generation · Renewable share = domestic hydro + solar + wind / total generation · Imported renewables are not classified',chart(shareRows,shareSeries,{unit:'%'}),'%'):'';
 const updated=currentDayData.updated_at?new Date(currentDayData.updated_at).toLocaleString('en-GB',{timeZone:'Asia/Dhaka'}):'—';
 const panels=`${combinedPanel}${sharePanel}${estimatedShedPanel}${fuelTypePanel}${totalImportsPanel}${importsByRoutePanel}`;
 return `<p class="note" id="current-status" role="status">Today only · ${esc(today)} Bangladesh time · refreshed ${esc(updated)}. Only sources with readings dated today are shown. Refreshes every three minutes.</p>${panels?`<div class="grid realtime-grid">${panels}</div>`:'<p class="note">No ERP readings are available for today.</p>'}<p class="note">Sources: ${(currentDayData.source_urls||[]).map((url,i)=>`<a href="${esc(url)}" target="_blank" rel="noopener">${['Demand / supply / load shedding','Generation by source','India imports'][i]||'ERP source'}</a>`).join(' · ')}</p>`
}
function substationKey(name){return String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'')}
function substationRows(report){
 const rows=new Map();
 for(const voltage of report.voltages||[]){
  const key=`${substationKey(voltage.name)}|${voltage.voltage_class}`;
  rows.set(key,{name:voltage.name,voltage_class:voltage.voltage_class,...voltage,load_mw:null,load_time:null});
 }
 for(const load of report.substations||[]){
  const matches=[...rows.values()].filter(row=>substationKey(row.name)===substationKey(load.name));
  if(matches.length){matches.forEach(row=>{row.load_mw=load.load_mw;row.load_time=load.time})}
  else{
   const key=`${substationKey(load.name)}|`;
   rows.set(key,{name:load.name,voltage_class:'',load_mw:load.load_mw,load_time:load.time});
  }
 }
 return [...rows.values()];
}
function substations(){
 const rows=data.substations||[],volts=data.voltages||[],classes=[...new Set(volts.map(v=>v.voltage_class))];
 return `<div class="metrics">${metric('Substations reporting load',rows.length,'','P3 · daily maximum load')}${metric('Highest served load',fmt(Math.max(...rows.map(r=>r.load_mw)),1),'MW','Across listed grid substations')}${metric('Voltage classes',classes.length,'','400 kV · 230 kV · 132 kV')}${metric('Voltage readings',volts.length,'','Maximum and minimum by station')}</div>${window.BEGDVoltageBands.render(volts,data.date)}<section class="panel full"><div class="panel-head"><div><h2>Substation load and voltage</h2><p>Daily maximum served load and voltage range by station and class</p></div><span class="tag">P3 · MW / VOLTAGE · KV</span></div><div class="toolbar"><input id="substation-search" type="search" placeholder="Search substations" aria-label="Search substations"><select id="substation-sort" aria-label="Sort substations"><option value="load_mw">Highest load ↓</option><option value="name">Station name A–Z</option></select><select id="voltage-class" aria-label="Filter voltage class"><option value="">All voltage classes</option>${classes.map(v=>`<option>${esc(v)}</option>`).join('')}</select></div><p class="count" id="substation-count"></p><div class="table-wrap"><table><thead><tr><th>Substation</th><th>Class</th><th class="num">Maximum load MW</th><th>Peak time · BST</th><th class="num">Maximum kV</th><th>Time · BST</th><th class="num">Minimum kV</th><th>Time · BST</th></tr></thead><tbody id="substation-rows"></tbody></table></div><p class="note">Source: P3, “Maximum Load Served by Different Grid Sub-Stations,” and Voltage sheet. Selected report values appear first; comparison values are listed underneath with their report label.</p></section>`
}
function updateSubstations(){
 if(!$('#substation-rows'))return;
 const query=$('#substation-search').value.toLowerCase(),sort=$('#substation-sort').value,voltageClass=$('#voltage-class').value;
 const allRows=substationRows(data);
 const rows=allRows.filter(row=>(!voltageClass||row.voltage_class===voltageClass)&&row.name.toLowerCase().includes(query)).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):(b.load_mw??-Infinity)-(a.load_mw??-Infinity));
 const comparisons=comparisonSources();
 $('#substation-count').textContent=`${rows.length} of ${allRows.length} station and voltage-class records`;
 const comparisonValues=(row,field)=>{
  const stationKey=substationKey(row.name);
  return comparisons.map(([day,report])=>{
   const label=day==='highest'?'highest gen.':day;
   const load=(report.substations||[]).find(item=>substationKey(item.name)===stationKey);
   const voltage=(report.voltages||[]).find(item=>substationKey(item.name)===stationKey&&(!row.voltage_class||item.voltage_class===row.voltage_class));
   let value;
   if(field==='load')value=load?`${fmt(load.load_mw,1)} MW`:'—';
   else if(field==='load_time')value=load?esc(load.time):'—';
   else if(field==='max_kv')value=voltage?`${fmt(voltage.max_kv)} kV`:'—';
   else if(field==='max_time')value=voltage?esc(voltage.max_time):'—';
   else if(field==='min_kv')value=voltage?`${fmt(voltage.min_kv)} kV`:'—';
   else value=voltage?esc(voltage.min_time):'—';
   return `<br><small>${value} (${esc(label)})</small>`;
  }).join('');
 };
 $('#substation-rows').innerHTML=rows.map(row=>`<tr><td class="name">${esc(row.name)}</td><td>${esc(row.voltage_class||'—')}</td><td class="num">${fmt(row.load_mw,1)}${comparisonValues(row,'load')}</td><td>${esc(row.load_time||'—')}${comparisonValues(row,'load_time')}</td><td class="num">${fmt(row.max_kv)}${comparisonValues(row,'max_kv')}</td><td>${esc(row.max_time||'—')}${comparisonValues(row,'max_time')}</td><td class="num">${fmt(row.min_kv)}${comparisonValues(row,'min_kv')}</td><td>${esc(row.min_time||'—')}${comparisonValues(row,'min_time')}</td></tr>`).join('')||'<tr><td colspan="8" class="empty">No substations match these filters.</td></tr>';
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
function stackedAreaChart(rows,series){
 const visible=series.filter(item=>dispatchVisibility.get(item.key)!==false);
 const scaleRows=rows.map(row=>({...row,stack_total:visible.reduce((sum,item)=>sum+(Number(row[item.key])||0),0)}));
 const measuredScale=chartScale(scaleRows,[{key:'stack_total'}]);
 const areaStep=1000;
 const scale={...measuredScale,min:0,max:Math.ceil(measuredScale.max/areaStep)*areaStep,step:areaStep};
 const W=800,H=500,L=58,R=15,T=14,B=82;
 const x=row=>L+(parseInt(row.time)*60+parseInt(row.time.slice(3)))/1380*(W-L-R);
 const y=value=>H-B-(value-scale.min)/(scale.max-scale.min)*(H-T-B);
 const id='plot-'+(++chartId);
 const stackSeries=series.filter(item=>item.key!=='shortage_mw').concat(series.filter(item=>item.key==='shortage_mw'));
 chartData.set(id,{rows,series:stackSeries,x,stackedArea:true,enCurve:true});
 const hatchDefs='<defs>'+series.map((item,index)=>hatchPattern('hatch-'+id+'-'+index,item,index)).join('')+'</defs>';
 let body=hatchDefs;
 let tick=0;
 for(let value=0;value<=scale.max;value+=scale.step,tick++){
  const position=y(value);
  body+='<line class="axis" data-tick-line="'+tick+'" x1="'+L+'" x2="'+(W-R)+'" y1="'+position+'" y2="'+position+'"/><text data-tick-label="'+tick+'" x="'+(L-8)+'" y="'+(position+4)+'" text-anchor="end">'+fmt(value)+'</text>';
 }
 for(let hour=0;hour<24;hour++){
  const time=String(hour).padStart(2,'0')+':00',position=x({time}),labelY=H-8;
  body+='<text x="'+position+'" y="'+labelY+'" text-anchor="end" transform="rotate(-45 '+position+' '+labelY+')">'+time+'</text>';
 }
 const cumulative=rows.map(()=>0);
 for(const seriesItem of stackSeries){
  const isVisible=dispatchVisibility.get(seriesItem.key)!==false;
  body+='<g data-series="'+esc(seriesItem.key)+'"'+(isVisible?'':' style="display:none"')+'>';
  if(isVisible){
   const lower=cumulative.slice();
   const upper=rows.map((row,index)=>lower[index]+(Number(row[seriesItem.key])||0));
   const upperPoints=upper.map((value,index)=>x(rows[index])+','+y(value));
   const lowerPoints=lower.map((value,index)=>x(rows[index])+','+y(value)).reverse();
   body+='<polygon points="'+upperPoints.concat(lowerPoints).join(' ')+'" fill="url(#hatch-'+id+'-'+series.indexOf(seriesItem)+')" stroke="'+seriesItem.color+'" stroke-width="1"><title>'+esc(seriesItem.name)+'</title></polygon>';
   upper.forEach((value,index)=>{cumulative[index]=value});
  }
  body+='</g>';
 }
 rows.forEach((row,index)=>{
  const left=index===0?L:(x(rows[index-1])+x(row))/2;
  const right=index===rows.length-1?W-R:(x(row)+x(rows[index+1]))/2;
  const label=stackSeries.slice().reverse().map(item=>item.name+': '+fmt(row[item.key],2)+' MW').join(', ');
  body+='<rect class="chart-hit" data-point="'+index+'" x="'+left+'" y="'+T+'" width="'+(right-left)+'" height="'+(H-T-B)+'" fill="transparent" tabindex="0" role="button" aria-label="'+esc(row.time+': '+label)+'"/>';
 });
 const controls='<div class="dispatch-chart-style"><label>Chart style <select data-chart-style="en-curve"><option value="area" selected>Stacked area</option><option value="line">Line chart</option></select></label></div>';
 return '<div class="interactive-chart en-curve-chart" data-chart="'+id+'">'+controls+'<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="group" aria-label="Half-hourly generation by source and shortage, stacked in megawatts"><title>Half-hourly generation by source and shortage, stacked in MW</title>'+body+'<line class="chart-cursor" y1="'+T+'" y2="'+(H-B)+'" hidden/></svg><div class="chart-tooltip" role="status" hidden></div>'+chartLegend(series,false,true)+'<p class="chart-help">Hover, tap, or focus the chart for values. Use the legend to select series.</p></div>';
}
function energyCurveHourlyTable(rows,series,totals={},mode='energy'){
 const sources=series.slice(),tableSources=sources.filter(source=>source.key!=='shortage_mw'),generationSources=sources.filter(source=>source.key!=='shortage_mw'),shortageSources=sources.filter(source=>source.key==='shortage_mw');
 const hours=Array.from({length:24},(_,hour)=>({hour,values:Object.fromEntries(sources.map(source=>[source.key,0])),mwValues:Object.fromEntries(sources.map(source=>[source.key,null]))}));
 for(const row of rows){
  const time=String(row.time),hour=Number(time.slice(0,2));
  if(!Number.isInteger(hour)||hour<0||hour>=24)continue;
  for(const source of sources){
   const mw=Number(row[source.key]);
   if(Number.isFinite(mw)){
    hours[hour].values[source.key]+=mw*0.5;
    if(time.slice(3,5)==='00')hours[hour].mwValues[source.key]=mw;
   }
  }
 }
 const sumFor=(values,group)=>group.reduce((sum,source)=>sum+(Number(values[source.key])||0),0);
 const rawTotals=Object.fromEntries(sources.map(source=>[source.key,hours.reduce((sum,hour)=>sum+hour.values[source.key],0)]));
 const rawGenerated=generationSources.reduce((sum,source)=>sum+rawTotals[source.key],0);
 const rawShortage=shortageSources.reduce((sum,source)=>sum+rawTotals[source.key],0);
 const publishedGenerated=Number(totals.energy_generated_mwh),publishedShortage=Number(totals.energy_not_served_mwh);
 const hasGenerated=Number.isFinite(publishedGenerated)&&publishedGenerated>=0,hasShortage=Number.isFinite(publishedShortage)&&publishedShortage>=0;
 const generatedScale=hasGenerated&&rawGenerated>0?publishedGenerated/rawGenerated:1;
 const shortageScale=hasShortage&&rawShortage>0?publishedShortage/rawShortage:1;
 const roundTenth=value=>Math.round((value+Number.EPSILON)*10)/10;
 for(const source of sources){
  const factor=source.key==='shortage_mw'?shortageScale:generatedScale;
  for(const hour of hours)hour.values[source.key]=roundTenth(hour.values[source.key]*factor);
 }
 const sourceTotals=Object.fromEntries(sources.map(source=>[source.key,hours.reduce((sum,hour)=>sum+hour.values[source.key],0)]));
 const reconcileGroup=(group,target)=> {
  if(!group.length||!Number.isFinite(target)||target<0)return;
  const difference=roundTenth(roundTenth(target)-sumFor(sourceTotals,group));
  if(Math.abs(difference)<0.05)return;
  const largest=group.slice().sort((a,b)=>sourceTotals[b.key]-sourceTotals[a.key])[0];
  for(let index=hours.length-1;index>=0;index--){
   if(hours[index].values[largest.key]!==0){hours[index].values[largest.key]=roundTenth(hours[index].values[largest.key]+difference);break}
  }
  sourceTotals[largest.key]=hours.reduce((sum,hour)=>sum+hour.values[largest.key],0);
 };
 if(hasGenerated)reconcileGroup(generationSources,publishedGenerated);
 if(hasShortage)reconcileGroup(shortageSources,publishedShortage);
 const isMw=mode==='mw',hourlyUnit=isMw?'MW':'MWh',title=isMw?'Hourly MW by source':'Hourly energy by source';
 const rowMarkup=hours.map(hour=>{
  const values=isMw?hour.mwValues:hour.values;
  const precision=isMw?2:1;
  const cells=tableSources.map(source=>'<td'+(source.key==='shortage_mw'?' class="energy-curve-shortage"':'')+'>'+fmt(values[source.key],precision)+'</td>').join('');
  const generationTotal=fmt(sumFor(values,generationSources),precision);
  return '<tr><th scope="row">'+String(hour.hour).padStart(2,'0')+':00–'+String(hour.hour).padStart(2,'0')+':59</th>'+cells+'<td class="energy-curve-total">'+generationTotal+'</td><td class="energy-curve-shortage">'+fmt(values.shortage_mw,precision)+'</td></tr>';
 }).join('');
 const generatedTotal=sumFor(sourceTotals,generationSources),controls='<div class="energy-curve-table-modes" role="group" aria-label="Hourly table measure"><button type="button" data-en-curve-table-mode="mw" aria-pressed="'+isMw+'">Hourly MW by source</button><button type="button" data-en-curve-table-mode="energy" aria-pressed="'+!isMw+'">Hourly energy by source</button></div>';
 const description=isMw?'Workbook MW readings at the start of each hour · Bangladesh time':'Hourly MWh allocated from half-hour readings and reconciled to published daily totals · Bangladesh time';
 const headers=tableSources.map(source=>'<th scope="col"'+(source.key==='shortage_mw'?' class="energy-curve-shortage"':'')+'>'+esc(source.name)+'</th>').join('');
 const footer=tableSources.map(source=>'<td'+(source.key==='shortage_mw'?' class="energy-curve-shortage"':'')+'>'+fmt(sourceTotals[source.key],1)+'</td>').join('');
 return '<section class="energy-curve-hourly" aria-labelledby="energy-curve-hourly-title"><div class="energy-curve-hourly-heading"><div><h3 id="energy-curve-hourly-title">'+title+'</h3><p>'+description+'</p></div>'+controls+'</div><div class="energy-curve-table-wrap" role="region" aria-label="'+title+'" tabindex="0"><table class="energy-curve-table"><caption>'+title+' in '+hourlyUnit+'. Daily source totals are energy in MWh; shortage reconciles to reported energy not served.</caption><thead><tr><th scope="col">Hour (BST)</th>'+headers+'<th scope="col" class="energy-curve-total">Generation / hour ('+hourlyUnit+')</th><th scope="col" class="energy-curve-shortage">Shortage</th></tr></thead><tbody>'+rowMarkup+'</tbody><tfoot><tr><th scope="row">Daily energy (MWh)</th>'+footer+'<td class="energy-curve-total">'+fmt(generatedTotal,1)+'</td><td class="energy-curve-shortage">'+fmt(sourceTotals.shortage_mw,1)+'</td></tr></tfoot></table></div></section>';
}
function enCurve(){
 const curve=data.en_curve, totals=curve?.totals||{}, rows=curve?.hourly||[];
 if(!rows.length)return '<section class="panel full"><div class="panel-head"><div><h2>Energy Curve data unavailable</h2><p>This archived report does not contain Energy Curve readings.</p></div><span class="tag">ENERGY CURVE</span></div></section>';
 const palette=['#1976b9','#347baf','#5d9bc2','#759398','#4d8e70','#72a984','#b07aa1','#8b72b4','#c48722','#d69a42','#b95442','#cf745c','#597a9d','#7a8da6','#4a9b8a'];
 const generationSeries=(curve.sources||[]).map((source,index)=>{const energyMwh=rows.reduce((sum,row)=>{const value=Number(row[source.key]);return sum+(Number.isFinite(value)?value*0.5:0)},0);return {key:source.key,name:source.key==='shortage_mw'?'Shortage':source.name,color:source.key==='shortage_mw'?'#ed4d4d':palette[index%palette.length],energyMwh,defaultVisible:dispatchVisibility.get(source.key)!==false}}).sort((a,b)=>b.energyMwh-a.energyMwh).map((source,index)=>({...source,hatch:true,hatchAngle:[0,45,90,135][index%4]}));
 const generationChart=enCurveChartStyle==='area'?stackedAreaChart(rows,generationSeries):chart(rows,generationSeries,{styleSetting:'en-curve',wrapLegend:true});
 const shortageChart=chart(rows,[{key:'shortage_mw',name:'Shortage',color:'#bf5b3c',bar:true}]);
 const gwh=value=>fmt(value==null?null:value/1000,2);
 const chartPanel=(title,subtitle,body,tag)=>'<section class="panel full"><div class="panel-head"><div><h2>'+title+'</h2><p>'+subtitle+'</p></div><span class="tag">'+tag+'</span></div>'+body+'</section>';
 return '<div class="metrics en-curve-metrics">'+metric('Energy generated',gwh(totals.energy_generated_mwh),'GWh','Daily total · '+esc(shortDate(curve.date||data.date)))+metric('Energy not served',gwh(totals.energy_not_served_mwh),'GWh','Reported daily energy shortage')+metric('Total energy requirement',gwh(totals.total_requirement_mwh),'GWh','Generated energy plus energy not served')+'</div>'+chartPanel('Generation by source','Half-hourly generation profile by workbook source, including reported shortage',generationChart+energyCurveHourlyTable(rows,generationSeries,totals,enCurveTableMode),'MW · BST')+chartPanel('Reported shortage','Half-hourly power shortage recorded in the workbook',shortageChart,'MW · BST')+'<p class="note">Source: En-Curve sheet · operating date '+esc(shortDate(curve.date||data.date))+'. Source series and daily totals are transcribed from the selected Power Grid workbook.</p>';
}
document.addEventListener('click',event=>{const toggle=event.target.closest?.('[data-en-curve-table-mode]');if(!toggle)return;const mode=toggle.dataset.enCurveTableMode==='mw'?'mw':'energy';if(mode===enCurveTableMode)return;enCurveTableMode=mode;render()});
function render(){if(location.hash==='#trends'){window.BEGDTrends?.mount();return}if(!data)return;currentPlantMap=null;chartData.clear();const view=location.hash.slice(1)||'overview';const valid=['overview','plants','regions','imports','realtime','substations','operations','forecast','en-curve'].includes(view)?view:'overview';const live=valid==='realtime';document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+valid));$('#title').textContent={overview:'National overview',plants:'Power plants',regions:'Regional data',imports:'Cross-border imports',realtime:'Real time',substations:'Substations',operations:'Operations detail',forecast:'Generation forecast','en-curve':'Energy Curve'}[valid];const reportDate=data.published_date||data.date;const dateLabel=d=>new Date(d+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Dhaka'});$('#subtitle').innerHTML=live?'ERP readings for today only · Bangladesh time':`<span class="operating-date-highlight">Operating date ${esc(dateLabel(data.date))}</span><span class="report-date-context">Report published ${esc(dateLabel(reportDate))} · All times Bangladesh time</span>`;$('#report-date-controls').hidden=live;$('#date-status').hidden=live;$('#day-sources').hidden=live;document.querySelector('.header-meta .status').textContent=live?'ERP LIVE READINGS':'DAILY OPERATING REPORT';$('#content').innerHTML=({overview,plants,regions,imports,realtime:realTime,substations,operations,forecast,'en-curve':enCurve}[valid])();$('#source').textContent=live?'Source: ERP rows dated today in Bangladesh time; see per-panel availability below.':`Source: Power Grid ERP · ${data.report_name||data.source_file} · Operating date: ${data.date}`;setupCharts(valid);if(valid==='regions')setupRegionMap();$('#fuel-mix-style')?.addEventListener('change',event=>{fuelMixStyle=event.target.value;render()});if(valid==='plants'){updatePlants();setupPlantMap()}if(valid==='substations'){['substation-search','substation-sort','voltage-class'].forEach(id=>{const control=$('#'+id);control.addEventListener('input',updateSubstations);control.addEventListener('change',updateSubstations)});updateSubstations()}if(valid==='forecast'){['forecast-search','forecast-fuel'].forEach(id=>$('#'+id).addEventListener('input',updateForecast));updateForecast()}}
document.addEventListener('change',event=>{
 const control=event.target.closest?.('[data-regional-snapshot-style]');if(!control)return;
 regionalSnapshotStyle=control.value;
 const chart=document.querySelector('.regional-snapshot-chart-wrap');
 if(chart){chart.outerHTML=regionalSnapshotChart();setupRegionalSnapshotTooltips();}
});
document.addEventListener('click',event=>{
 const option=event.target.closest?.('[data-regional-fuel]');if(!option)return;
 selectedRegionalFuel=option.dataset.regionalFuel;
 const explorer=option.closest('.regional-fuel-explorer');if(!explorer)return;
 explorer.querySelectorAll('[data-regional-fuel]').forEach(button=>button.setAttribute('aria-pressed',String(button===option)));
 const caption=explorer.querySelector('[data-regional-fuel-selected]');if(caption)caption.textContent=selectedRegionalFuel+' · generation by region, highest to lowest';
 const chart=explorer.querySelector('[data-regional-fuel-chart]');if(chart)chart.innerHTML=regionalFuelBarChart(selectedRegionalFuel);
});
async function load(reportId){const id=++request;try{const r=await fetch(`/api/report?id=${encodeURIComponent(reportId)}`,{cache:'no-store'});if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error||'Report could not be loaded')}const next=await r.json();if(id!==request)return false;if(data&&data.report_id!==next.report_id){for(const day of ['yesterday','tomorrow','highest']){comparisonRequests[day]++;comparisonData[day]=null;$(`#${day}-status`).textContent=$(`#source-${day}`).checked?'Loading…':'Off'}}data=next;previousForecastReport=null;$('#error').hidden=true;render();loadPreviousForecast();for(const day of ['yesterday','tomorrow','highest'])if($(`#source-${day}`).checked&&$(`#${day}-status`).textContent==='Waiting for report')loadComparison(day);return true}catch(e){if(id!==request)return false;$('#error').hidden=false;$('#error').textContent=e.message;if(location.hash!=='#trends')$('#content').innerHTML='';return false}}
async function loadPreviousForecast(){
 const id=++previousForecastRequest,reportId=data?.report_id;
 previousForecastReport=null;
 if(!data||!reportId)return;
 try{
  const response=await fetch(`/api/neighbor?id=${encodeURIComponent(reportId)}&offset=-1`,{cache:'no-store'});
  if(!response.ok)return;
  const report=await response.json();
  if(id!==previousForecastRequest||!data||data.report_id!==reportId)return;
  if(report.forecast?.date===data.date)previousForecastReport=report;
  render();
 }catch(error){if(id===previousForecastRequest&&data?.report_id===reportId){previousForecastReport=null;render()}}
}
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
function reportDayNavigationTarget(offset){
 const selected=$('#date').value,ordered=archiveReports.slice().sort((a,b)=>a.published_date.localeCompare(b.published_date));
 const index=ordered.findIndex(report=>String(report.id)===String(selected));
 return index<0?null:ordered[index+offset]||null;
}
function updateReportDayNavigation(){
 $('#previous-report').disabled=!reportDayNavigationTarget(-1);
 $('#next-report').disabled=!reportDayNavigationTarget(1);
}
function navigateReportDay(offset){
 const report=reportDayNavigationTarget(offset);if(!report)return;
 const select=$('#date'),id=String(report.id);
 if(![...select.options].some(option=>option.value===id)){
  const label=new Date(report.published_date+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
  const option=document.createElement('option');option.value=id;option.textContent=label+' · '+report.name;select.add(option);
 }
 select.value=id;
 select.dispatchEvent(new Event('change',{bubbles:true}));
}
async function selectReportById(id){
 updateReportDayNavigation();
 const status=$('#date-status'),previous=status.textContent;
 status.textContent='Loading selected report…';
 const loaded=await load(id);
 if(loaded)await Promise.all(['yesterday','tomorrow','highest'].filter(day=>$('#source-'+day).checked).map(loadComparison));
 status.textContent=previous;
}
function populateArchiveDateControls(reports, preferred={}){
 const yearSelect=$('#archive-year'),monthSelect=$('#archive-month'),daySelect=$('#archive-day');
 const older=reports.filter(report=>report.published_date<archiveCutoff);
 const years=[...new Set(older.map(report=>report.published_date.slice(0,4)))].sort().reverse();
 const year=years.includes(preferred.year)?preferred.year:'';
 yearSelect.innerHTML='<option value="">Year</option>'+years.map(value=>`<option value="${value}">${value}</option>`).join('');
 yearSelect.value=year;
 const months=[...new Set(older.filter(report=>report.published_date.slice(0,4)===year).map(report=>report.published_date.slice(5,7)))].sort().reverse();
 const month=months.includes(preferred.month)?preferred.month:'';
 monthSelect.innerHTML='<option value="">Month</option>'+months.map(value=>{const label=new Date(`${year}-${value}-01T12:00:00+06:00`).toLocaleDateString('en-GB',{month:'long',timeZone:'Asia/Dhaka'});return `<option value="${value}">${label}</option>`}).join('');
 monthSelect.value=month;monthSelect.disabled=!year;
 const days=[...new Set(older.filter(report=>report.published_date.slice(0,7)===`${year}-${month}`).map(report=>report.published_date))].sort().reverse();
 const day=days.includes(preferred.day)?preferred.day:'';
 daySelect.innerHTML='<option value="">Day</option>'+days.map(value=>`<option value="${value}">${new Date(`${value}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',timeZone:'Asia/Dhaka'})}</option>`).join('');
 daySelect.value=day;daySelect.disabled=!month;
}
$('#date').addEventListener('change',async event=>{
 updateReportDayNavigation();
 const selected=archiveReports.find(report=>String(report.id)===event.target.value);
 populateArchiveDateControls(archiveReports,selected&&selected.published_date<archiveCutoff?{year:selected.published_date.slice(0,4),month:selected.published_date.slice(5,7),day:selected.published_date}:{});
 await selectReportById(event.target.value);
});
$('#previous-report').addEventListener('click',()=>navigateReportDay(-1));
$('#next-report').addEventListener('click',()=>navigateReportDay(1));
$('#archive-year').addEventListener('change',event=>populateArchiveDateControls(archiveReports,{year:event.target.value}));
$('#archive-month').addEventListener('change',event=>populateArchiveDateControls(archiveReports,{year:$('#archive-year').value,month:event.target.value}));
$('#archive-day').addEventListener('change',async event=>{
 const day=event.target.value;if(!day)return;
 const report=archiveReports.find(item=>item.published_date===day);
 if(!report)return;
 const select=$('#date'),label=d=>new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
 if(![...select.options].some(option=>option.value===String(report.id)))select.insertAdjacentHTML('beforeend',`<option value="${esc(report.id)}">${esc(label(report.published_date))} · ${esc(report.name)}</option>`);
 select.value=String(report.id);
 await selectReportById(String(report.id));
});
window.addEventListener('hashchange',render);
document.querySelector('nav[aria-label="Dashboard views"]').addEventListener('click',event=>{if(event.target.closest('a[href^="#"]'))window.scrollTo(0,0)});
async function refreshDateList(){
 try{
  const response=await fetch('/api/reports',{cache:'no-store'});
  if(!response.ok)throw Error('Power Grid report dates could not be loaded');
  const archive=await response.json(),reports=archive.reports||[],select=$('#date');
  archiveReports=reports;
  const latest=reports.reduce((value,report)=>report.published_date>value?report.published_date:value,'');
  const cutoff=latest?new Date(new Date(`${latest}T12:00:00+06:00`).getTime()-13*86400000).toISOString().slice(0,10):'';
  archiveCutoff=cutoff;
  const recent=reports.filter(report=>report.published_date>=cutoff);
  const selectedId=select.value||data?.report_id||'';
  const selectedReport=reports.find(report=>String(report.id)===String(selectedId));
  const visible=recent.slice();
  if(selectedReport&&!visible.some(report=>String(report.id)===String(selectedReport.id)))visible.push(selectedReport);
  const label=d=>new Date(`${d}T12:00:00+06:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
  if(document.activeElement!==select&&reports.length){
   select.innerHTML=visible.map(report=>`<option value="${esc(report.id)}">${esc(label(report.published_date))} · ${esc(report.name)}</option>`).join('');
   if(selectedId&&visible.some(report=>String(report.id)===String(selectedId)))select.value=String(selectedId);
   else if(!data){select.value=String(recent[0].id);await load(String(recent[0].id))}
  }
  const active=reports.find(report=>String(report.id)===String(select.value));
  const archiveDate=active&&active.published_date<cutoff?{year:active.published_date.slice(0,4),month:active.published_date.slice(5,7),day:active.published_date}:{};
  populateArchiveDateControls(reports,archiveDate);
  updateReportDayNavigation();
  if(archive.error)$('#date-status').textContent=archive.error;
  else if(archive.complete)$('#date-status').textContent='';
  else $('#date-status').textContent=`Loading report dates · ${fmt(archive.pages_loaded)} of ${fmt(archive.page_count)} pages`;
  if(!archive.complete&&!archive.error)window.setTimeout(refreshDateList,2500);
 }catch(error){$('#error').hidden=false;$('#error').textContent=error.message;$('#date-status').textContent='Report archive unavailable'}
}
refreshDateList();
