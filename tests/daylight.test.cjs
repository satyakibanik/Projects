const {test}=require('node:test');
const assert=require('node:assert/strict');
const daylight=require('../begd/daylight.js');
test('Dhaka dates produce seasonal apparent-horizon sunrise and sunset in BST',()=>{
 const november=daylight.times('2026-11-02'),summer=daylight.times('2026-06-21'),winter=daylight.times('2026-12-21');
 // Independent broad clock-time expectations, not copies of the equations.
 assert.ok(november.sunrise>360&&november.sunrise<370);
 assert.ok(november.sunset>1035&&november.sunset<1045);
 assert.ok(summer.sunset-summer.sunrise>800);
 assert.ok(winter.sunset-winter.sunrise<660);
 assert.ok(summer.sunset>winter.sunset+85);
 assert.notEqual(daylight.times('2026-11-03').sunset,november.sunset);
 assert.ok(daylight.times('2024-02-29'));
 for(const date of ['2026-02-29','2026-11-31','2026-13-01','not-a-date',null])assert.equal(daylight.times(date),null);
});
test('time bands cover the full plot, clip to the axis, and use each date across midnight',()=>{
 const html=daylight.bands('2026-11-02',{left:50,right:1050,top:10,bottom:210,maxMinute:2820});
 const rects=[...html.matchAll(/<rect class="daylight-(night|day)" data-daylight-date="([^"]+)" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)];
 assert.equal(rects.length,6);
 assert.deepEqual(rects.map(r=>r[2]),['2026-11-02','2026-11-02','2026-11-02','2026-11-03','2026-11-03','2026-11-03']);
 let end=50;
 for(const r of rects){assert.ok(Math.abs(Number(r[3])-end)<1e-8);end=Number(r[3])+Number(r[5]);assert.equal(Number(r[6]),200)}
 assert.ok(Math.abs(end-1050)<1e-8);
 assert.match(html,/pointer-events="none"/);
 assert.equal(daylight.bands(null,{left:0,right:10,top:0,bottom:10}),'');
});
test('dial background uses the correct short or long clockwise daylight sector and exposes its basis',()=>{
 assert.match(daylight.dial('2026-11-02',220,220,178),/A178,178 0 0 1/);
 assert.match(daylight.dial('2026-06-21',220,220,178),/A178,178 0 1 1/);
 assert.match(daylight.legend('2026-11-02'),/sunrise 06:04 · sunset 17:20 BST · estimated/);
 assert.match(daylight.legend('2026-11-02',{days:2}),/2026-11-03/);
});
