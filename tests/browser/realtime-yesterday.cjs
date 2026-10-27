// Uses the offline site fixture; no ERP or forecast-model network requests.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1440]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390});
   let snapshot={...fixture.current_day,today_date:'2026-01-01',source_dates:{demand:'2026-01-01'},demand_hourly:[{time:'00:00',demand_mw:100,supply_mw:96,shed_mw:3}],forecast_history:{'2025-12-31':{demand_hourly:[{time:'00:00',demand_mw:90,supply_mw:90,shed_mw:0},{time:'23:00',demand_mw:110,supply_mw:101,shed_mw:8}]}}};
   await context.route('**/*',route=>new URL(route.request().url()).pathname==='/api/current-day'?route.fulfill({json:snapshot}):serve(route));
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto('https://begd.test/begd/index.html#realtime');
   const checkbox=page.locator('#realtime-yesterday'),panel=page.locator('#today-forecast-panel'),summary=page.locator('#today-forecast-panel > summary');
   await checkbox.waitFor();
   assert.equal(await checkbox.isChecked(),false);assert.equal(await panel.getAttribute('open'),null);
   assert.equal(await panel.locator('.forecast-body').isVisible(),false);
   await summary.click();assert.notEqual(await panel.getAttribute('open'),null);
   await checkbox.check();
   assert.notEqual(await panel.getAttribute('open'),null,'Opening yesterday collapsed forecasts');
   const plots=page.locator('[data-sync-group="realtime-dispatch"]');
   assert.equal(await plots.count(),2);
   for(let i=0;i<2;i++){
    const plot=plots.nth(i);
    assert.match(await plot.innerText(),/31 Dec 2025/);assert.match(await plot.innerText(),/1 Jan 2026/);
    await plot.locator('[data-point="0"]').focus();
    assert.match(await plot.locator('.chart-tooltip').innerText(),/31 Dec 2025 · 00:00/);
    assert.match(await plot.locator('.chart-tooltip').innerText(),/0 MW/);
    await plot.locator('[data-point="2"]').focus();
    assert.match(await plot.locator('.chart-tooltip').innerText(),/1 Jan 2026 · 00:00/);
   }
   await summary.focus();await summary.press('Space');assert.equal(await panel.getAttribute('open'),null);
   await checkbox.uncheck();assert.equal(await panel.getAttribute('open'),null);
   assert.equal(await plots.first().locator('[data-point]').count(),1);
   // Returning to Real time rerenders while retaining the session choices.
   await checkbox.check();
   await page.locator('nav a[href="#overview"]').click();await page.locator('nav a[href="#realtime"]').click();
   assert.equal(await checkbox.isChecked(),true);assert.equal(await panel.getAttribute('open'),null);
   // A fresh snapshot day uses only its exact previous date, never an older day.
   snapshot={...snapshot,today_date:'2026-01-02'};
   await page.reload();await checkbox.waitFor();
   assert.equal(await checkbox.isDisabled(),true);assert.match(await page.locator('#realtime-yesterday-status').innerText(),/ERP readings unavailable/);
   assert.deepEqual(errors,[]);console.log('PASS',width,'yesterday timeline, dated synchronized tooltips, missing history, native disclosure and session state');
   await context.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
