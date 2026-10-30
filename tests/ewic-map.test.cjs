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
test('time selection updates all three branches, units, direction, fixed-scale magnitude and missingness',async()=>{
 const {api,node}=load();
 await api.mount([
  {time:'12:00',ishwardi_ghorashal:-200,sirajganj_sreepur:null,gopalganj_aminbazar:0},
  {time:'00:00',ishwardi_ghorashal:100,sirajganj_sreepur:0,gopalganj_aminbazar:200}
 ]);
 assert.equal(node('[data-ewic-time-label]').textContent,'00:00');
 assert.equal(node('[data-ewic-time]').max,'1');
 let html=node('[data-ewic-branches]').innerHTML;
 assert.equal((html.match(/data-ewic-circuit=/g)||[]).length,3);
 assert.match(html,/stroke="#267db3" stroke-width="7"/);
 assert.match(node('[data-ewic-readings]').innerHTML,/West → east/);
 node('[data-ewic-time]').value='1';node('[data-ewic-time]').handlers.input();
 html=node('[data-ewic-branches]').innerHTML;
 assert.match(html,/stroke="#d55e32" stroke-width="12"/);
 assert.match(html,/stroke-dasharray="5 5"/);
 assert.match(html,/0 MW zero flow/);
 assert.equal(node('[data-ewic-time]').attrs['aria-valuetext'],'12:00 BST');
 assert.match(node('[data-ewic-readings]').innerHTML,/East → west/);
 assert.match(node('[data-ewic-readings]').innerHTML,/No reported value/);
 assert.match(node('[data-ewic-sources]').innerHTML,/OSM voltage not tagged/);
 assert.doesNotMatch(html,/NaN|Infinity/);
});
test('empty reports show unavailable circuits and disable the slider; failed assets offer retry',async()=>{
 const {api,node}=load();await api.mount([]);
 assert.equal(node('[data-ewic-time]').disabled,true);
 assert.equal(node('[data-ewic-time-label]').textContent,'No reported readings');
 assert.equal((node('[data-ewic-branches]').innerHTML.match(/stroke-dasharray="5 5"/g)||[]).length,3);
 const failed=load(true);await failed.api.mount([]);assert.match(failed.node('[data-ewic-frame]').innerHTML,/Retry map/);
});
test('catalogue contains six approved endpoints and explicitly discloses schematic routes',()=>{
 assert.equal(catalog.coordinate_reference,'WGS84');assert.equal(catalog.circuits.length,3);
 for(const c of catalog.circuits)for(const s of [c.west,c.east]){assert.equal(s.decision,'Use it');assert.ok(Number.isFinite(s.latitude)&&Number.isFinite(s.longitude));assert.ok(s.match_evidence);assert.ok(s.osm_id)}
 assert.match(catalog.note,/schematic/);
});
