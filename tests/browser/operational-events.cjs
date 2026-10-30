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
   let requests=0,fail=false;const errors=[];
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(route.request().url().endsWith('/operational-events.json')){requests++;return route.fulfill(fail?{status:503,body:'Unavailable'}:{json:bundle})}
    return serve(route);
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('https://begd.test/begd/index.html#trends');
   await page.waitForFunction(()=>document.querySelector('[data-event-result]')?.textContent.includes('65 of 65'));
   assert.equal(await page.locator('[data-event-rows] tr').count(),50);
   assert.equal(await page.locator('[data-event-coverage]').count(),0);
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
   assert.equal(await page.locator('[data-event-explorer-view="heatmap"]').isVisible(),width>600);
   if(width>600){
   await page.getByRole('tab',{name:'Category × hour',exact:true}).click();
   assert.equal(await page.locator('#operational-event-search').isVisible(),false);
   const settings=page.locator('.event-heatmap-settings');assert.equal(await settings.getAttribute('open'),null);
   assert.equal(await page.locator('#event-heatmap-asset').inputValue(),'');
   assert.equal(await page.locator('#event-heatmap-time').inputValue(),'action');
   assert.equal(await page.locator('#event-heatmap-date').inputValue(),'report');
   assert.equal(await page.locator('#event-heatmap-value').inputValue(),'count');
   assert.equal(await page.locator('[data-heatmap-summary]').count(),0);
   assert.equal(await page.locator('#operational-event-category').isVisible(),false);
   assert.equal(await page.locator('.event-heatmap tbody tr').count(),13);
   assert.equal(await page.locator('.event-heatmap tbody th').evaluateAll(cells=>cells.every(cell=>cell.scrollWidth<=cell.clientWidth)),true,'category labels must wrap inside their column');
   const heatCell=page.locator('[data-heatmap-category="scheduled"][data-heatmap-hour="8"]');
   assert.equal(await heatCell.innerText(),'64');await heatCell.click();
   assert.equal(await page.locator('[data-heatmap-evidence] tbody tr').count(),50);
   await page.locator('[data-heatmap-page="next"]').click();assert.equal(await page.locator('[data-heatmap-evidence] tbody tr').count(),14);
   assert.equal(await page.locator('[data-heatmap-evidence] a, [data-heatmap-evidence] [data-operational-event-date]').count(),0);
   await page.getByText('Additional settings',{exact:true}).click();
   await page.locator('#event-heatmap-value').selectOption('rate');
   assert.equal(await page.locator('[data-heatmap-category="scheduled"][data-heatmap-hour="8"]').innerText(),'32.00');
   assert.equal(await page.locator('.event-heatmap-settings').getAttribute('open'),'');
   await page.locator('#event-heatmap-asset').selectOption('Generator');
   assert.equal(await page.locator('[data-heatmap-category="scheduled"][data-heatmap-hour="8"]').innerText(),'0.00');
   await page.setViewportSize({width:390,height:900});
   assert.equal(await page.locator('[data-event-explorer-view="heatmap"]').isVisible(),false);
   await page.waitForFunction(()=>!document.querySelector('#event-explorer-logs').hidden&&document.querySelector('#event-explorer-heatmap').hidden);
   await page.setViewportSize({width,height:900});
   assert.equal(await page.getByRole('tab',{name:'Logs',exact:true}).getAttribute('aria-selected'),'true');
   }
   await page.locator('#operational-event-category').selectOption('');
   await page.locator('#operational-event-search').fill('Special');
   assert.equal(await page.locator('#operational-event-explorer a[href], [data-operational-event-date]').count(),0);
   assert.match(await page.locator('[data-event-rows]').innerText(),/2026-10-29/);
   assert.deepEqual(errors,[]);
   console.log('PASS operational event explorer',width,'heatmap defaults/settings/evidence, filters, all windows, pagination, plain dates, wrapped category labels, phone fallback and isolated retry');
   await context.close();
  }
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
