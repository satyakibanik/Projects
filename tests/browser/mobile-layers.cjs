// npm install --no-save --package-lock=false playwright@1.62.1
// npx playwright install chromium
// node tests/browser/mobile-layers.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../..');
const fixture=require('../fixtures/mobile-layers.cjs');
const report=fixture.report;
const days=Array.from({length:90},(_,i)=>({
  date:new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10),
  generation_mwh:240000+i*100,demand_mwh:245000+i*100,unserved_mwh:500,
  shed_peak_mw:100+i,temperature_c:30+i%5,imports_mwh:30000+i*10,
  fuels:{Gas:100000,Coal:70000,HFO:25000,HSD:500,Hydro:10000,Solar:4000,Wind:500,Imports:30000},
  imports:[{name:'Route A',energy_mwh:30000+i*10}],report_id:report.report_id,
}));
const trends={end_date:days.at(-1).date,days};
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.geojson':'application/json','.png':'image/png'};
async function serve(route){
  const url=new URL(route.request().url());
  if(url.hostname!=='begd.test')return route.abort();
  const json=data=>route.fulfill({json:data});
  if(url.pathname==='/api/reports')return json({reports:[{id:report.report_id,date:report.date,operating_date:report.date,published_date:report.published_date}],complete:true});
  if(url.pathname==='/api/report')return json(report);
  if(url.pathname==='/api/current-day')return json(fixture.current_day);
  if(url.pathname.startsWith('/api/'))return route.fulfill({status:404,json:{error:'Fixture has no comparison report'}});
  if(url.pathname.endsWith('/trends-data.json'))return json(trends);
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'Missing fixture asset'});
  return route.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream'});
}
async function checkLayer(page,selector,index,touch){
  const input=page.locator(selector).nth(index);
  await input.evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.waitForTimeout(80);
  await input.evaluate(el=>{
    const wrap=el.closest('.interactive-chart,.trends-chart')||el.closest('.panel').querySelector('.trends-chart');
    window.layerProbe={input:el,wrap,panel:wrap.closest('.panel,.dispatch-main'),svg:wrap.querySelector('svg'),
      scrollY,top:el.getBoundingClientRect().top,checked:el.checked,
      other:[...document.querySelectorAll('.interactive-chart svg.chart,.trends-chart > svg')].find(svg=>!wrap.closest('.panel,.dispatch-main').contains(svg)),
      charts:document.querySelectorAll('.interactive-chart,.trends-chart').length};
  });
  if(touch)await input.tap();else await input.press('Space');
  await page.waitForTimeout(100);
  const state=await page.evaluate(()=>{
    const p=window.layerProbe;
    return {input:p.input.isConnected,panel:p.panel.isConnected,wrap:p.wrap.isConnected,
      updated:p.wrap.querySelector('svg')!==p.svg,changed:p.input.checked!==p.checked,
      other:p.other?.isConnected??true,scrollDelta:scrollY-p.scrollY,
      topDelta:p.input.getBoundingClientRect().top-p.top,focused:document.activeElement===p.input};
  });
  assert(state.input&&state.panel&&state.wrap&&state.updated&&state.changed&&state.other,JSON.stringify(state));
  assert(Math.abs(state.scrollDelta)<=1&&Math.abs(state.topDelta)<=1,JSON.stringify(state));
  if(!touch)assert(state.focused,'Layer checkbox lost keyboard focus');
  // The visible SVG and tooltip must use the newly selected model.
  const tip=await page.evaluate(()=>{
    const wrap=window.layerProbe.wrap;
    if(wrap.matches('.interactive-chart')){
      const point=wrap.querySelector('[data-point]');point?.dispatchEvent(new FocusEvent('focus'));
      const t=wrap.querySelector('.chart-tooltip');return {shown:!t.hidden,text:t.textContent};
    }
    wrap.querySelector('svg').dispatchEvent(new FocusEvent('focus'));
    const t=wrap.querySelector('[role=tooltip]');return {shown:!t.hidden,text:t.textContent};
  });
  assert(tip.shown&&tip.text,'Updated plot tooltip is not bound');
}
(async()=>{
  const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
  try{
    for(const width of [390,1440]){
      const context=await browser.newContext({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390,reducedMotion:'no-preference'});
      await context.route('**/*',serve);
      const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto('https://begd.test/begd/index.html#overview');
      await page.waitForSelector('#content [data-toggle-series]');
      await page.waitForTimeout(200);
      for(const theme of ['light','dark']){
        await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
        for(const tab of ['realtime','trends','overview','en-curve','regions','plants','imports','substations','operations','forecast']){
          await page.evaluate(t=>location.hash=t,tab);await page.waitForTimeout(180);
          if(tab==='trends')await page.waitForSelector('[data-trend-layer]');
          let count=0;
          for(const selector of ['#content [data-toggle-series]','#content [data-toggle-family]','#content [data-trend-layer]','#content [data-trend-group]','#content [data-cost-trendline]']){
            const total=await page.locator(selector).count();
            for(let i=0;i<total;i++){
              // Toggle off/on; reusing the same node also catches duplicate listeners.
              await checkLayer(page,selector,i,width===390);
              await checkLayer(page,selector,i,width===390);count+=2;
            }
          }
          console.log('PASS',width,theme,tab,count,'stable layer toggles');
        }
      }
      assert.deepEqual(errors,[]);await context.close();
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
