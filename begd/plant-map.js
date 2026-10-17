/* Local country geometry and reviewed locations; no external map tiles or location service. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BEGDPlantMap=api})(typeof window==='undefined'?globalThis:window,()=>{
 const key=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const project=([lon,lat])=>[(lon-88)*Math.cos(24*Math.PI/180)*150,(27-lat)*150];
 const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 function onSegment(p,a,b){const cross=(p[1]-a[1])*(b[0]-a[0])-(p[0]-a[0])*(b[1]-a[1]);return Math.abs(cross)<1e-10&&p[0]>=Math.min(a[0],b[0])-1e-10&&p[0]<=Math.max(a[0],b[0])+1e-10&&p[1]>=Math.min(a[1],b[1])-1e-10&&p[1]<=Math.max(a[1],b[1])+1e-10}
 function inRing(point,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[j],b=ring[i];if(onSegment(point,a,b))return true;
   if((b[1]>point[1])!==(a[1]>point[1])&&point[0]<(a[0]-b[0])*(point[1]-b[1])/(a[1]-b[1])+b[0])inside=!inside;
  }return inside;
 }
 function insideCountry(lon,lat,geometry){return Number.isFinite(lon)&&Number.isFinite(lat)&&polygons(geometry).some(p=>inRing([lon,lat],p[0])&&!p.slice(1).some(r=>inRing([lon,lat],r)))}
 function resolvePlants(rows,catalog,geometry){
  const lookup=new Map(catalog.plants.map(p=>[key(p.name),p])),excluded=new Set((catalog.excluded||[]).map(p=>key(p.name)));
  const markers=[],unmapped=[],outside=[];
  for(const plant of rows){
   if(excluded.has(key(plant.name)))continue;
   const location=lookup.get(key(plant.name));
   if(!location){unmapped.push(plant);continue}
   if(!insideCountry(location.longitude,location.latitude,geometry)){outside.push(plant);continue}
   markers.push({plant,location,point:project([location.longitude,location.latitude])});
  }return {markers,unmapped,outside};
 }
 function groupNearby(markers,distance){
  const groups=[];
  for(const item of markers){
   let group=groups.find(g=>Math.hypot(g.point[0]-item.point[0],g.point[1]-item.point[1])<=distance);
   if(group)group.items.push(item);else groups.push({point:item.point,items:[item]});
  }return groups;
 }
 function detailsMarkup(items,columns,getValue){
  return items.map(({plant,location})=>`<article class="plant-map-card"><h3>${escape(plant.name)}</h3><dl>${columns.filter(([k])=>k!=='name').map(([k,label])=>{
   const value=getValue(plant,k),number=['installed','present','peak'].includes(k);
   return `<div><dt>${escape(label)}</dt><dd>${value==null?'—':number?escape(Number(value).toLocaleString('en-US',{maximumFractionDigits:1}))+' MW':escape(value)}</dd></div>`;
  }).join('')}</dl><p class="plant-map-location">${location.latitude.toFixed(6)}° N, ${location.longitude.toFixed(6)}° E · ${escape(location.source)}${location.approximate?' · approximate':''}</p><button type="button" data-map-plant-detail="${encodeURIComponent(plant.name)}">Open plant details and hourly output</button></article>`).join('');
 }
 const fuelColors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Wind:'#76b7b2','Dual fuel':'#9c6eaf',Other:'#526a7d'};
 const fuel=value=>String(value||'').includes('/')?'Dual fuel':fuelColors[value]?value:'Other';
 let assets;
 async function load(){
  if(!assets)assets=Promise.all(['bangladesh-boundary.geojson','plant-locations.json'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Plant map data unavailable');return r.json()})).catch(error=>{assets=null;throw error});
  return assets;
 }
 async function create({frame,sidebar,summary,legend,columns,getValue,onDetails}){
  const [boundary,catalog]=await load();if(!frame.isConnected)return null;
  const geometry=boundary.geometry,rings=polygons(geometry).flat(),points=rings.flat().map(project);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),padding=18;
  const home={x:Math.min(...xs)-padding,y:Math.min(...ys)-padding,w:Math.max(...xs)-Math.min(...xs)+padding*2,h:Math.max(...ys)-Math.min(...ys)+padding*2};
  let view={...home},markers=[],groups=[],drag=null,moved=false;
  const svgNS='http://www.w3.org/2000/svg',doc=frame.ownerDocument;
  const make=(name,attrs={})=>{const el=doc.createElementNS(svgNS,name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el};
  const svg=make('svg',{class:'plant-location-map',role:'group','aria-label':'Power plant locations inside Bangladesh',preserveAspectRatio:'xMidYMid meet'});
  const countryPath=polygons(geometry).map(p=>p.map(r=>r.map((v,i)=>`${i?'L':'M'}${project(v).map(n=>n.toFixed(3)).join(' ')}`).join('')+'Z').join('')).join('');
  const path=make('path',{d:countryPath,class:'plant-map-country','fill-rule':'evenodd'});
  const defs=make('defs'),clip=make('clipPath',{id:'plant-country-clip'});clip.append(make('path',{d:countryPath,'fill-rule':'evenodd','clip-rule':'evenodd'}));defs.append(clip);svg.append(defs,path);
  const layer=make('g',{'clip-path':'url(#plant-country-clip)'});svg.append(layer);frame.replaceChildren(svg);
  const idle=()=>{sidebar.innerHTML='<span class="region-map-kicker">POWER PLANT LOCATIONS</span><h3>Explore a power plant</h3><p>Hover, focus or tap a marker to see the selected report’s plant information. Numbered markers group nearby units; zoom in to separate them.</p>'};idle();
  const show=(group,index)=>{
   layer.querySelectorAll('.plant-map-marker').forEach((el,i)=>el.classList.toggle('is-active',i===index));
   sidebar.innerHTML=`<div class="plant-map-detail-head"><span class="region-map-kicker">${group.items.length===1?'POWER PLANT':group.items.length+' GENERATING UNITS'}</span><button type="button" data-clear-plant-map aria-label="Clear selected plant">Clear</button></div>`+detailsMarkup(group.items,columns,getValue);
  };
  sidebar.addEventListener('click',event=>{const button=event.target.closest('[data-map-plant-detail]');if(button)onDetails(decodeURIComponent(button.dataset.mapPlantDetail));if(event.target.closest('[data-clear-plant-map]')){layer.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active'));idle()}});
  const repaint=()=>{
   svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
   const screenScale=Math.min((frame.clientWidth||450)/view.w,(frame.clientHeight||620)/view.h),radius=8/screenScale;
   groups=groupNearby(markers,21/screenScale);layer.replaceChildren();
   groups.forEach((group,index)=>{
    const multiple=group.items.length>1,color=multiple?'#19374b':fuelColors[fuel(getValue(group.items[0].plant,'fuel'))];
    const label=multiple?`${group.items.length} nearby generating units: ${group.items.map(i=>i.plant.name).join(', ')}`:group.items[0].plant.name;
    const marker=make('g',{class:'plant-map-marker',tabindex:'0',role:'button','aria-label':label,'data-unit-count':group.items.length,transform:`translate(${group.point[0]} ${group.point[1]})`});
    marker.append(make('circle',{r:radius*(multiple?1.25:1),fill:color,stroke:'#fff','stroke-width':'1.5','vector-effect':'non-scaling-stroke'}));
    const title=make('title');title.textContent=label;marker.append(title);
    if(multiple){const text=make('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':radius*1.25,fill:'#fff'});text.textContent=group.items.length;marker.append(text)}
    marker.addEventListener('pointerenter',()=>{if(!drag)show(group,index)});marker.addEventListener('focus',()=>show(group,index));
    marker.addEventListener('click',event=>{event.stopPropagation();if(!moved)show(group,index)});
    marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show(group,index)}if(event.key==='Escape'){idle();marker.classList.remove('is-active')}});
    layer.append(marker);
   });
  };
  const limit=()=>{view.x=Math.max(home.x,Math.min(home.x+home.w-view.w,view.x));view.y=Math.max(home.y,Math.min(home.y+home.h-view.h,view.y))};
  const zoom=(factor,anchor={x:view.x+view.w/2,y:view.y+view.h/2})=>{
   const w=Math.min(home.w,Math.max(home.w/32,view.w*factor)),h=w*home.h/home.w;
   view={x:anchor.x-(anchor.x-view.x)*w/view.w,y:anchor.y-(anchor.y-view.y)*h/view.h,w,h};limit();repaint();idle();
  };
  const panel=frame.closest('.plant-map-panel');
  panel.querySelectorAll('[data-plant-map-zoom]').forEach(button=>button.addEventListener('click',()=>zoom(button.dataset.plantMapZoom==='in'?.65:1/.65)));
  panel.querySelector('[data-plant-map-reset]').addEventListener('click',()=>{view={...home};repaint();idle()});
  svg.addEventListener('wheel',event=>{event.preventDefault();const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());zoom(event.deltaY<0?.8:1.25,p)},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,view:{...view}};moved=false});
  svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)<4&&!moved)return;moved=true;svg.setPointerCapture(event.pointerId);const matrix=svg.getScreenCTM();view.x=drag.view.x-dx/matrix.a;view.y=drag.view.y-dy/matrix.d;limit();svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`)});
  ['pointerup','pointercancel'].forEach(type=>svg.addEventListener(type,()=>{if(moved){repaint();idle()}drag=null}));
  svg.addEventListener('pointerleave',()=>layer.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active')));
  const resize=new ResizeObserver(()=>repaint());resize.observe(frame);
  // A detached map has no live listeners or observers to retain on tab/date changes.
  const detach=new MutationObserver(()=>{if(!frame.isConnected){resize.disconnect();detach.disconnect()}});detach.observe(doc.getElementById('content'),{childList:true});
  return {update(rows){
   if(!frame.isConnected)return;
   const resolved=resolvePlants(rows,catalog,geometry);markers=resolved.markers;
   summary.textContent=`${markers.length} of ${markers.length+resolved.unmapped.length+resolved.outside.length} plant entries mapped · selected report · nearby units are grouped`;
   if(resolved.unmapped.length||resolved.outside.length)summary.textContent+=` · not mapped: ${[...resolved.unmapped,...resolved.outside].map(p=>p.name).join(', ')}`;
   const fuels=[...new Set(markers.map(m=>fuel(getValue(m.plant,'fuel'))))];legend.innerHTML=fuels.map(f=>`<span><i style="background:${fuelColors[f]}"></i>${escape(f)}</span>`).join('')+'<span><i style="background:#19374b"></i>Grouped units</span>';
   repaint();idle();
  }};
 }
 return {insideCountry,resolvePlants,groupNearby,project,detailsMarkup,create};
});
