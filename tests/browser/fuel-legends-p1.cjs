// Fuel groups/icons, a single plant legend, and corrected regional/transfer readings.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {serve,fixture}=require('./fixture-site.cjs');
const fuels=['Gas','Coal','HFO','HSD','Hydro','Solar','Imports','Wind','Nuclear'];
const costs_bdt=Object.fromEntries(fuels.map((name,i)=>[name,name==='Nuclear'?0:(i+1)*1000]));
const costs={days:Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10),currency:'BDT',total_bdt:Object.values(costs_bdt).reduce((a,b)=>a+b,0),costs_bdt,generation_kwh:Object.fromEntries(fuels.map(name=>[name,name==='Nuclear'?0:1000]))}))};
const report=process.env.BEGD_P1_REPORT?JSON.parse(fs.readFileSync(process.env.BEGD_P1_REPORT,'utf8')):{...fixture.report,date:'2026-11-02',en_curve:{...fixture.report.en_curve,date:'2026-11-02'},regional_snapshot:{time:'19:30'},regions:[{...fixture.report.regions[0],name:'Dhaka',demand_mw:5910,shed_mw:2},{...fixture.report.regions[0],name:'Chattogram',demand_mw:1520,shed_mw:0}],operations:{...fixture.report.operations,east_west:{energy_east_to_west_kwh:0,energy_west_to_east_kwh:45199472.73}},plant_units:[{...fixture.report.plant_units[0],name:'Karnaphuli Hydro PP Unit-1,2,3,4, 5',fuel:'Hydro'},{...fixture.report.plant_units[0],name:'Raozan 25 MW PP',fuel:'Gas',present_capacity_mw:40,peak_mw:20,peak_generation_mw:20,energy_mwh:500},{...fixture.report.plant_units[0],name:'Kaptai 7 MW Solar PP',fuel:'Solar'},{...fixture.report.plant_units[0],name:'Rooppur Nuclear Power Plant',fuel:'Nuclear',present_capacity_mw:180,peak_mw:170,peak_generation_mw:170,energy_mwh:3100}]};
(async()=>{
 const browser=await chromium.launch(process.env.BEGD_BROWSER_EXECUTABLE?{executablePath:process.env.BEGD_BROWSER_EXECUTABLE}:{});
 try{for(const width of [390,1210])for(const theme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height:858},isMobile:width<800,hasTouch:width<800});
  await context.addInitScript(value=>localStorage.setItem('begd-theme',value),theme);
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(['tile.openstreetmap.org','tiles.maps.eox.at'].includes(u.hostname)){
    const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==','base64');
    return route.fulfill({body:pixel,contentType:'image/png',headers:{'access-control-allow-origin':'*'}});
   }
   if(u.pathname==='/api/report')return route.fulfill({json:report});
   if(u.pathname.endsWith('/costs-data.json'))return route.fulfill({json:costs});
   return serve(route);
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('https://begd.test/begd/index.html?v=2#trends');
  await page.locator('[data-trend-section="fuel"]').click();
  const avg=page.locator('[data-trend-key="bpdb-unit-cost"]');await avg.waitFor();
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  const group=avg.locator('[data-trend-group]');await group.waitFor();
  await group.uncheck();assert(await avg.locator('[data-trend-layer]').evaluateAll(items=>items.every(e=>!e.checked)));
  await avg.locator('[data-trend-layer="Gas"]').check();assert.equal(await group.evaluate(e=>e.indeterminate),true);
  await group.check();assert(await avg.locator('[data-trend-layer]').evaluateAll(items=>items.every(e=>e.checked)));
  for(const key of ['bpdb-cost','bpdb-unit-cost','fuel-mix']){
   const chart=page.locator(`[data-trend-key="${key}"]`);
   for(const name of fuels.slice(0,key==='bpdb-cost'?9:8)){
    const label=chart.locator(`[data-trend-layer="${name}"]`).locator('..');
    assert.equal(await label.locator('img').count(),1,`${key} ${name} logo`);
   }
  }
  await page.waitForFunction(()=>[...document.querySelectorAll('.trends-legend img')].every(e=>e.complete&&e.naturalWidth>0));
  await page.goto('https://begd.test/begd/index.html?v=2#en-curve');
  const picker=page.locator('[data-cost-date-picker]');await picker.waitFor();await picker.selectOption(report.date);
  for(const [name,file] of [['Imports','import-export.png'],['Nuclear','nuclear-plant.png']])assert.equal(await page.locator(`[data-cost-row="${name}"] th img[src$="${file}"]`).count(),1);
  await page.goto('https://begd.test/begd/index.html?v=2#regions');
  const dhaka=page.locator('.region-card').filter({has:page.getByRole('heading',{name:'Dhaka',exact:true})});await dhaka.waitFor();
  assert.deepEqual(await dhaka.locator('.mini strong').allTextContents(),['5,910 MW','2 MW']);
  await page.goto('https://begd.test/begd/index.html?v=2#operations');
  await page.locator('.ewic-location-map').waitFor();
  const values=await page.locator('#content > .metrics .value').allTextContents();
  assert.match(values[2],/^0\s*MWh$/);assert.match(values[3],/45,199\.47\s*MWh/);
  await page.goto('https://begd.test/begd/index.html?v=2#plants');
  const buttons=page.locator('.plant-icon-key > button');await buttons.first().waitFor();
  assert.equal(await page.locator('.plant-slide-info .plant-category-key').count(),0,'Fuel types are listed once');
  assert(await buttons.count()>0);
  assert(await buttons.evaluateAll(items=>items.every(b=>b.querySelector('img')&&b.querySelector('.plant-fuel-swatch')&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')),'Each plant fuel combines its icon and color');
  await buttons.first().click();assert.equal(await buttons.first().getAttribute('aria-pressed'),'true');
  await buttons.first().click();assert.equal(await buttons.first().getAttribute('aria-pressed'),'false');
  const markers=page.locator('.plant-map-marker'),rings=await markers.count();
  const rooppur=markers.filter({has:page.locator('title').filter({hasText:'Rooppur Nuclear Power Plant'})});
  const karnaphuli=markers.filter({has:page.locator('title').filter({hasText:'Karnaphuli Hydro PP'})});
  const rooppurRing=rooppur.locator('.plant-slide-symbol > circle').first();
  const hydroRing=karnaphuli.locator('.plant-slide-symbol > circle').first();
  const sidebar=page.locator('#plant-map-sidebar');
  await rooppurRing.click();
  assert.equal(await rooppur.getAttribute('aria-pressed'),'true');
  assert.equal(await sidebar.locator('.plant-slide-readout').count(),0);
  assert.equal(await sidebar.locator('.plant-map-fuels').innerText(),'Nuclear');
  assert.equal(await sidebar.locator('.plant-map-fuels img').getAttribute('src'),'plant-icons/nuclear-plant.png');
  assert.equal(await sidebar.locator('a').getAttribute('href'),'https://osm.org/go/zq4nSU4A?m=');
  if(width>=800){
   await hydroRing.hover();
   assert.match(await sidebar.innerText(),/Rooppur Nuclear Power Plant/);
   await hydroRing.click();
   assert.equal(await karnaphuli.getAttribute('aria-pressed'),'true');
   await rooppurRing.hover();
   assert.match(await sidebar.innerText(),/Karnaphuli Hydro PP/);
   await page.locator('.plant-location-map').click({position:{x:8,y:80}});
   assert.equal(await karnaphuli.getAttribute('aria-pressed'),'false');
   await rooppurRing.hover();
   assert.match(await sidebar.innerText(),/Rooppur Nuclear Power Plant/);
  }
  const views=page.getByRole('group',{name:'Plant map view'});
  const dots=views.getByRole('radio',{name:'Dots view'}),icons=views.getByRole('radio',{name:'Plant icon view'});
  assert.equal(await page.locator('.plant-slide-tabs [role=tab]').count(),7);
  assert.equal(await icons.isChecked(),true);
  const basemap=page.getByRole('combobox',{name:'Basemap'});
  assert(await views.evaluate(el=>el.parentElement.previousElementSibling.classList.contains('map-controls')));
  assert.equal(await basemap.inputValue(),'streets');
  await page.locator('.plant-basemap-tiles img.is-loaded[src*="tile.openstreetmap.org"]').first().waitFor();
  const more=page.locator('.plant-map-panel .more-information');
  await more.locator('summary').click();
  assert.match(await more.innerText(),/OpenStreetMap contributors.*EOxCloudless/s);
  await more.locator('summary').click();
  if(width>=800){
   const svg=page.locator('.plant-location-map'),viewBefore=await svg.getAttribute('viewBox');
   const outline=await page.locator('.plant-map-country').getAttribute('d');
   for(const [value,host] of [['streets','tile.openstreetmap.org'],['satellite','tiles.maps.eox.at']]){
    await basemap.selectOption(value);
    await page.locator(`.plant-basemap-tiles img.is-loaded[src*="${host}"]`).first().waitFor();
    assert(await page.locator('.plant-basemap-credit').isVisible());
    assert.equal(await svg.getAttribute('viewBox'),viewBefore);
    assert.equal(await page.locator('.plant-map-country').getAttribute('d'),outline);
    assert.equal(await page.locator('.plant-map-district-boundary').count(),64);
   }
   await page.emulateMedia({reducedMotion:'reduce'});
   let releaseTiles;
   const delayedTiles=new Promise(resolve=>{releaseTiles=resolve});
   const delaySatellite=async route=>{await delayedTiles;await route.fallback()};
   await page.route('https://tiles.maps.eox.at/**',delaySatellite);
   try{
    await page.getByRole('button',{name:'Zoom in on power plants'}).click();
    assert.notEqual(await svg.getAttribute('viewBox'),viewBefore);
    assert.equal(await page.locator('.plant-basemap-tiles > div').count(),2);
    assert(await page.locator('.plant-basemap-tiles > div').first().locator('img.is-loaded:visible').count()>0);
    assert(await page.locator('.plant-map-frame').evaluate(el=>el.classList.contains('has-plant-basemap')));
   }finally{releaseTiles()}
   await page.locator('.plant-basemap-tiles > div').nth(1).waitFor({state:'detached'});
   await page.unroute('https://tiles.maps.eox.at/**',delaySatellite);
   await page.getByRole('button',{name:'Reset',exact:true}).click();

   // Exercise the in-page fullscreen fallback used by embedded browsers.
   const viewport=page.locator('.plant-map-layout .geomap-viewport');
   await viewport.evaluate(el=>Object.defineProperty(el,'requestFullscreen',{value:undefined}));
   const expand=page.getByRole('button',{name:'Enlarge map'}),collapse=page.getByRole('button',{name:'Exit full screen'});
   await buttons.first().click();
   await expand.click();await collapse.waitFor();
   assert.equal(await buttons.first().getAttribute('aria-pressed'),'true');
   assert(await viewport.evaluate(el=>el.classList.contains('is-plant-map-expanded')));
   await collapse.click();await expand.waitFor();
   await expand.click();await collapse.waitFor();
   await page.keyboard.press('Escape');await expand.waitFor();
   assert.equal(await viewport.evaluate(el=>el.classList.contains('is-plant-map-expanded')),false);
   await basemap.selectOption('boundaries');
   assert.equal(await page.locator('.plant-basemap-tiles img').count(),0);
   assert.equal(await page.locator('.plant-basemap-credit').isVisible(),false);
  }
  await dots.check();
  await page.locator('.plant-dot-symbol').first().waitFor();
  assert(await markers.count()>rings,'Smaller dots keep more locations separate');
  assert.equal(await page.locator('.plant-map-markers image').count(),0);
  assert.equal(await karnaphuli.locator('.plant-dot-symbol > path[fill]').count(),2);
  assert.equal(await karnaphuli.locator('.plant-unit-badge').textContent(),'×2');
  assert.deepEqual(await karnaphuli.locator('.plant-dot-symbol > path[fill]').evaluateAll(paths=>paths.map(p=>p.getAttribute('fill')).sort()),['#159d9c','#e0b91d']);
  await icons.check();
  assert.equal(await page.locator('.plant-dot-symbol').count(),0);
  await dots.check();
  assert.match(await page.locator('.plant-slide-tabs [role=tab]').nth(1).innerText(),/02\s+Present capacity/);
  const slideTabs=page.locator('.plant-slide-tabs [role=tab]');
  const raozan=markers.filter({has:page.locator('title').filter({hasText:'Raozan 25 MW PP'})});
  for(const [index,tab] of (await slideTabs.all()).entries()){
   if(index===0)continue;
   await tab.click();
   assert.equal(await dots.isChecked(),true);
   assert.equal(await page.locator('.plant-map-markers image').count(),0);
   assert.equal(await page.locator('.plant-icon-key').isVisible(),true);
   assert(await buttons.count()>0);
   const rooppurRadius=Number(await rooppur.getAttribute('data-radius'));
   const raozanRadius=Number(await raozan.getAttribute('data-radius'));
   if(index<=3){
    assert(rooppurRadius>raozanRadius,'The higher metric value produces a larger dot');
    assert(rooppurRadius<18,'Metric dots stay smaller than icon markers');
   }else assert.equal(rooppurRadius,raozanRadius,'Categorical dots have a fixed radius');
  }
  const capacity=page.getByRole('tab',{name:/Present capacity/});
  await capacity.click();
  assert.equal(await rooppur.locator('.plant-dot-symbol > circle[fill="#ed3c35"]').count(),1);
  await icons.check();
  assert.equal(await capacity.getAttribute('aria-selected'),'true');
  await dots.check();
  assert.equal(await capacity.getAttribute('aria-selected'),'true');
  if(width>=800){
   const fullscreenLegend=page.locator('.plant-fullscreen-legend');
   assert.equal(await fullscreenLegend.isVisible(),false);
   await page.getByRole('button',{name:'Enlarge map'}).click();
   await fullscreenLegend.waitFor();
   assert.match(await fullscreenLegend.innerText(),/Present capacity/);
   assert(await fullscreenLegend.locator('.plant-gradient').isVisible());
   assert(await fullscreenLegend.locator('.plant-fullscreen-fuels > span').filter({hasText:'Nuclear'}).locator('img').isVisible());
   assert.equal(await fullscreenLegend.locator('button').count(),0);
   await page.getByRole('button',{name:'Exit full screen'}).click();
   assert.equal(await dots.isChecked(),true);
   assert.equal(await fullscreenLegend.isVisible(),false);
  }
  if(process.env.BEGD_FUEL_QA_OUTPUT){fs.mkdirSync(process.env.BEGD_FUEL_QA_OUTPUT,{recursive:true});await page.locator('.plant-icon-key').screenshot({path:path.join(process.env.BEGD_FUEL_QA_OUTPUT,`${width}-${theme}-plant-fuels.png`)});}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  assert.deepEqual(errors,[]);console.log('PASS fuel logos, group controls, P1 readings and plant legend',width,theme);
  await context.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
