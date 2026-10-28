const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function status(hash='#overview'){
 const clock={},updated={},events={},timers=[];
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
