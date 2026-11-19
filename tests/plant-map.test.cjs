const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const map=require('../begd/plant-map.js');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/plant-locations.json'),'utf8'));
const boundary=JSON.parse(fs.readFileSync(path.join(__dirname,'../begd/bangladesh-boundary.geojson'),'utf8')).geometry;
test('reviewed catalog covers 155 unique dashboard entries inside Bangladesh',()=>{
 assert.equal(catalog.plants.length,155);
 assert.equal(new Set(catalog.plants.map(p=>p.name)).size,155);
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
 const dual=map.detailsMarkup([{plant:{...plant,fuel:'Gas/HSD'},location:{latitude:23,longitude:90}}],[['fuel','Fuel']],(p,k)=>p[k],{Gas:'gas-factory.png',HSD:'HSD.png'});
 assert.match(dual,/<img src="plant-icons\/gas-factory.png" alt="">Gas/);
 assert.match(dual,/<img src="plant-icons\/HSD.png" alt="">HSD/);
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

test('Rooppur is mapped when listed in the report and the map can supply its nuclear fuel type',()=>{
 const plant={name:'Rooppur Nuclear Power Plant'};
 const {markers,unmapped}=map.resolvePlants([plant],catalog,boundary);
 assert.equal(markers.length,1);
 assert.deepEqual(unmapped,[]);
 const details=map.detailsMarkup(markers,[['fuel','Fuel']],()=> '—');
 assert.match(details,/<dt>Fuel<\/dt><dd>Nuclear<\/dd>/);
 assert.ok(details.includes('href="https://osm.org/go/zq4nSU4A?m="'));
 assert.doesNotMatch(details,/IAEA-hosted|approximate/);
 assert.deepEqual(map.resolvePlants([],catalog,boundary).markers,[]);
});

test('Mercator tiles align with plant coordinates in a letterboxed viewport',()=>{
 const [x,y]=map.project([90,0]);
 const view={x:x-30,y:y-15,w:60,h:30};
 const width=300,height=300,tiles=map.tileViewport(view,width,height);
 assert.ok(tiles.length>0&&tiles.length<16);
 assert.ok(tiles.every(t=>t.left<width&&t.top<height&&t.left+t.size>0&&t.top+t.size>0));
 const equator=tiles.find(t=>t.y===2**(t.z-1)&&t.x===3*2**(t.z-2));
 assert.ok(equator);
 assert.ok(Math.abs(equator.left-width/2)<1e-7);
 assert.ok(Math.abs(equator.top-height/2)<1e-7);
});
