const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {serve}=require('./fixture-site.cjs');
const data=require('../../begd/fuel-data.json');
const latestLabel=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Dhaka'}).format(new Date(data.gas.at(-1).date+'T08:00:00+06:00'));
const screenshotPath=process.env.BEGD_FUEL_HISTORY_SCREENSHOT||require('node:path').join(require('node:os').tmpdir(),'begd-fuel-fast-history.png');
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{for(const width of [390,1165]){
  const context=await browser.newContext({viewport:{width,height:799},hasTouch:width===390,isMobile:width===390});
  await context.route('**/*',serve);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://begd.test/begd/index.html?v=2&fuelWindow=all#fuel');
  const history=page.locator('section.fuel-panel').filter({has:page.getByRole('heading',{name:'Gas supply over time',exact:true})});
  const surface=history.locator('[data-fuel-surface]');await surface.waitFor();
  assert.equal(await history.locator('svg *').count()<40,true);
  assert.equal(await page.locator('#fuel-daily-table tbody').count(),0);
  await surface.focus();await page.keyboard.press('End');
  assert.match(await history.locator('.fuel-tooltip').textContent(),new RegExp(latestLabel));
  assert.doesNotMatch(await history.locator('.fuel-tooltip').textContent(),/30-day avg/);
  if(width===390){const b=await surface.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);assert.equal(await history.locator('.fuel-tooltip').isVisible(),true);}
  await page.keyboard.press('Home');assert.match(await history.locator('.fuel-tooltip').textContent(),/12 Jan 2020/);
  await page.keyboard.press('ArrowRight');assert.match(await history.locator('.fuel-tooltip').textContent(),/17 Jan 2020/);
  const box=await surface.boundingBox();
  await page.mouse.move(box.x+box.width,box.y+box.height/2);
  assert.match(await history.locator('.fuel-tooltip').textContent(),new RegExp(latestLabel));
  await history.locator('[data-fuel-layer="gas-supply:lng"]').uncheck();
  assert.equal(await history.locator('.fuel-daily-line').count(),2);
  assert.equal(await page.locator('[data-fuel-series]').count(),0);
  assert.equal(await page.locator('.fuel-average-line').count(),0);
  await page.getByRole('button',{name:'365d',exact:true}).click();
  assert.equal(await history.locator('[data-fuel-surface]').count(),1);
  await page.getByRole('button',{name:'30d',exact:true}).click();
  assert.ok(await history.locator('[data-fuel-point]').count()>0);
  await page.getByRole('button',{name:'Long term',exact:true}).click();
  await page.locator('#fuel-daily-table > summary').click();
  await page.locator('#fuel-daily-table tbody tr').first().waitFor();
  assert.equal(await page.locator('#fuel-daily-table tbody tr').count(),data.gas.length);
  await page.locator('#fuel-daily-table > summary').click();
  await page.locator('#fuel-daily-table > summary').click();
  await page.locator('#fuel-daily-table tbody tr').first().waitFor();
  assert.equal(await page.locator('#fuel-daily-table tbody tr').count(),data.gas.length);
  if(width>800){
   await page.evaluate(()=>scrollTo(0,0));
   const nav=page.locator('nav'),bounds=await nav.boundingBox();
   await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
   const before=await page.evaluate(()=>scrollY);
   await page.mouse.wheel(0,1200);
   await page.waitForFunction(()=>document.querySelector('nav').scrollTop>0);
   assert.equal(await page.evaluate(()=>scrollY),before,'Rail scrolling must not move the main page');
   const last=nav.locator('a').last();await last.focus();
   const lastBounds=await last.boundingBox();assert.ok(lastBounds.y>=0&&lastBounds.y+lastBounds.height<=799);
   await history.locator('[data-fuel-layer="gas-supply:lng"]').check();
   await history.screenshot({path:screenshotPath});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);
  console.log('PASS lightweight daily history, pointer/keyboard tooltip, layers, lazy table, independent rail',width);
  await context.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
