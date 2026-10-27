/* Run against a local preview containing published plant histories. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:8772/begd/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const section=page.locator('#plants-history'),chart=section.locator('[data-history-chart]');
 const ready=async()=>{await chart.locator('svg.trends-plot').waitFor()};
 const checkbox=()=>chart.locator('[data-history-water-level]');
 const axis=()=>chart.locator('.trends-secondary-axis');
 try{
  await page.goto(base+'?v=2&date=2026-10-24&days=365#trends');
  await section.waitFor();await ready();
  assert.equal(await section.locator('[data-history-days="365"]').getAttribute('aria-pressed'),'true');
  assert.match(await chart.innerText(),/2025-10-25 – 2026-10-24/);
  assert.equal(await page.getByRole('heading',{name:'Kaptai Lake water level',exact:true}).count(),0);
  assert.equal(await checkbox().count(),0);
  await section.locator('[data-history-search]').fill('Karnaphuli Hydro');
  await section.locator('.history-entity-name').click();await ready();
  assert.equal(await checkbox().isChecked(),true);
  assert.match(await axis().getAttribute('aria-label'),/Kaptai Lake water level, right axis \(ft MSL\)/);
  assert.match(await chart.innerText(),/Kaptai Lake water level: 365\/365 days reported/);
  for(const days of [30,60,90,365]){
   await page.locator(`[data-trend-days="${days}"]`).click();await ready();
   assert.equal(await section.locator(`[data-history-days="${days}"]`).getAttribute('aria-pressed'),'true');
   assert.match(await chart.innerText(),new RegExp(`Kaptai Lake water level: ${days}/${days} days reported`));
  }
  for(const days of [30,60,90,365]){
   await section.locator(`[data-history-days="${days}"]`).click();await ready();
   assert.equal(await page.locator(`[data-trend-days="${days}"]`).getAttribute('aria-pressed'),'true');
   assert.equal(await checkbox().isChecked(),true);
   assert.match(await chart.innerText(),new RegExp(`Kaptai Lake water level: ${days}/${days} days reported`));
   await chart.locator('svg.trends-plot').focus();await page.keyboard.press('End');
   assert.match(await chart.locator('[role="tooltip"]').innerText(),/102.36 ft MSL · 24\/24 hours/);
   await page.keyboard.press('Escape');
  }
  const waterPath=()=>chart.locator('svg.trends-plot > path[stroke="#087e8b"]').getAttribute('d');
  const baseline=await waterPath();
  // The combined draft must retain the cost chart's group selector and fit.
  const costs=page.locator('.bpdb-cost-trend');await costs.waitFor();
  await costs.locator('[data-cost-trendline]').check();await ready();
  await costs.locator('[data-cost-trendline-path]').waitFor();
  await costs.locator('[data-trend-group]').check();await ready();
  assert.equal(await costs.locator('[data-cost-trendline-path]').count(),0);
  assert.equal(await waterPath(),baseline);
  await costs.locator('[data-trend-group]').uncheck();await ready();
  await costs.locator('[data-cost-trendline-path]').waitFor();
  assert.equal(await checkbox().isChecked(),true);assert.equal(await waterPath(),baseline);
  for(const metric of ['peak_generation_mw','capacity_factor_pct','puf_pct','utilization_ratio_pct','capacity']){
   const button=section.locator(`[data-history-metric-choice="${metric}"]`);
   assert.equal(await button.isEnabled(),true);await button.click();await ready();
   assert.equal(await checkbox().isChecked(),true);assert.equal(await waterPath(),baseline);
   assert.equal(await axis().count(),1);
  }
  await checkbox().uncheck();await ready();assert.equal(await axis().count(),0);
  for(const metric of ['peak_generation_mw','capacity_factor_pct','capacity']){
   await section.locator(`[data-history-metric-choice="${metric}"]`).click();await ready();
   assert.equal(await checkbox().isChecked(),false);assert.equal(await axis().count(),0);
  }
  await section.locator('[data-history-search]').fill('Karnaphuli Power');
  await section.locator('.history-entity-name').click();await ready();assert.equal(await checkbox().count(),0);assert.equal(await axis().count(),0);
  await section.locator('[data-history-search]').fill('Karnaphuli Hydro');
  await section.locator('.history-entity-name').click();await ready();assert.equal(await checkbox().isChecked(),false);
  await checkbox().check();await ready();
  await section.locator('[data-history-metric-choice="peak_generation_mw"]').click();await ready();
  const output=path.resolve(__dirname,'../../.cache/kaptai-qa');fs.mkdirSync(output,{recursive:true});
  await chart.screenshot({path:path.join(output,'overlay-desktop.png')});
  await page.setViewportSize({width:390,height:844});await ready();
  await chart.locator('svg.trends-plot').focus();await page.keyboard.press('End');
  const tip=await chart.locator('[role="tooltip"]').boundingBox();assert.ok(tip.x>=0&&tip.x+tip.width<=390);
  await page.keyboard.press('Escape');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await chart.screenshot({path:path.join(output,'overlay-mobile.png')});
  assert.deepEqual(errors,[]);
  console.log('Karnaphuli overlay: default on; ft MSL right axis; 30/60/90/365 days; all five metrics preserve water curve; checkbox persists across metric and plant changes; other plants excluded; desktop/mobile passed.');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exit(1)});
