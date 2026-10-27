/* Long-term workbook trends. Loaded independently from the selected daily report. */
(function (root) {
  const FUELS = {Gas:'#4e79a7', Coal:'#79706e', HFO:'#f28e2b', HSD:'#e15759', Hydro:'#59a14f', Solar:'#c59d1c', Imports:'#b07aa1', Wind:'#76b7b2'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const format = value => value == null ? '—' : Number(value).toLocaleString('en-US', {maximumFractionDigits:2});
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const dateLabel = date => new Date(date+'T12:00:00Z').toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
  let chartSerial=0,costTrendline=false;
  const hoverCharts=new Map();
  const hiddenLayers=new Map(),knownLayers=new Map();
  // IDs form part of the shared-link contract. Keep these mappings stable.
  const chartIds={'Generation and demand':'generation-demand','Reported load shedding':'load-shedding','Fuel mix':'fuel-mix','Imports':'imports','Import dependence and renewable share':'dependence-renewables','Unserved energy share':'unserved-share','Daily mean and 30-day rolling generation':'historical-generation'};
  const seriesIds={'Generation':'generation_mwh','Demand requirement':'demand_mwh','Maximum temperature':'temperature_c','Reported load shedding':'shed_peak_mw','Total imports':'imports_mwh','Import share':'import-share','Renewable share':'renewable-share','Unserved energy share':'unserved-share','Daily mean':'daily-mean','30-day rolling mean':'rolling-mean'};
  const stableId=name=>seriesIds[name]||String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-');
  function getViewState(){
    const layers=[];
    for(const [chart,names] of knownLayers)for(const name of names)layers.push([chart+'|'+name,!hiddenLayers.get(chart)?.has(name)]);
    // Include settings for charts not mounted in this session yet.
    for(const [chart,hidden] of hiddenLayers)for(const name of hidden)if(!layers.some(([id])=>id===chart+'|'+name))layers.push([chart+'|'+name,false]);
    return {costTrend:costTrendline?'linear':'off',days:String(period),generationUnit:chartUnits.generation,importsUnit:chartUnits.imports,temperatureUnit:temperatureUnit==='°F'?'F':'C',detail:temperatureDetail||'auto',trendLayers:layers.sort(([a],[b])=>a.localeCompare(b))};
  }
  function setViewState(state){
    costTrendline=state.costTrend==='linear';
    period=state.days==='10y'?'10y':Number(state.days);chartUnits.generation=state.generationUnit;chartUnits.imports=state.importsUnit;
    temperatureUnit=state.temperatureUnit==='F'?'°F':'°C';temperatureDetail=state.detail==='auto'?null:state.detail;
    hiddenLayers.clear();knownLayers.clear();
    for(const [id,visible] of state.trendLayers||[]){const split=id.indexOf('|');if(split<0)continue;const chart=id.slice(0,split),name=id.slice(split+1);if(!hiddenLayers.has(chart))hiddenLayers.set(chart,new Set());if(!knownLayers.has(chart))knownLayers.set(chart,new Set());knownLayers.get(chart).add(name);if(!visible)hiddenLayers.get(chart).add(name);}
    if(hiddenLayers.has('bpdb-cost'))for(const series of root.BEGDCosts?.series()||[])if(series.defaultVisible===false&&!knownLayers.get('bpdb-cost')?.has(stableId(series.name)))hiddenLayers.get('bpdb-cost').add(stableId(series.name));
    // Temperature is opt-in even when a link mentions only other layers.
    if(hiddenLayers.has('generation-demand')&&!knownLayers.get('generation-demand')?.has('temperature_c'))hiddenLayers.get('generation-demand').add('temperature_c');
  }
  const chartUnits={generation:'GWh',imports:'GWh'};
  let temperatureUnit='°C',temperatureDetail=null;
  let period = 30, bundle = null, history = null, pending = null, failure = null;
  function windowDays(data, count) {
    if (!data.end_date) return [];
    const byDate = new Map(data.days.map(day => [day.date, day]));
    const end = Date.parse(data.end_date+'T00:00:00Z');
    return Array.from({length:count}, (_,i) => {
      const date = new Date(end-(count-1-i)*86400000).toISOString().slice(0,10);
      return byDate.get(date) || {date};
    });
  }
  function total(rows, key) {
    const values = rows.map(row=>row[key]).filter(finite);
    return {value:values.length ? values.reduce((a,b)=>a+b,0) : null, count:values.length};
  }
  function rollingMean(rows, key, count=30) {
    return rows.map((row,i)=>{
      const preceding=rows.slice(Math.max(0,i-count+1),i+1);
      const values=preceding.map(day=>day[key]);
      return {...row, rolling_mw:values.length===count&&values.every(finite)?values.reduce((a,b)=>a+b,0)/count:null};
    });
  }
  function ratio(a,b) { return finite(a)&&finite(b)&&b>0?a/b*100:null; }
  function historyPanels() {
    if(!history)return panel('Decade-scale generation','BengalGrid v2 · separate historical dataset','<p class="empty">Historical aggregates could not be loaded.</p>');
    const length=Math.round((Date.parse(history.end_date)-Date.parse(history.start_date))/86400000)+1;
    const days=rollingMean(windowDays(history,length),'mean_mw');
    const excluded=history.excluded_records||[];
    const citation='<p class="note trends-citation">Rahman, Md Abir; Ahamed, Rafi (2026), “BengalGrid: A Decade-Scale Hourly Dataset of Bangladesh Power Supply by Source Type, Including Cross-Border Imports from India and Nepal”, Mendeley Data, V2, doi: <a href="https://doi.org/10.17632/xx9dhmy9rj.2" target="_blank" rel="noopener">10.17632/xx9dhmy9rj.2</a></p>';
    let html=panel('A decade of generation: daily mean & 30-day rolling mean',
      `${dateLabel(history.start_date)} – ${dateLabel(history.end_date)} · BengalGrid v2 · MW`,
      plot(days,[{name:'Daily mean',color:'#b0c3cb',width:1,markers:false,value:r=>r.mean_mw},{name:'30-day rolling mean',color:'#366474',width:2.8,markers:false,value:r=>r.rolling_mw}], 'Daily mean and 30-day rolling generation','MW',false,{annual:true,zoom:true})+
      `${citation}<p class="note">Daily means include the source’s half-hour readings; days with fewer observations remain included. The rolling mean requires 30 consecutive daily means, so gaps remain unfilled. ${excluded.length} generation readings outside the historical 756–17,468 MW IQR bounds are excluded from this view. These bounds do not filter the recent workbook charts.</p><p class="note">Data aggregated and screened for this view; the original CSV is unchanged. Licensed under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p><details><summary>Display exclusions (${excluded.length} source observations)</summary><ul>${excluded.map(row=>`<li>${escape(row.datetime)} · ${format(row.generation_mw)} MW</li>`).join('')}</ul></details>`);
    const months=history.months||[], byMonth=new Map(months.map(m=>[m.month,m]));
    const years=[...new Set(months.map(m=>m.month.slice(0,4)))];
    const values=months.map(m=>m.median_mw), low=Math.min(...values), high=Math.max(...values);
    html+=panel('Seasonality & growth by month','Monthly median of retained generation observations · MW · hover or focus a cell for coverage',
      `<div class="table-wrap"><table class="trends-heatmap"><caption class="visually-hidden">BengalGrid monthly median generation in MW; partial coverage is labeled</caption><thead><tr><th>Year</th>${Array.from({length:12},(_,i)=>`<th scope="col">${new Date(Date.UTC(2020,i,1)).toLocaleDateString('en-GB',{month:'short',timeZone:'UTC'})}</th>`).join('')}</tr></thead><tbody>${years.map(year=>`<tr><th scope="row">${year}</th>${Array.from({length:12},(_,i)=>{const key=year+'-'+String(i+1).padStart(2,'0'),m=byMonth.get(key);if(!m)return `<td tabindex="0" class="heat-empty" data-trend-tip="${key}: no reported observations">—</td>`;const daysInMonth=new Date(Date.UTC(Number(year),i+1,0)).getUTCDate(),partial=m.days<daysInMonth;return `<td tabindex="0" data-trend-tip="${escape(`${key}: ${format(m.median_mw)} MW; ${m.observations} observations across ${m.days}/${daysInMonth} days`)}" style="background:hsl(196 45% ${92-(m.median_mw-low)/Math.max(1,high-low)*64}%);color:${m.median_mw>low+(high-low)*.6?'#fff':'#163529'}" title="${key}: ${format(m.median_mw)} MW; ${m.observations} observations across ${m.days}/${daysInMonth} days"><span>${format(Math.round(m.median_mw))}${partial?'*':''}</span></td>`}).join('')}</tr>`).join('')}</tbody></table></div><p class="note">Darker cells show higher generation; * marks a month with fewer reported days than calendar days. A populated day can still have missing readings. Medians use individual observations, rather than monthly averages of daily means. This historical dataset ends on ${dateLabel(history.end_date)} and is not spliced into current workbook totals.</p>${citation}`);
    return html;
  }
  function card(label, value, unit, note, rows) {
    return `<div class="metric"><div class="label">${label}</div><div class="value">${format(value)}<span>${unit}</span></div><small>${note}</small>${root.BEGDMetricMethods?.render(label,{rows})||''}</div>`;
  }
  function monthTicks(rows) {
    const firsts=rows.map((row,i)=>row.date.endsWith('-01')?i:null).filter(i=>i!==null);
    return firsts.map((index,i)=>({index,label:new Date(rows[index].date+'T12:00:00Z').toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'}),sparse:i%3===0||i===firsts.length-1}));
  }
  function rangeBandSegments(rows,low,high){
    const segments=[];let segment=[];
    const finish=()=>{if(segment.length)segments.push(segment);segment=[]};
    rows.forEach((row,index)=>{
      const minimum=low(row),maximum=high(row);
      if(!finite(minimum)||!finite(maximum)||minimum>maximum){finish();return}
      segment.push({index,minimum,maximum});
    });
    finish();return segments;
  }
  function linearTrend(rows,series){
    const points=rows.map((row,index)=>({index,x:Date.parse(row.date+'T00:00:00Z')/86400000,y:series.value(row)})).filter(point=>finite(point.x)&&finite(point.y));
    if(points.length<2)return null;
    const x0=points[0].x,meanX=points.reduce((n,p)=>n+p.x-x0,0)/points.length,meanY=points.reduce((n,p)=>n+p.y,0)/points.length;
    const variance=points.reduce((n,p)=>n+(p.x-x0-meanX)**2,0);if(!variance)return null;
    const slope=points.reduce((n,p)=>n+(p.x-x0-meanX)*(p.y-meanY),0)/variance;
    const start=points[0].index,end=points.at(-1).index;
    return {name:series.name+' · linear trend',color:series.color,slope,count:points.length,start,end,value:row=>{const x=Date.parse(row.date+'T00:00:00Z')/86400000;return x<points[0].x||x>points.at(-1).x?null:meanY+slope*(x-x0-meanX)},formatValue:series.formatValue};
  }
  function plot(rows, allSeries, title, unit, stacked=false, options={}) {
    const key=options.key||chartIds[title]||stableId(title);
    knownLayers.set(key,new Set([...(knownLayers.get(key)||[]),...allSeries.map(s=>stableId(s.name))]));
    if(!hiddenLayers.has(key))hiddenLayers.set(key,new Set(allSeries.filter(s=>s.defaultVisible===false).map(s=>stableId(s.name))));
    const hidden=hiddenLayers.get(key);
    const series=allSeries.filter(s=>!hidden.has(stableId(s.name))&&!s.legendOnly);
    const fitted=options.fitTrend&&series.length===1?linearTrend(rows,series[0]):null;
    const secondary=series.filter(s=>s.axis==='right'),primary=series.filter(s=>s.axis!=='right');
    const W=840,H=options.compact?180:300,L=80,R=secondary.length?80:18,T=25,B=40;
    const values=rows.flatMap(row=>primary.map(s=>s.value(row))).filter(finite);
    const secondaryValues=rows.flatMap(row=>secondary.map(s=>s.value(row))).filter(finite);
    const empty=!values.length&&!secondaryValues.length;
    if(fitted)values.push(fitted.value(rows[fitted.start]),fitted.value(rows[fitted.end]));
    if(values.length&&finite(options.reference?.value))values.push(options.reference.value);
    const extentMin=values.length?Math.min(...values):0,extentMax=values.length?Math.max(...values):1;
    const extentPadding=Math.max((extentMax-extentMin)*0.08,Math.abs(extentMax)*0.01,0.01);
    const min=fitted?Math.min(0,...values):options.fitExtent&&values.length?Math.max(options.nonNegative?0:-Infinity,extentMin-extentPadding):options.temperatureScale&&values.length?Math.floor(Math.min(...values)-2):options.zoom?Math.max(0,Math.floor(Math.min(...(values.length?values:[0]))/1000)*1000):0;
    const max=options.fitExtent&&values.length?extentMax+extentPadding:options.temperatureScale?Math.max(min+1,Math.ceil(Math.max(...(values.length?values:[0]))+2)):stacked?100:Math.max(min+1,...values)*1.08;
    const x=i=>L+i/Math.max(1,rows.length-1)*(W-L-R), y=v=>H-B-(v-min)/(max-min)*(H-T-B);
    const secondaryMin=secondaryValues.length?Math.floor(Math.min(...secondaryValues)-2):0;
    const secondaryMax=secondaryValues.length?Math.ceil(Math.max(...secondaryValues)+2):1;
    const secondaryY=v=>H-B-(v-secondaryMin)/(secondaryMax-secondaryMin)*(H-T-B);
    const seriesY=(value,s)=>s.axis==='right'?secondaryY(value):y(value);
    let body='';
    if(secondary.length){
      body+=`<g class="trends-secondary-axis" aria-label="Maximum temperature, right axis (${escape(secondary[0].unit)})"><line x1="${W-R}" x2="${W-R}" y1="${T}" y2="${H-B}" stroke="currentColor"/><text x="${W-R+10}" y="${T-10}">${escape(secondary[0].unit)}</text>`;
      if(secondaryValues.length)for(let i=0;i<=4;i++){
        const value=secondaryMin+(secondaryMax-secondaryMin)*i/4;
        body+=`<text x="${W-R+10}" y="${secondaryY(value)+4}">${format(Math.round(value*10)/10)}</text>`;
      }
      body+='</g>';
    }
    const tickCount=options.compact?2:4;
    for(let i=0;i<=tickCount;i++) {
      const value=min+(max-min)*i/tickCount;
      const tick=options.tickDecimals!=null?value.toLocaleString('en-US',{minimumFractionDigits:options.tickDecimals,maximumFractionDigits:options.tickDecimals}):unit==='MW'?format(Math.round(value)):format(Math.round(value*10)/10);
      body+=`<line class="axis" x1="${L}" x2="${W-R}" y1="${y(value)}" y2="${y(value)}"/><text x="${L-9}" y="${y(value)+4}" text-anchor="end">${tick}</text>`;
    }
    const ticks=options.annual
      ?rows.map((r,i)=>r.date.endsWith('-01-01')?{index:i,label:r.date.slice(0,4),sparse:Number(r.date.slice(0,4))%2===0}:null).filter(Boolean)
      :rows.length===365?monthTicks(rows)
      :[...new Set([0,Math.round((rows.length-1)/3),Math.round(2*(rows.length-1)/3),rows.length-1])].map(index=>({index,label:dateLabel(rows[index].date),sparse:true}));
    for(const {index:i,label,sparse} of options.hideDateLabels?[]:ticks)
      body+=`<text class="trends-date-tick${sparse?' tick-sparse':''}" x="${x(i)}" y="${H-12}" text-anchor="${i===0?'start':i===rows.length-1?'end':'middle'}">${escape(label)}</text>`;
    if(empty)body+=`<text x="${(L+W-R)/2}" y="${H/2}" text-anchor="middle">${series.length?'No reported values in this window':'Select a legend layer to display'}</text>`;
    if(stacked) {
      const width=Math.max(.7,(W-L-R)/rows.length*.82);
      rows.forEach((row,i)=>{
        const parts=allSeries.map(s=>s.value(row));
        if(!parts.every(finite) || parts.reduce((a,b)=>a+b,0)<=0) return;
        const sum=parts.reduce((a,b)=>a+b,0);let bottom=0;
        parts.forEach((value,j)=>{
          const percent=value/sum*100;
          if(hidden.has(stableId(allSeries[j].name)))return;
          if(percent>0)body+=`<rect x="${x(i)-width/2}" y="${y(bottom+percent)}" width="${width}" height="${percent/max*(H-T-B)}" fill="${allSeries[j].color}" aria-label="${row.date} · ${escape(allSeries[j].name)}: ${format(percent)}% · ${format(value)} GWh"/>`;
          bottom+=percent;
        });
      });
    } else {
      if(options.band){
        const band=options.band;
        rangeBandSegments(rows,band.low,band.high).forEach(segment=>{
          const upper=segment.map(point=>`${x(point.index)},${y(point.maximum)}`);
          const lower=segment.slice().reverse().map(point=>`${x(point.index)},${y(point.minimum)}`);
          body+=`<path class="trends-range-band" d="M${upper.join(' L')} L${lower.join(' L')} Z" fill="${band.color}" fill-opacity="0.16" stroke="none" aria-label="Reported daily minimum–maximum voltage band"/>`;
        });
      }
      if(!empty&&finite(options.reference?.value))body+=`<line class="trends-reference" x1="${L}" x2="${W-R}" y1="${y(options.reference.value)}" y2="${y(options.reference.value)}" stroke="currentColor" stroke-opacity="0.55" stroke-dasharray="4 4"/><text x="${W-R-4}" y="${y(options.reference.value)-6}" text-anchor="end">${escape(options.reference.label)}</text>`;
      series.forEach(s=>{
        let path='',connected=false;
        rows.forEach((row,i)=>{const v=s.value(row);if(!finite(v)){connected=false;return}path+=`${connected?'L':'M'}${x(i)},${seriesY(v,s)} `;connected=true});
        body+=`<path d="${path}" fill="none" stroke="${s.color}" stroke-width="${s.width||2.2}" ${s.dash?'stroke-dasharray="6 4"':''}/>`;
        if(s.markers!==false)rows.forEach((row,i)=>{const v=s.value(row);if(finite(v))body+=`<circle cx="${x(i)}" cy="${seriesY(v,s)}" r="${rows.length>90?2:3}" fill="${s.color}" aria-label="${row.date} · ${escape(s.name)}: ${escape(s.formatValue?s.formatValue(v,row):format(v)+' '+(s.unit||unit))}"/>`});
      });
    }
    if(fitted){
      const start=rows[fitted.start],end=rows[fitted.end];
      body+=`<path data-cost-trendline-path d="M${x(fitted.start)},${y(fitted.value(start))} L${x(fitted.end)},${y(fitted.value(end))}" fill="none" stroke="${fitted.color}" stroke-width="3" stroke-dasharray="9 6" aria-label="${escape(fitted.name)} · least squares over ${fitted.count} reported days"/>`;
    }
    const legendLabel=s=>`<label><input type="checkbox" data-trend-layer="${escape(s.name)}" data-trend-chart-key="${escape(key)}" ${hidden.has(stableId(s.name))?'':'checked'}><i style="background:${s.color}"></i>${escape(s.name)}</label>`;
    const group=options.groupLayers?allSeries.filter(s=>s.name!=='Reported total'):[];
    const active=group.filter(s=>!hidden.has(stableId(s.name))).length;
    const legend=options.hideLegend?'':options.groupLayers?allSeries.filter(s=>s.name==='Reported total').map(legendLabel).join('')+`<fieldset class="bpdb-fuel-group"><legend><label><input type="checkbox" data-trend-group="${escape(key)}" data-partial="${active>0&&active<group.length}" ${group.length&&active===group.length?'checked':''}>Individual fuel types</label></legend><div>${group.map(legendLabel).join('')}</div></fieldset>`:allSeries.map(legendLabel).join('');
    const id='trend-chart-'+(++chartSerial);
    hoverCharts.set(id,{rows,series,allSeries,unit,stacked,W,H,L,R,T,B,tooltipSeries:options.tooltipSeries||(fitted?[...series,fitted]:null),syncGroup:options.syncGroup});
    return `<div class="trends-chart" data-trend-chart="${id}"><svg tabindex="0" aria-describedby="${id}-tip" data-trend-svg="${id}" class="chart trends-plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(title)} (${unit}). Missing dates are gaps. Hover or focus the chart for daily values.">${body}<line class="trends-cursor" data-trend-cursor x1="0" x2="0" y1="${T}" y2="${H-B}" hidden/></svg><div class="trends-tooltip" id="${id}-tip" role="tooltip" hidden></div><div class="trends-legend"${options.hideLegend?' hidden':''}>${legend}</div>${fitted?`<p class="bpdb-fit-note">Dashed: ${escape(fitted.name)} · least-squares fit over ${fitted.count} reported days; not a forecast.</p>`:''}</div>`;
  }
  const panel = (title,note,body,controls='') => `<section class="panel full"><div class="panel-head"><div><h2>${title}</h2><p>${note}</p></div>${controls}</div>${body}</section>`;
  function weeklyComparisonRows(rows) {
    const keys=['generation_mwh','demand_mwh','temperature_c'],result=[];
    for(let i=0;i<rows.length;i+=7){
      const group=rows.slice(i,i+7),row={date:group.at(-1).date,period_start:group[0].date,period_end:group.at(-1).date,window_days:group.length};
      for(const key of keys)row[key]=group.every(day=>finite(day[key]))?group.reduce((sum,day)=>sum+day[key],0)/group.length:null;
      result.push(row);
    }
    return result;
  }
  function detailControls(detail) { return `<div class="trends-unit-control" role="group" aria-label="Comparison detail">${[['weekly','7-day average'],['daily','Daily']].map(([key,label])=>`<button type="button" data-temperature-detail="${key}" aria-pressed="${detail===key}">${label}</button>`).join('')}</div>`; }
  function temperatureValue(value,unit='°C') { return finite(value)?(unit==='°F'?value*9/5+32:value):null; }
  function temperatureSeries() { return {name:'Maximum temperature',color:'#ba477b',axis:'right',unit:temperatureUnit,defaultVisible:false,value:row=>temperatureValue(row.temperature_c,temperatureUnit)}; }
  function temperatureControls() { return `<div class="trends-unit-control" role="group" aria-label="Maximum temperature units">${['°C','°F'].map(unit=>`<button type="button" data-temperature-unit="${unit}" aria-pressed="${temperatureUnit===unit}">${unit}</button>`).join('')}</div>`; }
  function energyValue(value,unit) { return finite(value)?value/(unit==='MW'?24:1000):null; }
  const energy = (key,name,color,dash=false,unit='GWh') => ({key,name,color,dash,value:row=>energyValue(row[key],unit)});
  function unitControls(chart) {
    return `<div class="trends-unit-control" role="group" aria-label="${chart==='generation'?'Generation and demand':'Imports'} chart units">${['GWh','MW'].map(unit=>`<button type="button" data-trend-unit="${unit}" data-unit-chart="${chart}" aria-pressed="${chartUnits[chart]===unit}">${unit}</button>`).join('')}</div>`;
  }

  function controls() {
    return `<div class="trends-toolbar"><div role="group" aria-label="Long-term trend window">${[30,60,90,365,'10y'].map(days=>`<button type="button" data-trend-days="${days}" aria-pressed="${days===period}">${days==='10y'?'10y':days+'d'}</button>`).join('')}</div><span>${period==='10y'?'Full BengalGrid history · 2015–2026':'Ending on the latest available operating day'}</span></div>`;
  }
  function content() {
    if(period==='10y')return controls()+`<p class="trends-coverage">BengalGrid historical view · full available record, ${history?dateLabel(history.start_date)+' – '+dateLabel(history.end_date):'2015–2026'} · generation only</p>`+(pending&&!history?'<p role="status">Loading historical generation…</p>':historyPanels());
    if(!bundle)return controls()+`<section class="panel full"><p role="status">${failure?'Historical data could not be loaded.': 'Loading daily trends…'}</p>${failure?'<button type="button" data-trends-retry>Retry</button>':''}</section>`;
    const allRows=rollingMean(windowDays(bundle,365).map(row=>({...row,average_mw:finite(row.generation_mwh)?row.generation_mwh/24:null})), 'average_mw');
    const selected=new Map(allRows.map(row=>[row.date,row]));
    const rows=windowDays(bundle,period).map(row=>selected.get(row.date)||row);
    if(!rows.length)return controls()+'<p class="empty">No historical reports are available in this build.</p>';
    const gen=total(rows,'generation_mwh'), demand=total(rows,'demand_mwh'), imported=total(rows,'imports_mwh');
    const shed=rows.map(r=>r.shed_peak_mw).filter(finite), unserved=total(rows,'unserved_mwh');
    const coverage=n=>`${n} / ${period} days reported`;
    const actual=rows.filter(row=>row.report_id!=null).length;
    const fuelSeries=Object.entries(FUELS).map(([name,color])=>({name,color,value:r=>finite(r.fuels?.[name])?r.fuels[name]/1000:null}));
    const completeMix=rows.filter(r=>fuelSeries.every(s=>finite(s.value(r)))&&fuelSeries.reduce((n,s)=>n+s.value(r),0)>0).length;
    const routeNames=[...new Set(rows.flatMap(row=>Object.keys(row.routes||{})))].sort();
    const routeColors=['#4e79a7','#b07aa1','#d88931','#59a14f','#76b7b2','#e15759'];
    const routeSeries=routeNames.map((name,i)=>({name,color:routeColors[i%routeColors.length],value:r=>energyValue(r.routes?.[name],chartUnits.imports)}));
    let html=controls()+`<p class="trends-coverage">${dateLabel(rows[0].date)} – ${dateLabel(rows.at(-1).date)} · <strong>${actual} / ${period} daily reports</strong> · Updated ${escape(bundle.generated_at?.replace('T',' ').slice(0,16)||'unknown')} UTC</p>`;
    html+='<div class="metrics">'+card('Total generation',gen.value==null?null:gen.value/1000,'GWh',coverage(gen.count)+' · includes imports',rows)+card('Total demand requirement',demand.value==null?null:demand.value/1000,'GWh',coverage(demand.count)+' · energy requirement',rows)+card('Maximum reported load shedding',shed.length?Math.max(...shed):null,'MW',coverage(shed.length)+' · maximum P4 reading',rows)+card('Total imports',imported.value==null?null:imported.value/1000,'GWh',coverage(imported.count),rows)+'</div>';
    html+=`<p class="note trends-method">Totals cover reported days only; incomplete windows are partial totals. Missing values stay blank and lines break at gaps. Demand requirement uses the matching-date En-Curve total, or P1 generation plus reported energy not served when that total is unavailable. This energy requirement is not a separately metered demand total. Reported load shedding is taken directly from P4; it is not inferred from demand minus generation. Energy not served: ${format(unserved.value==null?null:unserved.value/1000)} GWh (${coverage(unserved.count)}), a separate published P1 energy measure.</p>`;
    const generationUnit=chartUnits.generation, importUnit=chartUnits.imports;
    const showTemperature=hiddenLayers.has('generation-demand')&&!hiddenLayers.get('generation-demand').has('temperature_c');
    const powerNote='Daily average power = published daily energy ÷ 24 hours · MW';
    const detail=temperatureDetail||(period>=60?'weekly':'daily');
    const averaged=showTemperature&&detail==='weekly',comparisonRows=averaged?weeklyComparisonRows(rows):rows;
    const comparisonSeries=[energy('generation_mwh','Generation','#4e79a7',false,generationUnit),energy('demand_mwh','Demand requirement','#d88931',true,generationUnit),{...temperatureSeries(),legendOnly:true}].map(series=>showTemperature?{...series,unit:series.unit||generationUnit,markers:true,width:series.axis==='right'?2.8:1.9}:series);
    const comparisonTooltipSeries=showTemperature?comparisonSeries.filter(series=>!hiddenLayers.get('generation-demand')?.has(stableId(series.name))):null;
    const comparisonNote=(averaged?'7-day averages · ':'')+(generationUnit==='MW'?powerNote:'Daily energy · GWh')+' · generation includes imports · value axis fitted to visible data';
    const temperaturePlot=showTemperature?`<section class="temperature-subplot" aria-label="Maximum temperature subplot"><div class="temperature-subplot-heading"><h3>Maximum temperature · ${escape(temperatureUnit)}</h3>${temperatureControls()}</div>${plot(comparisonRows,[{...temperatureSeries(),axis:'left',defaultVisible:true,markers:true,width:2.5}],'Maximum temperature subplot',temperatureUnit,false,{key:'temperature-subplot',compact:true,temperatureScale:true,hideLegend:true,tooltipSeries:comparisonTooltipSeries,syncGroup:'generation-temperature'})}</section>`:'';
    html+=panel('Generation & demand',comparisonNote,'<div class="trends-generation-figure">'+plot(comparisonRows,comparisonSeries,'Generation and demand',generationUnit,false,{fitExtent:true,hideDateLabels:showTemperature,tooltipSeries:comparisonTooltipSeries,syncGroup:showTemperature?'generation-temperature':null})+temperaturePlot+'</div>',`<div class="trends-chart-controls">${showTemperature?detailControls(detail):''}${unitControls('generation')}</div>`);
    if(showTemperature)html+=`<p class="note trends-temperature-note">${averaged?'Lines show averages within consecutive 7-day windows; the final window may be shorter. Energy is average daily energy, and temperature is the average of daily maxima. Windows with missing readings remain gaps. ': 'Daily readings. '}Maximum temperature: P1!K11 · separate subplot with an aligned date axis · ${rows.filter(row=>finite(row.temperature_c)).length} / ${period} days reported. °F = °C × 9/5 + 32.</p>`;
    html+=root.BEGDCosts?.trendPanel(rows,plot,{trendline:costTrendline})||'';
    html+=panel('Reported load shedding','Daily maximum of available P4 load-shedding readings · MW',plot(rows,[{name:'Reported load shedding',color:'#e15759',value:r=>r.shed_peak_mw}],'Reported load shedding','MW'));
    html+=panel('Fuel mix',`Daily energy shares · hidden layers retain their original share of total generation · ${completeMix} / ${period} days with all fuel values reported`,plot(rows,fuelSeries,'Fuel mix','%',true));
    html+=panel('Imports over time',`${importUnit==='MW'?powerNote:'Daily energy · GWh'} · route names follow the workbooks`,plot(rows,[energy('imports_mwh','Total imports','#8a9e3a',true,importUnit),...routeSeries],'Imports',importUnit),unitControls('imports'));
    html+=panel('Import dependence & renewable share','Share of daily total generation · renewable = hydro + solar + wind · imports already included in total generation',plot(rows,[{name:'Import share',color:'#b07aa1',value:r=>ratio(r.imports_mwh,r.generation_mwh)},{name:'Renewable share',color:'#59a14f',value:r=>['Hydro','Solar','Wind'].every(k=>finite(r.fuels?.[k]))?ratio(r.fuels.Hydro+r.fuels.Solar+r.fuels.Wind,r.generation_mwh):null}],'Import dependence and renewable share','%'));
    html+=panel('Unserved energy as a share of requirement','Reported P1 energy not served ÷ total daily energy requirement · % · distinct from maximum MW load shedding',plot(rows,[{name:'Unserved energy share',color:'#e15759',value:r=>ratio(r.unserved_mwh,r.demand_mwh)}],'Unserved energy share','%'));
    return html+'<div id="entity-histories"></div>';
  }
  function tooltipRows(record,index) {
    const row=record.rows[index];
    const tooltipSeries=record.tooltipSeries||record.series;
    const values=tooltipSeries.map(s=>s.value(row));
    const fullValues=(record.allSeries||record.series).map(s=>s.value(row));
    const complete=fullValues.every(finite)&&fullValues.reduce((a,b)=>a+b,0)>0;
    const sum=complete?fullValues.reduce((a,b)=>a+b,0):null;
    let html=`<strong>${row.period_start?`${escape(dateLabel(row.period_start))} – ${escape(dateLabel(row.period_end))}`:escape(dateLabel(row.date))}</strong>`;
    if(row.window_days)html+=`<small>${row.window_days}-day average · temperature averages daily maxima</small>`;
    if(!tooltipSeries.length)html+='<small>No layers selected</small>';
    tooltipSeries.forEach((s,i)=>{
      const value=values[i];
      const text=record.stacked
        ?complete?`${format(value/sum*100)}% · ${format(value)} GWh`:'Not reported (incomplete mix)'
        :finite(value)?s.formatValue?s.formatValue(value,row):`${format(value)} ${s.unit||record.unit}`:'Not reported';
      html+=`<div><i style="background:${s.color}"></i><span>${escape(s.name)}</span><b>${escape(text)}</b></div>`;
    });
    if(row.observations!=null)html+=`<small>${format(row.observations)} retained source observation${row.observations===1?'':'s'}${row.excluded?' · '+row.excluded+' excluded for display':''}</small>`;
    return html;
  }
  let floatingTooltip=null;
  function hideFloatingTooltip() { if(floatingTooltip){floatingTooltip.remove();floatingTooltip=null;} }
  function positionTooltip(tip,x,y) {
    const gap=14, box=tip.getBoundingClientRect();
    const left=Math.max(8,Math.min(x+gap,root.innerWidth-box.width-8));
    const top=Math.max(8,Math.min(y+gap,root.innerHeight-box.height-8));
    tip.style.left=left+'px';tip.style.top=top+'px';
  }
  function setupTooltips(host) {
    host.querySelectorAll('[data-trend-chart]').forEach(wrap=>{
      const record=hoverCharts.get(wrap.dataset.trendChart), svg=wrap.querySelector('svg');
      const tip=wrap.querySelector('[role=tooltip]'),cursor=svg.querySelector('[data-trend-cursor]');
      const linked=()=>record.syncGroup?[...host.querySelectorAll('[data-trend-chart]')].filter(other=>hoverCharts.get(other.dataset.trendChart)?.syncGroup===record.syncGroup):[wrap];
      let selected=record.rows.length-1;
      const show=(index,event)=>{
        selected=Math.max(0,Math.min(record.rows.length-1,index));
        tip.innerHTML=tooltipRows(record,selected);tip.hidden=false;
        const x=record.L+selected/Math.max(1,record.rows.length-1)*(record.W-record.L-record.R);
        cursor.setAttribute('x1',x);cursor.setAttribute('x2',x);cursor.removeAttribute('hidden');
        for(const other of linked()){
          if(other===wrap)continue;
          const otherRecord=hoverCharts.get(other.dataset.trendChart),otherCursor=other.querySelector('[data-trend-cursor]');
          const otherX=otherRecord.L+selected/Math.max(1,otherRecord.rows.length-1)*(otherRecord.W-otherRecord.L-otherRecord.R);
          otherCursor.setAttribute('x1',otherX);otherCursor.setAttribute('x2',otherX);otherCursor.removeAttribute('hidden');
          other.querySelector('[role=tooltip]').hidden=true;
        }
        const bounds=svg.getBoundingClientRect();
        positionTooltip(tip,event?.clientX??bounds.left+bounds.width*x/record.W,event?.clientY??bounds.top+32);
      };
      const hide=()=>{for(const other of linked()){other.querySelector('[role=tooltip]').hidden=true;other.querySelector('[data-trend-cursor]').setAttribute('hidden','')}};
      svg.addEventListener('pointermove',event=>{
        const transform=svg.getScreenCTM();if(!transform)return;
        const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
        const local=point.matrixTransform(transform.inverse());
        if(local.x<record.L||local.x>record.W-record.R||local.y<record.T||local.y>record.H-record.B){hide();return}
        show(Math.round((local.x-record.L)/(record.W-record.L-record.R)*(record.rows.length-1)),event);
      });
      svg.addEventListener('pointerleave',hide);
      svg.addEventListener('focus',()=>show(selected));
      svg.addEventListener('blur',hide);
      svg.addEventListener('keydown',event=>{
        if(event.key==='Escape'){hide();return}
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        show(event.key==='Home'?0:event.key==='End'?record.rows.length-1:selected+(event.key==='ArrowLeft'?-1:1));
      });
    });
    host.querySelectorAll('[data-trend-tip]').forEach(cell=>{
      cell.removeAttribute('title');
      const show=event=>{
        hideFloatingTooltip();floatingTooltip=document.createElement('div');
        floatingTooltip.className='trends-tooltip';floatingTooltip.id='trend-month-tooltip';
        floatingTooltip.setAttribute('role','tooltip');floatingTooltip.textContent=cell.dataset.trendTip;
        document.body.appendChild(floatingTooltip);cell.setAttribute('aria-describedby',floatingTooltip.id);
        const box=cell.getBoundingClientRect();positionTooltip(floatingTooltip,event?.clientX??box.left,event?.clientY??box.bottom);
      };
      const hide=()=>{hideFloatingTooltip();cell.removeAttribute('aria-describedby')};
      cell.addEventListener('pointerenter',show);cell.addEventListener('pointermove',event=>{if(floatingTooltip)positionTooltip(floatingTooltip,event.clientX,event.clientY)});
      cell.addEventListener('pointerleave',hide);cell.addEventListener('focus',()=>show());cell.addEventListener('blur',hide);
      cell.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});
    });
  }
  function draw() {
    if(root.location.hash!=='#trends')return;
    hideFloatingTooltip();
    hoverCharts.clear();
    const host=document.querySelector('#content');host.innerHTML=content();
    setupTooltips(host);
    root.BEGDEntityHistory?.mount(host.querySelector('#entity-histories'));
    host.querySelectorAll('[data-trend-group]').forEach(control=>{
      control.indeterminate=control.dataset.partial==='true';
      control.addEventListener('change',()=>{
        const key=control.dataset.trendGroup,hidden=hiddenLayers.get(key)||new Set();
        control.closest('fieldset').querySelectorAll('[data-trend-layer]').forEach(input=>{const name=stableId(input.dataset.trendLayer);control.checked?hidden.delete(name):hidden.add(name)});
        hiddenLayers.set(key,hidden);draw();host.querySelector('[data-trend-group]')?.focus({preventScroll:true});
      });
    });
    host.querySelector('[data-cost-trendline]')?.addEventListener('change',event=>{costTrendline=event.target.checked;draw();host.querySelector('[data-cost-trendline]')?.focus({preventScroll:true})});
    host.querySelectorAll('[data-trend-layer]').forEach(control=>control.addEventListener('change',()=>{
      const key=control.dataset.trendChartKey, name=stableId(control.dataset.trendLayer);
      const hidden=hiddenLayers.get(key)||new Set();
      control.checked?hidden.delete(name):hidden.add(name);hiddenLayers.set(key,hidden);
      draw();
      [...host.querySelectorAll('[data-trend-layer]')].find(input=>input.dataset.trendChartKey===key&&stableId(input.dataset.trendLayer)===name)?.focus({preventScroll:true});
    }));
    host.querySelectorAll('[data-temperature-detail]').forEach(control=>control.addEventListener('click',()=>{
      temperatureDetail=control.dataset.temperatureDetail;draw();
      [...host.querySelectorAll('[data-temperature-detail]')].find(button=>button.dataset.temperatureDetail===temperatureDetail)?.focus({preventScroll:true});
    }));
    host.querySelectorAll('[data-temperature-unit]').forEach(control=>control.addEventListener('click',()=>{
      temperatureUnit=control.dataset.temperatureUnit;draw();
      [...host.querySelectorAll('[data-temperature-unit]')].find(button=>button.dataset.temperatureUnit===temperatureUnit)?.focus({preventScroll:true});
    }));
    host.querySelectorAll('[data-trend-unit]').forEach(control=>control.addEventListener('click',()=>{
      const chart=control.dataset.unitChart,unit=control.dataset.trendUnit;
      chartUnits[chart]=unit;draw();
      [...host.querySelectorAll('[data-trend-unit]')].find(button=>button.dataset.unitChart===chart&&button.dataset.trendUnit===unit)?.focus({preventScroll:true});
    }));
    document.querySelector('#subtitle').textContent=period==='10y'?'BengalGrid generation history · daily means, rolling trend and monthly seasonality':'Daily generation, demand, reported load shedding, fuel mix and imports · Bangladesh operating dates';
    document.querySelector('#source').textContent=period==='10y'?'Source: BengalGrid v2 · DOI 10.17632/xx9dhmy9rj.2 · CC BY 4.0 · full historical coverage shown above.':'Long-term trends: Power Grid Bangladesh PLC / NLDC operating-day workbooks (P1, P4, En-Curve and GenLog). National trends use published workbook totals.';
    host.querySelectorAll('[data-trend-days]').forEach(button=>button.addEventListener('click',()=>{period=button.dataset.trendDays==='10y'?'10y':Number(button.dataset.trendDays);draw()}));
    host.querySelector('[data-trends-retry]')?.addEventListener('click',()=>{failure=null;pending=null;mount()});
  }
  async function mount() {
    document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#trends'));
    document.querySelector('#title').textContent='Long-term trends';
    document.querySelector('#subtitle').textContent='Daily generation, demand, reported load shedding, fuel mix and imports · Bangladesh operating dates';
    ['report-date-controls','date-status','day-sources','error'].forEach(id=>{document.getElementById(id).hidden=true});
    document.querySelector('.header-meta .status').textContent='HISTORICAL OPERATING DATA';
    document.querySelector('#source').textContent='Long-term trends: Power Grid Bangladesh PLC / NLDC operating-day workbooks (P1, P4, En-Curve and GenLog). National trends use published workbook totals.';
    draw();
    if(!bundle&&!pending&&!failure){
      pending=Promise.all([root.BEGDCosts?.load(),fetch('trends-data.json',{cache:'no-store'}).then(response=>{if(!response.ok)throw Error('Trends unavailable');return response.json()}).then(data=>{if(!Array.isArray(data.days))throw Error('Invalid trends');bundle=data;failure=null}),fetch('bengalgrid-trends.json').then(response=>{if(!response.ok)throw Error('History unavailable');return response.json()}).then(data=>{history=data}).catch(()=>{history=null})]).catch(error=>{failure=error}).finally(()=>{pending=null;draw()});
    }
    await pending;
  }
  function releaseCharts(host){host.querySelectorAll('[data-trend-chart]').forEach(wrap=>hoverCharts.delete(wrap.dataset.trendChart));}
  root.BEGDTrends={setupTooltips,releaseCharts,getViewState,setViewState,mount,windowDays,total,plot,linearTrend,rollingMean,ratio,tooltipRows,monthTicks,rangeBandSegments,energyValue,temperatureValue,temperatureSeries,weeklyComparisonRows};
  root.addEventListener('hashchange',hideFloatingTooltip);
  root.addEventListener('DOMContentLoaded',()=>{if(root.location.hash==='#trends')mount()});
})(window);
