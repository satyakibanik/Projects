/* Reviewed plant locations and administrative boundaries with optional raster basemaps. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BEGDPlantMap=api})(typeof window==='undefined'?globalThis:window,()=>{
 const wheelZoomFactor=(delta,mode=0,height=800,pinch=false)=>Math.exp(Math.max(-240,Math.min(240,delta*(mode===1?16:mode===2?height:1)))*(pinch?.005:.0018));
 const zoomView=(view,factor,anchor,home)=>{
  const w=Math.min(home.w,Math.max(home.w/32,view.w*factor)),h=w*home.h/home.w;
  const x=anchor.x-(anchor.x-view.x)*w/view.w,y=anchor.y-(anchor.y-view.y)*h/view.h;
  return {x:Math.max(home.x,Math.min(home.x+home.w-w,x)),y:Math.max(home.y,Math.min(home.y+home.h-h,y)),w,h};
 };
 const key=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Use one Web Mercator coordinate system for tiles, outlines, and plant locations.
 const world=360*150*Math.cos(24*Math.PI/180);
 const project=([lon,lat])=>{
  const radians=Math.max(-85.051129,Math.min(85.051129,lat))*Math.PI/180;
  return [world*(lon/360+.5),world*(.5-Math.asinh(Math.tan(radians))/(2*Math.PI))];
 };
 function tileViewport(view,width,height,zoom){
  const scale=Math.min(width/view.w,height/view.h);
  const left=view.x+(view.w-width/scale)/2,top=view.y+(view.h-height/scale)/2;
  const z=zoom??Math.max(0,Math.min(19,Math.round(Math.log2(world*scale/256))));
  const tileCount=2**z,size=world/tileCount,tiles=[];
  const endX=Math.min(tileCount,Math.ceil((left+width/scale)/size));
  const endY=Math.min(tileCount,Math.ceil((top+height/scale)/size));
  for(let y=Math.max(0,Math.floor(top/size));y<endY;y++){
   for(let x=Math.max(0,Math.floor(left/size));x<endX;x++){
    tiles.push({z,x,y,left:(x*size-left)*scale,top:(y*size-top)*scale,size:size*scale});
   }
  }
  return tiles;
 }
 const basemaps={
  streets:{
   url:({z,x,y})=>`https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
   credit:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  },
  satellite:{
   url:({z,x,y})=>`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
   shortCredit:'<a href="https://cloudless.eox.at/documentation/license" target="_blank" rel="noopener">EOxCloudless · Sentinel 2016–17 · CC BY 4.0</a>',
   credit:'<a href="https://cloudless.eox.at/" target="_blank" rel="noopener">EOxCloudless</a> by <a href="https://eox.at/" target="_blank" rel="noopener">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2016 &amp; 2017) · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>'
  }
 };
 let preferredBasemap='streets';
 function createBasemap(frame,svg,viewChanged){
  const doc=frame.ownerDocument;
  const tiles=doc.createElement('div');tiles.className='plant-basemap-tiles';tiles.setAttribute('aria-hidden','true');
  const credit=doc.createElement('div');credit.className='plant-basemap-credit';credit.hidden=true;
  const status=doc.createElement('span');status.className='plant-basemap-status';status.setAttribute('role','status');
  frame.replaceChildren(tiles,svg,credit);
  const controls=doc.createElement('div');controls.className='plant-map-options';controls.setAttribute('data-html2canvas-ignore','');
  controls.innerHTML='<label>Basemap <select><option value="streets">OpenStreetMap streets</option><option value="boundaries">Boundaries only</option><option value="satellite">Satellite · 2016–17</option></select></label>';
  controls.append(status);frame.parentElement.append(controls);
  const picker=controls.querySelector('select');
  const credits=frame.closest('.plant-map-panel').querySelector('.plant-map-attribution');
  credits?.insertAdjacentHTML('beforeend',`<br>Basemaps · ${basemaps.streets.credit}. ${basemaps.satellite.credit}.`);
  let current=null,previous=null;
  function removeLayer(layer){layer?.element.remove()}
  function updateStatus(){
   const images=[...current?.images.values()||[]];
   if(previous&&images.length&&images.every(img=>img.naturalWidth>0)){
    removeLayer(previous);previous=null;
   }
   const available=images.some(img=>img.naturalWidth>0)||[...previous?.images.values()||[]].some(img=>!img.hidden&&img.naturalWidth>0);
   frame.classList.toggle('has-plant-basemap',available);
   const unavailable=images.length>0&&!available&&images.every(img=>img.complete);
   const message=unavailable?'Basemap tiles unavailable.':'';
   if(status.textContent!==message)status.textContent=message;
  }
  function place(img,tile){
   img.style.left=`${tile.left}px`;img.style.top=`${tile.top}px`;
   img.style.width=img.style.height=`${tile.size}px`;img.hidden=false;
  }
  function draw(view,width,height){
   const source=basemaps[picker.value];
   if(!source||!width||!height)return;
   const visibleTiles=tileViewport(view,width,height);
   if(!visibleTiles.length)return;
   const z=visibleTiles[0].z;
   if(current?.z!==z){
    if(previous?.z===z){
     removeLayer(current);current=previous;previous=null;
    }else{
     // Keep loaded imagery underneath the incoming zoom level.
     if(!previous&&current&&[...current.images.values()].some(img=>img.naturalWidth>0))previous=current;
     else removeLayer(current);
     current={z,images:new Map(),element:doc.createElement('div')};
     tiles.append(current.element);
    }
   }
   if(previous){
    for(const img of previous.images.values())img.hidden=true;
    for(const tile of tileViewport(view,width,height,previous.z)){
     const img=previous.images.get(source.url(tile));if(img)place(img,tile);
    }
   }
   const visible=new Set();
   for(const tile of visibleTiles){
    const url=source.url(tile);visible.add(url);
    let img=current.images.get(url);
    if(!img){
     img=doc.createElement('img');img.alt='';img.crossOrigin='anonymous';img.draggable=false;
     img.referrerPolicy='strict-origin-when-cross-origin';
     img.addEventListener('load',()=>{img.classList.add('is-loaded');updateStatus()});
     img.addEventListener('error',updateStatus);
     current.images.set(url,img);img.src=url;current.element.append(img);
    }
    place(img,tile);
   }
   for(const [url,img] of current.images)if(!visible.has(url)){img.remove();current.images.delete(url)}
   updateStatus();
  }
  function showCredit(){
   const source=basemaps[picker.value];
   frame.dataset.basemap=picker.value;
   credit.hidden=!source;credit.innerHTML=source?.shortCredit||source?.credit||'';
  }
  picker.value=preferredBasemap;showCredit();
  picker.addEventListener('change',()=>{
   preferredBasemap=picker.value;
   current=null;previous=null;tiles.replaceChildren();updateStatus();showCredit();
   viewChanged();
  });
  return draw;
 }
 function addFullscreenControl(viewport){
  const doc=viewport.ownerDocument,button=doc.createElement('button');
  const expand='M8 3H3v5m8-5h5v5M3 11v5h5m8-5v5h-5';
  const collapse='M3 8h5V3m8 5h-5V3M8 16v-5H3m8 5v-5h5';
  button.type='button';
  button.innerHTML='<svg viewBox="0 0 19 19" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path/></svg>';
  viewport.querySelector('.map-controls').append(button);
  let fallback=false,wasExpanded=false;
  const isExpanded=()=>fallback||doc.fullscreenElement===viewport;
  function sync(){
   const expanded=isExpanded(),label=expanded?'Exit full screen':'Enlarge map';
   button.setAttribute('aria-label',label);button.title=label;
   button.querySelector('path').setAttribute('d',expanded?collapse:expand);
   if(wasExpanded&&!expanded&&button.isConnected)button.focus({preventScroll:true});
   wasExpanded=expanded;
  }
  function setFallback(expanded){
   fallback=expanded;viewport.classList.toggle('is-plant-map-expanded',expanded);sync();
  }
  function exit(){
   if(fallback)setFallback(false);
   else if(doc.fullscreenElement===viewport)doc.exitFullscreen().catch(()=>{});
  }
  function escape(event){
   if(event.key==='Escape'&&isExpanded()){
    event.preventDefault();exit();
   }
  }
  button.addEventListener('click',async()=>{
   if(isExpanded()){exit();return}
   if(viewport.requestFullscreen){
    try{await viewport.requestFullscreen();sync();return}catch{}
   }
   setFallback(true);
  });
  doc.addEventListener('fullscreenchange',sync);
  doc.addEventListener('keydown',escape);
  sync();
  return ()=>{
   doc.removeEventListener('fullscreenchange',sync);
   doc.removeEventListener('keydown',escape);
  };
 }
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
 function plantValue({plant,location},key,getValue){
  const reported=getValue(plant,key);
  return key==='fuel'&&(!reported||reported==='—')?location.fuel??reported:reported;
 }
 function detailsMarkup(items,columns,getValue,fuelIcons){
  return items.map(({plant,location})=>{
   const osmLink=/^https:\/\/osm\.org\/go\/[A-Za-z0-9_~-]+\?m=$/.test(location.osm_url)?location.osm_url:osmURL(location.osm_id);
   const source=location.source?` · ${escape(location.source)}${location.approximate?' · approximate':''}`:'';
   return `<article class="plant-map-card"><h3>${escape(plant.name)}</h3><dl>${columns.filter(([k])=>k!=='name').map(([k,label])=>{
   const value=plantValue({plant,location},k,getValue),number=['installed','present','peak'].includes(k);
   if(k==='fuel'&&value&&fuelIcons){
    const fuels=String(value).split('/').map(name=>{
     const text=name.trim(),icon=Object.hasOwn(fuelIcons,text)?fuelIcons[text]:null;
     return `<span>${icon?`<img src="plant-icons/${escape(icon)}" alt="">`:''}${escape(text)}</span>`;
    });
    return `<div><dt>${escape(label)}</dt><dd class="plant-map-fuels">${fuels.join(' / ')}</dd></div>`;
   }
   return `<div><dt>${escape(label)}</dt><dd>${value==null?'—':number?escape(Number(value).toLocaleString('en-US',{maximumFractionDigits:1}))+' MW':escape(value)}</dd></div>`;
  }).join('')}</dl><p class="plant-map-location">${location.latitude.toFixed(6)}° N, ${location.longitude.toFixed(6)}° E${source}</p>${osmLink?`<p class="plant-map-osm"><a href="${escape(osmLink)}" target="_blank" rel="noopener noreferrer">View on OpenStreetMap ↗</a></p>`:''}<button type="button" data-map-plant-detail="${encodeURIComponent(plant.name)}">Open plant details and hourly output</button></article>`;}).join('');
 }
 const fuelColors={Gas:'#4e79a7',Coal:'#79706e',HFO:'#f28e2b',HSD:'#e15759',Hydro:'#59a14f',Solar:'#edc948',Wind:'#76b7b2',Nuclear:'#8b5bc7','Dual fuel':'#9c6eaf',Other:'#526a7d'};
 const fuel=value=>String(value||'').includes('/')?'Dual fuel':fuelColors[value]?value:'Other';
 let assets;
 async function load(){
  if(!assets)assets=Promise.all(['bangladesh-boundary.geojson','plant-locations.json?v=rooppur-osm-v2','plant-administrative-boundaries.geojson'].map(async url=>{const r=await fetch(url);if(!r.ok)throw Error('Plant map data unavailable');return r.json()})).catch(error=>{assets=null;throw error});
  return assets;
 }
 async function create({frame,sidebar,summary,legend,columns,getValue,onDetails,fuelIcons}){
  const [boundary,catalog,administrative]=await load();if(!frame.isConnected)return null;
  const geometry=boundary.geometry,rings=polygons(geometry).flat(),points=rings.flat().map(project);
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),padding=18;
  const home={x:Math.min(...xs)-padding,y:Math.min(...ys)-padding,w:Math.max(...xs)-Math.min(...xs)+padding*2,h:Math.max(...ys)-Math.min(...ys)+padding*2};
  let view={...home},markers=[],groups=[],drag=null,moved=false,zoomTarget=null,zoomFrame=0,lastZoomTime=0,groupingPixels=44,pinnedGroup=null;
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
  const layer=make('g',{class:'plant-map-markers'});svg.append(layer);
  const drawBasemap=createBasemap(frame,svg,()=>drawBasemap(view,frame.clientWidth,frame.clientHeight));
  const removeFullscreenControl=addFullscreenControl(frame.parentElement);
  const paintViewport=()=>{
   svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
   drawBasemap(view,frame.clientWidth,frame.clientHeight);
  };
  const idle=()=>{sidebar.innerHTML='<span class="region-map-kicker">POWER PLANT LOCATIONS</span><h3>Explore a power plant</h3><p>Hover or focus a marker to preview plant information. Select a marker to keep its details open. Click the map background to resume previews. Zoom in to separate nearby units.</p>'};idle();
  const clear=()=>{
   pinnedGroup=null;
   for(const marker of layer.children){marker.classList.remove('is-active');marker.setAttribute('aria-pressed','false')}
   idle();
  };
  const show=(group,marker)=>{
   for(const el of layer.children){
    el.classList.toggle('is-active',el===marker);
    el.setAttribute('aria-pressed',String(Boolean(pinnedGroup&&el===marker)));
   }
   sidebar.innerHTML=`<div class="plant-map-detail-head"><span class="region-map-kicker">${group.items.length===1?'POWER PLANT':group.items.length+' GENERATING UNITS'}</span><button type="button" data-clear-plant-map aria-label="Clear selected plant">Clear</button></div>`+detailsMarkup(group.items,columns,getValue,fuelIcons);
  };
  sidebar.addEventListener('click',event=>{const button=event.target.closest('[data-map-plant-detail]');if(button)onDetails(decodeURIComponent(button.dataset.mapPlantDetail));if(event.target.closest('[data-clear-plant-map]'))clear()});
  const repaint=()=>{
   paintViewport();
   const screenScale=Math.min((frame.clientWidth||450)/view.w,(frame.clientHeight||620)/view.h),radius=5.5/screenScale;
   groups=groupNearby(markers,groupingPixels/screenScale);layer.replaceChildren();
   groups.forEach(group=>{
    const multiple=group.items.length>1,color=multiple?'#19374b':fuelColors[fuel(plantValue(group.items[0],'fuel',getValue))];
    const label=multiple?`${group.items.length} nearby generating units: ${group.items.map(i=>i.plant.name).join(', ')}`:group.items[0].plant.name;
    const marker=make('g',{class:'plant-map-marker',tabindex:'0',role:'button','aria-label':label,'data-unit-count':group.items.length,transform:`translate(${group.point[0]} ${group.point[1]})`});
    marker.append(make('circle',{r:radius*(multiple?1.4:1),fill:color,stroke:'#fff','stroke-width':'1.5','vector-effect':'non-scaling-stroke'}));
    const title=make('title');title.textContent=label;marker.append(title);
    if(multiple){const text=make('text',{'text-anchor':'middle','dominant-baseline':'central','font-size':radius*1.55,fill:'#fff'});text.textContent=group.items.length;marker.append(text)}
    const pin=()=>{pinnedGroup=group;show(group,marker)};
    const preview=()=>{if(!drag&&!pinnedGroup)show(group,marker)};
    marker.classList.toggle('is-active',Boolean(pinnedGroup&&group.items.includes(pinnedGroup.items[0])));
    marker.setAttribute('aria-pressed',String(marker.classList.contains('is-active')));
    marker.addEventListener('pointerenter',preview);marker.addEventListener('focus',preview);
    marker.addEventListener('pointerdown',event=>event.stopPropagation());
    marker.addEventListener('click',event=>{event.stopPropagation();pin()});
    marker.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();pin()}if(event.key==='Escape')clear()});
    layer.append(marker);
   });
  };
  const limit=()=>{view.x=Math.max(home.x,Math.min(home.x+home.w-view.w,view.x));view.y=Math.max(home.y,Math.min(home.y+home.h-view.h,view.y))};
  const stopZoom=()=>{if(zoomFrame)cancelAnimationFrame(zoomFrame);zoomFrame=0;zoomTarget=null;lastZoomTime=0};
  const animateZoom=time=>{
   if(!frame.isConnected){stopZoom();return;}
   const alpha=1-Math.exp(-Math.min(64,lastZoomTime?time-lastZoomTime:16)/48);lastZoomTime=time;
   for(const k of ['x','y','w','h'])view[k]+=(zoomTarget[k]-view[k])*alpha;
   paintViewport();
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
  panel.querySelector('[data-plant-map-reset]').addEventListener('click',()=>{stopZoom();view={...home};repaint();if(!pinnedGroup)idle()});
  svg.addEventListener('wheel',event=>{event.preventDefault();const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse());zoom(wheelZoomFactor(event.deltaY,event.deltaMode,frame.clientHeight,event.ctrlKey),p)},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(event.button!==0)return;if(zoomFrame){stopZoom();repaint()}drag={x:event.clientX,y:event.clientY,view:{...view}};moved=false});
  svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)<4&&!moved)return;moved=true;svg.setPointerCapture(event.pointerId);const matrix=svg.getScreenCTM();view.x=drag.view.x-dx/matrix.a;view.y=drag.view.y-dy/matrix.d;limit();paintViewport()});
  ['pointerup','pointercancel'].forEach(type=>svg.addEventListener(type,()=>{if(drag&&moved){repaint();if(!pinnedGroup)idle()}drag=null}));
  svg.addEventListener('click',()=>{if(!moved)clear()});
  svg.addEventListener('pointerleave',()=>{if(!pinnedGroup)layer.querySelectorAll('.is-active').forEach(el=>el.classList.remove('is-active'))});
  const resize=new ResizeObserver(()=>repaint());resize.observe(frame);
  // A detached map has no live listeners or observers to retain on tab/date changes.
  const detach=new MutationObserver(()=>{if(!frame.isConnected){stopZoom();resize.disconnect();removeFullscreenControl();detach.disconnect()}});detach.observe(doc.getElementById('content'),{childList:true});
  return {getGroups(){return groups},setGroupingPixels(pixels){
   if(groupingPixels!==pixels){groupingPixels=pixels;repaint()}
  },update(rows){
   if(!frame.isConnected)return;stopZoom();
   const resolved=resolvePlants(rows,catalog,geometry);markers=resolved.markers;
   summary.textContent=`${markers.length} of ${markers.length+resolved.unmapped.length+resolved.outside.length} plant entries mapped · selected report · nearby units are grouped`;
   if(resolved.unmapped.length||resolved.outside.length)summary.textContent+=` · not mapped: ${[...resolved.unmapped,...resolved.outside].map(p=>p.name).join(', ')}`;
   const fuels=[...new Set(markers.map(m=>fuel(plantValue(m,'fuel',getValue))))];legend.innerHTML=fuels.map(f=>`<span><i style="background:${fuelColors[f]}"></i>${escape(f)}</span>`).join('')+'<span><i style="background:#19374b"></i>Grouped units</span><span><i class="district-boundary-key"></i>District boundary</span><span><i class="division-boundary-key"></i>Division boundary</span>';
   pinnedGroup=null;repaint();idle();
  }};
 }
 return {wheelZoomFactor,zoomView,tileViewport,geometryPath,osmURL,insideCountry,resolvePlants,groupNearby,project,detailsMarkup,create};
});
