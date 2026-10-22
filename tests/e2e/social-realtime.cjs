/* Uses the current published snapshots in a local preview; X navigation is stubbed. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1000},permissions:['clipboard-read','clipboard-write']});
 await context.addInitScript(()=>{window.opened=[];window.open=url=>{window.opened.push(url);return {};};});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto((process.env.BEGD_TEST_URL||'http://127.0.0.1:18945/begd/')+'#realtime');
  await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('.realtime-dispatch-plots'));
  const plots=page.locator('.realtime-dispatch-plots .interactive-chart');assert.equal(await plots.count(),2);
  assert.equal(await plots.nth(0).locator('[data-series="shed_mw"]').count(),0);
  assert.equal(await plots.nth(1).locator('[data-series="shed_mw"]').count(),1);
  const initial=await page.evaluate(()=>({date:data.date,rows:currentDayData.demand_hourly.length,updated:currentDayData.updated_at}));assert.ok(initial.rows>0);
  for(const plot of [plots.nth(0),plots.nth(1)]){
   await plot.locator('[data-point]').first().focus();
   for(const peer of [plots.nth(0),plots.nth(1)]){
    const text=await peer.locator('.chart-tooltip').innerText();assert.match(text,/generation \(real time\)/);assert.match(text,/Demand \(real time\)/);assert.match(text,/Load shedding \(real time\)/);
    assert.equal(await peer.locator('.chart-cursor').getAttribute('hidden'),null);
   }
   await page.keyboard.press('Escape');assert.equal(await plots.locator('.chart-tooltip:visible').count(),0);
  }
  // Matching axes: the shared reading falls at the same pixel in each plot.
  const axes=await plots.evaluateAll(nodes=>nodes.map(n=>{const r=n.querySelector('[data-point]').getBoundingClientRect();return r.x+r.width/2;}));assert.ok(Math.abs(axes[0]-axes[1])<1);
  await plots.nth(1).locator('[data-point]').first().hover();assert.equal(await plots.locator('.chart-tooltip:visible').count(),2);
  await page.mouse.move(0,0);assert.equal(await plots.locator('.chart-tooltip:visible').count(),0);
  await page.screenshot({path:'/private/tmp/begd-realtime-subplots.png',fullPage:true});
  // Observe the actual detached export; controls are omitted, the chosen report is retained.
  await page.evaluate(()=>{const original=window.html2canvas;window.html2canvas=(target,options)=>{if(target.matches('.dashboard-export'))window.snapshot={text:target.innerText,date:data.date,overview:!!target.querySelector('.dispatch-main'),comparisons:!!target.querySelector('#day-sources')};return original(target,options);};});
  await page.locator('#share-dashboard').click();const dialog=page.locator('.figure-share-dialog[open]');await dialog.getByLabel('Custom message').fill('Bangladesh grid today');await dialog.getByRole('link',{name:'Share dashboard on X.com'}).click();
  await page.waitForFunction(()=>window.opened.length===1,{},{timeout:60000});
  const snapshot=await page.evaluate(()=>window.snapshot);assert.equal(snapshot.overview,true);assert.equal(snapshot.comparisons,false);assert.doesNotMatch(snapshot.text,/Optional report comparisons/);assert.equal(snapshot.date,initial.date);
  const png=await page.evaluate(async()=>{const item=(await navigator.clipboard.read()).find(i=>i.types.includes('image/png'));return Array.from(new Uint8Array(await(await item.getType('image/png')).arrayBuffer()));});
  const data=Buffer.from(png);assert.equal(data.subarray(1,4).toString(),'PNG');assert.ok(data.readUInt32BE(16)>=2000);fs.writeFileSync('/private/tmp/begd-overview-clipboard.png',data);
  assert.equal(await page.locator('.dashboard-export').count(),0);assert.equal(await page.evaluate(()=>location.hash),'#realtime');
  const url=new URL(await page.evaluate(()=>window.opened[0]));assert.equal(url.searchParams.get('text'),'Bangladesh grid today');
  await page.evaluate(()=>{navigator.clipboard.write=()=>Promise.reject(new Error('Clipboard denied'));});await page.locator('#share-dashboard').click();await page.locator('.dashboard-x-link').click();await page.getByRole('status').filter({hasText:'X was not opened'}).waitFor();assert.equal(await page.evaluate(()=>window.opened.length),1);await page.locator('#figure-share-progress').getByRole('button',{name:'Close',exact:true}).click();
  // Even if ERP sources are empty, both plots remain available with missing-data feedback.
  await page.evaluate(()=>{currentDayData={...currentDayData,demand_hourly:[],generation_hourly:[]};render();});assert.equal(await page.locator('.realtime-dispatch-plots .interactive-chart').count(),2);assert.match(await page.locator('.realtime-dispatch-plots').innerText(),/No reported load shedding/);
  await page.setViewportSize({width:390,height:858});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: published data, synchronized hover/focus/cursors, aligned subplots, actual Overview clipboard PNG, comparison omission, preserved view/date/message, denied clipboard, empty ERP and mobile.',initial);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
