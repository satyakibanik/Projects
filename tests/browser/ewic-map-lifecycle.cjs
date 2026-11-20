// Map assets resolve after source notes move; failures stay visible and retry restores the map.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve}=require('./fixture-site.cjs');
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{
  for(const width of [390,1210])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:858},isMobile:width<800,hasTouch:width<800});
   let release,fail=false,failBackground=false;const delayed=new Promise(resolve=>release=resolve);
   await context.route('**/*',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(failBackground&&path.endsWith('/plant-administrative-boundaries.geojson')){
     return route.fulfill({status:503,body:'Background unavailable'});
    }
    if(path.endsWith('/ewic-locations.json')){
     await delayed;
     if(fail)return route.fulfill({status:503,body:'Unavailable'});
    }
    return serve(route);
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto('https://begd.test/begd/index.html?v=2#operations');
   await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
   await page.waitForFunction(()=>document.querySelector('.ewic-coordinate-notes')?.closest('.more-information'));
   assert.equal(await page.locator('[data-ewic-map] [data-ewic-sources]').count(),0,'Source notes move before map assets finish loading');
   release();
   const map=page.locator('.ewic-location-map');await map.waitFor();
   await page.locator('[data-ewic-next]:enabled').waitFor();
   assert.equal(await map.locator('[data-ewic-circuit]').count(),3);
   assert((await map.locator('.plant-map-country').getAttribute('d')).length>100);
   assert(await map.evaluate(svg=>{
    const view=svg.viewBox.baseVal;
    return [...svg.querySelectorAll('[data-ewic-circuit]')].every(path=>{
     const box=path.getBBox();
     return box.width>0&&box.x>=view.x&&box.x+box.width<=view.x+view.width&&
      box.y>=view.y&&box.y+box.height<=view.y+view.height;
    });
   }),'Projected circuit strokes must be inside the SVG viewport');
   await page.locator('[data-ewic-next]').click();
   assert.equal(await page.locator('[data-ewic-readings]').isVisible(),true);
   assert.match(await page.locator('[data-ewic-time-label]').innerText(),/BST/);
   assert.equal(await page.locator('.ewic-flow-panel > .more-information [data-ewic-coverage]').count(),1);
   assert.equal(await page.locator('.ewic-flow-panel > .more-information [data-ewic-sources] p').count(),3);
   // A missing asset must leave an actionable message in the frame.
   fail=true;await page.reload();
   const retry=page.getByRole('button',{name:'Retry map',exact:true});await retry.waitFor();
   assert.equal(await retry.isVisible(),true);
   assert.match(await page.locator('[data-ewic-frame]').innerText(),/could not be loaded/);
   fail=false;await retry.click();
   await page.locator('.ewic-location-map [data-ewic-circuit]').first().waitFor();
   await page.locator('[data-ewic-next]:enabled').waitFor();
   assert.equal(await page.locator('.ewic-location-map [data-ewic-circuit]').count(),3);
   failBackground=true;await page.reload();
   await page.locator('.ewic-location-map [data-ewic-circuit]').first().waitFor();
   assert.equal(await page.locator('.ewic-location-map [data-ewic-circuit]').count(),3);
   assert.match(await page.locator('[data-ewic-frame]').innerText(),/background layers are unavailable/);
   assert.deepEqual(errors,[]);
   console.log('PASS EWIC delayed assets and retry',width,theme);
   await context.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
