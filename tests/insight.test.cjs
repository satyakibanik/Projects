const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

function insight(){
 const window={};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/insight.js'),'utf8'),{window});
 return window.BEGDInsight;
}

test('fuel assumptions include order-independent dual-fuel labels',()=>{
 const api=insight();
 for(const [fuel,value] of [['Solar',0],['Wind',0],['HFO',.7],['HSD',.7],['Gas/HFO',5.5],['HFO/Gas',5.5],['Hydro',3.5],['Coal',4.5],['Gas',5.5],['Gas/HSD',5.5],['HSD/Gas',5.5]])assert.equal(api.inertiaFor({fuel}),value,fuel);
 assert.equal(api.inertiaFor({fuel:'—'}),undefined);
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
 assert.equal(rows[0].capacity,400);assert.equal(rows[0].plants,2);
 assert.equal(rows[1].h,(300*4.5+50*0)/350);
});

test('pre-aggregated legacy reports preserve fuel counts and capacity-weighted contributions',()=>{
 const window={BEGD_INSIGHT_HISTORY:{categories:['Gas','Coal','HFO','HSD','Hydro','Solar','Wind','Dual fuel','Other']}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/insight.js'),'utf8'),{window});
 const point=window.BEGDInsight.hourly({date:'2019-10-27',insight_hourly:[['01:00',3,4.5,200,[1,1,1,0,0,0,0,0,0],[100,100,50,0,0,0,0,0,0]]]} )[0];
 assert.equal(point.h,4.5);assert.equal(point.capacity,200);assert.equal(point.plants,3);
 assert.deepEqual(JSON.parse(JSON.stringify(point.fuelCounts)),{Gas:1,Coal:1,HFO:1});
 assert.equal(point.fuelNumerator.Gas,550);assert.equal(point.fuelNumerator.Coal,450);assert.equal(point.fuelNumerator.HFO,35);
});

test('Insight markup discloses MW proxy, MVA limitation, threshold and sources',()=>{
 const html=insight().markup({date:'2026-11-06'});
 for(const text of ['P</em><sub>cap,curr','MVA','H</em> = 3 s','ieeexplore.ieee.org','researchgate.net'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('Long Term'));
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
 assert.equal(mean7.counts[24*3],24);
 assert.ok(mean7.values.slice(24*3).every(Number.isFinite));
});
