/* Uses the current published snapshots in a local preview; X navigation is stubbed. */
const {chromium}=require('playwright'),assert=require('node:assert/strict');
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
    const text=await peer.locator('.chart-tooltip').innerText();assert.match(text,/Supply · substation side/);assert.match(text,/Demand · substation side/);assert.match(text,/Load shedding · substation side/);
    assert.equal(await peer.locator('.chart-cursor').getAttribute('hidden'),null);
   }
   await page.keyboard.press('Escape');assert.equal(await plots.locator('.chart-tooltip:visible').count(),0);
  }
  // Matching axes: the shared reading falls at the same pixel in each plot.
  const axes=await plots.evaluateAll(nodes=>nodes.map(n=>{const r=n.querySelector('[data-point]').getBoundingClientRect();return r.x+r.width/2;}));assert.ok(Math.abs(axes[0]-axes[1])<1);
  await plots.nth(1).locator('[data-point]').first().hover();assert.equal(await plots.locator('.chart-tooltip:visible').count(),2);
  await page.mouse.move(0,0);assert.equal(await plots.locator('.chart-tooltip:visible').count(),0);
  await page.screenshot({path:'/private/tmp/begd-realtime-subplots.png',fullPage:true});
  // Observe the figures passed to the real PNG renderer and intercept the native clipboard item.
  await page.evaluate(()=>{
    const original=window.html2canvas;
    window.html2canvas=(figure,options)=>{
      window.previewFigures.push({
        id:figure.id,
        date:data.date,
        realtime:figure.matches('.realtime-dispatch-plots'),
        plants:figure.matches('.plant-map-panel'),
        trends:figure.matches('.trends-generation-figure,.trends-chart')
      });
      return original(figure,options);
    };
    const write=navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write=items=>{
      window.previewPNG=items[0].getType('image/png');
      return write(items);
    };
  });
  async function shareTab(hash,title,contentKey){
    const opened=await page.evaluate(()=>{window.previewFigures=[];return window.opened.length;});
    await page.locator('#share-dashboard').click();
    const dialog=page.locator('.figure-share-dialog[open]');
    assert.match(await dialog.innerText(),new RegExp('Copies a figure preview of '+title));
    assert.equal(await dialog.locator('.figure-share-link').innerText(),'https://satyakibanik.github.io/Projects/begd/');
    await dialog.getByLabel('Custom message').fill('Bangladesh grid today');
    await dialog.getByRole('link',{name:'Share dashboard on X.com'}).click();
    await page.waitForFunction(count=>window.opened.length===count||
      document.querySelector('#figure-share-progress [role=status]')?.textContent.includes('X was not opened'),
      opened+1,{timeout:60000});
    assert.equal(await page.evaluate(()=>window.opened.length),opened+1,
      await page.locator('#figure-share-progress [role=status]').allTextContents());
    const figures=await page.evaluate(()=>window.previewFigures);
    assert.ok(figures.length>0&&figures.length<=3);
    assert.ok(figures.some(figure=>figure[contentKey]));
    assert.ok(figures.every(figure=>figure.id!=='content'&&figure.date===initial.date));
    assert.equal(await page.evaluate(()=>location.hash),hash);
    const url=new URL(await page.evaluate(()=>window.opened.at(-1)));
    assert.equal(url.searchParams.get('text'),'Bangladesh grid today');
    assert.equal(url.searchParams.get('url'),'https://satyakibanik.github.io/Projects/begd/');
    const png=Buffer.from(await page.evaluate(async()=>{
      return Array.from(new Uint8Array(await (await window.previewPNG).arrayBuffer()));
    }));
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),1050);
    assert.ok(png.readUInt32BE(20)>0&&png.readUInt32BE(20)<=1400);
    return png;
  }
  const realtime=await shareTab('#realtime','Real time','realtime');
  await page.evaluate(()=>{location.hash='plants';});
  await page.locator('#plant-map-frame svg').first().waitFor();
  const plants=await shareTab('#plants','Power plants','plants');
  assert.notDeepEqual(plants,realtime);
  await page.evaluate(()=>{location.hash='trends';});
  await page.locator('#content [data-trend-chart]').first().waitFor();
  const trends=await shareTab('#trends','Long-term trends','trends');
  assert.notDeepEqual(trends,plants);
  await page.evaluate(()=>{location.hash='realtime';});
  await page.locator('#content .realtime-dispatch-plots').waitFor();
  await page.evaluate(()=>{navigator.clipboard.write=()=>Promise.reject(new Error('Clipboard denied'));});await page.locator('#share-dashboard').click();await page.locator('.dashboard-x-link').click();await page.getByRole('status').filter({hasText:'X was not opened'}).waitFor();assert.equal(await page.evaluate(()=>window.opened.length),3);await page.locator('#figure-share-progress').getByRole('button',{name:'Close',exact:true}).click();
  // Even if ERP sources are empty, both plots remain available with missing-data feedback.
  await page.evaluate(()=>{currentDayData={...currentDayData,demand_hourly:[],generation_hourly:[]};render();});assert.equal(await page.locator('.realtime-dispatch-plots .interactive-chart').count(),2);assert.match(await page.locator('.realtime-dispatch-plots').innerText(),/No reported load shedding/);
  await page.setViewportSize({width:390,height:858});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);console.log('PASS: published data, synchronized hover/focus/cursors, aligned subplots, actual Real time, Power plants and Trends clipboard PNGs, comparison omission, preserved view/date/message, denied clipboard, empty ERP and mobile.',initial);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
