/* Opt-in real-browser checks against a local static preview of current published data.
   NODE_PATH=/path/to/node_modules BEGD_TEST_URL=http://127.0.0.1:8767/begd/ node tests/e2e/shared-view.cjs
   Set BEGD_BROWSER_EXECUTABLE if using a system Chromium/Edge installation. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path'),os=require('node:os');
const base=process.env.BEGD_TEST_URL||'http://127.0.0.1:8767/begd/';
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const errors=[];
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.stack));
 const ready=async p=>{await p.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('#content').children.length>0&&document.querySelector('#view-status').textContent!=='Restoring dashboard view…');};
 const capture=async p=>JSON.parse(await p.evaluate(()=>JSON.stringify(window.BEGDView.capture())));
 const add=async date=>{await page.locator('#comparison-date').fill(date);await page.locator('#add-comparison').click();await page.waitForFunction(date=>document.querySelector('#custom-comparisons').textContent.includes('Operating '+date)&&!document.querySelector('#custom-comparisons').textContent.includes('Loading…'),date);};
 try{
  await page.goto(base+'#overview');await ready(page);
  const dates=await page.evaluate(()=>Object.values(window.BEGD_STATIC_DATA.reports_by_id).map(r=>r.date).sort().reverse());
  const [selected,first,second]=dates;
  assert.equal((await capture(page)).date,selected);
  await add(first);await add(second);
  assert.equal(await page.locator('#custom-comparisons li').count(),2);
  assert.equal(await page.locator('#comparison-date').isVisible(),true);assert.equal(await page.locator('#add-comparison').isVisible(),true);
  await add(first);assert.match(await page.locator('#comparison-status').innerText(),/already included/);assert.equal(await page.locator('#custom-comparisons li').count(),2);
  await page.locator('#comparison-date').fill('');await page.locator('#add-comparison').click();assert.match(await page.locator('#comparison-status').innerText(),/valid operating date/);
  await add('1900-01-01');assert.match(await page.locator('#comparison-status').innerText(),/No archived report/);
  await page.getByRole('button',{name:'Remove comparison for operating date 1900-01-01',exact:true}).click();
  await page.getByRole('button',{name:'Remove comparison for operating date '+first,exact:true}).click();assert.equal(await page.locator('#custom-comparisons li').count(),1);await add(first);
  // A published older archive report, fetched on demand (download this snapshot into the preview).
  const archived=process.env.BEGD_ARCHIVE_DATE||'2026-09-15';await add(archived);assert.match(await page.locator('#comparison-status').innerText(),/Added/);
  await page.locator('[data-chart-style="dispatch"]').selectOption('bar');
  await page.locator('#fuel-mix-style').selectOption('ring');
  await page.locator('[data-toggle-series="generation_mw"]').uncheck();
  await page.locator('[data-chart-style="shed"]').selectOption('line');
  const styled=await capture(page);assert.equal(styled.dispatch,'bar');assert.equal(styled.fuel,'ring');assert.ok(styled.layers.some(([key,value])=>key==='overview:dispatch|generation_mw'&&!value));
  // Real clipboard, followed by a fresh browser context (no session storage).
  await page.locator('#copy-link').click();await page.waitForFunction(()=>document.querySelector('#share-status').textContent==='Link copied.');
  const link=await page.evaluate(()=>navigator.clipboard.readText());assert.equal(new URL(link).searchParams.get('date'),selected);
  const freshContext=await browser.newContext({reducedMotion:'reduce'}),fresh=await freshContext.newPage();fresh.on('pageerror',e=>errors.push(e.stack));
  await fresh.route('**/archive/*.json',async route=>{await new Promise(resolve=>setTimeout(resolve,200));await route.continue()});
  await fresh.goto(link);await ready(fresh);assert.deepEqual(await capture(fresh),styled);
  assert.equal(await fresh.locator('[data-toggle-series="generation_mw"]').isChecked(),false);assert.equal(await fresh.locator('#fuel-mix-style').inputValue(),'ring');
  await fresh.reload();await ready(fresh);assert.deepEqual(await capture(fresh),styled);
  // History restores asynchronous comparisons as well as synchronous chart choices.
  await fresh.locator('#fuel-mix-style').selectOption('pie');await fresh.waitForFunction(()=>new URL(location.href).searchParams.get('fuel')==='pie');
  await fresh.goBack();await ready(fresh);assert.equal(await fresh.locator('#fuel-mix-style').inputValue(),'ring');
  await fresh.goForward();await ready(fresh);assert.equal(await fresh.locator('#fuel-mix-style').inputValue(),'pie');
  // Clipboard denial exposes a selectable, exact URL.
  await fresh.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied')}}}));
  await fresh.locator('#copy-link').click();await fresh.waitForFunction(()=>!document.querySelector('#share-fallback').hidden);assert.match(await fresh.locator('#share-status').innerText(),/Select and copy/);assert.equal(await fresh.locator('#share-url').inputValue(),fresh.url());
  const alternateId=await fresh.evaluate(date=>window.BEGD_STATIC_DATA.reports_by_operating_date[date],second);
  await fresh.locator('#date').selectOption(alternateId);await fresh.waitForFunction(date=>document.querySelector('#subtitle').textContent.includes(new Date(date+'T12:00:00+06:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Dhaka'})),second);
  await fresh.waitForFunction(date=>new URL(location.href).searchParams.get('date')===date,second);
  assert.equal((await capture(fresh)).date,second);await fresh.reload();await ready(fresh);assert.equal((await capture(fresh)).date,second);
  await freshContext.close();
  // Presets resolve to explicit dates. Tomorrow is currently unavailable and remains pinned unavailable.
  await page.locator('#source-highest').check();await page.waitForFunction(()=>document.querySelector('#highest-status').textContent!=='Loading…');
  await page.locator('#source-tomorrow').check();await page.waitForFunction(()=>document.querySelector('#tomorrow-status').textContent==='Unavailable');
  const pinned=await capture(page);assert.match(pinned.presets.highest,/^\d{4}-\d{2}-\d{2}$/);assert.equal(pinned.presets.tomorrow,'unavailable');
  // Custom sources appear on every existing comparison view.
  await page.locator('nav a[href="#regions"]').click();await ready(page);
  assert.ok((await page.locator('.regional-snapshot-legend').innerText()).includes(archived));
  await page.locator('[data-regional-snapshot-style]').selectOption('line');
  await page.reload();await ready(page);assert.equal(await page.locator('[data-regional-snapshot-style]').inputValue(),'line');
  await page.locator('nav a[href="#imports"]').click();await ready(page);
  assert.ok(await page.locator(`[data-toggle-series="total_mw_custom_${archived}"]`).count());
  await page.locator(`[data-toggle-series="total_mw_custom_${archived}"]`).uncheck();
  await page.reload();await ready(page);assert.equal(await page.locator(`[data-toggle-series="total_mw_custom_${archived}"]`).isChecked(),false);
  await page.locator('nav a[href="#plants"]').click();await ready(page);
  await page.locator('.plant-row').first().click();await page.waitForSelector('.plant-detail .interactive-chart');
  assert.ok(await page.locator(`.plant-detail [data-toggle-series="output_custom_${first}"]`).count());
  await page.locator('nav a[href="#en-curve"]').click();await ready(page);
  const curveSeries=page.locator('.en-curve-chart [data-toggle-series]').first(),curveKey=await curveSeries.getAttribute('data-toggle-series');
  await curveSeries.uncheck();await page.locator('[data-chart-style="en-curve"]').selectOption('line');
  await page.reload();await ready(page);assert.equal(await page.locator('[data-chart-style="en-curve"]').inputValue(),'line');
  assert.equal(await page.locator(`.en-curve-chart [data-toggle-series="${curveKey}"]`).isChecked(),false);
  await page.locator('nav a[href="#trends"]').click();await ready(page);await page.waitForSelector('[data-trend-layer]');
  assert.equal(await page.locator('#day-sources').isVisible(),false);
  await page.locator('[data-trend-days="90"]').click();
  await page.locator('[data-trend-layer="Maximum temperature"]').check();
  await page.locator('[data-temperature-unit="°F"]').click();
  await page.locator('[data-temperature-detail="daily"]').click();
  await page.locator('[data-trend-unit="MW"][data-unit-chart="generation"]').click();
  await page.locator('[data-trend-unit="MW"][data-unit-chart="imports"]').click();
  await page.locator('[data-trend-layer="Generation"]').uncheck();
  await page.locator('[data-trend-layer="Coal"]').uncheck();
  const trends=await capture(page);await page.locator('#copy-link').click();await page.waitForFunction(()=>document.querySelector('#share-status').textContent==='Link copied.');
  const trendsLink=await page.evaluate(()=>navigator.clipboard.readText());
  const newContext=await browser.newContext({reducedMotion:'reduce'}),newPage=await newContext.newPage();newPage.on('pageerror',e=>errors.push(e.stack));
  await newPage.goto(trendsLink);await ready(newPage);await newPage.waitForSelector('[data-temperature-unit]');assert.deepEqual(await capture(newPage),trends);
  await newPage.reload();await ready(newPage);await newPage.waitForSelector('[data-temperature-unit]');assert.deepEqual(await capture(newPage),trends);
  assert.equal(await newPage.locator('[data-trend-layer="Maximum temperature"]').isChecked(),true);assert.equal(await newPage.locator('[data-trend-layer="Generation"]').isChecked(),false);assert.equal(await newPage.locator('[data-trend-layer="Coal"]').isChecked(),false);
  // Existing long v1 links must open identically, then Copy link migrates to compact v2.
  const legacyState=await newPage.evaluate(()=>window.BEGDTrends.getViewState()),legacy=new URL(trendsLink);
  legacy.searchParams.delete('hide');legacy.searchParams.delete('show');legacy.searchParams.set('v','1');
  const defaults=await newPage.evaluate(()=>window.BEGDViewCodec.defaults);
  for(const key of Object.keys(defaults))legacy.searchParams.set(key,trends[key]);
  legacy.searchParams.set('layers',JSON.stringify(trends.layers));legacy.searchParams.set('trendLayers',JSON.stringify(legacyState.trendLayers));
  await newPage.goto(legacy.href);await ready(newPage);await newPage.waitForSelector('[data-temperature-unit]');assert.deepEqual(await capture(newPage),trends);
  await newPage.locator('#copy-link').click();await newPage.waitForFunction(()=>document.querySelector('#share-url').value.includes('v=2'));
  const migrated=await newPage.locator('#share-url').inputValue();assert.ok(migrated.length<legacy.href.length);assert.equal(new URL(migrated).searchParams.has('trendLayers'),false);assert.equal(new URL(migrated).searchParams.has('layers'),false);
  await newPage.goto(migrated);await ready(newPage);await newPage.waitForSelector('[data-temperature-unit]');assert.deepEqual(await capture(newPage),trends);
  for(const days of ['30','60','90','365','10y']){await newPage.locator(`[data-trend-days="${days}"]`).click();await newPage.waitForFunction(days=>(new URL(location.href).searchParams.get('days')||'30')===days,days);assert.equal((await capture(newPage)).days,days);}
  await newPage.goBack();await ready(newPage);assert.equal((await capture(newPage)).days,'365');await newPage.goForward();await ready(newPage);assert.equal((await capture(newPage)).days,'10y');
  await newContext.close();
  await page.locator('nav a[href="#overview"]').click();await ready(page);
  // Keyboard Add works, and labels/remove buttons stay usable in every layout.
  for(const width of [1440,390])for(const theme of ['light','dark']){
   await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme},theme);
   await page.waitForTimeout(100);
   const bounds=await page.locator('#comparison-date').boundingBox();assert.ok(bounds.width>=150);assert.ok(bounds.x+bounds.width<=width);
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`${width} ${theme}: overflow`);
   await page.screenshot({path:path.join(os.tmpdir(),`begd-${width}-${theme}.png`),fullPage:true});
  }
  await page.locator('#comparison-date').fill('1900-01-02');await page.locator('#comparison-date').press('Enter');await page.waitForFunction(()=>document.querySelector('#comparison-status').textContent.includes('No archived report'));
  // Invalid parameters and legacy hash-only links are safe.
  await page.goto(base+'?date=bad&days=999&layers=oops#overview');await ready(page);assert.match(await page.locator('#view-status').innerText(),/Invalid operating date/);assert.equal((await capture(page)).days,'30');
  await page.goto(base+'?compare=1900-01-01#overview');await ready(page);assert.ok((await capture(page)).custom.includes('1900-01-01'));assert.match(await page.locator('#custom-comparisons').innerText(),/No archived report/);
  await page.goto(base+'#trends');await ready(page);assert.equal((await capture(page)).days,'30');await page.goto(base+'#overview');await ready(page);
  assert.deepEqual(errors,[]);console.log('PASS: custom comparisons, exact archive dates, fresh-session/reload state, all trends ranges, units/styles/visibility/temperature, history, clipboard success/fallback, keyboard, legacy/invalid links, desktop/mobile/light/dark.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
