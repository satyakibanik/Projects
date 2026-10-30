// Uses the Playwright setup in mobile-layers.cjs and the same fabricated, offline data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve}=require('./fixture-site.cjs');
async function swipe(session,start,end){
  await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x,y:start.y}]});
  for(let i=1;i<=8;i++){
    await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8}]});
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
async function inspect(page,wrap){
  const svg=wrap.locator('svg.chart').first(),tip=wrap.locator('.chart-tooltip,[role=tooltip]').first();
  // scrollIntoViewIfNeeded considers the viewport, but not the sticky date bar.
  // Center the chart so a preserved scroll position cannot put test taps behind it.
  await svg.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
  // A queued scroll event dismisses pinned values. Let the programmatic scroll
  // and layout settle before measuring the chart and sending the first tap.
  await svg.evaluate(async node=>{
    await document.fonts.ready;
    let previous='',stable=0;
    for(let frame=0;frame<120;frame++){
      await new Promise(requestAnimationFrame);
      const box=node.getBoundingClientRect();
      const position=[scrollX,scrollY,box.x,box.y,box.width,box.height].join('|');
      stable=position===previous?stable+1:0;
      if(stable>=3)return;
      previous=position;
    }
    throw Error('Chart layout did not settle before touch inspection');
  });
  const bounds=await svg.boundingBox();
  assert(bounds.width>=240,'Phone plot is too narrow');
  const viewBox=await svg.getAttribute('viewBox');assert.equal(Number(viewBox.split(' ')[2]),420,'Phone plot uses compressed desktop geometry');
  const originalScroll=await page.evaluate(()=>scrollY);
  let previous='';
  // Deliberately tap empty space below the data rather than a tiny marker.
  for(const fraction of [.25,.55,.85]){
    const point={x:bounds.x+bounds.width*fraction,y:bounds.y+bounds.height*.75};
    const target=await page.evaluate(({x,y})=>{
      const node=document.elementFromPoint(x,y);
      return {chart:Boolean(node?.closest('svg.chart')),tag:node?.tagName,className:node?.getAttribute('class')};
    },point);
    assert(target.chart,'Chart tap is obscured: '+JSON.stringify({point,target}));
    await page.touchscreen.tap(point.x,point.y);
    await page.waitForTimeout(150);
    assert(await tip.isVisible(),'Tap did not open values');
    const text=await tip.innerText();assert(text&&text!==previous,'Tap did not select the nearest new timestamp');previous=text;
    await svg.dispatchEvent('pointerleave',{pointerType:'touch'});
    await page.waitForTimeout(120);
    assert(await tip.isVisible(),'Values disappeared after lifting the finger');
    const box=await tip.boundingBox(),viewport=page.viewportSize();
    assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,JSON.stringify(box));
    assert(Math.abs(await page.evaluate(()=>scrollY)-originalScroll)<=1,'Tapping values moved the page');
  }
  await page.touchscreen.tap(3,70);
  await tip.waitFor({state:'hidden',timeout:1000});
  return {svg,tip,bounds};
}
(async()=>{
  const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
  try{
    for(const width of [360,390,430]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
      await context.route('**/*',serve);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      const session=await context.newCDPSession(page);
      await page.goto('https://begd.test/begd/index.html#overview');await page.waitForSelector('[data-toggle-series]');await page.waitForTimeout(200);
      for(const theme of ['light','dark']){
        await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        for(const tab of ['realtime','trends','overview','en-curve','imports','operations','forecast']){
          await page.evaluate(t=>location.hash=t,tab);await page.waitForTimeout(200);
          if(tab==='trends')await page.waitForSelector('[data-trend-layer]');
          if(tab==='realtime'&&await page.locator('#today-forecast-panel').getAttribute('open')===null)await page.locator('#today-forecast-panel > summary').click();
          const charts=page.locator('.interactive-chart,.trends-chart');let count=0;
          for(let i=0;i<await charts.count();i++){
            const wrap=charts.nth(i);
            if(await wrap.locator('[data-point]').count()===0&&await wrap.locator('[data-trend-svg]').count()===0)continue;
            try{await inspect(page,wrap)}catch(error){throw new Error(`${width}px ${theme} ${tab} chart ${i}: ${error.message}`,{cause:error})}count++;
          }
          console.log('TOUCH PASS',width,theme,tab,count,'charts');
          if(tab==='trends'){
            const wrap=page.locator('[data-trend-key="dependence-renewables"]');
            const {svg,tip,bounds}=await inspect(page,wrap);
            const y=bounds.y+bounds.height*.65,start={x:bounds.x+bounds.width*.3,y},end={x:bounds.x+bounds.width*.8,y};
            const before=await page.evaluate(()=>scrollY);
            await page.touchscreen.tap(start.x,start.y);const first=await tip.innerText();
            await swipe(session,start,end);await page.waitForTimeout(100);
            assert(await tip.isVisible(),'Sideways inspection dismissed values');assert.notEqual(await tip.innerText(),first,'Sideways gesture did not advance date');
            assert(Math.abs(await page.evaluate(()=>scrollY)-before)<=1,'Sideways inspection scrolled the page');
            if(process.env.BEGD_TOUCH_SCREENSHOT)await page.screenshot({path:process.env.BEGD_TOUCH_SCREENSHOT.replace('.png','-'+width+'-'+theme+'.png')});
            await swipe(session,{x:bounds.x+bounds.width*.5,y},{x:bounds.x+bounds.width*.5,y:y-140});await page.waitForTimeout(250);
            assert(await page.evaluate(()=>scrollY)>before+20,'Chart trapped vertical page scrolling');
            assert(!await tip.isVisible(),'Values remained pinned while scrolling the page');
          }
        }
      }
      assert.deepEqual(errors,[]);await context.close();
    }
    // Fine-pointer behavior remains hover/focus driven after touch support is loaded.
    const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',serve);
    const page=await context.newPage();await page.goto('https://begd.test/begd/index.html#trends');await page.waitForSelector('[data-trend-layer]');
    const svg=page.locator('[data-trend-key="dependence-renewables"] svg'),tip=page.locator('[data-trend-key="dependence-renewables"] [role=tooltip]');
    // scrollIntoViewIfNeeded considers the viewport, but not the sticky date bar.
  // Center the chart so a preserved scroll position cannot put test taps behind it.
  await svg.evaluate(node=>node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));const box=await svg.boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);assert(await tip.isVisible());
    await svg.focus();await page.keyboard.press('Home');const first=await tip.innerText();await page.keyboard.press('End');assert.notEqual(await tip.innerText(),first);
    await page.keyboard.press('Escape');assert(!await tip.isVisible());await context.close();
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
