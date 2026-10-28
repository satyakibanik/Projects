const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function status(hash='#overview'){
 const clock={},updated={dataset:{}},events={},timers=[];
 const document={querySelector:s=>s==='#bangladesh-clock'?clock:updated,addEventListener(){}};
 const window={setInterval:(fn,ms)=>timers.push({fn,ms}),addEventListener:(name,fn)=>events[name]=fn};
 const location={hash};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/data-status.js'),'utf8'),{window,document,location,Intl,Date});
 return {api:window.BEGDDataStatus,clock,updated,location,events,timers};
}
test('timestamps use Bangladesh time across midnight, and never invent missing hours',()=>{
 const {api}=status();
 assert.equal(api.timestamp('2026-10-28T20:05:09Z'),'29 Oct 2026, 02:05:09 BST');
 assert.equal(api.timestamp('2026-10-29T02:05:09+06:00'),'29 Oct 2026, 02:05:09 BST');
 assert.equal(api.timestamp('2026-10-28'),'28 Oct 2026 · time unavailable');
 for(const value of [null,'bad','2026-10-28T20:05:09'])assert.equal(api.timestamp(value),null);
});
test('clock ticks every second while source update times stay fixed and late tabs cannot overwrite the active view',()=>{
 const {api,clock,updated,location,events,timers}=status();
 assert.match(clock.textContent,/\d{2}:\d{2}:\d{2} BST$/);assert(Number.isFinite(Date.parse(clock.dateTime)));
 assert.equal(timers[0].ms,1000);
 api.set('overview',[{label:'Workbook snapshot updated',value:'2026-10-28T10:00:00Z'}]);
 const original=updated.textContent;timers[0].fn();assert.equal(updated.textContent,original);
 location.hash='#news';events.hashchange();
 api.set('trends',[{label:'Trends data updated',value:'2026-10-28T11:00:00Z'}]);assert.equal(updated.textContent,'Data updated: loading…');
 api.set('news',[{label:'News data updated',value:'2026-10-27'}]);assert.match(updated.textContent,/27 Oct 2026 · time unavailable/);
 api.set('news',[{label:'News data updated',value:null}]);assert.match(updated.textContent,/update time unavailable/);
});

test('realtime transparency separates source readings, unknown posting time, ERP fetch and browser chart updates',()=>{
 const {api,updated}=status('#realtime');
 const snapshot={today_date:'2026-10-28',updated_at:'2026-10-28T14:46:52Z',fetched_at:'2026-10-28T14:45:00Z',demand_hourly:[{time:'15:00'}],generation_hourly:[{time:'16:00'}],imports:[]};
 api.realtime(snapshot,'2026-10-28T17:30:00Z');
 assert.match(updated.textContent,/ERP reading: 28 Oct 2026, 16:00 BST/);
 assert.match(updated.textContent,/ERP posted: not exposed/);
 assert.match(updated.textContent,/ERP fetched: 28 Oct 2026, 20:45 BST/);
 assert.match(updated.textContent,/Chart updated: 28 Oct 2026, 23:30 BST/);
 assert.equal(updated.dataset.view,'realtime');assert.equal(updated.tabIndex,0);
 api.realtime({today_date:'2026-10-28',demand_hourly:[],generation_hourly:[],imports:[]},null);
 assert.match(updated.textContent,/ERP reading: unavailable/);assert.doesNotMatch(updated.textContent,/Invalid Date/);
});
