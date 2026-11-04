// Responsive structure and typography across every dashboard view.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const regions=['Dhaka','Chattogram','Cumilla','Mymensingh','Sylhet','Khulna','Barishal','Rajshahi','Rangpur'].map((name,i)=>({...fixture.report.regions[0],name,energy_mwh:24000+i*1200,demand_mw:1500+i*100,shed_mw:i*10,fuels:{Gas:38000-i*4000,Coal:i*1000}}));
const tabs=['realtime','trends','overview','en-curve','regions','plants','imports','substations','operations','forecast','news'];
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 const output=process.env.BEGD_PHONE_AUDIT_OUTPUT;
 if(output)fs.mkdirSync(output,{recursive:true});
 const results=[];
 try{
  for(const width of [360,390,438,1210])for(const theme of ['light','dark']){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:width<800,hasTouch:width<800});
   await context.route('**/*',route=>{
    if(new URL(route.request().url()).pathname==='/api/report')return route.fulfill({json:{...fixture.report,regions,quality_notes:['L-Curve omitted: totals do not reconcile with P4 generation.'],hourly:fixture.report.hourly.map((r,i)=>({...r,demand_mw:12500+i*150,generation_mw:12000+i*150}))}});
    if(new URL(route.request().url()).pathname.endsWith('/news-data.json'))return route.fulfill({json:{curated_on:'2026-01-15',window_days:30,event_labels:{grid:'Grid updates'},articles:[{id:'1',date:'2026-01-15',source:'BSS',event:'grid',language:'en',title:'Grid maintenance and electricity generation update',summary:'A representative news summary to verify wrapping and phone legibility.',url:'https://example.test/news'}]}});
    return serve(route);
   });
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   for(const tab of width>800?['realtime','overview','regions']:tabs){
    await page.goto(`https://begd.test/begd/index.html?v=2&date=2026-01-15#${tab}`);
    await page.waitForFunction(()=>window.BEGDView?.started&&document.querySelector('#content')?.textContent.trim()&&document.querySelector('#view-status').textContent!=='Restoring dashboard view…');
    if(tab==='news')await page.locator('.news-card').waitFor();
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    if(tab==='overview'){
     assert.equal(await page.locator('#content > .note').count(),0,'L-Curve notes must not appear in the overview banner');
     assert.equal(await page.locator('.dispatch-main .more-information').filter({hasText:'L-Curve omitted:'}).count(),1,'Keep source quality context in chart details');
    }
    if(tab==='realtime')assert.equal(await page.locator('nav a.active').evaluate(e=>getComputedStyle(e,'::before').display),'block','Real time needs the active indicator');
    if(tab==='regions'){
     await page.locator('[data-regional-snapshot-style]').selectOption('stacked');
     const point=page.locator('.regional-snapshot-point[data-region="Dhaka"]').first();
     await point.focus();
     const tooltip=page.locator('.regional-snapshot-tooltip');
     await tooltip.waitFor({state:'visible'});
     assert.equal(await tooltip.locator('div').count(),3,'Each regional bar tooltip shows all three measures');
     assert.deepEqual(await tooltip.locator('div').evaluateAll(rows=>rows.map(e=>({color:e.style.color,text:e.textContent}))),[
      {color:'rgb(78, 121, 167)',text:'Daily generation1,000 MW'},
      {color:'rgb(242, 142, 43)',text:'Evening demand1,500 MW'},
      {color:'rgb(225, 87, 89)',text:'Reported load shedding0 MW'},
     ]);
     await point.evaluate(e=>e.blur());
    }
    const metrics=await page.evaluate(()=>{
     const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
     const labels=[...document.querySelectorAll('#content .legend label,#content .trends-legend label,#content .vb-legend button')].filter(visible);
     const clipped=labels.filter(e=>e.scrollWidth>e.clientWidth+2).map(e=>e.textContent.trim());
     const small=labels.filter(e=>parseFloat(getComputedStyle(e.querySelector('[data-series-label]')||e).fontSize)<12).map(e=>e.textContent.trim());
     const cutAxes=[];
     for(const svg of document.querySelectorAll('#content svg.chart,#content svg.vb-chart'))for(const text of svg.querySelectorAll('text')){
      if(!visible(text))continue;
      const r=text.getBoundingClientRect();
      for(let p=svg.parentElement;p&&p.id!=='content';p=p.parentElement){
       const style=getComputedStyle(p),b=p.getBoundingClientRect();
       if(['hidden','auto','scroll','clip'].includes(style.overflowX)&&r.left<b.left-2){cutAxes.push(text.textContent);break}
      }
     }
     const axisOverlaps=[];
     for(const svg of document.querySelectorAll('#content svg.vb-chart')){
      const title=svg.querySelector('.vb-axis-title[transform]');if(!title)continue;
      const a=title.getBoundingClientRect();
      for(const tick of svg.querySelectorAll('.vb-axis[text-anchor="end"]')){
       const b=tick.getBoundingClientRect();
       if(Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1)axisOverlaps.push(tick.textContent);
      }
     }
     const overlappingRegions=[];
     for(const svg of document.querySelectorAll('.regional-fuel-svg,.regional-snapshot-chart')){
      const labels=[...svg.querySelectorAll('.regional-axis-label')].map(e=>({text:e.textContent,r:e.getBoundingClientRect()}));
      for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){
       const a=labels[i],b=labels[j];
       if(Math.min(a.r.right,b.r.right)>Math.max(a.r.left,b.r.left)+1&&Math.min(a.r.bottom,b.r.bottom)>Math.max(a.r.top,b.r.top)+1)overlappingRegions.push(a.text+' / '+b.text);
      }
     }
     const overlappingTicks=[];
     for(const svg of document.querySelectorAll('#content svg.chart,#content svg.vb-chart')){
      const ticks=[...svg.querySelectorAll('text')].filter(e=>visible(e)&&/^\d{2}:\d{2}$/.test(e.textContent.trim())).map(e=>({text:e.textContent,r:e.getBoundingClientRect()})).sort((a,b)=>a.r.left-b.r.left);
      for(let i=1;i<ticks.length;i++)if(ticks[i-1].r.right>ticks[i].r.left+1&&Math.min(ticks[i-1].r.bottom,ticks[i].r.bottom)>Math.max(ticks[i-1].r.top,ticks[i].r.top)+1)overlappingTicks.push(ticks[i-1].text+' / '+ticks[i].text);
     }
     return {overlappingRegions,axisOverlaps,overlappingTicks,overflow:document.documentElement.scrollWidth>innerWidth+1,clipped,small,cutAxes:[...new Set(cutAxes)]};
    });
    results.push({width,theme,tab,...metrics});
    if(output){
     await page.screenshot({path:path.join(output,`${width}-${theme}-${tab}-top.png`)});
     if(tab==='regions'){
      await page.locator('.regional-fuel-explorer').screenshot({path:path.join(output,`${width}-${theme}-regional-fuel.png`)});
      await page.locator('.regional-snapshot-chart-wrap').screenshot({path:path.join(output,`${width}-${theme}-regional-snapshot.png`)});
     }
     const target=page.locator('#content .panel,#content .dispatch-main,#content .realtime-dispatch').first();
     if(await target.count()){await target.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`${width}-${theme}-${tab}-content.png`)});}
    }
    console.log('AUDIT',JSON.stringify(results.at(-1)));
   }
   assert.deepEqual(errors,[],`${width} ${theme}: browser errors`);
   await context.close();
  }
  if(output)fs.writeFileSync(path.join(output,'metrics.json'),JSON.stringify(results,null,2));
  const issues=results.filter(r=>r.overlappingRegions.length||r.overflow||r.clipped.length||r.small.length||r.cutAxes.length||r.overlappingTicks.length||r.axisOverlaps.length);
  assert.deepEqual(issues,[],'Phone views must fit their viewport and retain readable, unclipped legends and axes');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
