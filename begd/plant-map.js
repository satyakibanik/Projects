/* Local country geometry and reviewed locations; no external map tiles or location service. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BEGDPlantMap=api})(typeof window==='undefined'?globalThis:window,()=>{
 const wheelZoomFactor=(delta,mode=0,height=800,pinch=false)=>Math.exp(Math.max(-240,Math.min(240,delta*(mode===1?16:mode===2?height:1)))*(pinch?.005:.0018));
 const zoomView=(view,factor,anchor,home)=>{
  const w=Math.min(home.w,Math.max(home.w/32,view.w*factor)),h=w*home.h/home.w;
  const x=anchor.x-(anchor.x-view.x)*w/view.w,y=anchor.y-(anchor.y-view.y)*h/view.h;
  return {x:Math.max(home.x,Math.min(home.x+home.w-w,x)),y:Math.max(home.y,Math.min(home.y+home.h-h,y)),w,h};
 };
 const key=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const project=([lon,lat])=>[(lon-88)*Math.cos(24*Math.PI/180)*150,(27-lat)*150];
 const polygons=geometry=>geometry.type==='Polygon'?[geometry.coordinates]:geometry.type==='MultiPolygon'?geometry.coordinates:[];
 const geometryPath=geometry=>polygons(geometry).map(p=>p.map(r=>r.map((v,i)=>`${i?'L':'M'}${project(v).map(n=>n.toFixed(3)).join(' ')}`).join('')+'Z').join('')).join('');
 const osmURL=id=>/^(node|way|relation)\/[1-9]\d*$/.test(String(id||''))?'https://www.openstreetmap.org/'+id:null;
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
  }).join('')}</dl><p class="plant-map-location">${location.latitude.toFixed(6)}° N, ${location.longitude.toFixed(6)}° E · ${escape(location.source)}${location.approximate?' · approximate':''}</p>${osmURL(location.osm_id)?`<p class="plant-map-osm"><a href="${osmURL(location.osm_id)}" target="_blank" rel="noopener noreferrer">View on OpenStreetMap ↗</a></p>`:''}<button type="button" data-map-plant-detail="${encodeURIComponent(plant.name)}">Open plant details and hourly output</button></article>`).join('');
 }
 const fuelColors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Wind:'#76b7b2','Dual fuel':'#9c6eaf',Other:'#526a7d'};
 const fuel=value=>String(value||'').includes('/')?'Dual fuel':fuelColors[value]?value:'Other';
 let assets;
 async function load(){
  if(!assets)assets=Promise.all(['bangladesh-boundary.geojson','plant-locations.json','plant-administrative-boundaries.geojson'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Plant map data unavailable');return r.json()})).catch(error=>{assets=null;throw error});
  return assets;
 }
 async function create({frame,sidebar,summary,legend,columns,getValue,onDetails}){
  const [boundary,catalog,administrative]=await load();if(!frame.isConnected)return null;
  const geometry=boundary.geometry,rings=polygons(geometry).flat(),points=rings.flat().map(project);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),padding=18;
  const home={x:Math.min(...xs)-padding,y:Math.min(...ys)-padding,w:Math.max(...xs)-Math.min(...xs)+padding*2,h:Math.max(...ys)-Math.min(...ys)+padding*2};
  let view={...home},markers=[],groups=[],drag=null,moved=false,zoomTarget=null,zoomFrame=0,lastZoomTime=0;
  const svgNS='http://www.w3.org/2000/svg',doc=frame.ownerDocument;
  const make=(name,attrs={})=>{const el=doc.createElementNS(svgNS,name);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el};
  const svg=make('svg',{class:'plant-location-map',role:'group','aria-label':'Power plant locations inside Bangladesh',preserveAspectRatio:'xMidYMid meet'});
  const countryPath=geometryPath(geometry);
  const path=make('path',{d:countryPath,class:'plant-map-country','fill-rule':'evenodd'});
  const defs=make('defs'),clip=make('clipPath',{id:'plant-country-clip'});clip.append(make('path',{d:countryPath,'fill-rule':'evenodd','clip-rule':'evenodd'}));defs.append(clip);svg.append(defs,path);
  const boundaries=make('g',{'clip-path':'url(#plant-country-clip)','aria-hidden':'true',class:'plant-map-boundaries'});
  for(const feature of administrative.features)boundaries.append(make('path',{d:geometryPath(feature.geometry),class:`plant-map-boundary plant-map-${feature.properties.level}-boundary`,'data-name':feature.properties.name,fill:'none'}));
  svg.append(boundaries);
  // Marker centers already pass the country fence; draw full circles across coastlines.
  const layer=make('g',{class:'plant-map-markers'});svg.append(layer);frame.replaceChildren(svg);
  const idle=()=>{sidebar.innerHTML='<span class="region-map-kicker">POWER PLANT LOCATIONS</span><h3>Explore a power plant</h3><p>Hover, focus or tap a marker to see the selected report’s plant information. Numbered markers group nearby units; zoom in to separate them.</p>'};idle();
  const show=(group,index)=>{
   layer.querySelectorAll('.plant-map-marker').forEach((el,i)=>el.classList.toggle('is-active',i===index));
   sidebar.innerHTML=`<div class="plant-map-detail-head"><span class="region-map-kicker">${group.items.length===1?'POWER PLANT':group.items.length+' GENERATING UNITS'}</span><button type="button" data-clear-plant-map aria-label="Clear selected plant">Clear</button></div>`+detailsMarkup(group.items,columns,getValue);
  };
  sidebar.addEventListener('click',event=>{const button=event.target.closest('[data-map-plant-detail]');if(button)onDetails(decodeURIComponent(button.dataset.mapPlantDetail));if(event.target.closest('[data-clear-plant-map]')){layer.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active'));idle()}});
  const repaint=()=>{
   svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
   const screenScale=Math.min((frame.clientWidth||450)/view.w,(frame.clientHeight||620)/view.h),radius=5.5/screenScale;
   groups=groupNearby(markers,44/screenScale);layer.replaceChildren();
   groups.forEach((group,index)=>{
    const multiple=group.items.length>1,color=multiple?'#19374b':fuelColors[fuel(getValue(group.items[0].plant,'fuel'))];
    const label=multiple?`${group.items.length} nearby generating units: ${group.items.map(i=>i.plant.name).join(', ')}`:group.items[0].plant.name;
    const marker=make('g',{class:'plant-map-marker',tabindex:'0',role:'button','aria-label':label,'data-unit-count':group.items.length,transform:`translate(${group.point[0]} ${group.point[1]})`});
    marker.append(make('circle',{r:radius*(multiple?1.4:1),fill:color,stroke:'#fff','stroke-width':'1.5','vector-effect':'non-scaling-stroke'}));
    const title=make('title');title.textContent=label;marker.append(title);
    if(multiple){const text=make('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':radius*1.55,fill:'#fff'});text.textContent=group.items.length;marker.append(text)}
    marker.addEventListener('pointerenter',()=>{if(!drag)show(group,index)});marker.addEventListener('focus',()=>show(group,index));
    marker.addEventListener('pointerdown',event=>event.stopPropagation());
    marker.addEventListener('click',event=>{event.stopPropagation();show(group,index)});
    marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();show(group,index)}if(event.key==='Escape'){idle();marker.classList.remove('is-active')}});
    layer.append(marker);
   });
  };
  const limit=()=>{view.x=Math.max(home.x,Math.min(home.x+home.w-view.w,view.x));view.y=Math.max(home.y,Math.min(home.y+home.h-view.h,view.y))};
  const stopZoom=()=>{if(zoomFrame)cancelAnimationFrame(zoomFrame);zoomFrame=0;zoomTarget=null;lastZoomTime=0};
  const animateZoom=time=>{
   if(!frame.isConnected){stopZoom();return;}
   const alpha=1-Math.exp(-Math.min(64,lastZoomTime?time-lastZoomTime:16)/48);lastZoomTime=time;
   for(const k of ['x','y','w','h'])view[k]+=(zoomTarget[k]-view[k])*alpha;
   svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
   const scale=Math.min((frame.clientWidth||450)/view.w,(frame.clientHeight||620)/view.h);
   for(const symbol of layer.querySelectorAll('.plant-slide-symbol'))symbol.setAttribute('transform',`scale(${1/scale})`);
   for(const halo of svg.querySelectorAll('.plant-map-heat>circle'))if(halo.dataset.screenRadius)halo.setAttribute('r',Number(halo.dataset.screenRadius)/scale);
   if(Math.max(...['x','y','w','h'].map(k=>Math.abs(view[k]-zoomTarget[k])))<home.w*.00005){view={...zoomTarget};stopZoom();repaint();return;}
   zoomFrame=requestAnimationFrame(animateZoom);
  };
  const zoom=(factor,anchor={x:view.x+view.w/2,y:view.y+view.h/2})=>{
   const from=zoomTarget||view;
   const targetAnchor={x:from.x+(anchor.x-view.x)*from.w/view.w,y:from.y+(anchor.y-view.y)*from.h/view.h};
   zoomTarget=zoomView(from,factor,targetAnchor,home);
   if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){view={...zoomTarget};stopZoom();repaint();return;}
   if(!zoomFrame)zoomFrame=requestAnimationFrame(animateZoom);
  };
  const panel=frame.closest('.plant-map-panel');
  panel.querySelectorAll('[data-plant-map-zoom]').forEach(button=>button.addEventListener('click',()=>zoom(button.dataset.plantMapZoom==='in'?.65:1/.65)));
  panel.querySelector('[data-plant-map-reset]').addEventListener('click',()=>{stopZoom();view={...home};repaint();idle()});
  svg.addEventListener('wheel',event=>{event.preventDefault();const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());zoom(wheelZoomFactor(event.deltaY,event.deltaMode,frame.clientHeight,event.ctrlKey),p)},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(event.button!==0)return;stopZoom();repaint();drag={x:event.clientX,y:event.clientY,view:{...view}};moved=false});
  svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)<4&&!moved)return;moved=true;svg.setPointerCapture(event.pointerId);const matrix=svg.getScreenCTM();view.x=drag.view.x-dx/matrix.a;view.y=drag.view.y-dy/matrix.d;limit();svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`)});
  ['pointerup','pointercancel'].forEach(type=>svg.addEventListener(type,()=>{if(moved){repaint();idle()}drag=null}));
  svg.addEventListener('pointerleave',()=>layer.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active')));
  const resize=new ResizeObserver(()=>repaint());resize.observe(frame);
  // A detached map has no live listeners or observers to retain on tab/date changes.
  const detach=new MutationObserver(()=>{if(!frame.isConnected){stopZoom();resize.disconnect();detach.disconnect()}});detach.observe(doc.getElementById('content'),{childList:true});
  return {getGroups(){return groups},update(rows){
   if(!frame.isConnected)return;stopZoom();
   const resolved=resolvePlants(rows,catalog,geometry);markers=resolved.markers;
   summary.textContent=`${markers.length} of ${markers.length+resolved.unmapped.length+resolved.outside.length} plant entries mapped · selected report · nearby units are grouped`;
   if(resolved.unmapped.length||resolved.outside.length)summary.textContent+=` · not mapped: ${[...resolved.unmapped,...resolved.outside].map(p=>p.name).join(', ')}`;
   const fuels=[...new Set(markers.map(m=>fuel(getValue(m.plant,'fuel'))))];legend.innerHTML=fuels.map(f=>`<span><i style="background:${fuelColors[f]}"></i>${escape(f)}</span>`).join('')+'<span><i style="background:#19374b"></i>Grouped units</span><span><i class="district-boundary-key"></i>District boundary</span><span><i class="division-boundary-key"></i>Division boundary</span>';
   repaint();idle();
  }};
 }
 return {wheelZoomFactor,zoomView,geometryPath,osmURL,insideCountry,resolvePlants,groupNearby,project,detailsMarkup,create};
});
