(function(){
 const ranges=[['day','Day',1],['7d','7d',7],['30d','30d',30],['60d','60d',60],['365d','365d',365],['all','Long Term','all']];
 const H={solar:0,wind:0,hfo:.7,hsd:.7,'gas/hfo':5.5,hydro:3.5,coal:4.5,gas:5.5,'gas/hsd':5.5};
 const fuelColors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Wind:'#76b7b2','Dual fuel':'#9c6eaf',Other:'#526a7d'};
 let selected='day',report=null,token=0,cache=new Map(),historyLoad=null,chartData=[],chartReports=[],chartDays=1,chartRolling=null,chartLabel='24h rolling mean',chartClass='365d',visibleExtent=null,zoomDragging=false;
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fuelKey=value=>{const parts=String(value||'').trim().toLowerCase().split('/').map(part=>part.trim());if(parts.length===2&&parts.includes('gas'))return 'gas/'+parts.find(part=>part!=='gas');return parts[0]};
 const fuelCategory=value=>{const label=String(value||'').trim();if(label.includes('/'))return 'Dual fuel';return Object.hasOwn(fuelColors,label)?label:'Other'};
 const inertiaFor=unit=>H[fuelKey(unit.fuel)];
 function hourly(source){
  if(Array.isArray(source.insight_hourly)){
   const categories=window.BEGD_INSIGHT_HISTORY?.categories||[];
   return source.insight_hourly.map(row=>{
    const [time,plants,h,capacity,counts,capacities]=row,fuelCounts={},fuelCapacity={},fuelNumerator={};
    categories.forEach((category,index)=>{
     const count=Number(counts[index])||0,cap=Number(capacities[index])||0;
     if(count)fuelCounts[category]=count;
     if(cap){fuelCapacity[category]=cap;const inertia=category==='Dual fuel'?5.5:H[fuelKey(category)];if(Number.isFinite(inertia))fuelNumerator[category]=cap*inertia}
    });
    return {date:source.date,time,h:Number(h),capacity:Number(capacity),plants:Number(plants),fuelCounts,fuelCapacity,fuelNumerator};
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
  return `<section class="insight-shell" aria-labelledby="insight-heading"><section class="panel full insight-intro"><div><div class="section-number">SYSTEM STABILITY / ESTIMATED INERTIA</div><h2 id="insight-heading">Hourly center-of-inertia constant</h2><p class="insight-definition">An estimate of the system inertia constant for each hour, using generating units with non-zero reported output in GenLog. Each online unit is weighted by its reported present capacity (<em>P</em><sub>cap,curr</sub>).</p><p class="insight-formula"><em>H</em><sub>COI</sub> = Σ(<em>P</em><sub>cap,curr,i</sub> × <em>H</em><sub>i</sub>) / Σ<em>P</em><sub>cap,curr,i</sub></p></div><aside class="insight-assumptions"><h3>Assumed inertia constants</h3><dl><dt>Solar · wind</dt><dd>0 s</dd><dt>HFO · HSD</dt><dd>0.7 s</dd><dt>Hydro</dt><dd>3.5 s</dd><dt>Coal</dt><dd>4.5 s</dd><dt>Gas · gas/HSD · gas/HFO</dt><dd>5.5 s</dd></dl></aside></section><section class="panel full"><div class="panel-head"><div><h2>Estimated system inertia</h2><p>Hourly capacity-weighted <em>H</em><sub>COI</sub> · Bangladesh time</p></div><span class="tag">SECONDS</span></div><div class="insight-range" role="group" aria-label="Inertia history range"><span>Range</span>${ranges.map(([key,label])=>`<button type="button" data-insight-range="${key}" aria-pressed="${key===selected}">${label}</button>`).join('')}</div><p id="insight-status" class="insight-status" role="status" aria-live="polite"></p><div id="insight-output"></div></section><section class="panel full insight-method"><h2>Method and limitations</h2><p>The standard center-of-inertia expression is normally weighted by each machine’s MVA rating. The PGCB daily operational report does not provide MVA ratings, so this dashboard uses reported present MW capacity (<em>P</em><sub>cap,curr</sub>) as a proxy. It is therefore an operational estimate, not a measured inertia value.</p><ul><li>A plant is treated as online only when its reported hourly generation is greater than zero. Imports are not assigned inertia.</li><li>Units with an unavailable fuel classification or unavailable present capacity are excluded. Dual-fuel labels are treated independently of order: HFO/Gas uses the gas/HFO assumption, and HSD/Gas uses gas/HSD.</li><li>The dashed <em>H</em> = 3 s line is shown as a minimum stability reference for interpretation, following the low-inertia stability literature supplied for this view. It is not a universal operating limit for every grid condition.</li></ul><p>Background: <a href="https://ieeexplore.ieee.org/abstract/document/9542998" target="_blank" rel="noopener noreferrer">IEEE paper 9542998</a> · <a href="https://www.researchgate.net/publication/259441097_Impact_of_Low_Rotational_Inertia_on_Power_System_Stability_and_Operation" target="_blank" rel="noopener noreferrer">Impact of Low Rotational Inertia on Power System Stability and Operation</a>. Operational data: selected PGCB/NLDC daily reports, P2 and GenLog sheets.</p></section></section>`;
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
 function chart(points,rolling=null,rollingLabel='24h rolling mean',chartClass='365d'){
  const W=1200,Ht=420,L=68,R=25,T=30,B=54,scale=chartScale(points),x=index=>L+index/Math.max(1,points.length-1)*(W-L-R),y=value=>Ht-B-(value-scale.min)/(scale.max-scale.min)*(Ht-T-B);
  let grid='';for(let value=scale.min;value<=scale.max+.001;value+=.5)grid+=`<line class="insight-grid" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-10}" y="${y(value)+4}" text-anchor="end">${value.toFixed(value%1?1:0)}</text>`;
  const tickCount=Math.min(6,points.length),ticks=Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,tickCount-1))).map(index=>`<text x="${x(index)}" y="${Ht-20}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(points[index].date===points[0].date?points[index].time:dateLabel(points[index].date))}</text>`).join('');
  const series=Array.isArray(rolling)&&rolling.length&&rolling[0]&&Object.hasOwn(rolling[0],'values')?rolling:rolling?[{id:'main',label:rollingLabel,values:rolling}]:[];
  const path=points.map((point,index)=>({point,index,stamp:pointStamp(point)})).reduce((parts,item)=>{const gap=parts.previous!=null&&item.stamp-parts.previous>90*60*1000;parts.path+=(parts.active&&!gap?'L':'M')+x(item.index).toFixed(2)+' '+y(item.point.h).toFixed(2);parts.active=true;parts.previous=item.stamp;return parts},{path:'',active:false,previous:null}).path,thresholdY=y(3);
  const rollingPaths=series.map(item=>item.values.map((value,index)=>({value,index})).reduce((parts,entry)=>{if(entry.value==null){parts.active=false;return parts}parts.path+=(parts.active?'L':'M')+x(entry.index).toFixed(2)+' '+y(entry.value).toFixed(2);parts.active=true;return parts},{path:'',active:false}).path);
  const legend=series.length?`<div class="insight-series-legend" aria-label="Inertia chart series"><span><i class="insight-series-hourly"></i>Hourly H_COI</span>${series.map(item=>`<span><i class="insight-series-rolling insight-series-rolling-${esc(item.id)}"></i>${esc(item.label)}${chartClass==='long-term'?' · available hourly estimates':''}</span>`).join('')}</div>`:'';
  const rollingTitle=series.map(item=>item.label).join(' and ');
  return `<div class="insight-chart-wrap">${legend}<svg class="insight-chart${series.length?' insight-chart-'+chartClass:''}" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Hourly estimated center-of-inertia constant${series.length?', with '+esc(rollingTitle):''} and a reference line at 3 seconds"><title>Hourly H_COI · seconds${series.length?' and '+esc(rollingTitle):''}</title><rect class="insight-threshold-band" x="${L}" y="${thresholdY}" width="${W-L-R}" height="${Ht-B-thresholdY}"/>${grid}<line class="insight-threshold" x1="${L}" x2="${W-R}" y1="${thresholdY}" y2="${thresholdY}"/><text x="${W-R-4}" y="${thresholdY-8}" text-anchor="end">H = 3 s · stability reference</text><path class="insight-line" d="${path}"/>${series.map((item,index)=>`<path class="insight-rolling-line insight-rolling-line-${esc(item.id)}" d="${rollingPaths[index]}"/>`).join('')}<circle class="insight-focus" cx="${x(0)}" cy="${y(points[0].h)}" r="5" hidden/>${series.map(item=>`<circle class="insight-rolling-focus insight-rolling-focus-${esc(item.id)}" data-rolling-focus="${esc(item.id)}" r="5" hidden/>`).join('')}<rect class="insight-hit" x="${L}" y="${T}" width="${W-L-R}" height="${Ht-T-B}" data-count="${points.length}"/>${ticks}<text x="18" y="${(T+Ht-B)/2}" transform="rotate(-90 18 ${(T+Ht-B)/2})" text-anchor="middle">H_COI · seconds</text></svg><div class="insight-tooltip" role="tooltip" hidden></div></div>`;
 }
 function contributionChart(points){
  const W=1200,Ht=340,L=68,R=25,T=28,B=54,plotHeight=Ht-T-B,plotWidth=W-L-R,maxY=6,step=.5,slot=plotWidth/Math.max(1,points.length),bins=stackedBuckets(points,Math.floor(plotWidth)),binSlot=plotWidth/Math.max(1,bins.length),barWidth=Math.max(1,Math.min(24,binSlot*.72)),x=index=>L+(index+.5)*slot,binX=index=>L+(index+.5)*binSlot,y=value=>Ht-B-value/maxY*plotHeight;
  let grid='';for(let value=0;value<=maxY+.001;value+=step){grid+=`<line class="insight-grid" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-10}" y="${y(value)+4}" text-anchor="end">${value.toFixed(value%1?1:0)}</text>`}
  const thresholdY=y(3),tickCount=Math.min(6,points.length),ticks=Array.from({length:tickCount},(_,i)=>Math.round(i*(points.length-1)/Math.max(1,tickCount-1))).map(index=>`<text x="${x(index)}" y="${Ht-20}" text-anchor="${index===0?'start':index===points.length-1?'end':'middle'}">${esc(points[index].date===points[0].date?points[index].time:dateLabel(points[index].date))}</text>`).join('');
  const categories=Object.keys(fuelColors).filter(category=>points.some(point=>point.fuelCapacity[category])),bars=bins.map(({point,index})=>{let bottom=0;const rects=categories.map(category=>{const contribution=point.fuelNumerator[category]||0;if(contribution<=0)return '';const height=contribution/maxY*plotHeight,top=y(bottom+contribution);bottom+=contribution;return `<rect x="${(binX(index)-barWidth/2).toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${Math.max(height,.65).toFixed(2)}" fill="${fuelColors[category]}"/>`}).join('');return `<g class="insight-fuel-bar">${rects}</g>`}).join('');
  const legend=categories.map(category=>`<span class="insight-fuel-key"><i style="--fuel-color:${fuelColors[category]}"></i>${esc(category)}</span>`).join('');
  return `<div class="insight-fuel-section insight-contribution-section"><div class="insight-fuel-heading"><div><h3>Fuel contributions to inertia</h3><p>Each stack is weighted by online present capacity; the total equals hourly H_COI. Solar and wind add capacity to the denominator but zero inertia contribution.${points.length>bins.length?' Long-range bars average hourly values to screen width; hover shows the exact hour.':''}</p></div><span class="tag">SECONDS</span></div><div class="insight-chart-wrap insight-fuel-chart-wrap insight-contribution-chart-wrap"><svg class="insight-chart insight-contribution-chart" viewBox="0 0 ${W} ${Ht}" role="img" aria-label="Hourly stacked contributions by fuel type summing to H_COI, with a reference line at 3 seconds"><title>Fuel contributions to H_COI · seconds</title><rect class="insight-threshold-band" x="${L}" y="${thresholdY}" width="${plotWidth}" height="${Ht-B-thresholdY}"/>${grid}${bars}<line class="insight-threshold" x1="${L}" x2="${W-R}" y1="${thresholdY}" y2="${thresholdY}"/><text x="${W-R-4}" y="${T+14}" text-anchor="end">H = 3 s · stability reference</text><rect class="insight-fuel-hit" x="${L}" y="${T}" width="${plotWidth}" height="${plotHeight}" data-count="${points.length}"/>${ticks}<text x="18" y="${(T+Ht-B)/2}" transform="rotate(-90 18 ${(T+Ht-B)/2})" text-anchor="middle">Contribution to H_COI · seconds</text></svg><div class="insight-tooltip insight-fuel-tooltip insight-contribution-tooltip" role="tooltip" hidden></div></div><div class="insight-fuel-legend" aria-label="Fuel type colors">${legend}</div></div>`;
 }
 function fuelChart(points){
  const W=1200,Ht=340,L=68,R=25,T=28,B=54,plotHeight=Ht-T-B,plotWidth=W-L-R,bins=stackedBuckets(points,Math.floor(plotWidth));let maxValue=1;for(const point of points)if(point.plants>maxValue)maxValue=point.plants;const step=Math.max(1,Math.ceil(maxValue/4)),maxY=Math.ceil(maxValue/step)*step,slot=plotWidth/Math.max(1,points.length),binSlot=plotWidth/Math.max(1,bins.length),barWidth=Math.max(1,Math.min(24,binSlot*.72)),x=index=>L+(index+.5)*slot,binX=index=>L+(index+.5)*binSlot;
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
  output.innerHTML=metrics(points,reports,days)+'<div class="insight-zoom-toolbar"><span>Drag horizontally in any plot to zoom all three linked charts.</span><button id="insight-reset-zoom" type="button" disabled>Reset zoom</button></div><div id="insight-linked-charts"></div>';
  renderChartView();
 }
 function renderChartView(){
  if(!chartData.length)return;
  const [start,end]=visibleExtent,points=chartData.slice(start,end),rolling=chartRolling?.map(item=>({...item,values:item.values.slice(start,end),counts:item.counts?.slice(start,end)}))||null,chartOutput=document.getElementById('insight-linked-charts'),status=document.getElementById('insight-status'),reset=document.getElementById('insight-reset-zoom');
  if(!chartOutput)return;
  chartOutput.innerHTML=chart(points,rolling,chartLabel,chartClass)+contributionChart(points)+fuelChart(points)+(chartDays===1?table(chartData):'');
  const zoomed=start>0||end<chartData.length;reset.disabled=!zoomed;
  const first=chartData[start],last=chartData[end-1];status.textContent=`${zoomed?'Zoomed coverage':'Coverage'} · ${dateLabel(first.date)} ${first.time} to ${dateLabel(last.date)} ${last.time} BST · ${chartReports.length} available report${chartReports.length===1?'':'s'}`;
  bindTooltip(points,rolling,chartLabel);bindContributionTooltip(points);bindFuelTooltip(points);bindSynchronizedZoom();
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
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerleave',()=>{focus.hidden=true;series.forEach(item=>{const marker=wrap.querySelector(`[data-rolling-focus="${item.id}"]`);if(marker)marker.hidden=true});tip.hidden=true});
 }
 function bindFuelTooltip(points){
  const wrap=document.querySelector('.insight-count-chart-wrap'),svg=wrap?.querySelector('svg'),hit=wrap?.querySelector('.insight-fuel-hit'),tip=wrap?.querySelector('.insight-fuel-tooltip');if(!hit)return;
  const show=event=>{if(zoomDragging)return;const rect=svg.getBoundingClientRect(),ratio=(event.clientX-rect.left)/rect.width,index=Math.max(0,Math.min(points.length-1,Math.floor((ratio-.0567)/.9225*points.length))),point=points[index],ranked=Object.entries(point.fuelCounts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));tip.hidden=false;tip.innerHTML=`<strong>${esc(dateLabel(point.date))} · ${esc(point.time)} BST</strong><span class="insight-fuel-tip-total">${point.plants} online plants</span>${ranked.map(([fuel,count])=>`<span class="insight-fuel-tip-row"><i style="--fuel-color:${fuelColors[fuel]}"></i>${esc(fuel)}<b>${count}</b></span>`).join('')}`;tip.style.left=Math.min(wrap.clientWidth-tip.offsetWidth-8,Math.max(8,event.clientX-wrap.getBoundingClientRect().left+12))+'px';tip.style.top=Math.max(8,event.clientY-wrap.getBoundingClientRect().top-tip.offsetHeight-12)+'px'};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerleave',()=>{tip.hidden=true});
 }
 function bindContributionTooltip(points){
  const wrap=document.querySelector('.insight-contribution-chart-wrap'),svg=wrap?.querySelector('svg'),hit=wrap?.querySelector('.insight-fuel-hit'),tip=wrap?.querySelector('.insight-contribution-tooltip');if(!hit)return;
  const show=event=>{if(zoomDragging)return;const rect=svg.getBoundingClientRect(),ratio=(event.clientX-rect.left)/rect.width,index=Math.max(0,Math.min(points.length-1,Math.floor((ratio-.0567)/.9225*points.length))),point=points[index],ranked=Object.entries(point.fuelCounts).map(([fuel])=>({fuel,capacity:point.fuelCapacity[fuel]||0,weighted:Object.hasOwn(point.fuelCapacity,fuel),contribution:(point.fuelNumerator[fuel]||0)/point.capacity})).sort((a,b)=>b.contribution-a.contribution||b.capacity-a.capacity||a.fuel.localeCompare(b.fuel));tip.hidden=false;tip.innerHTML=`<strong>${esc(dateLabel(point.date))} · ${esc(point.time)} BST</strong><span class="insight-fuel-tip-total">H_COI ${point.h.toFixed(3)} s · ${Math.round(point.capacity).toLocaleString()} MW weighted capacity</span>${ranked.map(item=>`<span class="insight-fuel-tip-row"><i style="--fuel-color:${fuelColors[item.fuel]}"></i><span>${esc(item.fuel)}</span><b>${item.weighted?item.contribution.toFixed(3)+' s · '+Math.round(item.capacity).toLocaleString()+' MW':'Excluded'}</b></span>`).join('')}`;tip.style.left=Math.min(wrap.clientWidth-tip.offsetWidth-8,Math.max(8,event.clientX-wrap.getBoundingClientRect().left+12))+'px';tip.style.top=Math.max(8,event.clientY-wrap.getBoundingClientRect().top-tip.offsetHeight-12)+'px'};
  hit.addEventListener('pointermove',show);hit.addEventListener('pointerleave',()=>{tip.hidden=true});
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
 function mount(source){report=source;cache.set(source.date,source);document.querySelectorAll('[data-insight-range]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.insightRange;document.querySelectorAll('[data-insight-range]').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));update()}));update()}
 function markupForHistory(source){return markup(source).replace('in GenLog.','in GenLog or the legacy Generation sheet.').replace('P2 and GenLog sheets.','P2, GenLog, and legacy Generation sheets.')}
 window.BEGDInsight={markup:markupForHistory,mount,hourly,inertiaFor,rolling24,rollingCalendar};
})();
