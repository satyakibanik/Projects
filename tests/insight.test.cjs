const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

function insight(){
 const window={};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/insight.js'),'utf8'),{window});
 return window.BEGDInsight;
}

function scenarioReport(){return {date:'2026-11-12',plant_units:[
 {name:'Gas Alpha',fuel:'Gas',present_capacity_mw:500,hourly:[{time:'14:00',mw:400},{time:'19:00',mw:420}]},
 {name:'Coal Beta',fuel:'Coal',present_capacity_mw:300,hourly:[{time:'14:00',mw:250},{time:'19:00',mw:270}]},
 {name:'Solar Gamma',fuel:'Solar',present_capacity_mw:100,hourly:[{time:'14:00',mw:80},{time:'19:00',mw:20}]},
 ],imports:[
  {name:'Bheramara HVDC',hourly:[{time:'14:00',mw:600},{time:'19:00',mw:550}]},
  {name:'Tripura',hourly:[{time:'14:00',mw:100},{time:'19:00',mw:90}]},
 ]};}

test('fuel assumptions include editable defaults, nuclear and order-independent dual-fuel labels',()=>{
 const api=insight();
 for(const [fuel,value] of [['Solar',0],['Wind',0],['HFO',.7],['HSD',.7],['Gas/HFO',5.5],['HFO/Gas',5.5],['Hydro',3.5],['Coal',4.5],['Gas',5.5],['Gas/HSD',5.5],['HSD/Gas',5.5],['Nuclear',5.5]])assert.equal(api.inertiaFor({fuel}),value,fuel);
 assert.equal(api.inertiaFor({fuel:'—'}),undefined);
 assert.equal(api.setInertia('nuclear',6.25),true);assert.equal(api.inertiaFor({fuel:'Nuclear'}),6.25);
 assert.equal(api.setInertia('nuclear',-1),false);assert.equal(api.setInertia('unknown',4),false);
});

test('hourly H_COI weights only online units by present capacity',()=>{
 const rows=insight().hourly({date:'2026-11-06',plant_units:[
  {fuel:'Gas',present_capacity_mw:100,hourly:[{time:'00:00',mw:50},{time:'01:00',mw:0}]},
  {fuel:'Coal',present_capacity_mw:300,hourly:[{time:'00:00',mw:1},{time:'01:00',mw:100}]},
  {fuel:'Solar',present_capacity_mw:50,hourly:[{time:'00:00',mw:0},{time:'01:00',mw:20}]},
  {fuel:'—',present_capacity_mw:1000,hourly:[{time:'00:00',mw:500}]},
 ]});
 assert.equal(rows.length,2);
 assert.equal(rows[0].h,(100*5.5+300*4.5)/400);
 assert.equal(rows[0].capacity,400);assert.equal(rows[0].plants,3);assert.equal(rows[0].fuelCounts.Other,1);
 assert.equal(rows[1].h,(300*4.5+50*0)/350);
});

test('hourly estimates largest-unit-loss RoCoF from post-trip stored energy',()=>{
 const api=insight(),rows=api.hourly(scenarioReport()),point=rows.find(row=>row.time==='14:00'),scenario=api.simulateScenario(scenarioReport(),'14:00',{largestUnitTrip:true});
 assert.equal(point.largestUnitName,'Gas Alpha');assert.equal(point.largestUnitMw,400);
 assert.equal(point.postTripNumerator,scenario.scenario.numerator);
 assert.equal(point.largestTripRoCoF,scenario.rocofHzS);
});

test('largest-unit-loss RoCoF chart renders hourly series and archival gaps honestly',()=>{
 const api=insight(),points=api.hourly(scenarioReport()),html=api.rocofChart(points);
 assert.match(html,/Estimated RoCoF with the loss of the largest online unit/);
 assert.match(html,/Initial \|RoCoF\| · Hz\/s/);assert.match(html,/insight-rocof-line/);
 const archival=[{date:'2020-01-01',time:'00:00',h:4.5,capacity:400,plants:2,fuelCounts:{},fuelCapacity:{},fuelNumerator:{},largestTripRoCoF:null}];
 assert.match(api.rocofChart(archival),/Unit-level hourly output is unavailable/);
});

test('pre-aggregated legacy reports preserve fuel counts and capacity-weighted contributions',()=>{
 const window={BEGD_INSIGHT_HISTORY:{categories:['Gas','Coal','HFO','HSD','Hydro','Solar','Wind','Dual fuel','Other']}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/insight.js'),'utf8'),{window});
 const point=window.BEGDInsight.hourly({date:'2019-10-27',insight_hourly:[['01:00',3,4.5,200,[1,1,1,0,0,0,0,0,0],[100,100,50,0,0,0,0,0,0]]]} )[0];
 assert.equal(point.h,(100*5.5+100*4.5+50*.7)/250);assert.equal(point.capacity,250);assert.equal(point.plants,3);
 assert.deepEqual(JSON.parse(JSON.stringify(point.fuelCounts)),{Gas:1,Coal:1,HFO:1});
 assert.equal(point.fuelNumerator.Gas,550);assert.equal(point.fuelNumerator.Coal,450);assert.equal(point.fuelNumerator.HFO,35);
});

test('custom assumptions recalculate raw and compact history instead of using stored H_COI',()=>{
 const api=insight();api.setInertia('gas',4.2);api.setInertia('coal',6.1);
 const raw=api.hourly({date:'2026-11-06',plant_units:[
  {fuel:'Gas',present_capacity_mw:100,hourly:[{time:'00:00',mw:1}]},
  {fuel:'Coal',present_capacity_mw:300,hourly:[{time:'00:00',mw:1}]},
 ]})[0];
 assert.equal(raw.h,(100*4.2+300*6.1)/400);
 const window={BEGD_INSIGHT_HISTORY:{categories:['Gas','Coal']}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/insight.js'),'utf8'),{window});
 window.BEGDInsight.setInertia('gas',4.2);window.BEGDInsight.setInertia('coal',6.1);
 const compact=window.BEGDInsight.hourly({date:'2020-01-01',insight_hourly:[['00:00',2,99,400,[1,1],[100,300]]]})[0];
 assert.equal(compact.h,(100*4.2+300*6.1)/400);
});

test('Insight markup discloses MW proxy, MVA limitation, threshold and sources',()=>{
 const api=insight(),html=api.markup({date:'2026-11-06'});
 for(const text of ['P</em><sub>cap,curr','MVA','H</em> = 3 s','ieeexplore.ieee.org','researchgate.net'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('Long Term'));
 assert.equal((html.match(/data-inertia-delta="-0\.1"/g)||[]).length,10);
 assert.equal((html.match(/data-inertia-delta="0\.1"/g)||[]).length,10);
 assert.match(html,/data-inertia-key="nuclear" value="5\.5"/);
 api.setInertia('gas',6.25);assert.match(api.markup({date:'2026-11-07'}),/data-inertia-key="gas" value="6\.25"/);
});

test('scenario lab exposes four presets and composable condition and contingency controls',()=>{
 const html=insight().markup(scenarioReport());
 for(const preset of ['largest','import','renewable','evening'])assert.match(html,new RegExp(`data-scenario-preset="${preset}"`));
 for(const condition of ['actual','high-renewable','evening-peak'])assert.match(html,new RegExp(`name="insight-condition" value="${condition}"`));
 assert.match(html,/id="insight-trip-largest"/);assert.match(html,/id="insight-import-loss"/);assert.match(html,/Bheramara HVDC/);
});

test('largest-unit trip removes the highest-output online generator at the selected hour',()=>{
 const api=insight(),result=api.simulateScenario(scenarioReport(),'14:00',{largestUnitTrip:true});
 assert.equal(result.largestUnit.name,'Gas Alpha');assert.equal(result.disturbanceMw,400);
 assert.equal(result.baseline.h,(500*5.5+300*4.5)/900);
 assert.equal(result.scenario.h,(300*4.5)/400);
 assert.ok(result.rocofHzS>0);
});

test('import loss adds a power imbalance without assigning inertia to imports',()=>{
 const api=insight(),result=api.simulateScenario(scenarioReport(),'14:00',{importLoss:true,importTarget:'largest'});
 assert.deepEqual(JSON.parse(JSON.stringify(result.importRoutes.map(route=>route.name))),['Bheramara HVDC']);
 assert.equal(result.disturbanceMw,600);assert.equal(result.scenario.h,result.baseline.h);
 const expected=50*600/(2*result.scenario.numerator);assert.equal(result.rocofHzS,expected);
});

test('high-renewable condition proportionally replaces synchronous output and combines with both contingencies',()=>{
 const api=insight(),condition=api.simulateScenario(scenarioReport(),'14:00',{condition:'high-renewable',highRenewableMw:200,solarSharePct:75});
 assert.ok(condition.condition.h<condition.baseline.h);assert.ok(condition.condition.fuelCapacity.Solar>condition.baseline.fuelCapacity.Solar);assert.ok(condition.condition.fuelCapacity.Wind>0);
 const combined=api.simulateScenario(scenarioReport(),'14:00',{condition:'high-renewable',highRenewableMw:200,largestUnitTrip:true,importLoss:true,importTarget:'largest'});
 assert.equal(combined.events.length,2);assert.ok(combined.disturbanceMw>600);assert.ok(combined.scenario.h<combined.baseline.h);assert.ok(combined.rocofHzS>0);
});

test('evening peak removes solar and adds the configured thermal mix before a contingency',()=>{
 const api=insight(),result=api.simulateScenario(scenarioReport(),'19:00',{condition:'evening-peak',eveningDemandIncreaseMw:1000,eveningThermalMw:1800,eveningGasSharePct:70,largestUnitTrip:true});
 assert.equal(result.condition.fuelCapacity.Solar,undefined);assert.ok(result.condition.fuelCapacity.Gas>result.baseline.fuelCapacity.Gas);assert.ok(result.condition.fuelCapacity.Coal>result.baseline.fuelCapacity.Coal);
 assert.equal(result.balanceDeltaMw,780);assert.equal(result.largestUnit.name,'Gas Alpha');assert.equal(result.disturbanceMw,420);
});

test('Insight stays directly addressable but is removed from dashboard navigation',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../begd/insight.css'),'utf8');
 const app=fs.readFileSync(path.join(__dirname,'../begd/app.js'),'utf8');
 assert.match(css,/nav a\[href="#insight"\]\{display:none\}/);
 assert.match(app,/function hideInsightNavigation\(\)/);
 assert.match(app,/location\.hash==='#insight'/);
});

test('24-hour and 7-day rolling means wait until their windows are covered',()=>{
 const api=insight(),hour=60*60*1000,start=new Date('2026-01-01T00:00:00Z');
 const hourly=Array.from({length:48},(_,index)=>({date:new Date(start.getTime()+index*hour).toISOString().slice(0,10),time:new Date(start.getTime()+index*hour).toISOString().slice(11,16),h:2+index/10}));
 const rolling24=api.rolling24(hourly);
 assert.equal(rolling24[22],null);assert.equal(rolling24[23],(hourly.slice(0,24).reduce((sum,point)=>sum+point.h,0)/24));
 const weekStart=new Date('2026-01-01T00:00:00Z');
 const weekly=Array.from({length:169},(_,index)=>{const stamp=new Date(weekStart.getTime()+index*hour);return {date:stamp.toISOString().slice(0,10),time:stamp.toISOString().slice(11,16),h:index}});
 const rolling7=api.rollingCalendar(weekly,7);
 assert.equal(rolling7.values[167],null);
 assert.equal(rolling7.values[168],weekly.slice(1).reduce((sum,point)=>sum+point.h,0)/168);
});

test('Long Term calendar rolling means stay connected across report-date gaps',()=>{
 const api=insight(),hour=60*60*1000,origin=new Date('2026-01-01T00:00:00Z'),points=[];
 for(const day of [0,15,30,31])for(let h=0;h<24;h++){
  const stamp=new Date(origin.getTime()+(day*24+h)*hour);
  points.push({date:stamp.toISOString().slice(0,10),time:stamp.toISOString().slice(11,16),h:day<15?4:6});
 }
 const mean7=api.rollingCalendar(points,7);
 assert.equal(mean7.values[24*3],6);
 assert.equal(mean7.counts[24*3],25);
 assert.ok(mean7.values.slice(24*3).every(Number.isFinite));
});
