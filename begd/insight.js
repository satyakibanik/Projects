(function(){
 const ranges=[['day','Day',1],['7d','7d',7],['30d','30d',30],['60d','60d',60],['365d','365d',365],['all','Long Term','all']];
 const assumptionFields=[['solar','Solar'],['wind','Wind'],['hfo','HFO'],['hsd','HSD'],['hydro','Hydro'],['coal','Coal'],['gas','Gas'],['gas/hsd','Gas + HSD'],['gas/hfo','Gas + HFO'],['nuclear','Nuclear']];
 const H={solar:0,wind:0,hfo:.7,hsd:.7,hydro:3.5,coal:4.5,gas:5.5,'gas/hsd':5.5,'gas/hfo':5.5,nuclear:5.5};
 const fuelColors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Wind:'#76b7b2','Gas + HSD':'#9c6eaf','Gas + HFO':'#b07aa1','Dual fuel':'#9c6eaf',Nuclear:'#af5f9d',Other:'#526a7d'};
 let selected='day',report=null,token=0,cache=new Map(),historyLoad=null,chartData=[],chartReports=[],chartDays=1,chartRolling=null,chartLabel='24h rolling mean',chartClass='365d',visibleExtent=null,zoomDragging=false,assumptionTimer=null;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fuelKey=value=>{const parts=String(value||'').trim().toLowerCase().split(/[\/+&]/).map(part=>part.trim()).filter(Boolean);if(parts.length===2&&parts.includes('gas'))return 'gas/'+parts.find(part=>part!=='gas');return parts[0]};
 const fuelCategory=value=>({'solar':'Solar','wind':'Wind','hfo':'HFO','hsd':'HSD','hydro':'Hydro','coal':'Coal','gas':'Gas','gas/hsd':'Gas + HSD','gas/hfo':'Gas + HFO','nuclear':'Nuclear'}[fuelKey(value)]||'Other');
 const inertiaForCategory=category=>category==='Dual fuel'?(H['gas/hsd']+H['gas/hfo'])/2:H[fuelKey(category)];
 const inertiaFor=unit=>H[fuelKey(unit.fuel)];
 const assumptionValue=value=>Number.isInteger(value)?String(value):String(Number(value.toFixed(6)));
 const setInertia=(key,value)=>{const number=Number(value);if(!Object.hasOwn(H,key)||!Number.isFinite(number)||number<0)return false;H[key]=number;return true};
 const scenarioDefaults={condition:'actual',highRenewableMw:2000,solarSharePct:80,eveningDemandIncreaseMw:1000,eveningThermalMw:1800,eveningGasSharePct:70,largestUnitTrip:false,importLoss:false,importTarget:'largest'};
 let scenarioState={...scenarioDefaults,hour:null};
 const wholeHour=value=>/^\d{2}:00$/.test(String(value||'').slice(0,5));
 const readingAt=(rows,time)=>{const row=(rows||[]).find(item=>String(item.time||'').slice(0,5)===time),value=Number(row?.mw);return Number.isFinite(value)?value:0};
 const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
 function scenarioHours(source){
  const values=new Set();for(const unit of source?.plant_units||[])for(const item of unit.hourly||[])if(wholeHour(item.time))values.add(String(item.time).slice(0,5));
  return [...values].sort();
 }
 function aggregateScenario(units){
  const fuelCapacity={},fuelOutput={};let numerator=0,capacity=0,output=0,plants=0;
  for(const unit of units){const cap=Number(unit.capacity)||0,mw=Number(unit.output)||0,category=unit.category||fuelCategory(unit.fuel);output+=mw;if(mw>0)plants++;fuelOutput[category]=(fuelOutput[category]||0)+mw;if(cap>0&&Number.isFinite(unit.h)){capacity+=cap;numerator+=cap*unit.h;fuelCapacity[category]=(fuelCapacity[category]||0)+cap}}
  return {h:capacity?numerator/capacity:null,numerator,capacity,output,plants,fuelCapacity,fuelOutput};
 }
 function scenarioSnapshot(source,time){
  const units=(source?.plant_units||[]).map((unit,index)=>{const output=readingAt(unit.hourly,time),h=inertiaFor(unit),capacity=Number(unit.present_capacity_mw),category=fuelCategory(unit.fuel);return {id:index,name:unit.name||`Unit ${index+1}`,fuel:unit.fuel,category,h:Number.isFinite(h)?h:null,capacity:Number.isFinite(capacity)&&capacity>0?capacity:0,output:output>0?output:0,synthetic:false}}).filter(unit=>unit.output>0);
  const imports=(source?.imports||[]).map((route,index)=>({id:index,name:route.name||`Interconnector ${index+1}`,mw:Math.max(0,readingAt(route.hourly,time))})).filter(route=>route.mw>0);
  return {units,imports,...aggregateScenario(units)};
 }
 function simulateScenario(source,time,options={}){
  const settings={...scenarioDefaults,...options},baseline=scenarioSnapshot(source,time),units=baseline.units.map(unit=>({...unit})),notes=[];let balanceDeltaMw=0;
  if(settings.condition==='high-renewable'){
   const synchronous=units.filter(unit=>unit.output>0&&unit.capacity>0&&Number.isFinite(unit.h)&&!['Solar','Wind'].includes(unit.category)),synchronousOutput=synchronous.reduce((sum,unit)=>sum+unit.output,0),replacement=Math.min(clamp(settings.highRenewableMw,0,100000),synchronousOutput),scale=synchronousOutput?1-replacement/synchronousOutput:1;let shiftedCapacity=0;
   for(const unit of synchronous){const original=unit.capacity;unit.capacity*=scale;unit.output*=scale;shiftedCapacity+=original-unit.capacity}
   const solarShare=clamp(settings.solarSharePct,0,100)/100,windShare=1-solarShare;
   if(shiftedCapacity*solarShare>0)units.push({id:'renewable-solar',name:'Scenario solar',fuel:'Solar',category:'Solar',h:H.solar,capacity:shiftedCapacity*solarShare,output:replacement*solarShare,synthetic:true});
   if(shiftedCapacity*windShare>0)units.push({id:'renewable-wind',name:'Scenario wind',fuel:'Wind',category:'Wind',h:H.wind,capacity:shiftedCapacity*windShare,output:replacement*windShare,synthetic:true});
   notes.push(`${Math.round(replacement).toLocaleString()} MW of synchronous output replaced by ${Math.round(solarShare*100)}% solar / ${Math.round(windShare*100)}% wind; ${Math.round(shiftedCapacity).toLocaleString()} MW of the present-capacity proxy shifts with it.`);
  }else if(settings.condition==='evening-peak'){
   let removedSolarOutput=0,removedSolarCapacity=0;for(const unit of units)if(unit.category==='Solar'){removedSolarOutput+=unit.output;removedSolarCapacity+=unit.capacity;unit.output=0;unit.capacity=0}
   const thermal=Math.max(0,Number(settings.eveningThermalMw)||0),gasShare=clamp(settings.eveningGasSharePct,0,100)/100,coalShare=1-gasShare,demandIncrease=Math.max(0,Number(settings.eveningDemandIncreaseMw)||0);
   if(thermal*gasShare>0)units.push({id:'evening-gas',name:'Scenario gas commitment',fuel:'Gas',category:'Gas',h:H.gas,capacity:thermal*gasShare,output:thermal*gasShare,synthetic:true});
   if(thermal*coalShare>0)units.push({id:'evening-coal',name:'Scenario coal commitment',fuel:'Coal',category:'Coal',h:H.coal,capacity:thermal*coalShare,output:thermal*coalShare,synthetic:true});
   balanceDeltaMw=thermal-removedSolarOutput-demandIncrease;
   notes.push(`Solar output falls by ${Math.round(removedSolarOutput).toLocaleString()} MW (${Math.round(removedSolarCapacity).toLocaleString()} MW capacity proxy); ${Math.round(thermal).toLocaleString()} MW thermal commitment is added at ${Math.round(gasShare*100)}% gas / ${Math.round(coalShare*100)}% coal while demand rises ${Math.round(demandIncrease).toLocaleString()} MW.`);
  }
  const condition=aggregateScenario(units),events=[];let disturbanceMw=0,largestUnit=null,importRoutes=[];
  if(settings.largestUnitTrip){largestUnit=units.filter(unit=>!unit.synthetic&&unit.output>0).sort((a,b)=>b.output-a.output||b.capacity-a.capacity)[0]||null;if(largestUnit){largestUnit.outputBeforeTrip=largestUnit.output;largestUnit.capacityBeforeTrip=largestUnit.capacity;disturbanceMw+=largestUnit.output;largestUnit.output=0;largestUnit.capacity=0;events.push(`${largestUnit.name} trips (${Math.round(largestUnit.outputBeforeTrip).toLocaleString()} MW ${settings.condition==='actual'?'reported output':'modeled output after the operating-condition adjustment'}).`) }else events.push('No online generator is available to trip at this hour.')}
  if(settings.importLoss){const active=baseline.imports.slice().sort((a,b)=>b.mw-a.mw),selected=settings.importTarget==='all'?active:settings.importTarget&&settings.importTarget!=='largest'?active.filter(route=>route.name===settings.importTarget):active.slice(0,1);importRoutes=selected;const lost=selected.reduce((sum,route)=>sum+route.mw,0);disturbanceMw+=lost;events.push(lost?`${selected.map(route=>route.name).join(' + ')} lost (${Math.round(lost).toLocaleString()} MW imported power).`:'No matching active import is available at this hour.')}
  const scenario=aggregateScenario(units),rocofHzS=disturbanceMw>0&&scenario.numerator>0?50*disturbanceMw/(2*scenario.numerator):0;
  return {time,settings,baseline,condition,scenario,disturbanceMw,rocofHzS,balanceDeltaMw,largestUnit,importRoutes,notes,events};
 }
 function scenarioControlsMarkup(source){
  const hours=scenarioHours(source),fallback=hours.includes('18:00')?'18:00':hours[0]||'00:00';if(!scenarioState.hour||!hours.includes(scenarioState.hour))scenarioState.hour=fallback;
  const importNames=(source.imports||[]).map(item=>item.name).filter(Boolean);
  return `<section class="panel full insight-scenario-lab" aria-labelledby="insight-scenario-heading"><div class="insight-scenario-head"><div><div class="section-number">COMPOSABLE WHAT-IF LAB</div><h2 id="insight-scenario-heading">Play with the grid</h2><p>Choose an operating condition, then layer one or both contingencies on top. Results use the selected report and hour.</p></div><button type="button" id="insight-scenario-reset">Reset scenario</button></div><div class="insight-preset-grid" role="group" aria-label="Scenario presets"><button type="button" data-scenario-preset="largest"><strong>Largest unit trip</strong><span>Trip the highest-output online generator.</span></button><button type="button" data-scenario-preset="import"><strong>Import loss</strong><span>Lose the largest active interconnector.</span></button><button type="button" data-scenario-preset="renewable"><strong>High renewable afternoon</strong><span>Replace synchronous output with solar and wind.</span></button><button type="button" data-scenario-preset="evening"><strong>Evening peak</strong><span>Remove solar and add demand plus thermal commitment.</span></button></div><div class="insight-scenario-controls"><fieldset><legend>Hour</legend><label for="insight-scenario-hour">Operating hour · BST</label><select id="insight-scenario-hour">${hours.map(hour=>`<option value="${hour}"${hour===scenarioState.hour?' selected':''}>${hour}</option>`).join('')}</select></fieldset><fieldset><legend>Operating condition</legend><label><input type="radio" name="insight-condition" value="actual" checked> Actual selected hour</label><label><input type="radio" name="insight-condition" value="high-renewable"> High renewable afternoon</label><label><input type="radio" name="insight-condition" value="evening-peak"> Evening peak</label></fieldset><fieldset><legend>Contingencies · combine freely</legend><label><input id="insight-trip-largest" type="checkbox"> Largest online unit trip</label><label><input id="insight-import-loss" type="checkbox"> Import interconnector loss</label><label for="insight-import-target">Import loss target</label><select id="insight-import-target"><option value="largest">Largest active interconnector</option><option value="all">All active imports</option>${importNames.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')}</select></fieldset></div><div class="insight-condition-parameters" data-condition-panel="high-renewable" hidden><label>Synchronous output replaced <span><input id="insight-renewable-mw" type="number" min="0" step="100" value="${scenarioState.highRenewableMw}"> MW</span></label><label>Solar share <span><input id="insight-solar-share" type="number" min="0" max="100" step="5" value="${scenarioState.solarSharePct}"> %</span></label></div><div class="insight-condition-parameters" data-condition-panel="evening-peak" hidden><label>Demand increase <span><input id="insight-evening-demand" type="number" min="0" step="100" value="${scenarioState.eveningDemandIncreaseMw}"> MW</span></label><label>Additional thermal commitment <span><input id="insight-evening-thermal" type="number" min="0" step="100" value="${scenarioState.eveningThermalMw}"> MW</span></label><label>Gas share of new thermal <span><input id="insight-evening-gas-share" type="number" min="0" max="100" step="5" value="${scenarioState.eveningGasSharePct}"> %</span></label></div><div id="insight-scenario-results" aria-live="polite"></div><p class="insight-scenario-caveat">Exploratory sensitivity model: present MW capacity remains the inertia-weighting proxy. Renewable replacement assumes proportional synchronous decommitment. RoCoF uses 50 Hz and excludes governor response, load damping and fast frequency response.</p></section>`;
 }
 function assumptionsMarkup(){return `<div class="insight-assumption-grid">${assumptionFields.map(([key,label])=>{const id='insight-inertia-'+key.replace('/','-');return `<div class="insight-assumption-row"><label for="${id}">${esc(label)}</label><div class="insight-assumption-stepper"><button type="button" data-inertia-delta="-0.1" data-inertia-key="${key}" aria-label="Decrease ${esc(label)} inertia constant by 0.1">−</button><input id="${id}" type="number" min="0" step="any" inputmode="decimal" data-inertia-key="${key}" value="${assumptionValue(H[key])}" aria-label="${esc(label)} assumed inertia constant in seconds"><button type="button" data-inertia-delta="0.1" data-inertia-key="${key}" aria-label="Increase ${esc(label)} inertia constant by 0.1">+</button><span aria-hidden="true">s</span></div></div>`}).join('')}</div>`}
 function hourly(source){
  if(Array.isArray(source.insight_hourly)){
   const categories=window.BEGD_INSIGHT_HISTORY?.categories||[];
   return source.insight_hourly.map(row=>{
    const [time,plants,_storedH,_storedCapacity,counts,capacities]=row,fuelCounts={},fuelCapacity={},fuelNumerator={};let numerator=0,capacity=0;
    categories.forEach((category,index)=>{
     const count=Number(counts[index])||0,cap=Number(capacities[index])||0;
     if(count)fuelCounts[category]=count;
     if(cap){fuelCapacity[category]=cap;const inertia=inertiaForCategory(category);if(Number.isFinite(inertia)){fuelNumerator[category]=cap*inertia;numerator+=cap*inertia;capacity+=cap}}
    });
    return {date:source.date,time,h:numerator/capacity,capacity,plants:Number(plants),fuelCounts,fuelCapacity,fuelNumerator};
   }).filter(point=>/^\d{2}:\d{2}$/.test(point.time)&&Number.isFinite(point.h)&&point.capacity>0);
  }
  const byTime=new Map();
  for(const unit of source.plant_units||[]){
   const h=inertiaFor(unit),capacity=Number(unit.present_capacity_mw),category=fuelCategory(unit.fuel),usable=Number.isFinite(h)&&Number.isFinite(capacity)&&capacity>0;
   for(const reading of unit.hourly||[]){
    const output=Number(reading.mw);if(!/^\d{2}:00$/.test(reading.time)||!(output>0))continue;
    const item=byTime.get(reading.time)||{date:source.date,time:reading.time,numerator:0,capacity:0,plants:0,fuelCounts:{},fuelCapacity:{},fuelNumerator:{}};
    item.plants++;item.fuelCounts[category]=(item.fuelCounts[category]||0)+1;
    if(usable){item.numerator+=capacity*h;item.capacity+=capacity;item.fuelCapacity[category]=(item.fuelCapacity[category]||0)+capacity;item.fuelNumerator[category]=(item.fuelNumerator[category]||0)+capacity*h}
    byTime.set(reading.time,item);
   }
  }
  return [...byTime.values()].filter(item=>item.capacity>0).sort((a,b)=>a.time.localeCompare(b.time)).map(item=>({...item,h:item.numerator/item.capacity}));
 }
 function markup(source){
  report=source;cache.set(source.date,source);
  return `<section class="insight-shell" aria-labelledby="insight-heading"><section class="panel full insight-intro"><div><div class="section-number">SYSTEM STABILITY / ESTIMATED INERTIA</div><h2 id="insight-heading">Hourly center-of-inertia constant</h2><p class="insight-definition">An estimate of the system inertia constant for each hour, using generating units with non-zero reported output in GenLog. Each online unit is weighted by its reported present capacity (<em>P</em><sub>cap,curr</sub>).</p><p class="insight-formula"><em>H</em><sub>COI</sub> = Σ(<em>P</em><sub>cap,curr,i</sub> × <em>H</em><sub>i</sub>) / Σ<em>P</em><sub>cap,curr,i</sub></p></div><aside class="insight-assumptions"><h3>Assumed inertia constants</h3><p>Adjust any value to recalculate the metrics, charts and scenario results.</p>${assumptionsMarkup()}</aside></section>${scenarioControlsMarkup(source)}<section class="panel full"><div class="panel-head"><div><h2>Estimated system inertia</h2><p>Hourly capacity-weighted <em>H</em><sub>COI</sub> · Bangladesh time</p></div><span class="tag">SECONDS</span></div><div class="insight-range" role="group" aria-label="Inertia history range"><span>Range</span>${ranges.map(([key,label])=>`<button type="button" data-insight-range="${key}" aria-pressed="${key===selected}">${label}</button>`).join('')}</div><p id="insight-status" class="insight-status" role="status" aria-live="polite"></p><div id="insight-output"></div></section><section class="panel full insight-method"><h2>Method and limitations</h2><p>The standard center-of-inertia expression is normally weighted by each machine’s MVA rating. The PGCB daily operational report does not provide MVA ratings, so this dashboard uses reported present MW capacity (<em>P</em><sub>cap,curr</sub>) as a proxy. It is therefore an operational estimate, not a measured inertia value.</p><ul><li>A plant is treated as online only when its reported hourly generation is greater than zero. Imports are not assigned inertia.</li><li>Scenario conditions change the selected hour only. High renewable replacement proportionally decommits synchronous output and its present-capacity proxy before adding zero-inertia solar and wind. Evening peak removes solar, adds the chosen thermal commitment, and reports the implied supply-margin change after higher demand.</li><li>Contingencies are applied after the operating condition. The largest-unit event removes the highest reported-output generator; import loss removes the selected active interconnector. The RoCoF estimate uses the post-event inertia proxy and does not model governor response, load damping, reserves, protection or fast frequency response.</li><li>Units with an unavailable fuel classification or unavailable present capacity are excluded. Dual-fuel labels are treated independently of order: HFO/Gas uses the gas/HFO assumption, and HSD/Gas uses gas/HSD. Legacy reports that only identify “Dual fuel” use the mean of those two assumptions.</li><li>The dashed <em>H</em> = 3 s line is shown as a minimum stability reference for interpretation, following the low-inertia stability literature supplied for this view. It is not a universal operating limit for every grid condition.</li></ul><p>Background: <a href="https://ieeexplore.ieee.org/abstract/document/9542998" target="_blank" rel="noopener noreferrer">IEEE paper 9542998</a> · <a href="https://www.researchgate.net/publication/259441097_Impact_of_Low_Rotational_Inertia_on_Power_System_Stability_and_Operation" target="_blank" rel="noopener noreferrer">Impact of Low Rotational Inertia on Power System Stability and Operation</a>. Operational data: selected PGCB/NLDC daily reports, P2 and GenLog sheets.</p></section></section>`;
 }
 const dateLabel=value=>new Date(value+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'});
 function pointStamp(point){let date=point.date,time=point.time;if(time==='24:00'){const next=new Date(date+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);date=next.toISOString().slice(0,10);time='00:00'}return new Date(`${date}T${time}:00+06:00`).getTime()}
 function availableDates(days){
  if(days===1)return [report.date];
  const end=new Date(report.date+'T00:00:00Z'),start=new Date(end);if(days!=='all')start.setUTCDate(start.getUTCDate()-days+1);
  const dates=new Set([...Object.keys(window.BEGD_STATIC_DATA?.reports_by_operating_date||{}),...Object.keys(window.BEGD_INSIGHT_HISTORY?.reports||{})]);
  return [...dates].filter(date=>{const value=new Date(date+'T00:00:00Z');return (days==='all'||value>=start)&&value<=end}).sort();
 }
 async function ensureHistory(){
  if(window.BEGD_INSIGHT_HISTORY)return window.BEGD_INSIGHT_HISTORY;
  if(!historyLoad)historyLoad=fetch('insight-history.json.gz',{cache:'force-cache'}).then(async response=>{if(!response.ok)throw Error('History unavailable');const stream=new Blob([await response.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).json()}).then(value=>window.BEGD_INSIGHT_HISTORY=value).catch(()=>window.BEGD_INSIGHT_HISTORY={categories:[],reports:{}});
  return historyLoad;
 }
 async function getReport(date){
  if(cache.has(date))return cache.get(date);
  const currentDates=window.BEGD_STATIC_DATA?.reports_by_operating_date||{},reportId=currentDates[date];
  const historical=window.BEGD_INSIGHT_HISTORY?.reports?.[date];
  if(historical&&!Object.hasOwn(currentDates,date)){const value={date,insight_hourly:historical};cache.set(date,value);return value}
  if(reportId){
   const bundled=window.BEGD_STATIC_DATA?.reports_by_id?.[reportId];if(bundled){cache.set(date,bundled);return bundled}
   const response=await fetch(new URL('archive/'+encodeURIComponent(reportId)+'.json',window.location.href),{cache:'no-store'});if(!response.ok)throw Error('Unavailable');
   const value=await response.json();cache.set(date,value);return value;
  }
  const response=await fetch('/api/report?date='+encodeURIComponent(date),{cache:'no-store'});if(!response.ok)throw Error('Unavailable');
  const value=await response.json();cache.set(date,value);return value;
 }
 async function loadDates(dates,requestToken,progressLabel='Loading reports'){
  const output=[];let cursor=0,complete=0;
  async function worker(){while(cursor<dates.length){const index=cursor++,date=dates[index];try{output[index]=await getReport(date)}catch{output[index]=null}complete++;if(requestToken===token&&(complete%100===0||complete===dates.length)){const status=document.getElementById('insight-status');if(status)status.textContent=`${progressLabel} · ${complete} of ${dates.length}`;}}}
  // Most dates resolve immediately from the compact history bundle; parallelize
  // the remaining archived report lookups so long-term views don't serialize them.
  await Promise.all(Array.from({length:Math.min(48,dates.length)},worker));return output.filter(Boolean);
 }
 function metrics(points,reports,requestedDays){
  const values=points.map(point=>point.h).filter(Number.isFinite),capacities=points.map(point=>point.capacity).filter(Number.isFinite);
  const mean=values.reduce((sum,value)=>sum+value,0)/values.length,min=values.reduce((value,item)=>Math.min(value,item),Infinity),below=values.filter(value=>value<3).length;
  const windowLabel=requestedDays==='all'?'available archive':requestedDays===1?'selected day':requestedDays+'-day window';
  const belowRate=below/values.length*100,belowLabel=belowRate>0&&belowRate<0.1?belowRate.toFixed(2):belowRate.toFixed(1);
  return `<div class="insight-metrics"><div class="insight-metric"><span>Mean H_COI</span><strong>${mean.toFixed(2)} s</strong><small>${values.length.toLocaleString()} hourly estimates</small></div><div class="insight-metric"><span>Minimum H_COI</span><strong>${min.toFixed(2)} s</strong><small>Lowest hourly estimate</small></div><div class="insight-metric"><span>Hours below 3 s</span><strong>${below.toLocaleString()}</strong><small>${belowLabel}% of covered hours</small></div><div class="insight-metric"><span>Mean online P_cap,curr</span><strong>${Math.round(capacities.reduce((a,b)=>a+b,0)/capacities.length).toLocaleString()} MW</strong><small>${reports.length} report${reports.length===1?'':'s'} in ${windowLabel}</small></div></div>`;
 }
 function chartScale(points){let min=Infinity,max=-Infinity;for(const point of points){if(point.h<min)min=point.h;if(point.h>max)max=point.h}return {min:Math.min(2.5,Math.floor((min-.25)*2)/2),max:Math.max(6,Math.ceil((max+.25)*2)/2)}}
 function stackedBuckets(points,limit){
  const count=Math.min(points.length,limit);
  if(count===points.length)return points.map((point,index)=>({point,index}));
  const categories=Object.keys(fuelColors),result=[];
  for(let bucket=0;bucket<count;bucket++){
   const start=Math.floor(bucket*points.length/count),end=Math.floor((bucket+1)*points.length/count),span=end-start;
   const fuelCounts={},fuelNumerator={};let plants=0;
   for(let index=start;index<end;index++){
    const point=points[index];plants+=point.plants;
    for(const category of categories){
     fuelCounts[category]=(fuelCounts[category]||0)+(point.fuelCounts[category]||0);
     fuelNumerator[category]=(fuelNumerator[category]||0)+(point.fuelNumerator[category]||0)/point.capacity;
    }
   }
   for(const category of categories){fuelCounts[category]/=span;fuelNumerator[category]/=span}
   result.push({index:bucket,point:{plants:plants/span,capacity:1,fuelCounts,fuelNumerator}});
  }
  return result;
 }
 function rolling24(points){
  const hour=60*60*1000,values=points.map(point=>({...point,stamp:pointStamp(point)})),result=Array(points.length).fill(null),window=[];let sum=0;
  values.forEach((point,index)=>{window.push({index,stamp:point.stamp,h:point.h});sum+=point.h;while(window.length&&point.stamp-window[0].stamp>=24*hour)sum-=window.shift().h;if(window.length===24&&point.stamp-window[0].stamp===23*hour)result[index]=sum/24});
  return result;
 }
 function rollingCalendar(points,days){
  const windowMs=days*24*60*60*1000,values=points.map(point=>({...point,stamp:pointStamp(point)})),result=Array(points.length).fill(null),counts=Array(points.length).fill(0);let start=0,sum=0;
  for(let end=0;end<values.length;end++){
   sum+=values[end].h;const cutoff=values[end].stamp-windowMs;
   while(start<=end&&values[start].stamp<=cutoff){sum-=values[start].h;start++}
   const sampleCount=end-start+1;
   // Use every estimate available in the trailing calendar window. Partial
   // archive coverage should affect the sample count, not break the curve.
   if(sampleCount&&values[end].stamp-values[0].stamp>=windowMs){result[end]=sum/sampleCount;counts[end]=sampleCount}
  }
  return {values:result,counts};
 }
 function chartSampleIndices(points,series,limit=1200){
  if(points.length<=limit)return points.map((_,index)=>index);
  const selected=new Set([0,points.length-1]),breaks=new Set(),metrics=[points.map(point=>point.h),...series.map(item=>item.values)];
  for(let index=1;index<points.length;index++){
   if(pointStamp(points[index])-pointStamp(points[index-1])>90*60*1000){breaks.add(index);selected.add(index)}
   for(const values of metrics){if((values[index]==null)!==(values[index-1]==null)){selected.add(index-1);selected.add(index)}}
  }
  const bucketCount=Math.max(1,Math.floor(limit/(metrics.length*2)));
  for(let bucket=0;bucket<bucketCount;bucket++){
   const start=Math.floor(bucket*points.length/bucketCount),end=Math.max(start+1,Math.floor((bucket+1)*points.length/bucketCount));
   for(const values of metrics){let minIndex=-1,maxIndex=-1,min=Infinity,max=-Infinity;for(let index=start;index<end;index++){const value=values[index];if(!Number.isFinite(value))continue;if(value<min){min=value;minIndex=index}if(value>max){max=value;maxIndex=index}}if(minIndex>=0)selected.add(minIndex);if(maxIndex>=0)selected.add(maxIndex)}
  }
  return [...selected].sort((a,b)=>a-b);
 }
 function chart(points,rolling=null,rollingLabel='24h rolling mean',chartClass='365d'){
  const W=1200,Ht=420,L=68,R=25,T=30,B=54,scale=chartScale(points),x=index=>L+index/Math.max(1,points.length-1)*(W-L-R),y=value=>Ht-B-(value-scale.min)/(scale.max-scale.min)*(Ht-T-B);
  let grid='';for(let value=scale.min;value<=scale.max+.001;value+=.5)grid+=`<line class="insight-grid" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-10}" y="${y(value)+4}" text-anchor="end">${value.toFixed(value%1?1:0)}</text>`;
  const tickCount=Math.min(6,points.length),ticks=Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,tickCount-1))).map(index=>`<text x="${x(index)}" y="${Ht-20}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(points[index].date===points[0].date?points[index].time:dateLabel(points[index].date))}</text>`).join('');
  const series=Array.isArray(rolling)&&rolling.length&&rolling[0]&&Object.hasOwn(rolling[0],'values')?rolling:rolling?[{id:'main',label:rollingLabel,values:rolling}]:[],plotIndices=chartSampleIndices(points,series),breaks=new Set();for(let index=1;index<points.length;index++)if(pointStamp(points[index])-pointStamp(points[index-1])>90*60*1000)breaks.add(index);
  const path=plotIndices.map(index=>({point:points[index],index})).reduce((parts,item)=>{const gap=breaks.has(item.index);parts.path+=(parts.active&&!gap?'L':'M')+x(item.index).toFixed(2)+' '+y(item.point.h).toFixed(2);parts.active=true;return parts},{path:'',active:false}).path,thresholdY=y(3);
  const rollingPaths=series.map(item=>plotIndices.map(index=>({value:item.values[index],index})).reduce((parts,entry)=>{if(entry.value==null){parts.active=false;return parts}parts.path+=(parts.active?'L':'M')+x(entry.index).toFixed(2)+' '+y(entry.value).toFixed(2);parts.active=true;return parts},{path:'',active:false}).path);
  const legend=series.length?`<div class="insight-series-legend" aria-label="Inertia chart series"><span><i class="insight-series-hourly"></i>Hourly H_COI</span>${series.map(item=>`<span><i class="insight-series-rolling insight-series-rolling-${esc(item.id)}"></i>${esc(item.label)}${chartClass==='long-term'?' · available hourly estimates':''}</span>`).join('')}</div>`:'';
  const rollingTitle=series.map(item=>item.label).join(' and ');
  return `<div class="insight-chart-wrap">${legend}<svg class="insight-chart${series.length?' insight-chart-'+chartClass:''}" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Hourly estimated center-of-inertia constant${series.length?', with '+esc(rollingTitle):''} and a reference line at 3 seconds"><title>Hourly H_COI · seconds${series.length?' and '+esc(rollingTitle):''}</title><rect class="insight-threshold-band" x="${L}" y="${thresholdY}" width="${W-L-R}" height="${Ht-B-thresholdY}"/>${grid}<line class="insight-threshold" x1="${L}" x2="${W-R}" y1="${thresholdY}" y2="${thresholdY}"/><text x="${W-R-4}" y="${thresholdY-8}" text-anchor="end">H = 3 s · stability reference</text><path class="insight-line" d="${path}"/>${series.map((item,index)=>`<path class="insight-rolling-line insight-rolling-line-${esc(item.id)}" d="${rollingPaths[index]}"/>`).join('')}<circle class="insight-focus" cx="${x(0)}" cy="${y(points[0].h)}" r="5" hidden/>${series.map(item=>`<circle class="insight-rolling-focus insight-rolling-focus-${esc(item.id)}" data-rolling-focus="${esc(item.id)}" r="5" hidden/>`).join('')}<rect class="insight-hit" x="${L}" y="${T}" width="${W-L-R}" height="${Ht-T-B}" data-count="${points.length}"/>${ticks}<text x="18" y="${(T+Ht-B)/2}" transform="rotate(-90 18 ${(T+Ht-B)/2})" text-anchor="middle">H_COI · seconds</text></svg><div class="insight-tooltip" role="tooltip" hidden></div></div>`;
 }
 function contributionChart(points){
  const W=1200,Ht=340,L=68,R=25,T=28,B=54,plotHeight=Ht-T-B,plotWidth=W-L-R,maxY=Math.max(6,Math.ceil(points.reduce((max,point)=>Math.max(max,point.h),0)*2)/2),step=maxY>12?2:maxY>8?1:.5,slot=plotWidth/Math.max(1,points.length),bins=stackedBuckets(points,Math.min(420,Math.floor(plotWidth))),binSlot=plotWidth/Math.max(1,bins.length),barWidth=Math.max(1,Math.min(24,binSlot*.72)),x=index=>L+(index+.5)*slot,binX=index=>L+(index+.5)*binSlot,y=value=>Ht-B-value/maxY*plotHeight;
  let grid='';for(let value=0;value<=maxY+.001;value+=step){grid+=`<line class="insight-grid" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-10}" y="${y(value)+4}" text-anchor="end">${value.toFixed(value%1?1:0)}</text>`}
  const thresholdY=y(3),tickCount=Math.min(6,points.length),ticks=Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,tickCount-1))).map(index=>`<text x="${x(index)}" y="${Ht-20}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(points[index].date===points[0].date?points[index].time:dateLabel(points[index].date))}</text>`).join('');
  const categories=Object.keys(fuelColors).filter(category=>points.some(point=>point.fuelCapacity[category])),bars=bins.map(({point,index})=>{let bottom=0;const rects=categories.map(category=>{const contribution=(point.fuelNumerator[category]||0)/(point.capacity||1);if(contribution<=0)return '';const height=contribution/maxY*plotHeight,top=y(bottom+contribution);bottom+=contribution;return `<rect x="${(binX(index)-barWidth/2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(height,.65).toFixed(2)}" fill="${fuelColors[category]}"/>`}).join('');return `<g class="insight-fuel-bar">${rects}</g>`}).join('');
  const legend=categories.map(category=>`<span class="insight-fuel-key"><i style="--fuel-color:${fuelColors[category]}"></i>${esc(category)}</span>`).join('');
  return `<div class="insight-fuel-section insight-contribution-section"><div class="insight-fuel-heading"><div><h3>Fuel contributions to inertia</h3><p>Each stack uses the assumptions above and is weighted by online present capacity; the total equals hourly H_COI.${points.length>bins.length?' Long-range bars average hourly values to screen width; hover shows the exact hour.':''}</p></div><span class="tag">SECONDS</span></div><div class="insight-chart-wrap insight-fuel-chart-wrap insight-contribution-chart-wrap"><svg class="insight-chart insight-contribution-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Hourly stacked contributions by fuel type summing to H_COI, with a reference line at 3 seconds"><title>Fuel contributions to H_COI · seconds</title><rect class="insight-threshold-band" x="${L}" y="${thresholdY}" width="${plotWidth}" height="${Ht-B-thresholdY}"/>${grid}${bars}<line class="insight-threshold" x1="${L}" x2="${W-R}" y1="${thresholdY}" y2="${thresholdY}"/><text x="${W-R-4}" y="${T+14}" text-anchor="end">H = 3 s · stability reference</text><rect class="insight-fuel-hit" x="${L}" y="${T}" width="${plotWidth}" height="${plotHeight}" data-count="${points.length}"/>${ticks}<text x="18" y="${(T+Ht-B)/2}" transform="rotate(-90 18 ${(T+Ht-B)/2})" text-anchor="middle">Contribution to H_COI · seconds</text></svg><div class="insight-tooltip insight-fuel-tooltip insight-contribution-tooltip" role="tooltip" hidden></div></div><div class="insight-fuel-legend" aria-label="Fuel type colors">${legend}</div></div>`;
 }
 function fuelChart(points){
  const W=1200,Ht=340,L=68,R=25,T=28,B=54,plotHeight=Ht-T-B,plotWidth=W-L-R,bins=stackedBuckets(points,Math.min(420,Math.floor(plotWidth)));let maxValue=1;for(const point of points)if(point.plants>maxValue)maxValue=point.plants;const step=Math.max(1,Math.ceil(maxValue/4)),maxY=Math.ceil(maxValue/step)*step,slot=plotWidth/Math.max(1,points.length),binSlot=plotWidth/Math.max(1,bins.length),barWidth=Math.max(1,Math.min(24,binSlot*.72)),x=index=>L+(index+.5)*slot,binX=index=>L+(index+.5)*binSlot;
  let grid='';for(let value=0;value<=maxY;value+=step){const y=Ht-B-value/maxY*plotHeight;grid+=`<line class="insight-grid" x1="${L}" x2="${W-R}" y1="${y}" y2="${y}"/><text x="${L-10}" y="${y+4}" text-anchor="end">${value}</text>`}
  const tickCount=Math.min(6,points.length),ticks=Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,tickCount-1))).map(index=>`<text x="${x(index)}" y="${Ht-20}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(points[index].date===points[0].date?points[index].time:dateLabel(points[index].date))}</text>`).join('');
  const categories=Object.keys(fuelColors).filter(category=>points.some(point=>point.fuelCounts[category])),bars=bins.map(({point,index})=>{let bottom=0;const rects=categories.map(category=>{const count=point.fuelCounts[category]||0;if(!count)return '';const height=count/maxY*plotHeight,y=Ht-B-(bottom+count)/maxY*plotHeight;bottom+=count;return `<rect x="${(binX(index)-barWidth/2).toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(height,.65).toFixed(2)}" fill="${fuelColors[category]}"/>`}).join('');return `<g class="insight-fuel-bar">${rects}</g>`}).join('');
  const legend=categories.map(category=>`<span class="insight-fuel-key"><i style="--fuel-color:${fuelColors[category]}"></i>${esc(category)}</span>`).join('');
  return `<div class="insight-fuel-section"><div class="insight-fuel-heading"><div><h3>Online plants by fuel type</h3><p>Hourly count of plants with non-zero reported generation · Bangladesh time${points.length>bins.length?'; long-range bars average hourly values to screen width, and hover shows the exact hour.':''}</p></div><span class="tag">PLANTS</span></div><div class="insight-chart-wrap insight-fuel-chart-wrap insight-count-chart-wrap"><svg class="insight-chart insight-fuel-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Hourly stacked count of online plants by fuel type"><title>Online plants by fuel type · hourly counts</title>${grid}${bars}<rect class="insight-fuel-hit" x="${L}" y="${T}" width="${plotWidth}" height="${plotHeight}" data-count="${points.length}"/>${ticks}<text x="18" y="${(T+Ht-B)/2}" transform="rotate(-90 18 ${(T+Ht-B)/2})" text-anchor="middle">Online plants</text></svg><div class="insight-tooltip insight-fuel-tooltip" role="tooltip" hidden></div></div><div class="insight-fuel-legend" aria-label="Fuel type colors">${legend}</div></div>`;
 }
 function table(points){return `<div class="insight-hourly" tabindex="0" role="region" aria-label="Hourly inertia estimates"><table><thead><tr><th>Date</th><th>Time · BST</th><th class="num">H_COI · s</th><th class="num">Online P_cap,curr · MW</th><th class="num">Online plants</th></tr></thead><tbody>${points.map(point=>`<tr><td>${esc(dateLabel(point.date))}</td><td>${esc(point.time)}</td><td class="num">${point.h.toFixed(3)}</td><td class="num">${Math.round(point.capacity).toLocaleString()}</td><td class="num">${point.plants}</td></tr>`).join('')}</tbody></table></div>`}
 function drawRange(points,reports,days){
  const output=document.getElementById('insight-output'),status=document.getElementById('insight-status');
  if(!points.length){output.innerHTML='<p class="empty">No hourly plant data with usable fuel and present-capacity fields is available for this range.</p>';status.textContent='No usable inertia estimates.';return}
  chartData=points;chartReports=reports;chartDays=days;chartClass=days==='all'?'long-term':'365d';chartLabel='24h rolling mean';chartRolling=days==='all'?[{id:'7d',label:'7d rolling mean',...rollingCalendar(points,7)}]:days===365?rolling24(points):null;visibleExtent=[0,points.length];
  output.innerHTML=metrics(points,reports,days)+'<div class="insight-zoom-toolbar"><span>Tap or hover a plot to inspect an hour; drag horizontally to zoom all three charts.</span><button id="insight-reset-zoom" type="button" disabled>Reset zoom</button></div><div id="insight-linked-charts"></div>';
  renderChartView();
 }
 function renderChartView(){
  if(!chartData.length)return;
  const [start,end]=visibleExtent,points=chartData.slice(start,end),rollingSeries=Array.isArray(chartRolling)&&chartRolling.length&&chartRolling[0]&&typeof chartRolling[0]==='object'?chartRolling:chartRolling?[{id:'main',label:chartLabel,values:chartRolling}]:null,rolling=rollingSeries?.map(item=>({...item,values:item.values.slice(start,end),counts:item.counts?.slice(start,end)}))||null,chartOutput=document.getElementById('insight-linked-charts'),status=document.getElementById('insight-status'),reset=document.getElementById('insight-reset-zoom');
  if(!chartOutput)return;
  status.textContent='Drawing inertia plot…';const inertiaPlot=chart(points,rolling,chartLabel,chartClass);status.textContent='Drawing fuel contribution plot…';const contributionPlot=contributionChart(points);status.textContent='Drawing online plant plot…';const plantPlot=fuelChart(points);status.textContent='Rendering plots…';chartOutput.innerHTML=inertiaPlot+contributionPlot+plantPlot+(chartDays===1?table(chartData):'');
  const zoomed=start>0||end<chartData.length;reset.disabled=!zoomed;
  const first=chartData[start],last=chartData[end-1];status.textContent=`${zoomed?'Zoomed coverage':'Coverage'} · ${dateLabel(first.date)} ${first.time} to ${dateLabel(last.date)} ${last.time} BST · ${chartReports.length} available report${chartReports.length===1?'':'s'}`;
  bindSynchronizedZoom();bindTooltip(points,rolling,chartLabel);bindContributionTooltip(points);bindFuelTooltip(points);
  reset.onclick=()=>{visibleExtent=[0,chartData.length];renderChartView()};
 }
 function bindSynchronizedZoom(){
  document.querySelectorAll('#insight-linked-charts svg').forEach(svg=>{
   const hit=svg.querySelector('.insight-hit,.insight-fuel-hit');if(!hit)return;
   let startX=null,selection=null;
   const viewX=event=>{const rect=svg.getBoundingClientRect();return Math.max(68,Math.min(1175,(event.clientX-rect.left)/rect.width*1200))};
   hit.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();startX=viewX(event);zoomDragging=true;selection=document.createElementNS('http://www.w3.org/2000/svg','rect');selection.setAttribute('class','insight-zoom-selection');selection.setAttribute('x',startX);selection.setAttribute('y',svg.classList.contains('insight-fuel-chart')||svg.classList.contains('insight-contribution-chart')?28:30);selection.setAttribute('height',svg.classList.contains('insight-fuel-chart')||svg.classList.contains('insight-contribution-chart')?258:336);selection.setAttribute('width','0');svg.append(selection);hit.setPointerCapture(event.pointerId)});
   hit.addEventListener('pointermove',event=>{if(startX==null||!selection)return;const current=viewX(event);selection.setAttribute('x',Math.min(startX,current));selection.setAttribute('width',Math.abs(current-startX))});
   hit.addEventListener('pointerup',event=>{if(startX==null)return;const finish=viewX(event),left=Math.min(startX,finish),right=Math.max(startX,finish),previous=visibleExtent.slice();if(selection)selection.remove();selection=null;startX=null;zoomDragging=false;if(right-left<18)return;const count=previous[1]-previous[0],first=Math.floor((left-68)/(1175-68)*count),last=Math.ceil((right-68)/(1175-68)*count),nextStart=Math.max(previous[0],previous[0]+first),nextEnd=Math.min(previous[1],previous[0]+last);if(nextEnd-nextStart>=2){visibleExtent=[nextStart,nextEnd];renderChartView()}});
   hit.addEventListener('pointercancel',()=>{if(selection)selection.remove();selection=null;startX=null;zoomDragging=false});
  });
 }
 function bindTooltip(points,rolling=null,rollingLabel='24h rolling mean'){
  const series=Array.isArray(rolling)&&rolling.length&&rolling[0]&&Object.hasOwn(rolling[0],'values')?rolling:rolling?[{id:'main',label:rollingLabel,values:rolling}]:[],wrap=document.querySelector('.insight-chart-wrap'),svg=wrap?.querySelector('svg'),hit=wrap?.querySelector('.insight-hit'),focus=wrap?.querySelector('.insight-focus'),tip=wrap?.querySelector('.insight-tooltip');if(!hit)return;
  const show=event=>{if(zoomDragging)return;const rect=svg.getBoundingClientRect(),ratio=(event.clientX-rect.left)/rect.width,index=Math.max(0,Math.min(points.length-1,Math.round((ratio-.0567)/.9225*(points.length-1)))),point=points[index],scale=chartScale(points),viewX=68+index/Math.max(1,points.length-1)*(1200-68-25),viewY=420-54-(point.h-scale.min)/(scale.max-scale.min)*(420-30-54);focus.hidden=false;focus.setAttribute('cx',viewX);focus.setAttribute('cy',viewY);series.forEach(item=>{const marker=wrap.querySelector(`[data-rolling-focus="${item.id}"]`),value=item.values[index];if(marker&&value!=null){marker.hidden=false;marker.setAttribute('cx',viewX);marker.setAttribute('cy',420-54-(value-scale.min)/(scale.max-scale.min)*(420-30-54))}else if(marker)marker.hidden=true});tip.hidden=false;tip.innerHTML=`<strong>${esc(dateLabel(point.date))} · ${esc(point.time)} BST</strong><span>H_COI: ${point.h.toFixed(3)} s</span>${series.map(item=>{const value=item.values[index],count=item.counts?.[index];return `<span>${esc(item.label)}: ${value==null?'window not yet covered':value.toFixed(3)+' s'+(count?` · ${count} hourly estimates`: '')}</span>`}).join('')}<span>Online P_cap,curr: ${Math.round(point.capacity).toLocaleString()} MW</span><span>Online plants: ${point.plants}</span>`;tip.style.left=Math.min(wrap.clientWidth-tip.offsetWidth-8,Math.max(8,event.clientX-wrap.getBoundingClientRect().left+12))+'px';tip.style.top=Math.max(8,event.clientY-wrap.getBoundingClientRect().top-tip.offsetHeight-12)+'px'};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerup',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')show(event)});hit.addEventListener('pointerleave',event=>{if(event.pointerType==='touch')return;focus.hidden=true;series.forEach(item=>{const marker=wrap.querySelector(`[data-rolling-focus="${item.id}"]`);if(marker)marker.hidden=true});tip.hidden=true});
 }
 function bindFuelTooltip(points){
  const wrap=document.querySelector('.insight-count-chart-wrap'),svg=wrap?.querySelector('svg'),hit=wrap?.querySelector('.insight-fuel-hit'),tip=wrap?.querySelector('.insight-fuel-tooltip');if(!hit)return;
  const show=event=>{if(zoomDragging)return;const rect=svg.getBoundingClientRect(),ratio=(event.clientX-rect.left)/rect.width,index=Math.max(0,Math.min(points.length-1,Math.floor((ratio-.0567)/.9225*points.length))),point=points[index],ranked=Object.entries(point.fuelCounts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));tip.hidden=false;tip.innerHTML=`<strong>${esc(dateLabel(point.date))} · ${esc(point.time)} BST</strong><span class="insight-fuel-tip-total">${point.plants} online plants</span>${ranked.map(([fuel,count])=>`<span class="insight-fuel-tip-row"><i style="--fuel-color:${fuelColors[fuel]}"></i>${esc(fuel)}<b>${count}</b></span>`).join('')}`;tip.style.left=Math.min(wrap.clientWidth-tip.offsetWidth-8,Math.max(8,event.clientX-wrap.getBoundingClientRect().left+12))+'px';tip.style.top=Math.max(8,event.clientY-wrap.getBoundingClientRect().top-tip.offsetHeight-12)+'px'};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerup',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')show(event)});hit.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')tip.hidden=true});
 }
 function bindContributionTooltip(points){
  const wrap=document.querySelector('.insight-contribution-chart-wrap'),svg=wrap?.querySelector('svg'),hit=wrap?.querySelector('.insight-fuel-hit'),tip=wrap?.querySelector('.insight-contribution-tooltip');if(!hit)return;
  const show=event=>{if(zoomDragging)return;const rect=svg.getBoundingClientRect(),ratio=(event.clientX-rect.left)/rect.width,index=Math.max(0,Math.min(points.length-1,Math.floor((ratio-.0567)/.9225*points.length))),point=points[index],ranked=Object.entries(point.fuelCounts).map(([fuel])=>({fuel,capacity:point.fuelCapacity[fuel]||0,weighted:Object.hasOwn(point.fuelCapacity,fuel),contribution:(point.fuelNumerator[fuel]||0)/point.capacity})).sort((a,b)=>b.contribution-a.contribution||b.capacity-a.capacity||a.fuel.localeCompare(b.fuel));tip.hidden=false;tip.innerHTML=`<strong>${esc(dateLabel(point.date))} · ${esc(point.time)} BST</strong><span class="insight-fuel-tip-total">H_COI ${point.h.toFixed(3)} s · ${Math.round(point.capacity).toLocaleString()} MW weighted capacity</span>${ranked.map(item=>`<span class="insight-fuel-tip-row"><i style="--fuel-color:${fuelColors[item.fuel]}"></i><span>${esc(item.fuel)}</span><b>${item.weighted?item.contribution.toFixed(3)+' s · '+Math.round(item.capacity).toLocaleString()+' MW':'Excluded'}</b></span>`).join('')}`;tip.style.left=Math.min(wrap.clientWidth-tip.offsetWidth-8,Math.max(8,event.clientX-wrap.getBoundingClientRect().left+12))+'px';tip.style.top=Math.max(8,event.clientY-wrap.getBoundingClientRect().top-tip.offsetHeight-12)+'px'};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerup',event=>{if(event.pointerType==='touch'||event.pointerType==='pen')show(event)});hit.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')tip.hidden=true});
 }
 function scenarioBar(label,snapshot){
  const total=snapshot.capacity||1,categories=Object.entries(snapshot.fuelCapacity).filter(([,value])=>value>0).sort((a,b)=>b[1]-a[1]);
  return `<div class="insight-scenario-bar-row"><div><strong>${esc(label)}</strong><span>${Math.round(snapshot.capacity).toLocaleString()} MW capacity proxy</span></div><div class="insight-scenario-bar" aria-label="${esc(label)} fuel capacity composition">${categories.map(([category,value])=>`<i title="${esc(category)} · ${Math.round(value).toLocaleString()} MW" style="--scenario-color:${fuelColors[category]||fuelColors.Other};width:${value/total*100}%"></i>`).join('')}</div></div>`;
 }
 function readScenarioControls(){
  const value=id=>Number(document.getElementById(id)?.value),condition=document.querySelector('input[name="insight-condition"]:checked')?.value||'actual';
  scenarioState={...scenarioState,hour:document.getElementById('insight-scenario-hour')?.value||scenarioState.hour,condition,highRenewableMw:value('insight-renewable-mw'),solarSharePct:value('insight-solar-share'),eveningDemandIncreaseMw:value('insight-evening-demand'),eveningThermalMw:value('insight-evening-thermal'),eveningGasSharePct:value('insight-evening-gas-share'),largestUnitTrip:Boolean(document.getElementById('insight-trip-largest')?.checked),importLoss:Boolean(document.getElementById('insight-import-loss')?.checked),importTarget:document.getElementById('insight-import-target')?.value||'largest'};
  return scenarioState;
 }
 function syncScenarioControls(){
  const condition=scenarioState.condition||'actual',radio=document.querySelector(`input[name="insight-condition"][value="${condition}"]`);if(radio)radio.checked=true;
  const assign=(id,key,property='value')=>{const element=document.getElementById(id);if(element)element[property]=scenarioState[key]};
  assign('insight-scenario-hour','hour');assign('insight-renewable-mw','highRenewableMw');assign('insight-solar-share','solarSharePct');assign('insight-evening-demand','eveningDemandIncreaseMw');assign('insight-evening-thermal','eveningThermalMw');assign('insight-evening-gas-share','eveningGasSharePct');assign('insight-trip-largest','largestUnitTrip','checked');assign('insight-import-loss','importLoss','checked');assign('insight-import-target','importTarget');
  document.querySelectorAll('[data-condition-panel]').forEach(panel=>panel.hidden=panel.dataset.conditionPanel!==condition);const target=document.getElementById('insight-import-target');if(target)target.disabled=!scenarioState.importLoss;
 }
 function renderScenarioResults(){
  const output=document.getElementById('insight-scenario-results');if(!output||!report)return;const result=simulateScenario(report,scenarioState.hour,scenarioState),actualH=result.baseline.h,scenarioH=result.scenario.h,delta=Number.isFinite(actualH)&&Number.isFinite(scenarioH)?scenarioH-actualH:null,conditionLabel={actual:'Actual selected hour','high-renewable':'High renewable afternoon','evening-peak':'Evening peak'}[scenarioState.condition]||'Scenario';
  if(!Number.isFinite(actualH)){output.innerHTML='<p class="empty">Plant-level hourly data is unavailable for this scenario hour.</p>';return}
  const details=[...result.notes,...result.events];if(scenarioState.condition==='evening-peak')details.push(`Implied supply-margin change: ${result.balanceDeltaMw>=0?'+':''}${Math.round(result.balanceDeltaMw).toLocaleString()} MW before any contingency.`);if(!details.length)details.push('No operating-condition adjustment or contingency is active.');
  const contingencyCount=Number(scenarioState.largestUnitTrip)+Number(scenarioState.importLoss),contingencyLabel=contingencyCount?`${contingencyCount} active contingenc${contingencyCount===1?'y':'ies'}`:'No contingency selected';
  output.innerHTML=`<div class="insight-scenario-summary"><div><span>ACTUAL H_COI</span><strong>${actualH.toFixed(2)} s</strong><small>${scenarioState.hour} BST reported state</small></div><div><span>SCENARIO H_COI</span><strong>${scenarioH.toFixed(2)} s</strong><small>${delta===null?'Unavailable':`${delta>=0?'+':''}${delta.toFixed(2)} s versus actual`}</small></div><div><span>POWER IMBALANCE</span><strong>${Math.round(result.disturbanceMw).toLocaleString()} MW</strong><small>${contingencyLabel}</small></div><div><span>INITIAL |ROCOF|</span><strong>${result.disturbanceMw?result.rocofHzS.toFixed(2):'—'}${result.disturbanceMw?' Hz/s':''}</strong><small>50 Hz · inertia-only estimate</small></div></div><div class="insight-scenario-comparison"><div class="insight-scenario-bars"><h3>Capacity composition</h3>${scenarioBar('Actual',result.baseline)}${scenarioBar('Scenario',result.scenario)}<div class="insight-scenario-legend">${[...new Set([...Object.keys(result.baseline.fuelCapacity),...Object.keys(result.scenario.fuelCapacity)])].map(category=>`<span><i style="--scenario-color:${fuelColors[category]||fuelColors.Other}"></i>${esc(category)}</span>`).join('')}</div></div><div class="insight-scenario-detail"><h3>${esc(conditionLabel)} · ${esc(scenarioState.hour)} BST</h3><ul>${details.map(item=>`<li>${esc(item)}</li>`).join('')}</ul><p>Post-event stored-energy proxy: <strong>${Math.round(result.scenario.numerator).toLocaleString()} MW·s</strong> · online capacity proxy: <strong>${Math.round(result.scenario.capacity).toLocaleString()} MW</strong>.</p></div></div>`;
 }
 function applyScenarioPreset(name){
  scenarioState={...scenarioDefaults,hour:scenarioState.hour};const hours=scenarioHours(report);
  if(name==='largest')scenarioState.largestUnitTrip=true;
  else if(name==='import')scenarioState.importLoss=true;
  else if(name==='renewable'){scenarioState.condition='high-renewable';if(hours.includes('14:00'))scenarioState.hour='14:00'}
  else if(name==='evening'){scenarioState.condition='evening-peak';if(hours.includes('19:00'))scenarioState.hour='19:00'}
  syncScenarioControls();renderScenarioResults();
 }
 function bindScenarioControls(){
  syncScenarioControls();document.querySelectorAll('[data-scenario-preset]').forEach(button=>button.addEventListener('click',()=>applyScenarioPreset(button.dataset.scenarioPreset)));document.getElementById('insight-scenario-reset')?.addEventListener('click',()=>applyScenarioPreset('reset'));
  document.querySelectorAll('#insight-scenario-hour,input[name="insight-condition"],#insight-trip-largest,#insight-import-loss,#insight-import-target,.insight-condition-parameters input').forEach(control=>control.addEventListener('input',()=>{readScenarioControls();syncScenarioControls();renderScenarioResults()}));renderScenarioResults();
 }
 async function update(){
  const output=document.getElementById('insight-output'),status=document.getElementById('insight-status');if(!output||!report)return;await ensureHistory();const requestToken=++token,entry=ranges.find(([key])=>key===selected),days=entry[2],dates=availableDates(days);status.textContent=dates.length>1?`Loading ${dates.length} available operating-day reports…`:'Calculating selected operating day…';output.setAttribute('aria-busy','true');
  let reports;
  if(days==='all'){
   const currentDates=window.BEGD_STATIC_DATA?.reports_by_operating_date||{},historyDates=dates.filter(date=>window.BEGD_INSIGHT_HISTORY?.reports?.[date]&&!Object.hasOwn(currentDates,date)),newerDates=dates.filter(date=>!historyDates.includes(date));
   const olderReports=await loadDates(historyDates,requestToken,'Preparing Long Term history');if(requestToken!==token)return;
   const olderPoints=olderReports.flatMap(hourly).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
   if(newerDates.length){drawRange(olderPoints,olderReports,days);status.textContent=`Long Term preview · ${olderReports.length} older reports loaded; loading ${newerDates.length} newer reports…`}
   const newerReports=await loadDates(newerDates,requestToken,'Loading newer reports');if(requestToken!==token)return;reports=olderReports.concat(newerReports);
  }else reports=days===1?[report]:await loadDates(dates,requestToken);
  if(requestToken!==token)return;const points=reports.flatMap(hourly).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));output.removeAttribute('aria-busy');drawRange(points,reports,days);
 }
 function recalculateFromInput(input,delay=0){if(!input||input.value.trim()===''||!setInertia(input.dataset.inertiaKey,input.value)){input?.setAttribute('aria-invalid','true');return}input.removeAttribute('aria-invalid');clearTimeout(assumptionTimer);assumptionTimer=setTimeout(()=>{const status=document.getElementById('insight-status');if(status)status.textContent='Recalculating with updated inertia assumptions…';renderScenarioResults();update()},delay)}
 function mount(source){report=source;cache.set(source.date,source);bindScenarioControls();document.querySelectorAll('[data-insight-range]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.insightRange;document.querySelectorAll('[data-insight-range]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));update()}));document.querySelectorAll('.insight-assumption-stepper input').forEach(input=>{input.addEventListener('input',()=>recalculateFromInput(input,250));input.addEventListener('change',()=>recalculateFromInput(input))});document.querySelectorAll('[data-inertia-delta]').forEach(button=>button.addEventListener('click',()=>{const input=document.querySelector(`.insight-assumption-stepper input[data-inertia-key="${button.dataset.inertiaKey}"]`),next=Math.max(0,Number((H[button.dataset.inertiaKey]+Number(button.dataset.inertiaDelta)).toFixed(10)));input.value=assumptionValue(next);recalculateFromInput(input);input.focus({preventScroll:true})}));update()}
 function markupForHistory(source){return markup(source).replace('in GenLog.','in GenLog or the legacy Generation sheet.').replace('P2 and GenLog sheets.','P2, GenLog, and legacy Generation sheets.')}
 window.BEGDInsight={markup:markupForHistory,mount,hourly,inertiaFor,rolling24,rollingCalendar,setInertia,simulateScenario,scenarioHours,assumptions:()=>({...H})};
})();
