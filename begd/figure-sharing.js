/* Figure exports stay in the browser. Social composers require a final user post. */
(function(root){
  'use strict';
  const BRAND='Bangladesh Electric Grid Dashboard';
  const COPYRIGHT='© '+BRAND;
  const SELECTOR='.interactive-chart, .fuel-report-chart, .regional-snapshot-chart-wrap, .regional-fuel-svg, .plant-map-panel, .region-map-panel, .vb-combined, .trends-generation-figure, .trends-chart, .trends-heatmap, .region-card';
  const canonical='https://satyakibanik.github.io/Projects/begd/';
  const cleanText=node=>(node?.innerText||node?.textContent||'').replace(/\s+/g,' ').trim();
  function shareURL(href){const source=new URL(href),url=new URL(canonical);url.search=source.search;url.hash=source.hash;return url.href;}
  function socialURL(network,url,message){const target=new URL(network==='x'?'https://twitter.com/intent/tweet':'https://www.linkedin.com/sharing/share-offsite/');target.searchParams.set('url',url);if(network==='x')target.searchParams.set('text',message);return target.href;}
  function filename(title){return 'begd-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90)+'.png';}
  function describe(target){
    const panel=target.closest('.panel,.dispatch-main,.energy-band,.plant-detail'),svg=target.matches('svg')?target:target.querySelector('svg:not(.series-swatch)');
    const heading=(target.matches('.trends-generation-figure')?cleanText(panel?.querySelector('h2')):cleanText(target.querySelector('h2,h3')))||cleanText(panel?.querySelector('h2,h3'))||'Grid figure';
    const label=target.matches('.fuel-report-chart')?cleanText(target.querySelector('.comparison-strip-label')):target.matches('.trends-chart,.regional-fuel-svg')?svg?.getAttribute('aria-label')?.split('. Missing dates')[0]||'':'';
    const note=cleanText(panel?.querySelector('.panel-head p'));
    const source=[...panel?.querySelectorAll('.note,.trends-citation,.plant-map-attribution,.dispatch-bottom')||[]].map(cleanText);
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
    if(!target.isConnected)throw new Error('The figure changed. Close this dialog and select it again.');
    // html2canvas requires an HTML root; capturing an SVG root fails during cloning.
    const capture=target.matches('svg,table')?target.closest('.figure-export-wrap'):target;
    let contentBounds;
    const shot=await root.html2canvas(capture,{backgroundColor:getComputedStyle(document.body).backgroundColor,scale:2,logging:false,
      // Expand clipped chart/table containers only in the detached export document.
      onclone:(doc,clone)=>{
        const style=doc.createElement('style');
        style.textContent='*,*::before,*::after{animation:none!important;transition:none!important}.dispatch-chart-style,.map-controls,.regional-snapshot-controls,.temperature-subplot-heading .trends-unit-control,.chart-help,.figure-actions,.chart-tooltip,.trends-tooltip,.fuel-tooltip{display:none!important}.en-curve-chart{grid-template-areas:"plot legend";grid-template-rows:auto}.en-curve-chart>.legend{max-height:none!important;overflow:visible!important}@media(max-width:760px){.en-curve-chart{grid-template-areas:"plot" "legend"}}';
        doc.head.append(style);
        doc.querySelectorAll('.regional-snapshot-chart-scroll,.table-wrap').forEach(node=>{node.style.overflow='visible';node.style.maxHeight='none';});
        clone.style.width=Math.ceil(Math.max(capture.getBoundingClientRect().width,capture.scrollWidth))+'px';
        clone.style.height='auto';clone.style.minHeight='0';clone.style.maxHeight='none';
        clone.querySelectorAll('.en-curve-chart>svg.chart').forEach(svg=>{
          const view=svg.viewBox.baseVal,ink=svg.getBBox(),bounds=svg.getBoundingClientRect();
          const extra=Math.max(0,ink.y+ink.height-view.y-view.height);
          if(extra){const height=view.height+extra+4;svg.style.height=(bounds.height*height/view.height)+'px';svg.style.maxHeight='none';svg.setAttribute('viewBox',`${view.x} ${view.y} ${view.width} ${height}`);}
        });
        // Measure after removing controls/help so their former height is not exported.
        const bounds=clone.getBoundingClientRect();
        const visible=[...clone.querySelectorAll('svg:not(.series-swatch),.legend,.trends-legend,.regional-snapshot-legend,.comparison-strip-label,.composition-strip,table,.vb-reading')].filter(node=>node.getBoundingClientRect().height>0);
        if(visible.length&&!target.matches('.plant-map-panel,.region-map-panel'))contentBounds={height:Math.max(...visible.map(node=>node.getBoundingClientRect().bottom))-bounds.top+4};
      },
      ignoreElements:node=>node.hasAttribute('data-html2canvas-ignore')||node.matches('.chart-tooltip,.trends-tooltip,.fuel-tooltip,.chart-cursor,.trends-cursor')});
    const captureHeight=contentBounds?Math.min(shot.height,Math.ceil(contentBounds.height*2)):shot.height;
    const canvas=document.createElement('canvas'),width=Math.max(1200,shot.width),pad=32;
    canvas.width=width;const ctx=canvas.getContext('2d');ctx.font='bold 22px sans-serif';
    const heading=lines(ctx,info.title,width-pad*2);ctx.font='22px sans-serif';const context=lines(ctx,info.context,width-pad*2);ctx.font='20px sans-serif';const notes=(info.footer||[]).flatMap(text=>lines(ctx,text,width-pad*2));
    const top=pad+(heading.length+context.length)*30+16,bottom=notes.length*28+100;
    const figureHeight=captureHeight*width/shot.width;canvas.height=top+figureHeight+bottom;ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#163529';ctx.font='bold 22px sans-serif';
    let y=pad;for(const line of heading){y+=30;ctx.fillText(line,pad,y);}ctx.font='22px sans-serif';for(const line of context){y+=30;ctx.fillText(line,pad,y);}
    ctx.drawImage(shot,0,0,shot.width,captureHeight,0,top,width,figureHeight);y=top+figureHeight+8;ctx.font='20px sans-serif';for(const line of notes){y+=28;ctx.fillText(line,pad,y);}
    ctx.textAlign='right';ctx.font='bold 22px sans-serif';ctx.fillText(COPYRIGHT,width-pad,canvas.height-48);
    ctx.font='18px sans-serif';ctx.fillText(canonical,width-pad,canvas.height-22);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not create the PNG.')),'image/png'));
  }
  function download(blob,title){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename(title);a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function button(label,action){const element=document.createElement('button');element.type='button';element.textContent=label;element.addEventListener('click',action);return element;}
  function toolbar(){const bar=document.createElement('div');bar.className='figure-actions';bar.setAttribute('data-html2canvas-ignore','');return bar;}
  function reportError(status,error){status.textContent=error.message||'Export failed. Try downloading the PNG.';}
  function copyImage(target,info){
    if(!root.isSecureContext||!navigator.clipboard?.write||!root.ClipboardItem)throw new Error('Image copy is unavailable here. Use Download PNG instead.');
    // Start the write in the click gesture, including Safari's promised-blob support.
    return navigator.clipboard.write([new root.ClipboardItem({'image/png':exportPNG(target,info)})]);
  }
  let dialog;
  function openShare(target,opener){
    const info=target?describe(target):{title:'Bangladesh Electric Grid Dashboard'},url=shareURL(location.href);
    if(!dialog){dialog=document.createElement('dialog');dialog.className='figure-share-dialog';dialog.setAttribute('data-html2canvas-ignore','');document.body.append(dialog);}
    dialog.replaceChildren();const title=document.createElement('h2');title.id='figure-share-title';title.textContent=target?'Share figure':'Share dashboard';dialog.setAttribute('aria-labelledby',title.id);dialog.append(title);
    const label=document.createElement('label');label.textContent='Custom message';label.htmlFor='figure-share-message';const message=document.createElement('textarea');message.id=label.htmlFor;message.rows=4;message.value=info.title+' — '+BRAND;dialog.append(label,message);
    const link=document.createElement('p');link.className='figure-share-link';link.textContent=url;dialog.append(link);
    const help=document.createElement('p');help.textContent=(target?'To attach the image, use Share image… if available, or download the PNG and attach it in your post. ':'')+'LinkedIn does not prefill your message: Share to LinkedIn also copies your message; paste it into “Share your thoughts” in LinkedIn. X prefills the message. The LinkedIn/X link buttons do not attach images.';dialog.append(help);
    const status=document.createElement('p');status.setAttribute('role','status');
    const actions=toolbar();
    if(target){actions.append(button('Download PNG',async()=>{try{download(await exportPNG(target,info),info.title);status.textContent='PNG downloaded. Attach it to your post.';}catch(error){reportError(status,error);}}),button('Copy figure',async()=>{try{await copyImage(target,info);status.textContent='Figure copied. Paste it into your post.';}catch(error){reportError(status,error);}}));}
    if(target){
      const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');
      summary.textContent='Text below this figure';
      for(const text of [...info.footer,COPYRIGHT,canonical]){const item=document.createElement('li');item.textContent=text;list.append(item);}
      details.append(summary,list);dialog.append(details);
      if(navigator.share&&navigator.canShare){
        let file;
        const native=button('Preparing image…',async()=>{
          try{await navigator.share({files:[file],title:info.title,text:message.value+'\n'+url});status.textContent='Image handed to the selected app. Review the message and attachment there.';}
          catch(error){if(error.name!=='AbortError')status.textContent='Image sharing was unavailable. Download PNG and attach it in your post.';}
        });native.disabled=true;actions.append(native);
        // Prepare before the click so native sharing retains its required user gesture.
        exportPNG(target,info).then(blob=>{
          file=new File([blob],filename(info.title),{type:'image/png'});
          if(navigator.canShare({files:[file]})){native.textContent='Share image…';native.disabled=false;}
          else{native.remove();status.textContent='This browser cannot share image files. Download PNG and attach it in your post.';}
        }).catch(error=>{native.remove();reportError(status,error);});
      }
    }
    actions.append(button('Copy message',async()=>{try{await navigator.clipboard.writeText(message.value+'\n'+url);status.textContent='Message and link copied.';}catch(error){status.textContent='Clipboard unavailable. Select and copy the custom message above.';message.focus();message.select();}}));
    for(const [network,name] of [['linkedin','Share to LinkedIn'],['x','Share to X']]){
      const a=document.createElement('a');a.textContent=name;a.target='_blank';a.rel='noopener noreferrer';
      const update=()=>{a.href=socialURL(network,url,message.value);};update();message.addEventListener('input',update);
      if(network==='linkedin')a.addEventListener('click',()=>{
        // LinkedIn accepts a URL only. Keep the message ready for the user's paste.
        if(navigator.clipboard?.writeText)navigator.clipboard.writeText(message.value+'\n'+url).then(()=>{status.textContent='Message copied. Paste it into LinkedIn’s “Share your thoughts” field.';}).catch(()=>{status.textContent='Clipboard blocked. Select and copy the custom message, then paste it into LinkedIn.';});
        else status.textContent='Select and copy the custom message, then paste it into LinkedIn.';
      });
      actions.append(a);
    }
    const close=button('Close',()=>dialog.close());actions.append(close);dialog.append(actions,status);dialog.onclose=()=>opener?.isConnected&&opener.focus();dialog.showModal();
  }
  function install(){
    document.querySelectorAll('#content '+SELECTOR.split(', ').join(', #content ')).forEach(target=>{
      if(target.dataset.figureActions||target.parentElement?.closest(SELECTOR))return;
      target.dataset.figureActions='true';const bar=toolbar(),status=document.createElement('span');status.setAttribute('role','status');
      bar.setAttribute('role','group');bar.setAttribute('aria-label','Figure options: '+describe(target).title);
      const copy=button('Copy figure',async()=>{try{await copyImage(target);status.textContent='Figure copied.';}catch(error){reportError(status,error);}});
      const save=button('Download PNG',async()=>{save.disabled=true;try{download(await exportPNG(target),describe(target).title);status.textContent='PNG downloaded.';}catch(error){reportError(status,error);}finally{save.disabled=false;}});
      const share=button('Share figure',()=>openShare(target,share));
      if(target.matches('.plant-map-panel,.region-map-panel'))bar.append(save,status);
      else bar.append(copy,save,share,status);
      if(target.matches('svg,table')){const holder=document.createElement('div');holder.className='figure-export-wrap';target.before(holder);holder.append(bar,target);}else target.prepend(bar);
    });
  }
  const website=document.querySelector('#share-dashboard');website.addEventListener('click',()=>openShare(null,website));
  // Rendering, async map loads, filters, and plant expansion all replace figure nodes.
  const observer=new MutationObserver(install);observer.observe(document.querySelector('#content'),{childList:true,subtree:true});install();
  root.BEGDFigures={shareURL,socialURL,filename,exportPNG,describe};
})(window);
