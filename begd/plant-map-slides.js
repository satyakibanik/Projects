/* Experimental map slides: metrics, categorical rings, and user-supplied generation icons. */
(function(root){
'use strict';
const base=root.BEGDPlantMap;if(!base)return;
const NS='http://www.w3.org/2000/svg',BLUE='#2374e8',YELLOW='#ffe04b',RED='#ed3c35',GRAY='#89939e',MISSING='#9b7baf';
const fuelColors={Coal:'#586574',Gas:'#2878cd',HFO:'#e67e28',HSD:'#df527b',Hydro:'#159d9c',Solar:'#e0b91d',Wind:'#4c9e48',Nuclear:'#8b5bc7','Not reported':MISSING};
const slides=[
 {id:'fuel',title:'Fuel type',description:'Color and icons identify generation type. Hover a fuel icon below to preview matching units; click it to keep the selection.'},
 {id:'energy',title:'Daily energy',unit:'MWh',description:'Reported energy generated across the operating day.',heat:true},
 {id:'peak',title:'Daily peak generation',unit:'MW',description:'Highest reported output for each generating unit during the day.',heat:true},
 {id:'region',title:'Region',description:'Color identifies the report’s operating region.'},
 {id:'producer',title:'Producer',description:'Color identifies the producer listed in the report.'},
 {id:'capacity',title:'Present capacity',unit:'MW',description:'Reported present capacity of each generating unit.'},
 {id:'status',title:'Online / offline',description:'Online: reported output during the day. Offline: no reported output; this alone does not establish an outage.'}
];
const colors=['#2878cd','#e67e28','#8b5bc7','#279d78','#df527b','#b18a1f','#19a1b3','#b85936','#6776c9','#5d8e39','#bd49a4','#627484'];
const icons={Imports:'import-export.png',Coal:'coal.png',Gas:'gas-factory.png',HFO:'HFO.png',HSD:'HSD.png',Hydro:'hydroelectricity.png',Solar:'solar.png',Wind:'wind-energy.png',Nuclear:'nuclear-plant.png'};
let preferred=0,instance=0;
const categoryRegistry={region:new Map(),producer:new Map()};
const fmt=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:1});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
function color(value,max){
 if(value===null)return MISSING;if(value===0)return GRAY;
 const t=max>0?Math.min(1,Math.max(0,value/max)):0;
 const a=t<=.5?[255,224,75]:[250,143,40],b=t<=.5?[250,143,40]:[237,60,53],f=t<=.5?t*2:(t-.5)*2;
 return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*f).toString(16).padStart(2,'0')).join('');
}
function metric(plant,id,options){
 if(id==='energy')return number(options.getEnergy?.(plant)??plant.energy_mwh);
 return number(options.getValue(plant,id==='capacity'?'present':'peak'));
}
function types(plant,options){
 const fuel=String(options.getValue(plant,'fuel')||'');
 return fuel.split('/').map(s=>s.trim()).filter(s=>icons[s]);
}
function category(plant,id,options){
 if(id==='fuel')return types(plant,options).join(' / ')||'Not reported';
 if(id==='status')return plant.status==='running'?'Online':plant.status==='no-output'?'Offline':'Not reported';
 const v=options.getValue(plant,id);return !v||v==='—'?'Not reported':String(v);
}
function matchesSelection(plant,selection,options){
 if(!selection)return true;
 const {id,value}=selection;
 if(id==='fuel')return value==='Not reported'?types(plant,options).length===0:types(plant,options).includes(value);
 if(['energy','peak','capacity'].includes(id)){const v=metric(plant,id,options);return value==='missing'?v===null:value==='zero'?v===0:v!==null&&v>0;}
 return category(plant,id,options)===value;
}
const make=(doc,name,attrs={})=>{const el=doc.createElementNS(NS,name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el};
async function create(options){
 const controller=await base.create(options);if(!controller||!options.frame.isConnected)return controller;
 const frame=options.frame,doc=frame.ownerDocument,panel=frame.closest('.plant-map-panel'),svg=frame.querySelector('svg'),layer=svg.querySelector('.plant-map-markers');
 let index=preferred,rows=[],mappedRows=[],activeFilter=null,categoryMaps=categoryRegistry,highlightedFuel=null,pinnedFuel=null,suppressPreview=false;const uid=++instance;
 panel.classList.add('has-plant-slides');
 const controls=doc.createElement('div');controls.className='plant-slides';controls.setAttribute('aria-label','Plant map slides');
 controls.innerHTML=`<div class="plant-slide-top"><div class="plant-slide-arrows"><button type="button" data-slide-step="-1" aria-label="Previous map slide">←</button><span class="plant-slide-count"></span><button type="button" data-slide-step="1" aria-label="Next map slide">→</button></div></div><div class="plant-slide-tabs" role="tablist" aria-label="Map color basis">${slides.map((s,i)=>`<button type="button" role="tab" id="plant-slide-${uid}-${i}" aria-controls="plant-slide-panel-${uid}" data-slide="${i}"><span>${String(i+1).padStart(2,'0')}</span>${s.title}</button>`).join('')}</div>`;
 panel.querySelector('.panel-head').after(controls);
 const info=doc.createElement('div');info.className='plant-slide-info';info.id=`plant-slide-panel-${uid}`;info.setAttribute('role','tabpanel');info.setAttribute('aria-live','polite');
 controls.after(info);
 const heat=make(doc,'g',{class:'plant-map-heat','clip-path':'url(#plant-country-clip)','aria-hidden':'true'});svg.insertBefore(heat,svg.querySelector('.plant-map-boundaries'));
 const heatDefs=make(doc,'g');svg.querySelector('defs').append(heatDefs);
 const iconKey=doc.createElement('div');iconKey.className='plant-icon-key';iconKey.setAttribute('aria-label','Generation type icons');panel.querySelector('.plant-map-layout').before(iconKey);
 function readout(plant){
  const slide=slides[index];if(slide.unit){const v=metric(plant,slide.id,options);return `${slide.title}: ${v===null?'Not reported':fmt(v)+' '+slide.unit}`;}
  return `${slide.title}: ${category(plant,slide.id,options)}`;
 }
 let scaleGroups=null,scaleCache={};
 function scaleMaximum(id){
  const groups=controller.getGroups();if(groups!==scaleGroups){scaleGroups=groups;scaleCache={};}
  if(Object.hasOwn(scaleCache,id))return scaleCache[id];
  const values=groups.map(g=>g.items.map(i=>metric(i.plant,id,options)));
  return scaleCache[id]=Math.max(0,...(id==='capacity'?values.flat():values.map(v=>v.some(n=>n!==null)?v.reduce((a,n)=>a+(n??0),0):null)).filter(v=>v!==null));
 }
 function decorateSidebar(){
  const lookup=new Map(rows.map(p=>[p.name,p]));
  for(const card of options.sidebar.querySelectorAll('.plant-map-card')){
   const plant=lookup.get(card.querySelector('h3')?.textContent);if(!plant)continue;
   let p=card.querySelector('.plant-slide-readout');if(!p){p=doc.createElement('p');p.className='plant-slide-readout';card.querySelector('dl').before(p)}
   const text=readout(plant);if(p.textContent!==text)p.textContent=text;
   const active=slides[index];p.classList.toggle('has-metric-color',Boolean(active.unit));
   if(active.unit)p.style.setProperty('--metric-color',color(metric(plant,active.id,options),scaleMaximum(active.id)));
   for(const row of card.querySelectorAll('dl>div')){
    const label=row.querySelector('dt')?.textContent,id=label==='Present cap.'?'capacity':label==='Peak gen. today'?'peak':null;
    if(!id)continue;const value=metric(plant,id,options),maximum=scaleMaximum(id),shade=color(value,maximum),dd=row.querySelector('dd');
    dd.classList.add('plant-metric-value');dd.style.setProperty('--metric-color',shade);dd.dataset.metricColor=shade;dd.dataset.metric=id;
    dd.title=`${id==='peak'?'Daily peak generation':'Present capacity'} slide scale: 0–${fmt(maximum)} MW; gray = zero, purple = not reported`;
   }
  }
 }
 function render(){
  if(!frame.isConnected)return;
  const slide=slides[index],groups=controller.getGroups(),markers=[...layer.children];
  controls.querySelector('.plant-slide-count').textContent=`${index+1} / ${slides.length}`;
  controls.querySelectorAll('[data-slide]').forEach((b,i)=>{b.setAttribute('aria-selected',String(i===index));b.tabIndex=i===index?0:-1});
  info.setAttribute('aria-labelledby',`plant-slide-${uid}-${index}`);
  const numeric=Boolean(slide.unit),values=groups.map(g=>g.items.map(i=>metric(i.plant,slide.id,options)));
  const sums=values.map(v=>v.some(n=>n!==null)?v.reduce((a,n)=>a+(n??0),0):null);
  const maximum=Math.max(0,...(slide.id==='capacity'?values.flat():sums).filter(n=>n!==null));
  const catMap=categoryMaps[slide.id]||new Map();
  const catColor=c=>c==='Not reported'?MISSING:slide.id==='fuel'?fuelColors[c]||MISSING:slide.id==='status'?(c==='Online'?BLUE:GRAY):catMap.get(c)||MISSING;
  let legend='';
  if(numeric)legend=`<div class="plant-gradient-key"><button type="button" data-legend-filter="zero"><i style="background:${GRAY}"></i>0 ${slide.unit}</button><button type="button" class="plant-positive-label" data-legend-filter="positive">&gt;0 ${slide.unit}</button><div class="plant-gradient"><span>${fmt(maximum/2)} ${slide.unit}</span></div><span><i style="background:${RED}"></i>${fmt(maximum)} ${slide.unit} · highest</span><button type="button" data-legend-filter="missing"><i style="background:${MISSING}"></i>Not reported</button></div>`;
  else {const categories=slide.id==='fuel'?[...new Set(mappedRows.flatMap(p=>types(p,options)))].sort():slide.id==='status'?['Online','Offline','Not reported']:[...catMap.keys()];legend=`<div class="plant-category-key">${categories.map(c=>`<button type="button" data-legend-filter="${esc(c)}" aria-pressed="${activeFilter?.id===slide.id&&activeFilter.value===c}"><i style="background:${catColor(c)}"></i>${esc(c)}</button>`).join('')}</div>`;}
  if(numeric&&maximum===0)legend=`<div class="plant-gradient-key"><button type="button" data-legend-filter="zero"><i style="background:${GRAY}"></i>0 ${slide.unit}</button><span>No positive reported values</span><button type="button" data-legend-filter="missing"><i style="background:${MISSING}"></i>Not reported</button></div>`;
  const partial=values.filter(v=>v.some(n=>n===null)&&v.some(n=>n!==null)).length;
  const note=slide.heat?`Marker size, color and halo show combined ${slide.unit} for grouped units; scale follows the filtered map and zoom.${slide.id==='peak'?' Grouped values sum individual daily peaks, which may occur at different times.':''}${partial?' '+partial+' group(s) have incomplete readings.':''}`:slide.id==='capacity'?'Marker size shows the largest unit capacity in a group. Each ring segment shows one unit’s capacity; shared capacities are not added together.':slide.id==='fuel'?'Split rings and multiple icons identify mixed-fuel groups. Hover a fuel icon below to preview matching units; click it to keep the selection.':'Split rings show each category’s share of the units in a group.';
  info.innerHTML=`<div class="plant-slide-heading"><h3>${slide.title}${slide.unit?' <span>'+slide.unit+'</span>':''}</h3><p>${slide.description}</p></div>${legend}<p class="plant-slide-note">${note} Icons identify generation type on every slide. Zoom in to separate nearby units.</p>`;
  info.querySelectorAll('[data-legend-filter]').forEach(b=>b.setAttribute('aria-pressed',String(activeFilter?.id===slide.id&&activeFilter.value===b.dataset.legendFilter)));
  if(activeFilter){const status=doc.createElement('p');status.className='plant-legend-filter-status';status.setAttribute('role','status');status.textContent=`Showing ${controller.getGroups().reduce((n,g)=>n+g.items.length,0)} of ${mappedRows.length} mapped units · ${activeFilter.label}. Click the selected category again or elsewhere to show all.`;info.append(status);}
  heat.replaceChildren();heatDefs.replaceChildren();
  const view=svg.viewBox.baseVal,scale=Math.min((frame.clientWidth||450)/view.width,(frame.clientHeight||620)/view.height);
  groups.forEach((g,i)=>{
   const marker=markers[i];if(!marker)return;
   marker.querySelector('.plant-slide-symbol')?.remove();
   // Keep the original marker and its listeners; replace only its visual contents.
   marker.querySelectorAll(':scope>circle,:scope>text').forEach(el=>el.setAttribute('display','none'));
   const symbol=make(doc,'g',{class:'plant-slide-symbol','pointer-events':'all',transform:`scale(${1/scale})`});
   const valueForSize=numeric?(slide.heat?sums[i]:Math.max(0,...values[i].filter(v=>v!==null))):null;
   const radius=numeric?18+14*Math.sqrt(maximum>0?(valueForSize??0)/maximum:0):24;
   marker.dataset.value=valueForSize??'';marker.dataset.radius=radius;
   const slices=numeric?(slide.heat?[color(sums[i],maximum)]:values[i].map(v=>color(v,maximum))):slide.id==='fuel'?g.items.flatMap(({plant})=>{const f=types(plant,options);return (f.length?f:['Not reported']).map(catColor)}):g.items.map(({plant})=>catColor(category(plant,slide.id,options)));
   const frequencies=new Map();slices.forEach(c=>frequencies.set(c,(frequencies.get(c)||0)+1));
   symbol.append(make(doc,'circle',{r:radius,fill:'#fff',stroke:'#fff','stroke-width':2}));
   let offset=0;for(const [c,count]of frequencies){const arc=2*Math.PI*(radius-1)*count/slices.length;
    symbol.append(make(doc,'circle',{r:radius-1,fill:'none',stroke:c,'stroke-width':4,'stroke-dasharray':`${arc} ${2*Math.PI*(radius-1)-arc}`,'stroke-dashoffset':-offset,transform:'rotate(-90)'}));offset+=arc;}
   const fuels=[...new Set(g.items.flatMap(({plant})=>types(plant,options)))];
   marker.dataset.fuels=fuels.join('|');
   marker.dataset.fuelCounts=JSON.stringify(Object.fromEntries(fuels.map(f=>[f,g.items.filter(i=>types(i.plant,options).includes(f)).length])));
   const chosen=fuels.slice(0,3),size=chosen.length===1?radius*1.45:radius*.85;
   chosen.forEach((fuel,j)=>{let x=-size/2,y=-size/2;
    if(chosen.length===2)x=(j===0?-size:0);
    if(chosen.length===3){x=j===2?-size/2:(j===0?-size:0);y=j===2?0:-size;}
    symbol.append(make(doc,'image',{href:'plant-icons/'+icons[fuel],x,y,width:size,height:size}));});
   if(!chosen.length){const t=make(doc,'text',{'text-anchor':'middle','dominant-baseline':'central','font-size':13,fill:'#334155'});t.textContent='?';symbol.append(t)}
   const badge=make(doc,'g',{class:'plant-unit-badge',display:g.items.length>1?'inline':'none'});
   badge.append(make(doc,'rect',{x:radius-11,y:-radius-6,width:20,height:16,rx:8,fill:'#17364d',stroke:'#fff','stroke-width':1}));
   const badgeText=make(doc,'text',{x:radius-1,y:-radius+2,'text-anchor':'middle','dominant-baseline':'central','font-size':9,fill:'#fff'});badgeText.textContent=g.items.length;badge.append(badgeText);symbol.append(badge);
   marker.append(symbol);
   const name=g.items.map(({plant})=>plant.name).join(', '),value=numeric&&slide.heat?`${slide.title}: ${sums[i]===null?'Not reported':fmt(sums[i])+' '+slide.unit}`:g.items.map(({plant})=>readout(plant)).join('; ');
   const title=`${name} · ${value}${numeric&&values[i].some(v=>v===null)?' · Incomplete / missing readings':''}`;marker.dataset.baseTitle=title;marker.querySelector('title').textContent=title;marker.setAttribute('aria-label',title);
   if(slide.heat&&sums[i]!==null&&sums[i]>0){const c=color(sums[i],maximum),id=`plant-heat-${uid}-${i}`,gradient=make(doc,'radialGradient',{id});
    for(const [at,opacity]of [['0%','.6'],['45%','.3'],['100%','0']])gradient.append(make(doc,'stop',{offset:at,'stop-color':c,'stop-opacity':opacity}));heatDefs.append(gradient);
    const ratio=maximum>0?sums[i]/maximum:0;heat.append(make(doc,'circle',{cx:g.point[0],cy:g.point[1],r:(radius+24*Math.sqrt(ratio))/scale,'data-screen-radius':radius+24*Math.sqrt(ratio),fill:`url(#${id})`}));}
  });
  const fuels=[...new Set(groups.flatMap(g=>g.items.flatMap(i=>types(i.plant,options))))].sort();
  iconKey.innerHTML='<strong>Generation type</strong>'+fuels.map(f=>`<button type="button" data-highlight-fuel="${f}" aria-label="Highlight ${f} plants"><img src="plant-icons/${icons[f]}" alt="">${f} (${groups.reduce((n,g)=>n+g.items.filter(i=>types(i.plant,options).includes(f)).length,0)})</button>`).join('')+'<small class="plant-fuel-summary" role="status" aria-live="polite"></small>';
  applyHighlight(highlightedFuel);decorateSidebar();
 }
 function applyHighlight(fuel){
  highlightedFuel=fuel;panel.classList.toggle('has-fuel-highlight',Boolean(fuel));
  let matchingUnits=0,matchingGroups=0,totalUnits=0;
  for(const marker of layer.children){
   const counts=JSON.parse(marker.dataset.fuelCounts||'{}'),count=fuel?(counts[fuel]||0):0,total=Number(marker.dataset.unitCount||1),matches=count>0;
   totalUnits+=total;matchingUnits+=count;if(matches)matchingGroups++;
   marker.classList.toggle('is-fuel-match',matches);marker.classList.toggle('is-fuel-muted',Boolean(fuel)&&!matches);
   const badge=marker.querySelector('.plant-unit-badge'),text=badge?.querySelector('text'),rect=badge?.querySelector('rect');
   if(badge){badge.setAttribute('display',total>1||matches?'inline':'none');text.textContent=matches?`${count}/${total}`:String(total);rect.setAttribute('width',matches?34:20);rect.setAttribute('x',Number(marker.dataset.radius)-(matches?18:11));}
   const title=(marker.dataset.baseTitle||'')+(fuel?` · ${count} of ${total} generating units match ${fuel}`:'');marker.querySelector('title').textContent=title;marker.setAttribute('aria-label',title);
  }
  iconKey.querySelectorAll('[data-highlight-fuel]').forEach(b=>{b.classList.toggle('is-highlighted',b.dataset.highlightFuel===fuel);b.setAttribute('aria-pressed',String(b.dataset.highlightFuel===pinnedFuel));});
  const summary=iconKey.querySelector('.plant-fuel-summary');
  if(summary)summary.textContent=fuel?`${fuel}: ${matchingUnits} generating unit${matchingUnits===1?'':'s'} in ${matchingGroups} map group${matchingGroups===1?'':'s'}. Highlighted badges show ${fuel} units / all units in that group.${pinnedFuel?' Selection locked. Click the icon again or anywhere else to show all units.':' Click the icon to keep this selection.'}`:`All ${totalUnits} mapped generating units shown. Badges count all units in a group; a group may combine nearby plants. Hover to preview a generation type; click to keep it selected.`;
 }
 iconKey.addEventListener('pointerover',e=>{const b=e.target.closest('[data-highlight-fuel]');if(b&&!pinnedFuel&&!suppressPreview&&!b.contains(e.relatedTarget))applyHighlight(b.dataset.highlightFuel)});
 iconKey.addEventListener('pointerleave',()=>{suppressPreview=false;applyHighlight(pinnedFuel)});
 iconKey.addEventListener('focusin',e=>{const b=e.target.closest('[data-highlight-fuel]');if(b&&!pinnedFuel&&!suppressPreview)applyHighlight(b.dataset.highlightFuel)});
 iconKey.addEventListener('focusout',e=>{if(!iconKey.contains(e.relatedTarget))applyHighlight(pinnedFuel)});
 iconKey.addEventListener('click',e=>{const b=e.target.closest('[data-highlight-fuel]');if(!b)return;const same=pinnedFuel===b.dataset.highlightFuel;pinnedFuel=same?null:b.dataset.highlightFuel;suppressPreview=same;applyHighlight(pinnedFuel)});
 function matchesFilter(plant){return matchesSelection(plant,activeFilter,options)}
 function updateMapFilter(){controller.update(rows.filter(matchesFilter));render();}
 info.addEventListener('click',e=>{
  const b=e.target.closest('[data-legend-filter]');if(!b)return;
  const slide=slides[index],value=b.dataset.legendFilter;
  activeFilter=activeFilter?.id===slide.id&&activeFilter.value===value?null:{id:slide.id,value,label:b.textContent.trim()};
  pinnedFuel=null;highlightedFuel=null;suppressPreview=true;updateMapFilter();
 });
 const clearOnOutside=e=>{
  if(e.target.closest?.('[data-legend-filter]')||controls.contains(e.target))return;
  const restore=Boolean(activeFilter);activeFilter=null;
  if(!e.target.closest?.('.plant-icon-key [data-highlight-fuel]')){pinnedFuel=null;suppressPreview=false;applyHighlight(null);}
  if(restore)updateMapFilter();
 };
 doc.addEventListener('click',clearOnOutside,true);
 function select(i,focus=false){const restore=Boolean(activeFilter);activeFilter=null;if(restore)controller.update(rows);index=(i+slides.length)%slides.length;preferred=index;render();if(focus)controls.querySelector(`[data-slide="${index}"]`).focus()}
 controls.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.slide!==undefined)select(Number(b.dataset.slide));else select(index+Number(b.dataset.slideStep))});
 controls.addEventListener('keydown',e=>{if(!e.target.matches('[data-slide]'))return;const key=e.key;if(['ArrowRight','ArrowLeft','Home','End'].includes(key)){e.preventDefault();select(key==='Home'?0:key==='End'?slides.length-1:index+(key==='ArrowRight'?1:-1),true)}});
 const markerObserver=new MutationObserver(render);markerObserver.observe(layer,{childList:true});
 const sidebarObserver=new MutationObserver(decorateSidebar);sidebarObserver.observe(options.sidebar,{childList:true,subtree:true});
 const detach=new MutationObserver(()=>{if(!frame.isConnected){markerObserver.disconnect();sidebarObserver.disconnect();detach.disconnect();doc.removeEventListener('click',clearOnOutside,true)}});detach.observe(doc.getElementById('content'),{childList:true});
 return {...controller,update(next){rows=Array.isArray(next)?next:[];
  // Stable category colors across filtering, sorting, zoom, and report changes.
  for(const id of ['region','producer']){const labels=[...new Set(rows.map(p=>category(p,id,options)))].sort();for(const label of labels)if(!categoryMaps[id].has(label)){const n=categoryMaps[id].size;categoryMaps[id].set(label,label==='Not reported'?GRAY:colors[n]||`hsl(${(n*137.508)%360} 65% 43%)`);}}
  controller.update(rows);mappedRows=controller.getGroups().flatMap(g=>g.items.map(i=>i.plant));if(activeFilter)controller.update(rows.filter(matchesFilter));render();
 }};
}
root.BEGDPlantMap={...base,create,slideColor:color,slideMetric:metric,slideMatches:matchesSelection};
})(window);
