const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const map=require('../begd/plant-map.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/plant-locations.json'),'utf8'));
const boundary=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/bangladesh-boundary.geojson'),'utf8')).geometry;
test('reviewed catalog covers 154 unique dashboard entries inside Bangladesh',()=>{
 assert.equal(catalog.plants.length,154);
 assert.equal(new Set(catalog.plants.map(p=>p.name)).size,154);
 assert.ok(catalog.excluded.some(p=>p.name==='Water Level'));
 for(const p of catalog.plants)assert.ok(map.insideCountry(p.longitude,p.latitude,boundary),p.name);
 for(const [lon,lat] of [[0,0],[88.3639,22.5726],[91.2924,27.1952],[93,23.5]])assert.equal(map.insideCountry(lon,lat,boundary),false);
});
test('country fence honors polygon holes and boundary points',()=>{
 const g={type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]};
 assert.equal(map.insideCountry(2,2,g),true);assert.equal(map.insideCountry(5,5,g),false);assert.equal(map.insideCountry(0,5,g),true);assert.equal(map.insideCountry(NaN,5,g),false);
});
test('only units in the selected report are plotted; unknown, non-plant and outside rows cannot become markers',()=>{
 const known=catalog.plants[0];
 const rows=[{name:known.name},{name:'Water Level'},{name:'New unmapped unit'},{name:'Foreign plant'}];
 const c={...catalog,plants:[known,{name:'Foreign plant',longitude:0,latitude:0}]};
 const result=map.resolvePlants(rows,c,boundary);
 assert.equal(result.markers.length,1);assert.equal(result.markers[0].plant.name,known.name);
 assert.deepEqual(result.unmapped.map(p=>p.name),['New unmapped unit']);assert.deepEqual(result.outside.map(p=>p.name),['Foreign plant']);
});
test('user coordinates and approved primary candidates are retained without moving them',()=>{
 const get=name=>catalog.plants.find(p=>p.name===name);
 assert.deepEqual([get('SS Power').latitude,get('SS Power').longitude],[21.970844,91.888932]);
 assert.deepEqual([get('Sreepur 150 MW PP BRPL').latitude,get('Sreepur 150 MW PP BRPL').longitude],[24.2319,90.5421]);
 assert.equal(get('Gazipur 100 MW PP').approximate,true);
 assert.equal(get('Ashuganj TSK 50 MW PP').osm_id,'way/1307560517');
});
test('nearby/coincident units remain individually accessible when grouped',()=>{
 const items=[{point:[1,1],plant:{name:'Gas mode'}},{point:[1,1],plant:{name:'HSD mode'}},{point:[50,50],plant:{name:'Other site'}}];
 const groups=map.groupNearby(items,10);assert.equal(groups.length,2);assert.equal(groups[0].items.length,2);
 assert.equal(map.groupNearby([{point:[1,1]},{point:[5,5]}],1).length,2);
 // Anchors always use real member coordinates, so grouping never invents an offshore point.
 for(const group of groups)assert.ok(group.items.some(p=>p.point===group.point));
});
test('sidebar displays every plant-table field, including real zero and absent values',()=>{
 const plant={name:'Plant <A>',fuel:'Gas',region:'Dhaka',producer:'IPP',installed:100,present:0,peak:null};
 const html=map.detailsMarkup([{plant,location:{latitude:23,longitude:90,source:'Reviewed'}}],[['name','Name'],['fuel','Fuel'],['region','Region'],['producer','Producer'],['installed','Installed cap.'],['present','Present cap.'],['peak','Peak gen. today']],(p,k)=>p[k]);
 for(const field of ['Plant &lt;A&gt;','Fuel','Gas','Region','Dhaka','Producer','IPP','Installed cap.','100 MW','Present cap.','0 MW','Peak gen. today','—'])assert.ok(html.includes(field),field);
 assert.doesNotMatch(html,/<A>/);
});
test('sidebar links only to validated matched OSM features',()=>{
 const render=osm_id=>map.detailsMarkup([{plant:{name:'Reviewed unit'},location:{latitude:23,longitude:90,source:'OSM',osm_id}}],[],()=>null);
 for(const id of ['node/123','way/1307560517','relation/42']){
  assert.ok(render(id).includes(`href="https://www.openstreetmap.org/${id}"`));
  assert.ok(render(id).includes('rel="noopener noreferrer"'));
 }
 for(const id of [null,'','https://example.org','way/12" onclick="bad','way/-1'])assert.doesNotMatch(render(id),/View on OpenStreetMap/);
});
test('administrative outlines cover all 64 districts and eight divisions',()=>{
 const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/plant-administrative-boundaries.geojson'),'utf8'));
 const districts=data.features.filter(f=>f.properties.level==='district'),divisions=data.features.filter(f=>f.properties.level==='division');
 assert.equal(districts.length,64);assert.equal(divisions.length,8);
 assert.equal(new Set(districts.map(f=>f.properties.name)).size,64);
 for(const d of divisions){assert.equal(d.properties.district_count,districts.filter(f=>f.properties.division===d.properties.name).length);assert.ok(d.properties.district_count>0)}
 for(const f of data.features){const path=map.geometryPath(f.geometry);assert.match(path,/^M/);assert.doesNotMatch(path,/NaN|Infinity/);assert.ok(path.endsWith('Z'))}
});
