const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../begd/operational-events.js'),'utf8'),{window,Date,URL});return window.BEGDOperationalEvents}
test('explicit actions take precedence over causes; generic maintenance stays unspecified',()=>{
 const api=load();
 for(const [text,category] of [['Grid Forced S/D Due to CB tripped','forced'],['Unit Shutdown with remarks:- annual maintenance','shutdown'],['Unit tripped showing relay shutdown','trip'],['Grid Scheduled S/D','scheduled'],['Grid Project Work S/D','project'],['Grid is restored.','restored'],['Unit Syn.','synchronized'],['Line switched ON for the first time','commissioning'],['Line switched ON','switching'],['Station, FGMO is OFF with remarks:- shutdown','fgmo'],['Minimum generation: 13000 MW','generation'],['Full load interruption due to tripping','interruption'],['.','review']])assert.equal(api.classify(text),category,text);
});
test('calendar windows are inclusive, use the trends end date and count empty logs as available',()=>{
 const api=load(),data={days:[{date:'2026-09-29',events:[{description:'Old shutdown'}]},{date:'2026-09-30',events:[]},{date:'2026-10-28',events:null},{date:'2026-10-29',events:[{description:'Unit tripped',outage_time:'23:30',restoration_time:'—'}]},{date:'2026-10-30',events:[{description:'Future shutdown'}]}]};
 for(const count of [30,60,90,365]){const result=api.selectWindow(data,count,'2026-10-29');assert.ok(result.rows.every(r=>r.date<='2026-10-29'));assert.equal(result.available,count===30?2:3)}
 const result=api.selectWindow(data,30,'2026-10-29');assert.equal(result.rows.length,1);assert.equal(result.rows[0].category,'trip');assert.equal(result.rows[0].outage_time,'23:30');
 assert.equal(api.selectWindow(data,'10y','2026-10-29').rows.length,0);
});
test('entries sort by newest report then clock time, using restoration for restoration-only rows',()=>{
 const rows=load().selectWindow({days:[{date:'2026-10-29',events:[{description:'Late shutdown',outage_time:'23:59'},{description:'Restored',outage_time:'—',restoration_time:'08:10'},{description:'Unknown shutdown'},{description:'Early trip',outage_time:'00:00'}]},{date:'2026-10-28',events:[{description:'Older trip',outage_time:'12:00'}]}]},30,'2026-10-29').rows;
 assert.deepEqual(Array.from(rows,r=>r.description),['Early trip','Restored','Late shutdown','Unknown shutdown','Older trip']);
});
test('description search is case-insensitive literal text and combines with category',()=>{
 const api=load(),rows=[{description:'Sylhet GT Tripped',category:'trip'},{description:'SYLHET synchronized',category:'synchronized'},{description:'Line . trip',category:'trip'}];
 assert.equal(api.filterRows(rows,' sylhet ','trip').length,1);assert.equal(api.filterRows(rows,'.','trip').length,1);assert.equal(api.filterRows(rows,'','').length,3);assert.equal(api.filterRows(rows,'missing','').length,0);
});
test('source text is escaped and dates are plain text without workbook or navigation links',()=>{
 const api=load(),row={date:'2026-10-29',outage_time:'<img>',restoration_time:'—',category:'trip',description:'<script>alert(1)</script> & "full"',source_url:'javascript:alert(1)'};
 let html=api.rowsHTML([row]);assert.doesNotMatch(html,/<script>|<img>|href=/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&amp; &quot;full&quot;/);
 row.source_url='https://erp.powergrid.gov.bd/web/files/download?location=erp%2Freport.xlsx';html=api.rowsHTML([row]);assert.doesNotMatch(html,/href=|target=|files\/download/);assert.match(html,/2026-10-29/);assert.doesNotMatch(html,/<button|data-operational-event-date|Open daily event log/);
});
test('clock parsing preserves midnight, accepts 24:00 and rejects invalid source times',()=>{
 const api=load();assert.equal(api.clockMinutes('00:00'),0);assert.equal(api.clockMinutes('24:00'),1440);
 for(const bad of ['—','24:30','25:00','12:99',''])assert.equal(api.clockMinutes(bad),null);
});
test('explorer mounts after entity histories and its script loads before trend initialization',()=>{
 const trends=fs.readFileSync(path.join(__dirname,'../begd/trends.js'),'utf8'),index=fs.readFileSync(path.join(__dirname,'../begd/index.html'),'utf8');
 assert.match(trends,/<div id="entity-histories"><\/div><div id="operational-event-explorer"><\/div>/);
 assert.match(trends,/BEGDOperationalEvents\?\.mount\(host.querySelector\('#operational-event-explorer'\),period,bundle\?\.end_date\)/);
 assert.ok(index.indexOf('src="operational-events.js')<index.indexOf('src="trends.js'));
});
