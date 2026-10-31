/* Approved endpoint sites, with deliberately schematic circuit connections. */
(function(root){
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const format=value=>finite(value)?Math.abs(value).toLocaleString('en-US',{maximumFractionDigits:1}):'—';
 const minutes=time=>{
  const match=/^(\d{1,2}):(\d{2})$/.exec(String(time||'').trim());
  if(!match)return null;const h=Number(match[1]),m=Number(match[2]);
  return h<=24&&m<60&&(h<24||m===0)?h*60+m:null;
 };
 const clock=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
 const signed=value=>finite(value)?value.toLocaleString('en-US',{maximumFractionDigits:1}):'—';
 const aliases={
  ishwardi_ghorashal:[/\b(?:ishwardi|ishurdi|iswardi|ishwardy|isd)\b/i,/\b(?:ghorashal|ghorasal)\b/i],
  sirajganj_sreepur:[/\b(?:sirajganj|sirajgonj)\b/i,/\b(?:sreepur|sripur)\b/i],
  gopalganj_aminbazar:[/\b(?:gopalganj|gopalgonj)\b/i,/\bamin\s*bazar\b/i]
 };
 function matchingCircuits(description,circuits){
  const text=String(description||'').replace(/[^a-z0-9]+/gi,' ');
  const pairs=circuits.filter(c=>aliases[c.key]?.every(pattern=>pattern.test(text))).map(c=>c.key);
  return pairs.length?pairs:/\bewic\b|\beast west interconnector\b/i.test(text)?circuits.map(c=>c.key):[];
 }
 function buildMoments(input,events,circuits){
  const rows=input.filter(row=>minutes(row.time)!==null).slice().sort((a,b)=>minutes(a.time)-minutes(b.time));
  const stops=new Map();let untimedEvents=0,matchedEvents=0;
  const add=(minute,reason)=>{if(!stops.has(minute))stops.set(minute,{minute,time:clock(minute),reasons:[]});stops.get(minute).reasons.push(reason)};
  for(const circuit of circuits){
   const readings=rows.filter(row=>finite(row[circuit.key]));if(!readings.length)continue;
   const values=readings.map(row=>row[circuit.key]),low=Math.min(...values),high=Math.max(...values);
   for(const [kind,value] of low===high?[['Constant reported flow',low]]:[['Minimum signed flow',low],['Maximum signed flow',high]]){
    const matches=readings.filter(row=>row[circuit.key]===value);
    add(minutes(matches[0].time),{kind,keys:[circuit.key],label:circuit.name,value,ties:matches.length});
   }
  }
  for(const event of events){
   const keys=matchingCircuits(event.description,circuits);if(!keys.length)continue;matchedEvents++;
   const outage=minutes(event.outage_time),restoration=minutes(event.restoration_time);
   let placed=false;
   if(outage!==null){add(outage,{kind:'P1 event / outage time',keys,description:event.description});placed=true}
   // A restoration earlier than its outage belongs to the following day.
   if(restoration!==null&&(outage===null||restoration>=outage)){
    add(restoration,{kind:'P1 restoration time',keys,description:event.description});placed=true;
   }
   if(!placed)untimedEvents++;
  }
  const moments=[...stops.values()].sort((a,b)=>a.minute-b.minute).map(stop=>{
   const nearest=rows.reduce((best,row)=>!best||Math.abs(minutes(row.time)-stop.minute)<Math.abs(minutes(best.time)-stop.minute)?row:best,null);
   // Event timestamps retain their own precision; never interpolate hourly flows.
   return {...stop,row:nearest&&Math.abs(minutes(nearest.time)-stop.minute)<=60?nearest:null};
  });
  return {rows,moments,untimedEvents,matchedEvents};
 }
 function flowStyle(value){
  return {color:!finite(value)||value===0?'#788692':value>0?'#267db3':'#d55e32',width:5,dash:finite(value)?'':'5 5'};
 }
 const chevron=direction=>`<svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22"><path d="${direction==='left'?'M15 5l-7 7 7 7':'M9 5l7 7-7 7'}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
 const render=()=>`<div class="ewic-map" data-ewic-map><h3>Interconnector flow map</h3><p class="note">Approved endpoint sites · schematic connections</p><div class="ewic-map-layout"><div class="ewic-map-frame" data-ewic-frame role="status">Loading map…</div><div class="ewic-map-readings" data-ewic-readings></div></div><div class="ewic-map-time"><label for="ewic-moment">Notable times · BST</label><div class="ewic-moment-controls"><button type="button" data-ewic-prev aria-label="Previous notable EWIC time" disabled>${chevron('left')}</button><select id="ewic-moment" data-ewic-moment aria-label="Choose a notable EWIC time" disabled><option>No notable times</option></select><button type="button" data-ewic-next aria-label="Next notable EWIC time" disabled>${chevron('right')}</button></div><div class="ewic-moment-status" aria-live="polite" aria-atomic="true"><p data-ewic-time-label></p><div data-ewic-reasons></div></div></div><p class="note" data-ewic-coverage></p><p class="note">Blue: west → east · Orange: east → west · Grey: zero or unavailable (dashed). Highlighted lines relate to the selected stop; widths stay fixed. Stops mark each line’s lowest and highest signed MW, and matching P1 event/restoration times. Ties use the first reading. Event times use the nearest EWIC reading within 60 minutes, labelled separately; flows are not interpolated.</p><details><summary>Coordinate sources and limitations</summary><p class="note">Sites use the user-approved Substation Coordinate Matches.xlsx catalogue (WGS84). The branches connect endpoint sites schematically; surveyed line routes and circuit-specific terminal coordinates are unverified. Review notes for site and voltage matching remain in the endpoint evidence below.</p><div data-ewic-sources></div></details></div>`;
 async function mount(input,events=[]){
  const host=document.querySelector('[data-ewic-map]');if(!host)return;
  const frame=host.querySelector('[data-ewic-frame]');
  try{
   const [catalog,boundary,admin]=await Promise.all(['ewic-locations.json','bangladesh-boundary.geojson','plant-administrative-boundaries.geojson'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Map asset unavailable');return r.json()}));
   if(!host.isConnected)return;
   const map=root.BEGDPlantMap;if(!map)throw Error('Map projection unavailable');
   const {moments,untimedEvents,matchedEvents}=buildMoments(input,events,catalog.circuits);
   let selected=0;
   const country=map.geometryPath(boundary.geometry);
   frame.innerHTML=`<svg class="plant-location-map ewic-location-map" viewBox="0 0 710 990" role="img" aria-label="Three schematic east–west interconnector circuits on the Bangladesh basemap"><path class="plant-map-country" d="${country}"/><g class="plant-map-boundaries" aria-hidden="true">${admin.features.map(f=>`<path class="plant-map-boundary plant-map-${escape(f.properties.level)}-boundary" fill="none" d="${map.geometryPath(f.geometry)}"/>`).join('')}</g><g data-ewic-branches></g><g>${catalog.circuits.flatMap(c=>[c.west,c.east]).map(site=>{const [x,y]=map.project([site.longitude,site.latitude]);return `<g><circle cx="${x}" cy="${y}" r="5" fill="var(--ink)" stroke="var(--bg)" stroke-width="2"/><text class="ewic-site-label" x="${x+10}" y="${y-10}">${escape(site.name)}</text></g>`}).join('')}</g></svg>`;
   frame.removeAttribute('role');
   host.querySelector('[data-ewic-sources]').innerHTML=catalog.circuits.map(c=>`<p class="note"><strong>${escape(c.name)}</strong><br>${[c.west,c.east].map(s=>`${escape(s.name)}: ${s.latitude.toFixed(6)}° N, ${s.longitude.toFixed(6)}° E · <a href="https://www.openstreetmap.org/${escape(s.osm_id)}" target="_blank" rel="noopener noreferrer">${escape(s.osm_id)}</a> · ${escape(s.source)} · ${escape(s.match_evidence)}`).join('<br>')}</p>`).join('');
   const previous=host.querySelector('[data-ewic-prev]'),next=host.querySelector('[data-ewic-next]'),select=host.querySelector('[data-ewic-moment]');
   const shortReason=reason=>reason.label?reason.label+' · '+reason.kind.toLowerCase():reason.kind;
   select.innerHTML=moments.length?moments.map((stop,i)=>`<option value="${i}">${stop.time} · ${escape(stop.reasons.map(shortReason).join('; '))}</option>`).join(''):'<option>No notable times</option>';
   select.disabled=!moments.length;
   host.querySelector('[data-ewic-coverage]').textContent=`${moments.length} notable times · ${matchedEvents} matching P1 log entries${untimedEvents?' · '+untimedEvents+' without a same-day time (see Daily event log)':''}. Log matching requires both endpoint names, or an explicit EWIC reference; other substation events are not assigned to these lines.`;
   const draw=()=>{
    const stop=moments[selected],row=stop?.row;
    const active=new Set(stop?.reasons.flatMap(reason=>reason.keys)||[]);
    previous.disabled=!stop||selected===0;next.disabled=!stop||selected===moments.length-1;select.value=String(selected);
    host.querySelector('[data-ewic-time-label]').textContent=stop?`${stop.time} BST · ${selected+1} of ${moments.length}`:'No notable times in the selected report';
    host.querySelector('[data-ewic-reasons]').innerHTML=stop?'<ul>'+stop.reasons.map(reason=>`<li>${reason.label?`<strong>${escape(reason.label)}</strong> · ${escape(reason.kind)}: ${signed(reason.value)} MW${reason.ties>1?` (first of ${reason.ties} equal readings)`:''}`:`<strong>${escape(reason.kind)}</strong> · ${escape(reason.description)}`}</li>`).join('')+'</ul>':'';
    host.querySelector('[data-ewic-branches]').innerHTML=catalog.circuits.map(c=>{
     const v=row?.[c.key],style=flowStyle(v),a=map.project([c.west.longitude,c.west.latitude]),b=map.project([c.east.longitude,c.east.latitude]);
     return `<path data-ewic-circuit="${c.key}" d="M${a.join(',')} L${b.join(',')}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-opacity="${active.size&&!active.has(c.key)?'.3':'1'}" stroke-dasharray="${style.dash}" stroke-linecap="round" vector-effect="non-scaling-stroke"><title>${escape(c.name)}: ${format(v)} MW${finite(v)?v>0?' west to east':v<0?' east to west':' zero flow':' unavailable'}</title></path>`;
    }).join('');
    const readingLabel=row?`EWIC reading · ${row.time} BST${minutes(row.time)!==stop.minute?' · nearest to event time':''}`:'No EWIC reading within 60 minutes';
    host.querySelector('[data-ewic-readings]').innerHTML=`<p class="ewic-map-kicker">${escape(readingLabel)}</p>`+catalog.circuits.map(c=>{const v=row?.[c.key],style=flowStyle(v);return `<article class="${active.has(c.key)?'is-highlighted':''}"><h4>${escape(c.name)}</h4><strong style="color:${style.color}">${format(v)} <small>MW</small></strong><p>${!finite(v)?'No reported value':v>0?'West → east':v<0?'East → west':'Zero flow'}</p></article>`}).join('');
   };
   previous.addEventListener('click',()=>{if(selected>0){selected--;draw()}});
   next.addEventListener('click',()=>{if(selected<moments.length-1){selected++;draw()}});
   select.addEventListener('change',()=>{const index=Number(select.value);if(Number.isInteger(index)&&index>=0&&index<moments.length){selected=index;draw()}});
   draw();
  }catch(error){if(host.isConnected)frame.innerHTML='<p class="note">The flow map could not be loaded. <button type="button" data-ewic-retry>Retry map</button></p>';host.querySelector('[data-ewic-retry]')?.addEventListener('click',()=>mount(input,events));}
 }
 root.BEGDEWICMap={render,mount,flowStyle,buildMoments,matchingCircuits};
})(typeof window==='undefined'?globalThis:window);
