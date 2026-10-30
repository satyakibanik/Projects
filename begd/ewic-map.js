/* Candidate OSM transmission routes and voltage-specific endpoint sites. */
(function(root){
 const finite=value=>typeof value==='number'&&Number.isFinite(value);
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const format=value=>finite(value)?Math.abs(value).toLocaleString('en-US',{maximumFractionDigits:1}):'—';
 function flowStyle(value,maximum){
  return {color:!finite(value)||value===0?'#788692':value>0?'#267db3':'#d55e32',width:finite(value)?2+10*Math.abs(value)/Math.max(1,maximum):2,dash:finite(value)?'':'5 5'};
 }
 const render=()=>`<div class="ewic-map" id="ewic-flow-map" data-ewic-map><h3>Interconnector flow map</h3><p class="note">OSM transmission routes · EWIC corridor assignments inferred</p><div class="ewic-map-layout"><div class="ewic-map-frame" data-ewic-frame role="status">Loading map…</div><div class="ewic-map-readings" data-ewic-readings></div></div><div class="ewic-map-time"><label for="ewic-time">Time of day · BST <output for="ewic-time" data-ewic-time-label></output></label><input id="ewic-time" data-ewic-time type="range" min="0" max="0" value="0" step="1" disabled aria-label="Interconnector flow time of day in Bangladesh time"><div class="ewic-map-hours"><span data-ewic-first></span><span data-ewic-last></span></div></div><p class="note">Blue: west → east · Orange: east → west · Grey: zero or unavailable (dashed). Width shows absolute MW on a fixed scale across the selected day. Slider steps use reported EWIC readings; missing values are not interpolated.</p><details><summary>Coordinate sources and limitations</summary><p class="note">Routes follow the supplied OSM transmission geometry snapshot dated 25 October 2026. Sirajganj uses the Jamuna Bridge 230 kV site; Gopalganj uses Gopalganj (N) 400 kV. These are candidate EWIC corridor assignments, inferred from line geometry, voltage and connectivity. Some OSM line names are missing or unreliable. Small gaps between line terminals and substation centre markers are retained.</p><p class="note">Route data © OpenStreetMap contributors · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">ODbL</a>.</p><div data-ewic-sources></div></details></div>`;
 async function mount(input){
  const host=document.querySelector('[data-ewic-map]');if(!host)return;
  const frame=host.querySelector('[data-ewic-frame]');
  try{
   const [catalog,boundary,admin]=await Promise.all(['ewic-locations.json','bangladesh-boundary.geojson','plant-administrative-boundaries.geojson'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Map asset unavailable');return r.json()}));
   if(!host.isConnected)return;
   const map=root.BEGDPlantMap;if(!map)throw Error('Map projection unavailable');
   const rows=input.filter(row=>/^\d{2}:\d{2}$/.test(row.time)).slice().sort((a,b)=>a.time.localeCompare(b.time));
   const maximum=Math.max(1,...rows.flatMap(row=>catalog.circuits.map(c=>row[c.key])).filter(finite).map(Math.abs));
   const country=map.geometryPath(boundary.geometry);
   const points=catalog.circuits.flatMap(c=>c.routes.flat().map(map.project));
   const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
   const viewBox=[Math.min(...xs)-55,Math.min(...ys)-35,Math.max(...xs)-Math.min(...xs)+110,Math.max(...ys)-Math.min(...ys)+75].join(' ');
   frame.innerHTML=`<svg class="plant-location-map ewic-location-map" viewBox="${viewBox}" role="img" aria-label="Candidate east–west interconnector line routes on the Bangladesh basemap"><path class="plant-map-country" d="${country}"/><g class="plant-map-boundaries" aria-hidden="true">${admin.features.map(f=>`<path class="plant-map-boundary plant-map-${escape(f.properties.level)}-boundary" fill="none" d="${map.geometryPath(f.geometry)}"/>`).join('')}</g><g data-ewic-branches></g><g>${catalog.circuits.flatMap(c=>[c.west,c.east]).map(site=>{const [x,y]=map.project([site.longitude,site.latitude]);return `<g><circle cx="${x}" cy="${y}" r="2.4" fill="var(--ink)" stroke="var(--bg)" stroke-width="2"/><text class="ewic-site-label" x="${x+5}" y="${y-6}">${escape(site.name)}</text></g>`}).join('')}</g></svg>`;
   frame.removeAttribute('role');
   host.querySelector('[data-ewic-sources]').innerHTML=catalog.circuits.map(c=>`<p class="note"><strong>${escape(c.name)}</strong> · route ${c.route_ids.map(id=>`<a href="https://www.openstreetmap.org/${escape(id)}" target="_blank" rel="noopener noreferrer">${escape(id)}</a>`).join(' + ')}<br>${[c.west,c.east].map(s=>`${escape(s.name)}: ${s.latitude.toFixed(6)}° N, ${s.longitude.toFixed(6)}° E · <a href="https://www.openstreetmap.org/${escape(s.osm_id)}" target="_blank" rel="noopener noreferrer">${escape(s.osm_id)}</a> · ${escape(s.source)} · ${escape(s.match_evidence)}`).join('<br>')}</p>`).join('');
   const slider=host.querySelector('[data-ewic-time]');slider.max=String(Math.max(0,rows.length-1));slider.disabled=!rows.length;
   const draw=()=>{
    const row=rows[Number(slider.value)];host.querySelector('[data-ewic-time-label]').textContent=row?.time||'No reported readings';
    slider.setAttribute('aria-valuetext',row?row.time+' BST':'No reported readings');
    host.querySelector('[data-ewic-branches]').innerHTML=catalog.circuits.map(c=>{
     const v=row?.[c.key],style=flowStyle(v,maximum);
     const routePath=c.routes.map(route=>route.map((point,i)=>(i?'L':'M')+map.project(point).map(n=>n.toFixed(3)).join(',')).join(' ')).join(' ');
     return `<path data-ewic-circuit="${c.key}" d="${routePath}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-dasharray="${style.dash}" stroke-linecap="round" vector-effect="non-scaling-stroke"><title>${escape(c.name)}: ${format(v)} MW${finite(v)?v>0?' west to east':v<0?' east to west':' zero flow':' unavailable'}</title></path>`;
    }).join('');
    host.querySelector('[data-ewic-readings]').innerHTML=`<p class="ewic-map-kicker">SELECTED DAY · ${escape(row?.time||'—')} BST</p>`+catalog.circuits.map(c=>{const v=row?.[c.key],style=flowStyle(v,maximum);return `<article><h4>${escape(c.name)}</h4><strong style="color:${style.color}">${format(v)} <small>MW</small></strong><p>${!finite(v)?'No reported value':v>0?'West → east':v<0?'East → west':'Zero flow'}</p></article>`}).join('');
   };
   host.querySelector('[data-ewic-first]').textContent=rows[0]?.time||'';host.querySelector('[data-ewic-last]').textContent=rows.at(-1)?.time||'';
   slider.addEventListener('input',draw);draw();
  }catch(error){if(host.isConnected)frame.innerHTML='<p class="note">The flow map could not be loaded. <button type="button" data-ewic-retry>Retry map</button></p>';host.querySelector('[data-ewic-retry]')?.addEventListener('click',()=>mount(input));}
 }
 root.BEGDEWICMap={render,mount,flowStyle};
})(typeof window==='undefined'?globalThis:window);
