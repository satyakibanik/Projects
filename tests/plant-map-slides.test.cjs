const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context={window:{BEGDPlantMap:{create(){}}}};
const source=fs.readFileSync(path.join(root,'begd/plant-map-slides.js'),'utf8');
vm.runInNewContext(source,context);
const {slideColor:color,slideMetric:metric,slideMatches:matches}=context.window.BEGDPlantMap;
const options={getValue:(p,k)=>p[k],getEnergy:p=>p.energy_mwh};
const select=(p,id,value)=>matches(p,{id,value},options);

test('numeric colors keep zero and missing distinct from positive energy or MW',()=>{
 assert.equal(color(0,100),'#89939e');assert.equal(color(null,100),'#9b7baf');
 assert.equal(color(1,1e12),'#ffe04b');assert.equal(color(50,100),'#fa8f28');assert.equal(color(100,100),'#ed3c35');
 assert.notEqual(color(.01,100),color(0,100));assert.equal(color(0,0),'#89939e');
});
test('energy, peak and present capacity read independent fields and preserve real zero',()=>{
 const plant={energy_mwh:2400,peak:180,present:250};
 assert.equal(metric(plant,'energy',options),2400);assert.equal(metric(plant,'peak',options),180);assert.equal(metric(plant,'capacity',options),250);
 assert.equal(metric({energy_mwh:0},'energy',options),0);
 for(const v of [null,undefined,'',-1,'not reported',Infinity])assert.equal(metric({energy_mwh:v},'energy',options),null);
});
test('online and offline legend filters exclude other states and restore all when cleared',()=>{
 const online={status:'running'},offline={status:'no-output'},unknown={};
 assert(select(online,'status','Online'));assert(!select(offline,'status','Online'));assert(!select(unknown,'status','Online'));
 assert(select(offline,'status','Offline'));assert(!select(online,'status','Offline'));assert(select(unknown,'status','Not reported'));
 for(const p of [online,offline,unknown])assert(matches(p,null,options));
});
test('fuel selection matches dual-fuel units without accepting unrelated types',()=>{
 const dual={fuel:'Gas/HSD'};
 assert(select(dual,'fuel','Gas'));assert(select(dual,'fuel','HSD'));assert(!select(dual,'fuel','Wind'));
 assert(select({fuel:'Wind'},'fuel','Wind'));assert(select({fuel:'—'},'fuel','Not reported'));
});
test('region and producer filters compare complete report categories',()=>{
 const p={region:'Khulna',producer:'IPP'};
 assert(select(p,'region','Khulna'));assert(!select(p,'region','Dhaka'));
 assert(select(p,'producer','IPP'));assert(!select(p,'producer','PDB'));assert(select({},'region','Not reported'));
});
test('numeric legend predicates never confuse missing readings with zero',()=>{
 for(const [id,key] of [['energy','energy_mwh'],['peak','peak'],['capacity','present']]){
  assert(select({[key]:0},id,'zero'));assert(!select({[key]:null},id,'zero'));
  assert(select({[key]:.01},id,'positive'));assert(!select({[key]:0},id,'positive'));
  assert(select({[key]:null},id,'missing'));assert(!select({[key]:0},id,'missing'));
 }
});
const {wheelZoomFactor,zoomView}=require('../begd/plant-map.js');
test('wheel zoom is proportional, reversible and normalizes line/page deltas',()=>{
 assert(wheelZoomFactor(-1)<1&&wheelZoomFactor(-1)>wheelZoomFactor(-100));
 assert.equal(wheelZoomFactor(-1,1),wheelZoomFactor(-16,0));assert.equal(wheelZoomFactor(1,2,800),wheelZoomFactor(240));
 assert(Math.abs(wheelZoomFactor(-80)*wheelZoomFactor(80)-1)<1e-12);
});
test('zoom preserves cursor anchor and aspect ratio within country-scale limits',()=>{
 const home={x:0,y:0,w:100,h:200},anchor={x:30,y:70};
 const zoomed=zoomView(home,.5,anchor,home);
 assert.equal(zoomed.w,50);assert.equal(zoomed.h,100);assert.equal((anchor.x-zoomed.x)/zoomed.w,.3);assert.equal((anchor.y-zoomed.y)/zoomed.h,.35);
 assert.equal(zoomView(home,.00001,anchor,home).w,home.w/32);assert.deepEqual(zoomView(home,100,anchor,home),home);
});
test('all supplied generation icons exist with creator credits',()=>{
 const credits=fs.readFileSync(path.join(root,'begd/plant-icons/README.md'),'utf8');
 for(const name of ['coal.png','gas-factory.png','HFO.png','HSD.png','hydroelectricity.png','solar.png','wind-energy.png','nuclear-plant.png']){
  assert(fs.existsSync(path.join(root,'begd/plant-icons',name)),name);assert(credits.includes(name),name);
 }
 for(const creator of ['Magnific','Mutualism','Andy Horvath','Iconfromus','Iconjam','alekseyvanin'])assert(source.includes(creator)&&credits.includes(creator));
});
test('slide extension loads after the base map and before dashboard initialization',()=>{
 const html=fs.readFileSync(path.join(root,'begd/index.html'),'utf8');
 assert(html.indexOf('<script src="plant-map.js')<html.indexOf('<script src="plant-map-slides.js'));
 assert(html.indexOf('<script src="plant-map-slides.js')<html.indexOf('<script src="app.js'));
 assert(!source.includes('EXPERIMENTAL GEOPLOT'));
 const theme=fs.readFileSync(path.join(root,'begd/theme.css'),'utf8');
 assert(theme.includes('[data-theme=dark] .plant-map-marker>text{fill:#102332}'));
});
