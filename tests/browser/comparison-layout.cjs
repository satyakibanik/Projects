// Offline regression for date focus/scroll, comparison colors and regional keys.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1213])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:858},isMobile:width===390,hasTouch:width===390});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const report=date=>({...fixture.report,report_id:date,date,published_date:date});
   await page.route('**/*',route=>{
    const u=new URL(route.request().url());
    if(u.pathname==='/api/report')return route.fulfill({json:report(u.searchParams.get('date')||'2026-10-29')});
    if(u.pathname==='/api/reports')return route.fulfill({json:{reports:['2026-10-29','2026-10-28','2026-10-27'].map(date=>({id:date,date,operating_date:date,published_date:date})),complete:true}});
    return serve(route);
   });
   await page.goto('https://begd.test/begd/index.html?v=2&date=2026-10-29&compare=2026-10-03,2026-10-27#operations');
   await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('#view-status').textContent!=='Restoring dashboard view…');
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   await page.waitForTimeout(150);
   async function steadyDate(action,date){
    await page.evaluate(()=>window.scrollTo(0,400));await page.waitForTimeout(100);
    const before=await page.evaluate(()=>scrollY);
    await action();
    await page.waitForFunction(date=>document.querySelector('#report-date').value===date&&document.querySelector('#report-date-controls').getAttribute('aria-busy')==='false',date);
    await page.waitForTimeout(150);
    const after=await page.evaluate(()=>scrollY);
    assert(Math.abs(after-before)<=8,`${width} ${theme}: date selection jumped ${before} → ${after}`);
    assert.equal(new URL(page.url()).hash,'#operations');
    assert.equal(new URL(page.url()).searchParams.get('date'),date);
    assert.equal(await page.locator('#custom-comparisons li').count(),2);
   }
   await steadyDate(()=>page.locator('#previous-report').click(),'2026-10-28');
   await steadyDate(()=>page.locator('#next-report').click(),'2026-10-29');
   await steadyDate(async()=>{await page.locator('#report-date').fill('2026-10-27');await page.locator('#load-report').click()},'2026-10-27');
   await steadyDate(async()=>{await page.locator('#report-date').fill('2026-10-28');await page.locator('#report-date').press('Enter')},'2026-10-28');
   await steadyDate(()=>page.locator('#latest-report').click(),'2026-10-29');
   await page.locator('nav a[href="#overview"]').click();
   await page.locator('[data-toggle-series="shed_mw_custom_2026-10-03"]').waitFor();
   const colors=await page.locator('[data-chart-style="shed"]').evaluate(el=>{
    const wrap=el.closest('.interactive-chart');
    return ['2026-10-03','2026-10-27'].map(date=>wrap.querySelector('[data-toggle-series="shed_mw_custom_'+date+'"]').closest('label').querySelector('.series-swatch rect').getAttribute('fill'));
   });
   assert.notEqual(colors[0],colors[1],'loaded reports must have distinct colors');
   await page.locator('nav a[href="#regions"]').click();
   await page.waitForFunction(()=>document.querySelector('.regional-date-keys')?.children.length===3&&document.querySelector('#view-status').textContent!=='Restoring dashboard view…');
   for(const style of ['stacked','line']){
    await page.locator('[data-regional-snapshot-style]').selectOption(style);await page.waitForTimeout(100);
    const keys=page.locator('.regional-snapshot-date-key');assert.equal(await keys.count(),3);
    assert.equal(await keys.evaluateAll(keys=>keys.every(key=>{
     const swatch=key.querySelector('svg').getBoundingClientRect(),box=key.getBoundingClientRect();
     return Math.abs(swatch.width-46)<1&&Math.abs(swatch.height-16)<1&&key.scrollWidth<=key.clientWidth+1&&box.height<65;
    })),true,`${width} ${theme} ${style}: regional date keys must stay compact`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   }
   assert.deepEqual(errors,[]);console.log('PASS comparison layout',width,theme,'distinct colors, compact legends, stable date arrows/load/Enter/latest');
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
