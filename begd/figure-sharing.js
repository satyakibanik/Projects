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
    const source=[...sourceRoot?.querySelectorAll('.note,.information-note,.trends-citation,.plant-map-attribution,.dispatch-bottom')||[]].map(cleanText);
    if(target.matches('.forecast-subplot'))source.push(...[...panel?.querySelectorAll('.forecast-body > .note')||[]].map(cleanText));
    if(panel?.matches('.plant-detail'))source.push('Source: GenLog · hourly plant output · MW · Bangladesh time.');
    if(target.matches('.trends-generation-figure')&&panel?.nextElementSibling?.matches('.trends-temperature-note'))source.push(cleanText(panel.nextElementSibling));
    source.push(...[...target.querySelectorAll('.fuel-mix-segment')].map(node=>node.getAttribute('aria-label')));
    const footer=[...new Set([note,...source].filter(Boolean))];
    return {title:heading+(label&&label!==heading?' · '+label:''),context:cleanText(document.querySelector('#subtitle')),footer};
  }
  function lines(ctx,text,width){
    const result=[];let line='';
    for(const word of text.split(/\s+/)){if(line&&ctx.measureText(line+' '+word).width>width){result.push(line);line=word;}else line+=(line?' ':'')+word;}
    if(line)result.push(line);return result;
  }
  async function exportPNG(target,info=describe(target)){
    if(!target.isConnected)throw new Error('The figure changed. Select it again.');
    // html2canvas requires an HTML root; capturing an SVG root fails during cloning.
    const capture=target.matches('svg,table')?target.closest('.figure-export-wrap'):target;
    const captureScale=info.dashboard?2:4,outputScale=2;
    // Capture the theme once so chart, title and footer use the same palette.
    const theme=getComputedStyle(document.body),background=theme.backgroundColor,ink=theme.color;
    let contentBounds;
    const shot=await root.html2canvas(capture,{backgroundColor:background,scale:captureScale,logging:false,
      // Expand clipped chart/table containers only in the detached export document.
      onclone:(doc,clone)=>{
        const style=doc.createElement('style');
        style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}.forecast-subplot-controls label,.dispatch-chart-style,.map-controls,.regional-snapshot-controls,.temperature-subplot-heading .trends-unit-control,.chart-help,.metric-method,.vb-reading,.vb-stats,.figure-actions,.chart-tooltip,.trends-tooltip,.fuel-tooltip{display:none!important}.dispatch-main .chart{margin-left:0!important;width:100%!important}.en-curve-chart{grid-template-areas:"plot legend";grid-template-rows:auto}.en-curve-chart>.legend{max-height:none!important;overflow:visible!important}@media(max-width:760px){.en-curve-chart{grid-template-areas:"plot" "legend"}}';
        doc.head.append(style);
        doc.querySelectorAll('.regional-snapshot-chart-scroll,.table-wrap').forEach(node=>{node.style.overflow='visible';node.style.maxHeight='none';});
        clone.style.width=Math.ceil(Math.max(capture.getBoundingClientRect().width,capture.scrollWidth))+'px';
        clone.style.height='auto';clone.style.minHeight='0';clone.style.maxHeight='none';
        clone.querySelectorAll('.en-curve-chart>svg.chart').forEach(svg=>{
          const view=svg.viewBox.baseVal,ink=svg.getBBox(),bounds=svg.getBoundingClientRect();
          const extra=Math.max(0,ink.y+ink.height-view.y-view.height);
          if(extra){const height=view.height+extra+4;svg.style.height=(bounds.height*height/view.height)+'px';svg.style.maxHeight='none';svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${height}`);}
        });
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
        if(!info.dashboard&&visible.length&&!target.matches('.plant-map-panel,.region-map-panel'))contentBounds={height:Math.max(...visible.map(node=>node.getBoundingClientRect().bottom))-bounds.top+4};
      },
      ignoreElements:node=>node.hasAttribute('data-html2canvas-ignore')||node.matches('.chart-tooltip,.trends-tooltip,.fuel-tooltip,.chart-cursor,.trends-cursor,.vb-reading,.vb-stats')||
        // Cloning unrelated 365-day SVG panels makes single-figure exports needlessly slow.
        Boolean(node.closest('body')&&!node.contains(capture)&&!capture.contains(node))});
    const captureHeight=contentBounds?Math.min(shot.height,Math.ceil(contentBounds.height*captureScale)):shot.height;
    const canvas=document.createElement('canvas'),width=Math.max(1200,shot.width/outputScale),pad=32;
    // Render the chart and all annotations at twice the previous PNG resolution.
    canvas.width=width*outputScale;const ctx=canvas.getContext('2d');ctx.font='bold 32px sans-serif';
    const heading=lines(ctx,info.title,width-pad*2);ctx.font='22px sans-serif';const context=lines(ctx,info.context,width-pad*2);ctx.font='20px sans-serif';const notes=(info.footer||[]).flatMap(text=>lines(ctx,text,width-pad*2));
    const top=pad+heading.length*40+context.length*30+16,bottom=notes.length*28+100;
    const figureHeight=captureHeight*width/shot.width;canvas.height=Math.ceil((top+figureHeight+bottom)*outputScale);ctx.scale(outputScale,outputScale);ctx.fillStyle=background;ctx.fillRect(0,0,width,canvas.height/outputScale);ctx.fillStyle=ink;ctx.font='bold 32px sans-serif';
    let y=pad;for(const line of heading){y+=40;ctx.fillText(line,pad,y);}ctx.font='22px sans-serif';for(const line of context){y+=30;ctx.fillText(line,pad,y);}
    ctx.drawImage(shot,0,0,shot.width,captureHeight,0,top,width,figureHeight);y=top+figureHeight+8;ctx.font='20px sans-serif';for(const line of notes){y+=28;ctx.fillText(line,pad,y);}
    ctx.textAlign='right';ctx.font='bold 22px sans-serif';ctx.fillText(COPYRIGHT,width-pad,canvas.height/outputScale-48);
    ctx.font='18px sans-serif';ctx.fillText(canonical,width-pad,canvas.height/outputScale-22);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the PNG.')),'image/png'));
  }
  async function exportDashboardPNG(){
    const main=document.querySelector('main'),target=document.createElement('main');
    target.className='dashboard-export';
    target.style.cssText='position:absolute;left:-100000px;top:0;margin:0;width:'+Math.ceil(main.getBoundingClientRect().width)+'px;max-width:none;';
    const brand=document.querySelector('.brand').cloneNode(true),intro=document.querySelector('.intro').cloneNode(true);
    intro.querySelector('h1').textContent='National overview';
    intro.querySelector('#subtitle').innerHTML=reportSubtitle('overview',data);
    target.append(brand,intro);
    const content=document.createElement('div');content.innerHTML=overviewSnapshotMarkup();target.append(content);document.body.append(target);
    try{return await exportPNG(target,{title:'BEGD · National overview',context:'',footer:[],dashboard:true});}
    finally{target.remove();}
  }
  function copyDashboard(){
    if(!root.isSecureContext||!navigator.clipboard?.write||!root.ClipboardItem)throw new Error('Image copy is unavailable here.');
    return navigator.clipboard.write([new root.ClipboardItem({'image/png':exportDashboardPNG()})]);
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
    const hint=document.createElement('p');hint.textContent='Copies National overview for the selected report as a PNG, without comparison controls. Paste the image into your X post.';dialog.append(hint);
    const url=shareURL(location.href),link=document.createElement('p');link.className='figure-share-link';link.textContent=url;dialog.append(link);
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
      const heading=target.matches('.fuel-report-chart')?target.querySelector('.comparison-strip-label'):target.matches('.regional-fuel-svg')?panel?.querySelector('[data-regional-fuel-selected]'):target.matches('.trends-generation-figure,.realtime-dispatch-plots')?panel?.querySelector('h2'):target.querySelector('h2,h3')||panel?.querySelector('h2,h3');
      if(target.matches('.fuel-report-chart')){
        let host=panel.querySelector('.fuel-export-actions');if(!host){host=document.createElement('div');host.className='fuel-export-actions';panel.querySelector('.fuel-chart-style').after(host);}
        if(panel.querySelectorAll('.fuel-report-chart').length>1){const label=document.createElement('span');label.className='fuel-export-label';label.textContent=cleanText(heading);bar.prepend(label);}
        host.append(bar);
      }
      else if(heading){let row=heading.parentElement;if(!row.classList.contains('figure-title-row')){row=document.createElement('div');row.className='figure-title-row';heading.before(row);row.append(heading);}row.append(bar);}
      else target.before(bar);
    });
  }
  const website=document.querySelector('#share-dashboard');website.addEventListener('click',()=>openDashboardShare(website));
  const observer=new MutationObserver(install);observer.observe(document.querySelector('#content'),{childList:true,subtree:true});install();
  root.BEGDFigures={shareURL,socialURL,filename,exportPNG,exportDashboardPNG,describe};
})(window);
