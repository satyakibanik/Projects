// Offline desktop/mobile integration: window changes, filters, pagination and retry.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const bundle={version:1,end_date:'2026-10-29',days:[
 {date:'2026-10-29',report_id:'2',events:Array.from({length:65},(_,i)=>({outage_time:i===0?'—':'08:01',restoration_time:i===0?'09:00':'—',description:i===0?'Special line is restored.':`Unit ${i} Scheduled S/D Due to annual maintenance <full> & source`}))},
 {date:'2026-09-29',report_id:'1',events:[{outage_time:'03:00',restoration_time:'—',description:'Older generator Tripped with remarks:- flame failure'}]},
 {date:'2026-10-28',report_id:'3',events:[]},
 {date:'2026-10-27',report_id:'4',events:null}
]};
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
   let requests=0,fail=false,failDate=false,holdDate=null,releaseDate=null,signalHeld=null;const errors=[];
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/report'&&url.searchParams.has('date')){
      const date=url.searchParams.get('date');
      if(holdDate===date){holdDate=null;signalHeld?.();await new Promise(resolve=>{releaseDate=resolve})}
      return route.fulfill(failDate?{status:404,json:{error:'No report'}}:{json:{...fixture.report,date,report_id:'day-'+date,operations:{...fixture.report.operations,events:bundle.days.find(d=>d.date===date)?.events||[]}}});
    }
    if(route.request().url().endsWith('/operational-events.json')){requests++;return route.fulfill(fail?{status:503,body:'Unavailable'}:{json:bundle})}
    return serve(route);
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('https://begd.test/begd/index.html#trends');
   await page.waitForFunction(()=>document.querySelector('[data-event-result]')?.textContent.includes('65 of 65'));
   assert.equal(await page.locator('[data-event-rows] tr').count(),50);
   await page.waitForFunction(()=>document.querySelector('[data-event-coverage]')?.textContent.includes('2 / 30 days'));
   assert.match(await page.locator('[data-event-coverage]').innerText(),/2 \/ 30 days/);
   assert.match(await page.locator('[data-event-rows]').innerText(),/<full> & source/);
   await page.locator('[data-event-next]').click();assert.equal(await page.locator('[data-event-rows] tr').count(),15);
   await page.locator('#operational-event-search').fill('SPECIAL');
   assert.match(await page.locator('[data-event-result]').innerText(),/1 of 65/);
   assert.match(await page.locator('[data-event-rows]').innerText(),/— – 09:00/);
   assert.equal(await page.locator('#operational-event-search').inputValue(),'SPECIAL');
   await page.locator('#operational-event-category').selectOption('trip');assert.match(await page.locator('[data-event-rows]').innerText(),/No entries match/);
   await page.locator('#operational-event-search').fill('');
   for(const days of [60,90,365]){
    await page.locator(`[data-trend-days="${days}"]`).click();
    await page.waitForFunction(()=>document.querySelector('[data-event-result]')?.textContent.includes('1 of 66'));
    assert.match(await page.locator('[data-event-rows]').innerText(),/Older generator Tripped/);
   }
   await page.locator('[data-trend-days="10y"]').click();assert.equal(await page.locator('#operational-event-explorer').count(),0);
   await page.locator('[data-trend-days="30"]').click();assert.equal(requests,1,'range changes must reuse the event bundle');
   // Fail only the independent log request; the generation charts remain mounted.
   fail=true;await page.reload();await page.getByRole('button',{name:'Retry event logs'}).waitFor();
   assert.ok(await page.locator('[data-trend-chart]').count()>0);
   fail=false;await page.getByRole('button',{name:'Retry event logs'}).click();
   await page.waitForFunction(()=>document.querySelector('[data-event-result]')?.textContent.includes('65 of 65'));
   await page.locator('#operational-event-search').fill('Special');
   await page.getByRole('tab',{name:'Category × hour',exact:true}).click();
   assert.equal(await page.locator('#operational-event-search').isVisible(),false);
   const settings=page.locator('.event-heatmap-settings');assert.equal(await settings.getAttribute('open'),null);
   assert.equal(await page.locator('#event-heatmap-asset').inputValue(),'');
   assert.equal(await page.locator('#event-heatmap-time').inputValue(),'action');
   assert.equal(await page.locator('#event-heatmap-date').inputValue(),'report');
   assert.equal(await page.locator('#event-heatmap-value').inputValue(),'count');
   assert.match(await page.locator('[data-heatmap-summary]').innerText(),/65 timed entries/);
   await page.locator('#operational-event-category').selectOption('scheduled');
   const heatCell=page.locator('[data-heatmap-category="scheduled"][data-heatmap-hour="8"]');
   assert.equal(await heatCell.innerText(),'64');await heatCell.click();
   assert.equal(await page.locator('[data-heatmap-evidence] tbody tr').count(),50);
   await page.locator('[data-heatmap-page="next"]').click();assert.equal(await page.locator('[data-heatmap-evidence] tbody tr').count(),14);
   await page.getByText('Additional settings',{exact:true}).click();
   await page.locator('#event-heatmap-value').selectOption('rate');
   assert.equal(await page.locator('[data-heatmap-category="scheduled"][data-heatmap-hour="8"]').innerText(),'32.00');
   assert.equal(await page.locator('.event-heatmap-settings').getAttribute('open'),'');
   await page.locator('#event-heatmap-asset').selectOption('Generator');
   assert.match(await page.locator('[data-heatmap-summary]').innerText(),/0 timed entries/);
   await page.getByRole('tab',{name:'Logs',exact:true}).click();
   await page.locator('#operational-event-category').selectOption('');
   await page.locator('#operational-event-search').fill('Special');
   const dateButton=page.locator('[data-operational-event-date="2026-10-29"]');
   assert.equal(await dateButton.count(),1);
   assert.equal(await page.locator('#operational-event-explorer a[href]').count(),0);
   await dateButton.click();
   await page.waitForFunction(()=>location.hash==='#operations'&&document.querySelector('#report-date').value==='2026-10-29'&&!document.querySelector('[data-event-view="table"]').hidden);
   assert.match(page.url(),/date=2026-10-29#operations/);
   assert.ok(await page.locator('.event-chronograph-panel').boundingBox());
   await page.locator('[data-event-view-select="lanes"]').click();
   await page.locator('nav a[href="#trends"]').click();
   await page.locator('[data-operational-event-date="2026-10-29"]').click();
   await page.waitForFunction(()=>location.hash==='#operations'&&!document.querySelector('[data-event-view="table"]').hidden);
   await page.locator('nav a[href="#trends"]').click();failDate=true;
   await page.locator('[data-operational-event-date="2026-10-29"]').click();
   await page.waitForFunction(()=>document.querySelector('[data-event-result]')?.textContent.includes('could not be opened'));
   assert.equal(new URL(page.url()).hash,'#trends');
   // A date click must supersede an unfinished restoration of the page URL.
   failDate=false;holdDate='2026-10-29';
   const held=new Promise(resolve=>{signalHeld=resolve});
   await page.goto('https://begd.test/begd/index.html?v=2&date=2026-10-29&days=60#trends');
   await Promise.race([held,new Promise((_,reject)=>setTimeout(()=>reject(Error('Initial date request was not held')),5000))]);
   await page.locator('[data-trend-days="60"]').click();
   await page.locator('#operational-event-search').fill('Older generator');
   await page.locator('[data-operational-event-date="2026-09-29"]').click();
   await page.waitForFunction(()=>location.hash==='#operations'&&document.querySelector('#report-date').value==='2026-09-29');
   const originalResponse=page.waitForResponse(response=>response.url().includes('/api/report?date=2026-10-29'));
   releaseDate();await originalResponse;await page.waitForTimeout(100);
   assert.equal(await page.locator('#report-date').inputValue(),'2026-09-29');
   assert.equal(new URL(page.url()).searchParams.get('date'),'2026-09-29');
   assert.equal(new URL(page.url()).hash,'#operations');
   assert.deepEqual(errors,[]);
   console.log('PASS operational event explorer',width,'heatmap defaults/settings/evidence, filters, all windows, pagination, date navigation, startup race and isolated retry');
   await context.close();
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
