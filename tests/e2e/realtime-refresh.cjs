/* Verify published snapshot polling without reload or changes to the selected daily report. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const preview=process.env.BEGD_PREVIEW_DIR||path.join(__dirname,'../../.cache/sharing-preview/begd');
 const bundled=JSON.parse(fs.readFileSync(path.join(preview,'live-data.js'),'utf8').replace(/^window.BEGD_STATIC_DATA=/,'').trim().replace(/;$/,''));
 const fresh=JSON.parse(fs.readFileSync(path.join(preview,'current-day.json'),'utf8'));
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage();let response=bundled.current_day,fail=false,calls=0;
 await page.route('**/current-day.json',route=>{calls++;return fail?route.abort():route.fulfill({contentType:'application/json',body:JSON.stringify(response)});});
 try{
  await page.goto((process.env.BEGD_TEST_URL||'http://127.0.0.1:18943/begd/')+'#realtime');
  await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('#current-status')?.textContent.includes('ERP snapshot captured'));
  const selected=await page.evaluate(()=>data.date),initial=await page.evaluate(()=>currentDayData.updated_at);
  response=fresh;await page.evaluate(()=>loadCurrentDay());assert.equal(await page.evaluate(()=>currentDayData.updated_at),fresh.updated_at);assert.equal(await page.evaluate(()=>currentDayData.demand_hourly.length),fresh.demand_hourly.length);assert.equal(await page.evaluate(()=>data.date),selected);assert.ok(calls>=2);
  assert.match(await page.locator('#current-status').innerText(),/Checks for newer published snapshots every three minutes/);
  fail=true;await page.evaluate(()=>loadCurrentDay());assert.equal(await page.evaluate(()=>currentDayData.updated_at),fresh.updated_at);assert.match(await page.locator('#current-status').innerText(),/Could not check the latest/);
  fail=false;response=bundled.current_day;await page.evaluate(()=>loadCurrentDay());assert.equal(await page.evaluate(()=>currentDayData.updated_at),fresh.updated_at);assert.equal(await page.evaluate(()=>data.date),selected);
  console.log('PASS: snapshot re-fetch, newer readings without reload, failure retention, older-artifact rejection and preserved selected report.',{initial,fresh:fresh.updated_at,readings:fresh.demand_hourly.length});
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
