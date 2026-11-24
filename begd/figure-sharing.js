/* Figure exports stay in the browser. Social composers require a final user post. */
(function(root){
  'use strict';
  const BRAND='Bangladesh Electric Grid Dashboard';
  const COPYRIGHT='© '+BRAND;
  const SELECTOR='.realtime-dispatch-plots, .forecast-subplot, .interactive-chart, .fuel-report-chart, .regional-snapshot-chart-wrap, .regional-fuel-svg, .plant-map-panel, .region-map-panel, .vb-combined, .trends-generation-figure, .trends-chart, .trends-heatmap, .region-card';
  const canonical='https://satyakibanik.github.io/Projects/begd/';
  const cleanText=node=>(node?.innerText||node?.textContent||'').replace(/\s+/g,' ').trim();
  function shareURL(href){const source=new URL(href),url=new URL(canonical);url.search=source.search;url.hash=source.hash;return url.href;}
  function socialURL(url,message){const target=new URL('https://twitter.com/intent/tweet');target.searchParams.set('url',url);target.searchParams.set('text',message);return target.href;}
  function filename(title){return 'begd-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)+'.png';}
  function describe(target){
    const panel=target.closest('.panel,.dispatch-main,.energy-band,.plant-detail'),svg=target.matches('svg')?target:target.querySelector('svg:not(.series-swatch)');
    const heading=(target.matches('.trends-generation-figure,.realtime-dispatch-plots')?cleanText(panel?.querySelector('h2')):cleanText(target.querySelector('h2,h3')))||cleanText(panel?.querySelector('h2,h3'))||'Grid figure';
    const label=target.matches('.fuel-report-chart')?cleanText(target.querySelector('.comparison-strip-label')):target.matches('.trends-chart,.regional-fuel-svg')?svg?.getAttribute('aria-label')?.split('. Missing dates')[0]||'':'';
    const note=cleanText(panel?.querySelector('[data-panel-caption],.panel-head p'));
    const sourceRoot=target.matches('.forecast-subplot')?target:panel;
    const source=[...sourceRoot?.querySelectorAll('.note,.information-note,.trends-citation,.plant-map-attribution,.dispatch-bottom')||[]].filter(node=>!node.matches('.chart-help,.chart-touch-help')).map(cleanText);
    if(target.matches('.forecast-subplot'))source.push(...[...panel?.querySelectorAll('.forecast-body > .note')||[]].map(cleanText));
    if(panel?.matches('.plant-detail'))source.push('Source: GenLog · hourly plant output · MW · Bangladesh time.');
    if(target.matches('.trends-generation-figure')&&panel?.nextElementSibling?.matches('.trends-temperature-note'))source.push(cleanText(panel.nextElementSibling));
    source.push(...[...target.querySelectorAll('.fuel-mix-segment')].map(node=>node.getAttribute('aria-label')));
    const basemap=target.querySelector('.plant-basemap-credit:not([hidden])');
    if(basemap)source.push(cleanText(basemap)+' · '+[...basemap.querySelectorAll('a')].map(link=>link.href).join(' · '));
    const footer=[...new Set([note,...source].filter(Boolean))];
    return {title:heading+(label&&label!==heading?' · '+label:''),footer};
  }
  function lines(ctx,text,width){
    const result=[];let line='';
    for(const word of text.split(/\s+/)){if(line&&ctx.measureText(line+' '+word).width>width){result.push(line);line=word;}else line+=(line?' ':'')+word;}
    if(line)result.push(line);return result;
  }
  function normalizeColorFunctions(doc,root,resolveComputed=false){
    const canvas=doc.createElement('canvas');canvas.width=canvas.height=1;
    const context=canvas.getContext('2d');if(!context)return;
    const cache=new Map();
    const resolveColor=value=>{
      if(cache.has(value))return cache.get(value);
      context.clearRect(0,0,1,1);context.fillStyle='rgba(0,0,0,0)';context.fillStyle=value;context.fillRect(0,0,1,1);
      const [r,g,b,a]=context.getImageData(0,0,1,1).data;
      const normalized=`rgba(${r},${g},${b},${Number((a/255).toFixed(4))})`;cache.set(value,normalized);return normalized;
    };
    const normalize=value=>{
      let output='',cursor=0;
      while(cursor<value.length){
        const start=value.toLowerCase().indexOf('color(',cursor);if(start<0){output+=value.slice(cursor);break;}
        output+=value.slice(cursor,start);let depth=1,end=start+6;
        for(;end<value.length&&depth;end++){if(value[end]==='(')depth++;else if(value[end]===')')depth--;}
        if(depth){output+=value.slice(start);break;}
        output+=resolveColor(value.slice(start,end));cursor=end;
      }
      return output;
    };
    const normalizeDeclaration=declaration=>{
      for(let i=0;i<declaration.length;i++){
        const property=declaration.item(i),value=declaration.getPropertyValue(property);
        if(!value.toLowerCase().includes('color('))continue;
        const replacement=normalize(value);
        if(replacement!==value)declaration.setProperty(property,replacement,declaration.getPropertyPriority(property));
      }
    };
    const normalizeRules=rules=>{
      for(const rule of rules){
        if(rule.style)normalizeDeclaration(rule.style);
        if(rule.cssRules)normalizeRules(rule.cssRules);
        if(rule.styleSheet)try{normalizeRules(rule.styleSheet.cssRules);}catch{}
      }
    };
    for(const sheet of doc.styleSheets)try{normalizeRules(sheet.cssRules);}catch{}
    // color-mix() with theme variables resolves to color(srgb ...) only in computed styles.
    const computedProperties=['color','background-color','background-image','border-top-color','border-right-color','border-bottom-color','border-left-color','box-shadow','text-shadow','outline-color'];
    for(const node of [root,...root.querySelectorAll('*')]){
      if(resolveComputed&&node.style){
        const computed=doc.defaultView.getComputedStyle(node);
        for(const property of computedProperties){
          const value=computed.getPropertyValue(property);
          if(value.includes('color('))node.style.setProperty(property,normalize(value),'important');
        }
      }
      if(node.style)normalizeDeclaration(node.style);
      for(const attribute of ['color','fill','stroke','stop-color','flood-color','lighting-color']){
        const value=node.getAttribute(attribute);if(value?.toLowerCase().includes('color('))node.setAttribute(attribute,normalize(value));
      }
    }
  }
  function simplifySingleLayerLegends(clone){
    const chartSelector='[data-chart], [data-trend-chart], [data-fuel-controls]';
    const layerSelector='[data-toggle-series], [data-trend-layer], [data-fuel-layer]';
    const charts=[...clone.querySelectorAll(chartSelector)];
    if(clone.matches(chartSelector))charts.unshift(clone);
    for(const chart of charts){
      const selected=[...chart.querySelectorAll(layerSelector)].filter(input=>input.checked&&input.closest(chartSelector)===chart);
      if(selected.length!==1)continue;
      const input=selected[0],label=input.closest('label');
      if(!label||label.closest('[hidden]'))continue;
      const legends=[...chart.querySelectorAll('.legend,.trends-legend,.fuel-legend,.forecast-layer')]
        .filter(legend=>legend.closest(chartSelector)===chart&&!legend.parentElement.closest('.legend,.trends-legend,.fuel-legend,.forecast-layer'));
      if(!legends.length)continue;
      const legend=clone.ownerDocument.createElement('div');
      legend.className='legend';
      legends[0].before(legend);
      legend.append(label);
      input.remove();
      // The dashboard legend reserves a grid column for its checkbox.
      label.style.display='flex';
      label.style.alignItems='center';
      label.style.gap='8px';
      legends.forEach(item=>item.remove());
      chart.querySelector('.fuel-layer-actions')?.remove();
    }
  }
  async function inlinePlantIcons(clone){
    const images=[...clone.querySelectorAll('.plant-slide-symbol image[href]')];
    const sources=new Set(images.map(image=>image.getAttribute('href')));
    const dataURLs=new Map(await Promise.all([...sources].map(async source=>{
      const response=await fetch(new URL(source,document.baseURI)).catch(()=>null);
      if(!response?.ok)return [source,null];
      const blob=await response.blob();
      const dataURL=await new Promise(resolve=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);
        reader.readAsDataURL(blob);
      });
      return [source,dataURL];
    })));
    for(const image of images){
      const dataURL=dataURLs.get(image.getAttribute('href'));
      if(dataURL)image.setAttribute('href',dataURL);
    }
  }
  const figureLegendSize=24,dashboardLegendSize=16;
  const minimumFigureWidth=1200;
  function scaleExportLegend(clone,width,outputWidth,fontSize){
    if(!width)return;
    // Work in canvas drawing units. Pixel density is applied to the entire PNG later.
    const size=fontSize*width/outputWidth;
    clone.style.setProperty('--begd-legend-size',size+'px');
    for(const label of clone.querySelectorAll('[data-text-role="legend-chart"]')){
      const matrix=label.getScreenCTM?.();
      const scale=matrix?Math.hypot(matrix.c,matrix.d):1;
      label.style.setProperty('--readable-svg-size',size/(scale||1)+'px');
    }
  }
  async function exportPNG(target,info=describe(target)){
    if(!target.isConnected)throw new Error('The figure changed. Select it again.');
    // Browser download tests inject a deterministic PNG to check every button
    // without repeatedly rasterizing large SVGs. Still run the Color 4 clone
    // normalization on the power-plant map so its regression stays covered.
    if(typeof Blob!=='undefined'&&root.__BEGD_FIGURE_TEST_PNG instanceof Blob){
      if(target.matches('.plant-map-panel')){
        const doc=document.implementation.createHTMLDocument(''),clone=target.cloneNode(true);doc.body.append(clone);normalizeColorFunctions(doc,clone);
        root.__BEGD_FIGURE_TEST_NORMALIZED_COLOR=clone.style.getPropertyValue('outline-color');
      }
      return root.__BEGD_FIGURE_TEST_PNG;
    }
    // html2canvas requires an HTML root; capturing an SVG root fails during cloning.
    const capture=target.matches('svg,table')?target.closest('.figure-export-wrap'):target;
    const preview=info.preview;
    const captureScale=info.measure?0.5:preview?2:4;
    const hasPlantMap=target.matches('.plant-map-panel,.plant-map-frame');
    // Capture the theme once so chart, title and footer use the same palette.
    const theme=getComputedStyle(document.body),background=theme.backgroundColor,ink=theme.color;
    let contentBounds;
    const shot=await root.html2canvas(capture,{backgroundColor:background,scale:captureScale,logging:false,useCORS:hasPlantMap,
      // Expand clipped chart/table containers only in the detached export document.
      onclone:async(doc,clone)=>{
        const style=doc.createElement('style');
        style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}.forecast-subplot-controls label,.dispatch-chart-style,.map-controls,.regional-snapshot-controls,.temperature-subplot-heading .trends-unit-control,.chart-help,.metric-method,.vb-reading,.vb-stats,.figure-actions,.chart-tooltip,.trends-tooltip,.fuel-tooltip{display:none!important}.dispatch-main .chart{margin-left:0!important;width:100%!important}.en-curve-chart{grid-template-areas:"plot legend" "daylight legend";grid-template-rows:auto}.en-curve-chart>.legend{max-height:none!important;overflow:visible!important}@media(max-width:760px){.en-curve-chart{grid-template-areas:"plot" "daylight" "legend"}}';
        style.textContent+='input[type=checkbox]{display:none!important}'
          +'label:has(>input[type=checkbox]):has(>.series-swatch){grid-template-columns:auto minmax(0,1fr)!important}'
          +'.source-legend-group legend label:has(>input[type=checkbox]){grid-template-columns:minmax(0,1fr)!important}';
        doc.head.append(style);
        if(preview){
          style.textContent+='.preview-figure :is(p,details,.news-meta,.organogram-node-arrow,.fuel-layer-actions,.fuel-window,.chart-style,.layer-actions,select){display:none!important}'
            +'.preview-figure.en-curve-chart{grid-template-columns:minmax(0,1fr) 245px}.preview-figure.en-curve-chart>.legend{margin:0;gap:2px}.preview-figure .event-dial-list,.preview-figure .plant-map-sidebar,.preview-figure .plant-map-options,.preview-figure .plant-slide-controls{display:none!important}.preview-figure.event-dial-layout{display:block}.preview-figure .event-dial-svg{display:block;margin:auto;width:min(100%,440px)}';
          clone.classList.add('preview-figure');
        }else{
          doc.querySelectorAll('.regional-snapshot-chart-scroll,.table-wrap').forEach(node=>{node.style.overflow='visible';node.style.maxHeight='none';});
        }
        clone.style.width=Math.ceil(Math.max(capture.getBoundingClientRect().width,capture.scrollWidth))+'px';
        clone.style.height='auto';clone.style.minHeight='0';clone.style.maxHeight='none';
        if(info.prepare)info.prepare(clone);
        simplifySingleLayerLegends(clone);
        const cloneWidth=Math.ceil(clone.getBoundingClientRect().width);
        if(info.legendWidth)scaleExportLegend(clone,cloneWidth,info.legendWidth,dashboardLegendSize);
        else if(!preview){
          const outputWidth=Math.max(minimumFigureWidth,cloneWidth*captureScale/2);
          scaleExportLegend(clone,cloneWidth,outputWidth,figureLegendSize);
        }
        clone.querySelectorAll('.en-curve-chart>svg.chart').forEach(svg=>{
          const view=svg.viewBox.baseVal,ink=svg.getBBox(),bounds=svg.getBoundingClientRect();
          const extra=Math.max(0,ink.y+ink.height-view.y-view.height);
          if(extra){const height=view.height+extra+4;svg.style.height=(bounds.height*height/view.height)+'px';svg.style.maxHeight='none';svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${height}`);}
        });
        if(info.measure){
          // The first pass only needs the layout bounds, but still parses the root style.
          normalizeColorFunctions(doc,clone,true);
          clone.style.opacity='0';
          return;
        }
        // Keep circular fuel SVGs self-contained. Copying every computed CSS
        // property into their serialized image can suppress the SVG artwork.
        clone.querySelectorAll('svg.fuel-mix-chart').forEach(svg=>{
          const bounds=svg.getBoundingClientRect();
          const properties=['fill','stroke','stroke-width','stroke-dasharray','stroke-dashoffset','stroke-linecap','stroke-linejoin','fill-opacity','stroke-opacity','opacity','font-family','font-size','font-weight','letter-spacing','text-anchor','dominant-baseline'];
          const nodes=[svg,...svg.querySelectorAll('*')];
          const styles=nodes.map(node=>{const computed=doc.defaultView.getComputedStyle(node);return properties.map(property=>property+':'+computed.getPropertyValue(property)).join(';');});
          nodes.forEach((node,index)=>node.setAttribute('style',styles[index]));
          svg.setAttribute('width',bounds.width);svg.setAttribute('height',bounds.height);
          // The 25px ring stroke extends beyond the original 144px viewport.
          if(svg.matches('.fuel-mix-ring'))svg.setAttribute('viewBox','-4 -4 152 152');
        });
        // Measure after removing controls/help so their former height is not exported.
        const bounds=clone.getBoundingClientRect();
        const visible=[...clone.querySelectorAll('svg:not(.series-swatch),.legend,.trends-legend,.regional-snapshot-legend,.comparison-strip-label,.composition-strip,table')].filter(node=>node.getBoundingClientRect().height>0);
        if(!preview&&visible.length&&!target.matches('.plant-map-panel,.region-map-panel'))contentBounds={height:Math.max(...visible.map(node=>node.getBoundingClientRect().bottom))-bounds.top+4};
        // html2canvas does not parse CSS Color 4 color(srgb ...) values.
        normalizeColorFunctions(doc,clone,preview||hasPlantMap);
        if(hasPlantMap)await inlinePlantIcons(clone);
      },
      ignoreElements:node=>node.hasAttribute('data-html2canvas-ignore')||node.matches('.chart-tooltip,.trends-tooltip,.fuel-tooltip,.chart-cursor,.trends-cursor,.vb-reading,.vb-stats')||
        // Cloning unrelated 365-day SVG panels makes single-figure exports needlessly slow.
        Boolean(node.closest('body')&&!node.contains(capture)&&!capture.contains(node))});
    if(preview)return shot;
    const captureHeight=contentBounds?Math.min(shot.height,Math.ceil(contentBounds.height*captureScale)):shot.height;
    const canvas=document.createElement('canvas'),width=Math.max(minimumFigureWidth,shot.width/2),pad=32;
    // Render the chart and all annotations at twice the previous PNG resolution.
    const ctx=canvas.getContext('2d');ctx.font='bold 32px sans-serif';
    const heading=lines(ctx,info.title,width-pad*2);ctx.font='20px sans-serif';const notes=(info.footer||[]).flatMap(text=>lines(ctx,text,width-pad*2));
    const top=pad+heading.length*40+16,bottom=notes.length*28+100;
    const figureHeight=captureHeight*width/shot.width;
    const height=top+figureHeight+bottom;
    const outputScale=2;
    canvas.width=Math.floor(width*outputScale);canvas.height=Math.ceil(height*outputScale);ctx.scale(outputScale,outputScale);ctx.fillStyle=background;ctx.fillRect(0,0,width,canvas.height/outputScale);ctx.fillStyle=ink;ctx.font='bold 32px sans-serif';
    let y=pad;for(const line of heading){y+=40;ctx.fillText(line,pad,y);}
    ctx.drawImage(shot,0,0,shot.width,captureHeight,0,top,width,figureHeight);y=top+figureHeight+8;ctx.font='20px sans-serif';for(const line of notes){y+=28;ctx.fillText(line,pad,y);}
    ctx.textAlign='right';ctx.font='bold 22px sans-serif';ctx.fillText(COPYRIGHT,width-pad,canvas.height/outputScale-48);
    ctx.font='18px sans-serif';ctx.fillText(canonical,width-pad,canvas.height/outputScale-22);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the PNG.')),'image/png'));
  }
  const previewFigures={
    realtime:'.realtime-dispatch-plots',
    regions:'.region-map-frame:has(svg),.regional-snapshot-chart-wrap',
    substations:'.vb-combined',
    forecast:'.forecast-subplot',
    insight:'.insight-chart-wrap',
    'publication-timing':'.timing-plot'
  };
  function waitForPreview(read){
    return new Promise((resolve,reject)=>{
      const deadline=Date.now()+12000;
      function check(){
        const value=read();
        if(value)resolve(value);
        else if(Date.now()>deadline)reject(new Error('The preview figures could not be loaded.'));
        else setTimeout(check,75);
      }
      check();
    });
  }
  function chartUnder(doc,heading,selector='.interactive-chart'){
    const title=[...doc.querySelectorAll('#content h2')].find(node=>cleanText(node)===heading);
    return title?.closest('section')?.querySelector(selector);
  }
  function placePlantLegend(clone){
    const map=clone.querySelector('.plant-map-layout'),gradient=clone.querySelector('.plant-gradient-key'),icons=clone.querySelector('.plant-icon-key');
    const key=clone.ownerDocument.createElement('aside');
    key.style.cssText='display:grid;align-content:center;gap:14px;padding:12px;';
    key.append(gradient,icons);
    icons.querySelector('.plant-fuel-summary')?.remove();
    icons.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;';
    const viewport=map.querySelector('.geomap-viewport');
    map.replaceChildren(viewport,key);
    map.style.cssText='display:grid;grid-template-columns:minmax(0,2fr) minmax(230px,1fr);';
    clone.replaceChildren(map);
  }
  function placeCostLegend(clone){
    const legend=clone.ownerDocument.createElement('div');
    legend.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-content:center;gap:10px 16px;';
    for(const slice of clone.querySelectorAll('[data-cost-slice]')){
      const name=slice.dataset.costSlice;
      const item=clone.ownerDocument.createElement('div');
      item.style.cssText='display:flex;gap:8px;align-items:center;font-size:15px;';
      const color=clone.ownerDocument.createElement('span');
      color.style.cssText='width:12px;height:12px;flex:none;background:'+slice.firstElementChild.getAttribute('fill');
      const icon=[...clone.querySelectorAll('[data-cost-row]')].find(row=>row.dataset.costRow===name)?.querySelector('img');
      item.dataset.textRole='legend';
      item.append(color);
      if(icon)item.append(icon.cloneNode());
      item.append(name);legend.append(item);
    }
    const layout=clone.querySelector('.bpdb-cost-layout'),pie=layout.querySelector('.bpdb-pie-wrap');
    layout.style.cssText='display:grid;grid-template-columns:260px minmax(0,1fr);gap:36px;max-width:840px;margin:auto;';
    pie.style.cssText='width:240px;min-width:0;';
    pie.querySelector('svg').style.cssText='width:240px;height:240px;max-width:100%;';
    layout.replaceChildren(pie,legend);
    clone.style.width='840px';
    clone.replaceChildren(layout);
  }
  function arrangeOrganizationTree(clone){
    const mainBranches=clone.querySelector(':scope > li > .organogram-tree');
    if(!mainBranches)return;
    mainBranches.style.cssText='display:grid;grid-template-columns:0.75fr 1.6fr 1.6fr;align-items:stretch;width:100%;';
    for(const branch of mainBranches.children){
      const row=branch.querySelector(':scope > .organogram-tree-row');
      if(row)row.style.width='100%';
      const divisions=branch.querySelector(':scope > .organogram-tree:not([hidden])');
      if(!divisions)continue;
      divisions.style.cssText='display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%;';
      for(const division of divisions.children){
        const divisionRow=division.querySelector(':scope > .organogram-tree-row');
        if(divisionRow)divisionRow.style.width='100%';
      }
    }
  }
  async function dashboardPreviewRows(tab,date,themeName,legendWidths){
    const staged=['trends','plants','operations','fuel','organogram'].includes(tab);
    let frame;
    try{
      let doc=document;
      if(staged){
        const url=new URL(location.href);
        if(date){url.searchParams.set('v','2');url.searchParams.set('date',date);}
        if(tab==='trends')url.searchParams.set('days','365');
        if(tab==='fuel')url.searchParams.set('fuelType','gas');
        frame=document.createElement('iframe');
        frame.title='Dashboard share preview rendering';
        frame.setAttribute('aria-hidden','true');
        frame.tabIndex=-1;
        frame.style.cssText='position:fixed;left:-1800px;top:0;width:1440px;height:1000px;border:0;pointer-events:none;';
        frame.src=url.href;document.body.append(frame);
        doc=await waitForPreview(()=>frame.contentWindow?.BEGDView?.started&&frame.contentDocument);
        if(themeName)doc.documentElement.dataset.theme=themeName;
      }
      const find=selector=>doc.querySelector('#content '+selector);
      let captureIndex=0;
      const capture=async(read,title,prepare)=>{
        const target=await waitForPreview(typeof read==='string'?()=>find(read):read);
        const section=target.closest('.trends-section[hidden]');
        if(section)doc.querySelector('[aria-controls="'+section.id+'"]')?.click();
        const index=captureIndex++;
        const shot=await exportPNG(target,{preview:true,prepare,measure:!legendWidths,legendWidth:legendWidths?.[index]});

        if(!shot.width||!shot.height)throw new Error('Could not create the dashboard preview.');
        const label=title??describe(target).title;
        return {shot,index,title:label==='Grid figure'?'':label};
      };
      if(tab==='trends'){
        return [
          [await capture('[data-trend-key="generation-demand"]','Generation & demand')],
          [await capture('[data-trend-key="seasonal-load-duration"]','Seasonal load-duration curves')],
          [await capture('[data-trend-key="imports"]','Imports over time')]
        ];
      }
      if(tab==='overview')return [
        [await capture('.dispatch-main .interactive-chart','Demand and generation')],
        [await capture(()=>chartUnder(doc,'Import dependence (%), renewable share (%) & clean energy share (%)'),'Import dependence (%), renewable share (%) & clean energy share (%)')]
      ];
      if(tab==='en-curve')return [
        [await capture('.en-curve-chart','Generation by source')],
        [await capture(()=>find('.bpdb-cost-panel:has([data-cost-slice])'),'Fuel cost by generation type',placeCostLegend)]
      ];
      if(tab==='plants'){
        const icon=await waitForPreview(()=>find('.plant-marker-view [value="icons"]'));
        icon.checked=true;icon.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
        find('[data-slide="1"]').click();
        const rampal=await waitForPreview(()=>[...doc.querySelectorAll('#plant-rows [data-plant]')]
          .find(row=>/^Rampal/i.test(decodeURIComponent(row.dataset.plant))));
        rampal.click();
        return [
          [await capture('.plant-map-panel:has(.plant-gradient-key)','Power plant locations · Present capacity',placePlantLegend)],
          [await capture('#plant-detail','')]
        ];
      }
      if(tab==='imports'){
        const importChart=async(target,title)=>{
          const legend=[...target.querySelectorAll('.legend label')].flatMap(label=>{
            const sample=label.querySelector('.series-swatch path');
            if(!sample||!label.querySelector('input')?.checked)return [];
            return [{name:cleanText(label.querySelector('[data-series-label]')),color:sample.getAttribute('stroke'),dash:sample.getAttribute('stroke-dasharray')}];
          });
          const result=await capture(()=>target,title,clone=>clone.querySelector('.legend')?.remove());
          return {...result,legend};
        };
        const total=await importChart(await waitForPreview(()=>chartUnder(doc,'Total imports')),'Total imports');
        const routes=()=>doc.querySelectorAll('#content > .grid > .panel .interactive-chart');
        const charts=[];
        for(let i=0;i<Math.min(4,routes().length);i++)charts.push(await importChart(routes()[i]));
        return [[total],charts.slice(0,2),charts.slice(2,4)].filter(row=>row.length);
      }
      if(tab==='operations'){
        const dial=await waitForPreview(()=>find('[data-event-view-select="dial"]'));
        dial.click();
        return [[await capture(()=>chartUnder(doc,'East–west interconnector flows')||find('.ewic-chart-column .interactive-chart'),'EWIC flows')],
          [await capture('.event-dial-layout','24-hour time dial',clone=>{
            clone.style.width='460px';
            const dial=clone.querySelector('.event-dial-svg');
            clone.replaceChildren(dial);
            dial.style.cssText='display:block;width:100%;height:auto;';
          })]];
      }
      if(tab==='fuel'){
        const source=await capture(()=>chartUnder(doc,'Gas supply by source over time','.fuel-chart'),'Gas supply by source over time');
        const destination=await capture(()=>chartUnder(doc,'Gas supply by destination over time','.fuel-chart'),'Gas supply by destination over time');
        find('#fuel-tab-coal').click();
        return [[source],[destination],[await capture(()=>chartUnder(doc,'Annual Barapukuria coal production','.fuel-chart'),'Annual Barapukuria coal production')]];
      }
      if(tab==='organogram'){
        const view=await waitForPreview(()=>find('[data-org-view]'));
        view.value='tree';view.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
        return [[await capture('.organogram-tree','Organization tree',arrangeOrganizationTree)]];
      }
      const selector=previewFigures[tab]||SELECTOR;
      const figures=[...doc.querySelectorAll('#content :is('+selector+')')]
        .filter(node=>!node.closest('[hidden],details:not([open])')&&node.getBoundingClientRect().height>0);
      const rows=[];
      for(const node of figures.filter(node=>!figures.some(other=>other!==node&&other.contains(node))).slice(0,2)){
        rows.push([await capture(()=>node)]);
      }
      return rows;
    }finally{frame?.remove();}
  }
  async function exportDashboardPNG(){
    const tab=root.location?.hash.slice(1)||'overview';
    const date=document.querySelector('#report-date')?.value;
    const themeName=document.documentElement.dataset.theme;
    const {backgroundColor,color}=getComputedStyle(document.body);
    const previews=await dashboardPreviewRows(tab,date,themeName);
    if(!previews.length)throw new Error('Could not create the dashboard preview.');

    const canvas=document.createElement('canvas'),width=1050,maxHeight=1400,pad=32;
    const figureTop=114,footerHeight=60,gap=14,headingHeight=25;
    const tabName=cleanText(document.querySelector('#title'));
    const operatingDate=date?new Intl.DateTimeFormat('en-GB',{
      dateStyle:'long',timeZone:'Asia/Dhaka'
    }).format(new Date(date+'T12:00:00+06:00')):'Unavailable';
    const pack=figures=>figures.map(row=>{
      const columnWidth=(width-pad*2-gap*(row.length-1))/row.length;
      return row.map(figure=>({
        ...figure,columnWidth,
        chrome:(figure.title?headingHeight:0)+Math.ceil((figure.legend?.length||0)/2)*21
      }));
    });
    const rowHeight=(row,factor)=>Math.max(...row.map(({shot,columnWidth,chrome})=>
      (columnWidth/shot.width)*shot.height*factor+chrome));
    const totalHeight=(rows,factor)=>rows.reduce((total,row)=>total+rowHeight(row,factor),gap*(rows.length-1));
    const measured=pack(previews);
    const availableHeight=maxHeight-figureTop-footerHeight;
    let factor=1;
    if(totalHeight(measured,1)>availableHeight){
      let low=0,high=1;
      for(let i=0;i<16;i++){
        const mid=(low+high)/2;
        if(totalHeight(measured,mid)>availableHeight)high=mid;
        else low=mid;
      }
      factor=low;
    }
    const legendWidths=[];
    for(const row of measured)for(const item of row)legendWidths[item.index]=item.columnWidth*factor;
    const rows=pack(await dashboardPreviewRows(tab,date,themeName,legendWidths));
    const height=Math.ceil(figureTop+totalHeight(rows,factor)+footerHeight);
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle=backgroundColor;ctx.fillRect(0,0,width,height);
    ctx.fillStyle=color;
    ctx.font='bold 38px sans-serif';ctx.fillText('BEGD · '+tabName,pad,57);
    ctx.font='23px sans-serif';ctx.fillText('Operating date '+operatingDate+' · All times BST',pad,92);

    let rowTop=figureTop;
    rows.forEach(row=>{
      const height=rowHeight(row,factor);
      row.forEach(({shot,title,legend=[],columnWidth},column)=>{
        const headingSpace=title?headingHeight:0;
        const scale=columnWidth/shot.width*factor;
        const imageWidth=shot.width*scale,imageHeight=shot.height*scale;
        const columnLeft=pad+column*(columnWidth+gap);
        const left=columnLeft+(columnWidth-imageWidth)/2;
        const top=rowTop;
        if(title){
          ctx.font='600 21px sans-serif';
          ctx.fillText(title,Math.min(left,columnLeft+Math.max(0,columnWidth-ctx.measureText(title).width)),top+21,columnWidth);
        }
        ctx.drawImage(shot,left,top+headingSpace,imageWidth,imageHeight);
        ctx.font=dashboardLegendSize+'px sans-serif';
        const legendWidth=Math.min(columnWidth,650)/2,legendLeft=columnLeft+(columnWidth-legendWidth*2)/2;
        legend.forEach(({name,color,dash},i)=>{
          const x=legendLeft+i%2*legendWidth,y=top+headingSpace+imageHeight+16+Math.floor(i/2)*21;
          ctx.strokeStyle=color;ctx.lineWidth=2;
          ctx.setLineDash(dash&&dash!=='none'?dash.split(/\s+/).map(Number):[]);
          ctx.beginPath();ctx.moveTo(x,y-5);ctx.lineTo(x+26,y-5);ctx.stroke();ctx.setLineDash([]);
          ctx.fillText(name,x+33,y,legendWidth-36);
        });
      });
      rowTop+=height+gap;
    });

    ctx.font='600 19px sans-serif';ctx.fillText(COPYRIGHT,pad,height-25);
    ctx.font='18px sans-serif';ctx.textAlign='right';ctx.fillText(canonical,width-pad,height-25);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the PNG.')),'image/png'));
  }
  function copyDashboard(){
    if(!root.isSecureContext||!navigator.clipboard?.write||!root.ClipboardItem)throw new Error('Image copy is unavailable here.');
    const png=exportDashboardPNG();
    // A denied clipboard write can reject before the browser consumes the PNG.
    png.catch(()=>{});
    return navigator.clipboard.write([new root.ClipboardItem({'image/png':png})]);
  }
  function download(blob,title){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename(title);a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function button(label,action){const element=document.createElement('button');element.type='button';element.textContent=label;element.addEventListener('click',action);return element;}
  function toolbar(){const bar=document.createElement('div');bar.className='figure-actions';bar.setAttribute('data-html2canvas-ignore','');return bar;}
  function copyImage(target,info){
    if(!root.isSecureContext||!navigator.clipboard?.write||!root.ClipboardItem)throw new Error('Image copy is unavailable here. Use Download PNG instead.');
    // Start the write in the click gesture, including Safari's promised-blob support.
    return navigator.clipboard.write([new root.ClipboardItem({'image/png':exportPNG(target,info)})]);
  }
  const ICONS={
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    x:'<path fill="currentColor" stroke="none" d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.2l7.3-8.5L.8 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.8L6.3 3.9H4.4L17.8 20Z"/>',
    share:'<path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8"/>'
  };
  function iconButton(label,icon,action){
    const element=button('',action);element.setAttribute('aria-label',label);element.title=label;
    element.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+ICONS[icon]+'</svg>';if(icon==='x'){element.classList.add('x-share-control');element.insertAdjacentHTML('beforeend','<span aria-hidden="true">.com</span>');}return element;
  }
  let status;
  function announce(message){
    if(!status){status=document.createElement('div');status.id='figure-action-status';status.setAttribute('role','status');status.setAttribute('data-html2canvas-ignore','');document.body.append(status);}
    status.replaceChildren();status.textContent=message;return status;
  }
  function downloadStatus(control,message){
    const bar=control.closest('.figure-actions');let note=bar.querySelector('.figure-download-status');
    if(!note){note=document.createElement('span');note.className='figure-download-status';note.setAttribute('role','status');note.setAttribute('data-html2canvas-ignore','');bar.append(note);}
    clearTimeout(note.dismissTimer);note.textContent=message;
    note.dismissTimer=setTimeout(()=>note.remove(),5000);
  }
  async function shareFigure(target,control,options={}){
    const info=options.dashboard?null:describe(target),url=options.url||socialURL(shareURL(location.href),info.title+' — '+BRAND);
    const progress=document.createElement('dialog');progress.id='figure-share-progress';progress.className='figure-share-dialog';progress.setAttribute('data-html2canvas-ignore','');
    const heading=document.createElement('h2');heading.id='figure-progress-title';heading.textContent='Share on X.com';progress.setAttribute('aria-labelledby',heading.id);
    const message=document.createElement('p');message.setAttribute('role','status');message.textContent='Copying PNG…';
    let cancelled=false;const close=button('Cancel',()=>progress.close());
    progress.addEventListener('close',()=>{cancelled=true;progress.remove();control.disabled=false;if(control.isConnected)control.focus();});
    progress.append(heading,message,close);document.body.append(progress);if(status)status.textContent='';progress.showModal();control.disabled=true;
    try{
      await (options.dashboard?copyDashboard():copyImage(target,info));if(cancelled)return;
      message.textContent='PNG copied to your clipboard. Opening X... Paste the image into your post.';
      await new Promise(resolve=>setTimeout(resolve,2500));if(cancelled)return;
      const popup=root.open(url,'_blank');
      if(popup){popup.opener=null;progress.close();}
      else{
        const help=document.createElement('p');help.textContent='Your browser blocked the new tab. Open X.com below and paste the image.';
        const link=document.createElement('a');link.className='x-share-control';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Open X.com');link.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS.x+'</svg><span aria-hidden="true">.com</span>';
        progress.insertBefore(help,close);progress.insertBefore(link,close);close.textContent='Close';
      }
    }catch(error){if(!cancelled){message.textContent=error.message+' X was not opened.';close.textContent='Close';}}
    finally{control.disabled=false;}
  }
  let dialog;
  function openDashboardShare(opener){
    if(!dialog){dialog=document.createElement('dialog');dialog.className='figure-share-dialog';dialog.setAttribute('data-html2canvas-ignore','');document.body.append(dialog);}
    dialog.replaceChildren();const title=document.createElement('h2');title.id='figure-share-title';title.textContent='Share dashboard';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);
    const label=document.createElement('label');label.textContent='Custom message';label.htmlFor='figure-share-message';const message=document.createElement('textarea');message.id=label.htmlFor;message.rows=4;message.value='Check out Bangladesh Electric Grid Dashboard. See how the grid is performing live or any given day!';dialog.append(label,message);
    const hint=document.createElement('p');const tabTitle=cleanText(document.querySelector('#title'))||'the current tab';
    hint.textContent='Copies a figure preview of '+tabTitle+' as a PNG. Paste the image into your X post.';dialog.append(hint);
    // Share one stable, crawlable URL instead of a separately cached card for every view.
    const url=canonical,link=document.createElement('p');link.className='figure-share-link';link.textContent=url;dialog.append(link);
    const actions=toolbar(),x=document.createElement('a');x.className='dashboard-x-link x-share-control';x.setAttribute('aria-label','Share dashboard on X.com');x.title='Share dashboard on X.com';x.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+ICONS.x+'</svg><span aria-hidden="true">.com</span>';
    x.addEventListener('click',event=>{event.preventDefault();dialog.close();shareFigure(null,x,{dashboard:true,url:x.href});});
    x.target='_blank';x.rel='noopener noreferrer';const update=()=>{x.href=socialURL(url,message.value);};update();message.addEventListener('input',update);
    actions.append(x,button('Close',()=>dialog.close()));dialog.append(actions);dialog.onclose=()=>opener?.isConnected&&opener.focus();dialog.showModal();
  }
  const installed=new Map();
  function install(){
    for(const [target,bar] of installed)if(!target.isConnected){bar.remove();installed.delete(target);}
    document.querySelectorAll('#content '+SELECTOR.split(', ').join(', #content ')).forEach(target=>{
      if(target.dataset.figureActions||target.parentElement?.closest(SELECTOR))return;
      target.dataset.figureActions='true';const bar=toolbar();installed.set(target,bar);
      bar.setAttribute('role','group');bar.setAttribute('aria-label','Figure options: '+describe(target).title);
      const copy=iconButton('Copy figure','copy',async()=>{try{await copyImage(target);announce('PNG copied to your clipboard.');}catch(error){announce(error.message);}});
      const save=iconButton('Download PNG','download',async()=>{save.disabled=true;try{download(await exportPNG(target),describe(target).title);downloadStatus(save,'PNG downloaded.');}catch(error){downloadStatus(save,error.message);}finally{save.disabled=false;}});
      const share=iconButton('Share figure on X.com','x',()=>shareFigure(target,share));
      if(target.matches('.plant-map-panel,.region-map-panel'))bar.append(save);else bar.append(save,copy,share);
      if(target.matches('svg,table')){const holder=document.createElement('div');holder.className='figure-export-wrap';target.before(holder);holder.append(target);}
      const panel=target.closest('.panel,.dispatch-main,.energy-band,.plant-detail');
      const heading=target.matches('.fuel-report-chart')?target.querySelector('.comparison-strip-label'):target.matches('.regional-fuel-svg')?panel?.querySelector('[data-regional-fuel-selected]'):target.matches('.trends-generation-figure,.realtime-dispatch-plots')?panel?.querySelector('h2'):target.querySelector('h2,h3')||target.closest('.availability-chart')?.querySelector('h3')||panel?.querySelector('h2,h3');
      if(target.matches('.fuel-report-chart')){
        let host=panel.querySelector('.fuel-export-actions');if(!host){host=document.createElement('div');host.className='fuel-export-actions';panel.querySelector('.fuel-chart-style').after(host);}
        if(panel.querySelectorAll('.fuel-report-chart').length>1){const label=document.createElement('span');label.className='fuel-export-label';label.textContent=cleanText(heading);bar.prepend(label);}
        host.append(bar);
      }
      else if(heading){let row=heading.parentElement;if(!row.classList.contains('figure-title-row')){row=document.createElement('div');row.className='figure-title-row';heading.before(row);row.append(heading);}row.append(bar);}
      else target.before(bar);
    });
  }
  const website=document.querySelector('#share-dashboard');website.addEventListener('click',()=>{if(!website.hidden)openDashboardShare(website);});
  const syncShareVisibility=()=>{website.hidden=root.location?.hash==='#news';};
  root.addEventListener?.('hashchange',syncShareVisibility);syncShareVisibility();
  const observer=new MutationObserver(install);observer.observe(document.querySelector('#content'),{childList:true,subtree:true});install();
  root.BEGDFigures={shareURL,socialURL,filename,exportPNG,exportDashboardPNG,describe};
})(window);
