const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function app(document={addEventListener(){},querySelector(){return {addEventListener(){}}}}){
 const source=fs.readFileSync(path.join(root,'begd/app.js'),'utf8').replace('loadCurrentDay();window.setInterval(loadCurrentDay,180000);','').replace(/refreshDateList\(\);\s*$/,'');
 const context=vm.createContext({document,window:{addEventListener(){}},console});
 vm.runInContext(source,context);return context;
}
test('legend geometry follows bar/line style changes, including dotted forecasts',()=>{
 const c=app();
 const draw=style=>vm.runInContext(`dispatchChartStyle='${style}';chart([{time:'00:00',demand:20,forecast:22},{time:'23:00',demand:30,forecast:25}],[{key:'demand',name:'Demand',color:'#c48722',dash:true},{key:'forecast',name:'Forecast',color:'#df6f9b',dot:true,pointsOnly:true,connectPoints:true}],{styleSetting:'dispatch'})`,c);
 const line=draw('line'),bar=draw('bar');
 assert.match(line,/Demand · dashed line/);assert.match(line,/Forecast · dotted line/);
 assert.match(bar,/Demand · solid fill/);assert.match(bar,/Forecast · dotted line/);
 assert.match(line,/stroke-dasharray="1 5" stroke-linecap="round"/);
 assert.match(line,/stroke-dasharray="6 4"/);
});
test('stacked-area hatch samples share plot angle, spacing, color and opacity',()=>{
 const c=app();
 const html=vm.runInContext(`stackedAreaChart([{time:'00:00',a:10,b:20},{time:'23:00',a:15,b:25}],[{key:'a',name:'A',color:'#123456',hatch:true},{key:'b',name:'B',color:'#abcdef',hatch:true}])`,c);
 const patterns=[...html.matchAll(/<pattern id="([^"]+)"([^]*?)<\/pattern>/g)];
 assert.equal(patterns.length,4);
 for(let i=0;i<2;i++)assert.equal(patterns[i][2],patterns[i+2][2]);
 const line=vm.runInContext(`enCurveChartStyle='line';chart([{time:'00:00',a:10},{time:'23:00',a:20}],[{key:'a',name:'A',color:'#123456',hatch:true}],{styleSetting:'en-curve'})`,c);
 assert.doesNotMatch(line,/<pattern/);assert.match(line,/A · solid line/);
});
class Element{
 constructor(dataset={}){this.dataset=dataset;this.events={};this.attrs={};this.innerHTML='Default map detail';this.isConnected=true;const classes=new Set();this.classList={toggle(n,on){on?classes.add(n):classes.delete(n)},remove(...names){names.forEach(n=>classes.delete(n))},contains(n){return classes.has(n)}}}
 addEventListener(n,fn){this.events[n]=fn}setAttribute(n,v){this.attrs[n]=v}
}
test('region hover and keyboard exit restore all colors; zoom resets to fitted bounds',async()=>{
 const frame=new Element(),svg=new Element(),group={getBBox:()=>({x:900,y:0,width:4600,height:6000})},detail=new Element(),keys=['dhaka','cumilla'].map(name=>new Element({mapSelect:name[0].toUpperCase()+name.slice(1)})),regions=['dhaka','cumilla'].map(region=>new Element({region})),zoomIn=new Element(),zoomOut=new Element(),reset=new Element();
 frame.querySelector=s=>s==='svg'?svg:null;svg.querySelector=()=>group;frame.querySelectorAll=()=>regions;
 const document={addEventListener(){},querySelector(s){return {'#region-map-frame':frame,'#region-map-detail':detail,'[data-map-zoom="in"]':zoomIn,'[data-map-zoom="out"]':zoomOut,'[data-map-reset]':reset}[s]||new Element()},querySelectorAll:()=>keys};
 const c=app(document);c.fetch=async()=>({ok:true,text:async()=>'<svg/>'});
 vm.runInContext(`data={regions:[{name:'Dhaka',energy_mwh:10,demand_mw:5,shed_mw:0},{name:'Cumilla',energy_mwh:12,demand_mw:6,shed_mw:0}]}`,c);
 await vm.runInContext('setupRegionMap()',c);
 const home=svg.attrs.viewBox;assert.equal(home,'800 -100 4800 6200');
 const assertClear=()=>{for(const r of regions){assert.equal(r.classList.contains('is-selected'),false);assert.equal(r.classList.contains('is-muted'),false);assert.equal(r.attrs['aria-pressed'],'false')}assert.equal(detail.innerHTML,'Default map detail')};
 regions[0].events.pointerenter();assert.equal(regions[1].classList.contains('is-muted'),true);regions[0].events.pointerleave();assertClear();
 regions[1].events.focus();assert.equal(regions[1].attrs['aria-pressed'],'true');regions[1].events.blur();assertClear();
 keys[0].events.pointerenter();keys[0].events.pointerleave();assertClear();
 zoomIn.events.click();assert.notEqual(svg.attrs.viewBox,home);reset.events.click();assert.equal(svg.attrs.viewBox,home);assertClear();
});
test('forecast numeric sorts preserve zero, order numerically and leave missing values last',()=>{
 const c=app();
 vm.runInContext(`var forecastFixture=[{name:'small',capacity_mw:9},{name:'large',capacity_mw:100},{name:'missing',capacity_mw:null},{name:'zero',capacity_mw:0},{name:'bad',capacity_mw:NaN}]`,c);
 const order=direction=>JSON.parse(vm.runInContext(`JSON.stringify(sortForecastRows(forecastFixture,{key:'capacity_mw',direction:'${direction}'}).map(r=>r.name))`,c));
 assert.deepEqual(order('asc'),['zero','small','large','missing','bad']);
 assert.deepEqual(order('desc'),['large','small','zero','missing','bad']);
 assert.equal(vm.runInContext('forecastFixture[0].name',c),'small');
});
test('forecast text sorts naturally and every column has an accessible sort control',()=>{
 const c=app();
 assert.equal(vm.runInContext(`sortForecastRows([{name:'Unit 10'},{name:'Unit 2'}],{key:'name',direction:'asc'})[0].name`,c),'Unit 2');
 vm.runInContext(`data={forecast:{date:'2026-10-16',totals:{},plants:[]}}`,c);
 const html=vm.runInContext('forecast()',c);
 assert.equal((html.match(/data-forecast-sort=/g)||[]).length,9);
 assert.match(html,/Scrollable generation availability forecast/);
 assert.match(html,/Forecast for 16 Oct 2026/);
 assert.match(html,/forecast-day/);assert.match(html,/forecast-evening/);
});
test('forecast subtitle distinguishes forecast target date from actuals and does not invent a missing date',()=>{
 const c=app();
 const forecast=vm.runInContext(`reportSubtitle('forecast',{date:'2026-10-15',published_date:'2026-10-16',forecast:{date:'2026-10-16'}})`,c);
 assert.match(forecast,/Forecast for 16 October 2026/);assert.match(forecast,/Actuals in this workbook cover 15 October 2026/);
 assert.doesNotMatch(forecast,/Operating date 15/);
 assert.match(vm.runInContext(`reportSubtitle('forecast',{date:'2026-10-15'})`,c),/Forecast for unavailable/);
 assert.match(vm.runInContext(`reportSubtitle('overview',{date:'2026-10-15'})`,c),/Operating date 15 October 2026/);
});
test('largest circuit flow uses signed individual observations, ignores gaps and does not sum circuits',()=>{
 const c=app();
 const peak=JSON.parse(vm.runInContext(`JSON.stringify(largestCircuitFlow([{time:'01:00',ishwardi_ghorashal:800,sirajganj_sreepur:900},{time:'02:00',gopalganj_aminbazar:-1338},{time:'03:00',ishwardi_ghorashal:null}]))`,c));
 assert.deepEqual(peak,{key:'gopalganj_aminbazar',time:'02:00',value:-1338,magnitude:1338});
 assert.equal(vm.runInContext('largestCircuitFlow([])',c),null);
 assert.equal(vm.runInContext(`largestCircuitFlow([{time:'00:00',ishwardi_ghorashal:0}]).magnitude`,c),0);
});
