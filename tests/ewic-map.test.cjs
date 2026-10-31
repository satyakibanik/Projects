const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'begd/ewic-locations.json'),'utf8'));
function load(fail=false){
 const nodes=new Map();
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'0',attrs:{},handlers:{},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,fn){this.handlers[k]=fn}});return nodes.get(selector)};
 const host={isConnected:true,querySelector:node};
 const window={BEGDPlantMap:require('../begd/plant-map.js')};
 const fetch=async url=>({ok:!fail,json:async()=>url==='ewic-locations.json'?catalog:JSON.parse(fs.readFileSync(path.join(root,'begd',url),'utf8'))});
 vm.runInNewContext(fs.readFileSync(path.join(root,'begd/ewic-map.js'),'utf8'),{window,document:{querySelector:()=>host},fetch});
 return {api:window.BEGDEWICMap,node};
}
test('notable-time arrows update all circuits, fixed-width direction, and missingness',async()=>{
 const {api,node}=load();
 await api.mount([
  {time:'12:00',ishwardi_ghorashal:-200,sirajganj_sreepur:null,gopalganj_aminbazar:0},
  {time:'00:00',ishwardi_ghorashal:100,sirajganj_sreepur:0,gopalganj_aminbazar:200}
 ]);
 assert.match(node('[data-ewic-time-label]').textContent,/00:00 BST/);
 assert.equal(node('[data-ewic-prev]').disabled,true);
 assert.equal(node('[data-ewic-next]').disabled,false);
 assert.match(node('[data-ewic-moment]').innerHTML,/12:00/);
 let html=node('[data-ewic-branches]').innerHTML;
 assert.equal((html.match(/data-ewic-circuit=/g)||[]).length,3);
 assert.match(html,/stroke="#267db3" stroke-width="5"/);
 assert.match(node('[data-ewic-readings]').innerHTML,/West → east/);
 node('[data-ewic-next]').handlers.click();
 html=node('[data-ewic-branches]').innerHTML;
 assert.match(html,/stroke="#d55e32" stroke-width="5"/);
 assert.match(html,/stroke-dasharray="5 5"/);
 assert.match(html,/0 MW zero flow/);
 assert.match(node('[data-ewic-time-label]').textContent,/12:00 BST/);
 assert.equal(node('[data-ewic-next]').disabled,true);
 node('[data-ewic-moment]').value='0';node('[data-ewic-moment]').handlers.change();
 assert.match(node('[data-ewic-time-label]').textContent,/00:00 BST/);
 node('[data-ewic-next]').handlers.click();
 assert.match(node('[data-ewic-readings]').innerHTML,/East → west/);
 assert.match(node('[data-ewic-readings]').innerHTML,/No reported value/);
 assert.match(node('[data-ewic-sources]').innerHTML,/OSM voltage not tagged/);
 assert.doesNotMatch(html,/NaN|Infinity/);
});
test('empty reports show unavailable circuits and disable the slider; failed assets offer retry',async()=>{
 const {api,node}=load();await api.mount([]);
 assert.equal(node('[data-ewic-prev]').disabled,true);
 assert.equal(node('[data-ewic-next]').disabled,true);
 assert.equal(node('[data-ewic-moment]').disabled,true);
 assert.equal(node('[data-ewic-time-label]').textContent,'No notable times in the selected report');
 assert.equal((node('[data-ewic-branches]').innerHTML.match(/stroke-dasharray="5 5"/g)||[]).length,3);
 const failed=load(true);await failed.api.mount([]);assert.match(failed.node('[data-ewic-frame]').innerHTML,/Retry map/);
});
test('catalogue contains six approved endpoints and explicitly discloses schematic routes',()=>{
 assert.equal(catalog.coordinate_reference,'WGS84');assert.equal(catalog.circuits.length,3);
 for(const c of catalog.circuits)for(const s of [c.west,c.east]){assert.equal(s.decision,'Use it');assert.ok(Number.isFinite(s.latitude)&&Number.isFinite(s.longitude));assert.ok(s.match_evidence);assert.ok(s.osm_id)}
 assert.match(catalog.note,/schematic/);
});

test('signed extrema combine simultaneous stops, keep zero/missing distinct and collapse constant series',()=>{
 const {api}=load();const result=api.buildMoments([
  {time:'02:00',ishwardi_ghorashal:100,sirajganj_sreepur:0},
  {time:'00:00',ishwardi_ghorashal:-300,sirajganj_sreepur:0},
  {time:'01:00',ishwardi_ghorashal:null,sirajganj_sreepur:0},
  {time:'03:00',ishwardi_ghorashal:100,sirajganj_sreepur:0},
  {time:'25:00',gopalganj_aminbazar:9999}
 ],[],catalog.circuits);
 assert.deepEqual(Array.from(result.moments,s=>s.time),['00:00','02:00']);
 assert.equal(result.moments[0].reasons.length,2);
 assert.equal(result.moments[0].reasons[0].kind,'Minimum signed flow');
 assert.equal(result.moments[0].reasons[0].value,-300);
 assert.equal(result.moments[0].reasons[1].kind,'Constant reported flow');
 assert.equal(result.moments[0].reasons[1].value,0);
 assert.equal(result.moments[1].reasons[0].ties,2);
});
test('incident aliases match endpoint pairs, exclude unrelated substation entries and preserve source text',async()=>{
 const {api,node}=load();const description='Ghorasal-Ishurdi 230kV Ckt-2 Tripped <source> & remarks';
 const events=[{outage_time:'09:30',restoration_time:'10:15',description},
 {outage_time:'11:00',description:'Ghorasal-Tongi 230kV Ckt-1 trip'},
 {outage_time:'12:00',description:'Gopalganj 132kV transformer shutdown'},
 {outage_time:'13:00',description:'Sreepur-Sirajgonj Ckt-1 restored'},
 {outage_time:'—',restoration_time:'—',description:'Gopalganj-Amin Bazar line maintenance'}];
 const rows=[{time:'09:00',ishwardi_ghorashal:100},{time:'10:00',ishwardi_ghorashal:150},{time:'11:00',ishwardi_ghorashal:200}];
 const result=api.buildMoments(rows,events,catalog.circuits);
 assert.equal(result.matchedEvents,3);assert.equal(result.untimedEvents,1);
 const incident=result.moments.find(s=>s.time==='09:30');assert.equal(incident.row.time,'09:00');
 assert.equal(incident.reasons[0].description,description);
 assert.equal(result.moments.find(s=>s.time==='10:15').row.time,'10:00');
 assert.equal(result.moments.find(s=>s.time==='13:00').row,null);
 await api.mount(rows,events);
 const index=result.moments.findIndex(s=>s.time==='09:30');node('[data-ewic-moment]').value=String(index);node('[data-ewic-moment]').handlers.change();
 assert.match(node('[data-ewic-time-label]').textContent,/09:30/);
 assert.match(node('[data-ewic-readings]').innerHTML,/09:00 BST.*nearest to event/);
 assert.match(node('[data-ewic-reasons]').innerHTML,/&lt;source&gt; &amp; remarks/);
 assert.doesNotMatch(node('[data-ewic-reasons]').innerHTML,/<source>/);
 assert.match(node('[data-ewic-branches]').innerHTML,/stroke-opacity=".3"/);
 assert.doesNotMatch(api.render(),/type="range"/);
});
test('restoration-only and overnight entries respect the selected day and midnight boundaries',()=>{
 const {api}=load();const description='Sirajganj-Sreepur line';
 const result=api.buildMoments([], [
 {outage_time:'23:50',restoration_time:'00:10',description},
 {outage_time:'—',restoration_time:'00:00',description},
 {outage_time:'23:00',restoration_time:'24:00',description},
 {outage_time:'25:00',restoration_time:'invalid',description},
 {outage_time:'14:00',description:'EWIC system operating note'}
 ],catalog.circuits);
 assert.deepEqual(Array.from(result.moments,s=>s.time),['00:00','14:00','23:00','23:50','24:00']);
 assert.equal(result.untimedEvents,1);
 assert.equal(result.moments.find(s=>s.time==='14:00').reasons[0].keys.length,3);
 assert.ok(result.moments.every(s=>s.row===null));
});
