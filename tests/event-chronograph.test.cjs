const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function viewer(mobile=false){
 const listeners={},panels=[];
 const context=vm.createContext({window:{BEGDDaylight:require('../begd/daylight.js'),matchMedia(){return {matches:mobile,addEventListener(){}}}},document:{querySelector(){return null},querySelectorAll(){return panels},addEventListener(type,fn){(listeners[type]??=[]).push(fn)}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../begd/operational-events.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../begd/event-chronograph.js'),'utf8'),context);
 return {api:context.window.BEGDEventChronograph,listeners,panels};
}
test('normalisation handles midnight, missing times and zero-length periods',()=>{
 const {api}=viewer();
 const rows=api.normalise([{outage_time:'23:50',restoration_time:'00:10'},{outage_time:'—',restoration_time:'08:15'},{outage_time:'25:00'},{outage_time:'09:00',restoration_time:'09:00'}]);
 assert.equal(rows.find(e=>e.index===0).duration,20);
 assert.equal(rows.find(e=>e.index===1).sortTime,495);
 assert.equal(rows.find(e=>e.index===3).duration,0);
 assert.equal(rows.at(-1).unavailable,true);
});
test('phone table defaults preserve workbook content and expose exactly four choices',()=>{
 const {api}=viewer(true);
 const table='<section class="panel full"><div class="panel-head"><div><h2>Daily event log</h2><p>Notes</p></div><span class="tag">1 EVENTS</span></div><table><tbody><tr><td>Original order</td></tr></tbody></table><p>Source P1</p></section>';
 const html=api.render([{outage_time:'12:00',description:'<script>unsafe</script>'}],[],table);
 assert.equal((html.match(/data-event-view-select=/g)||[]).length,4);
 assert.match(html,/data-event-view-select="table" aria-pressed="true"/);
 assert.match(html,/data-event-view="table"><div><table>/);
 assert.match(html,/Original order/);assert.match(html,/Source P1/);
 assert.doesNotMatch(html,/<script>unsafe/);
 assert.equal((html.match(/<h2>Daily event log/g)||[]).length,1);
 assert.doesNotMatch(html,/NaN|Infinity/);
});
test('switching views updates visibility, pressed state and survives report render',()=>{
 const {api,listeners}=viewer();
 const buttons=['table','lanes','density','dial'].map(key=>({dataset:{eventViewSelect:key},setAttribute(k,v){this[k]=v}}));
 const sections=buttons.map(b=>({dataset:{eventView:b.dataset.eventViewSelect},hidden:false}));
 const description={},note={};
 const panel={querySelectorAll(s){return s==='[data-event-view-select]'?buttons:sections},querySelector(s){return s==='.event-view-description'?description:note}};
 buttons[2].closest=()=>panel;
 const target={closest(s){return s==='[data-event-view-select]'?buttons[2]:null}};
 for(const fn of listeners.click)fn({target});
 assert.equal(buttons[2]['aria-pressed'],'true');assert.deepEqual(sections.map(s=>s.hidden),[true,true,false,true]);
 assert.equal(note.hidden,false);
 assert.match(api.render([],[]),/data-event-view-select="density" aria-pressed="true"/);
});
test('empty and partial reports produce finite charts and preserve untimed entries',()=>{
 const {api}=viewer();
 for(const events of [[],[{description:'No time'}],[{outage_time:'12:00',restoration_time:'12:00'}],[{outage_time:'23:50',restoration_time:'00:10'}]]){
  const html=api.render(events,[{time:'01:00',demand_mw:0,generation_mw:0}]);
  assert.doesNotMatch(html,/NaN|Infinity/);
  assert.equal((html.match(/class="event-density-bin(?: is-selected)?"/g)||[]).length,48);
 }
 assert.match(api.render([{description:'No time'}],[]),/No reported time/);
 assert.match(api.render([{outage_time:'12:00',description:'Timed event'}],[]),/event-time-marker event-single-marker/);
});

test('pulse counts outage and restoration endpoints separately without a period category',()=>{
 const {api}=viewer();
 const html=api.render([{outage_time:'01:00',restoration_time:'02:00',description:'Paired event'},{outage_time:'23:50',restoration_time:'00:10',description:'Next day restoration'}],[]);
 assert.match(html,/01:00 to 01:30: 1 outages, 0 restorations/);
 assert.match(html,/02:00 to 02:30: 0 outages, 1 restorations/);
 assert.match(html,/00:00 to 00:30: 0 outages, 0 restorations/);
 assert.doesNotMatch(html,/Period starts|Active periods|event-density-midpoint|event-density-endpoints|event-density-active/);
 assert.match(html,/Demand \(MW\)/);assert.match(html,/Generation \(MW\)/);
 assert.doesNotMatch(html,/event-view-description|Demand &amp; generation response/);
 assert.match(html,/event-lanes-scroll/);
});

test('pulse click locks selection against hover/focus until an outside click or Escape',()=>{
 const {api,listeners,panels}=viewer();api.render([{outage_time:'01:00',restoration_time:'02:00'}],[]);
 const selection={innerHTML:''},nodes=[],panel={dataset:{},querySelectorAll(){return nodes},querySelector(s){return s==='.event-density-selection'?selection:null}};
 const target=index=>({dataset:{densityIndex:String(index)},closest(s){return s==='[data-density-index]'||s==='.event-density-bin'?this:s==='.event-chronograph-panel'?panel:null}});
 panels.push(panel);
 const clicked=target(2),other=target(4);
 for(const fn of listeners.click)fn({target:clicked});
 assert.equal(panel.dataset.densityPinned,'2');assert.match(selection.innerHTML,/01:00–01:30/);
 for(const fn of listeners.pointerover)fn({target:other});
 for(const fn of listeners.focusin)fn({target:other});
 assert.match(selection.innerHTML,/01:00–01:30/);
 for(const fn of listeners.click)fn({target:other});assert.equal(panel.dataset.densityPinned,'4');assert.match(selection.innerHTML,/02:00–02:30/);
 for(const fn of listeners.click)fn({target:{closest(){return null}}});assert.equal(panel.dataset.densityPinned,undefined);
 for(const fn of listeners.pointerover)fn({target:clicked});assert.match(selection.innerHTML,/01:00–01:30/);
 for(const fn of listeners.click)fn({target:other});
 for(const fn of listeners.keydown)fn({target:other,key:'Escape'});assert.equal(panel.dataset.densityPinned,undefined);
 for(const fn of listeners.pointerover)fn({target:clicked});assert.match(selection.innerHTML,/01:00–01:30/);
});

test('phone views use a uniform response chart and aligned scrollable histogram',()=>{
 const {api}=viewer(true);
 const html=api.render([{outage_time:'08:00',restoration_time:'10:00'},{outage_time:'12:00'}],[{time:'08:00',demand_mw:100,generation_mw:90}]);
 assert.match(html,/event-context-canvas/);
 assert.match(html,/viewBox="0 0 1120 200"/);
 assert.match(html,/data-density-left="150"/);
 assert.doesNotMatch(html,/event-density-mobile-picker|event-density-bin-button/);
 assert.match(html,/event-context-group event-context-fixed/);
 assert.match(html,/viewBox="0 0 1120 190"/);
 assert.match(html,/event-dial-hit/);assert.match(html,/event-dial-point-hit/);
 assert.doesNotMatch(html,/NaN|Infinity/);
});

test('pulse details use the Explorer category and preserve escaped source descriptions',()=>{
 const {api}=viewer();
 for(const [description,label] of [['Grid Forced S/D Due to CB tripped','Forced Shutdown'],['Grid Scheduled S/D','Scheduled Shutdown (S/D)'],['Unspecified <source>','Unclassified / Source Fragment']]){
  const html=api.render([{outage_time:'01:00',description}],[]);
  assert.ok(html.includes('<span class="event-category">'+label+'</span>'));
  assert.doesNotMatch(html,/<source>/);
 }
});

test('desktop defaults to timeline and retains the table as a choice',()=>{
 const {api}=viewer();const html=api.render([],[],'<table>Workbook rows</table>');
 assert.match(html,/data-event-view-select="lanes" aria-pressed="true"/);
 assert.match(html,/data-event-view="lanes">/);
 assert.match(html,/data-event-view="table" hidden>/);
});

test('all three views share response-curve geometry, scales, ticks and legends on desktop and phone',()=>{
 for(const mobile of [false,true]){
  const {api}=viewer(mobile);const html=api.render([{outage_time:'08:00',description:'Unit tripped'}],[{time:'00:00',generation_mw:11000,demand_mw:12000},{time:'12:00',generation_mw:9000,demand_mw:10000},{time:'23:00',generation_mw:13000,demand_mw:14000}]);
  const charts=[...html.matchAll(/<svg class="event-context-svg"([^]*?)<\/svg>/g)].map(m=>m[0]);assert.equal(charts.length,3);
  const geometry=svg=>({viewBox:svg.match(/viewBox="([^"]+)"/)[1],curves:[...svg.matchAll(/<polyline class="event-(demand|generation)-line" points="([^"]+)"/g)].map(m=>m[0]),ticks:[...svg.matchAll(/<text class="event-plot-y-label"[^]*?<\/text>/g)].map(m=>m[0]),legend:svg.match(/<g class="event-chart-legend"[^]*?<\/g>/)?.[0]});
  assert.deepEqual(geometry(charts[0]),geometry(charts[1]));assert.deepEqual(geometry(charts[1]),geometry(charts[2]));
 }
});
test('pulse category changes filter histogram and inspected entries while preserving P4 curves and other views',()=>{
 const {api,listeners}=viewer();
 const events=[{outage_time:'01:00',description:'Unit A Scheduled S/D'},{outage_time:'01:00',description:'Unit B Tripped'},{outage_time:'01:00',description:'Unit C Forced S/D'}];
 const hourly=[{time:'00:00',generation_mw:100},{time:'02:00',generation_mw:200}];
 const before=api.render(events,hourly);
 const pulse={innerHTML:'',querySelector(){return null}},selection={innerHTML:''};
 const panel={dataset:{densityPinned:'2'},querySelector(s){return s==='[data-event-view="density"]'?pulse:s==='.event-density-selection'?selection:null},querySelectorAll(){return []}};
 const control={value:'trip',closest(s){return s==='[data-pulse-category]'?this:s==='.event-chronograph-panel'?panel:null}};
 for(const fn of listeners.change)fn({target:control});
 assert.equal(panel.dataset.densityPinned,undefined);
 assert.match(pulse.innerHTML,/1 of 3 log entries/);assert.match(pulse.innerHTML,/01:00 to 01:30: 1 outages, 0 restorations/);
 assert.match(pulse.innerHTML,/Unit B Tripped/);assert.doesNotMatch(pulse.innerHTML,/Unit A Scheduled|Unit C Forced/);
 const generation=html=>html.match(/<polyline class="event-generation-line" points="([^"]+)"/)[1];assert.equal(generation(before),generation(pulse.innerHTML));
 const target={dataset:{densityIndex:'2'},closest(s){return s==='[data-density-index]'||s==='.event-density-bin'?this:s==='.event-chronograph-panel'?panel:null}};
 for(const fn of listeners.click)fn({target});assert.match(selection.innerHTML,/Unit B Tripped/);assert.doesNotMatch(selection.innerHTML,/Unit A Scheduled/);
 const after=api.render(events,hourly);assert.match(after,/3 EVENTS · BST/);assert.match(after,/value="trip" selected/);
 const reset=api.render([{outage_time:'01:00',description:'Unit A Scheduled S/D'}],hourly);assert.match(reset,/1 of 1 log entries/);assert.doesNotMatch(reset,/value="trip" selected/);
});

test('timeline and dial filter event markers and lists with the pulse category while retaining actuals',()=>{
 const {api,listeners}=viewer();
 const events=[{outage_time:'01:00',description:'Unit A Scheduled S/D'},{outage_time:'02:00',description:'Unit B Tripped'}];
 const hourly=[{time:'00:00',generation_mw:100},{time:'03:00',generation_mw:200}];
 const before=api.render(events,hourly);
 const views=Object.fromEntries(['lanes','density','dial'].map(key=>[key,{innerHTML:'',querySelector(){return null}}]));
 const panel={dataset:{},querySelector(selector){const key=selector.match(/data-event-view="(.*?)"/)?.[1];return views[key]||null},querySelectorAll(){return []}};
 const control={value:'trip',closest(selector){return selector==='[data-event-category-filter]'?this:selector==='.event-chronograph-panel'?panel:selector==='[data-event-view]'?{dataset:{eventView:'lanes'}}:null}};
 for(const fn of listeners.change)fn({target:control});
 for(const key of ['lanes','dial']){
  assert.match(views[key].innerHTML,/1 of 2 log entries/);
  assert.match(views[key].innerHTML,/Unit B Tripped/);
  assert.doesNotMatch(views[key].innerHTML,/Unit A Scheduled/);
  assert.match(views[key].innerHTML,/event-generation-line/);
  assert.match(views[key].innerHTML,/value="trip" selected/);
 }
 const after=api.render(events,hourly);
 for(const key of ['lanes','density','dial'])assert.match(after,new RegExp('id="event-'+key+'-category"'));
 assert.equal((after.match(/value="trip" selected/g)||[]).length,3);
});

test('Operations curves, event lanes, pulse, and clock dial shade the report operating date',()=>{
 const {api}=viewer();
 const html=api.render([{outage_time:'07:00',restoration_time:'18:00',description:'Test event'}],[{time:'00:00',generation_mw:100}], '', '2026-11-02');
 assert.equal((html.match(/class="daylight-background"/g)||[]).length,6);
 assert.match(html,/data-daylight-date="2026-11-02"/);
 assert.match(html,/A178,178 0 0 1/);
 assert.match(html,/sunrise 06:04 · sunset 17:20/);
 const next=api.render([],[], '', '2026-06-21');
 assert.match(next,/A178,178 0 1 1/);
 assert.doesNotMatch(next,/2026-11-02/);
});
