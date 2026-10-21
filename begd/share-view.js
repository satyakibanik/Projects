/* One coordinator owns URL/history changes; render and data loading never create history. */
(function(root){
  const codec=root.BEGDViewCodec,presets=['yesterday','tomorrow','highest'];
  let started=false,restoring=false,revision=0,lastURL='',queued=false;
  const status=message=>{$('#view-status').textContent=message;};
  function capture(){
    const trends=root.BEGDTrends.getViewState();
    return {date:data?.date,custom:[...customComparisons.keys()],presets:Object.fromEntries(presets.filter(day=>$('#source-'+day).checked).map(day=>[day,comparisonData[day]?.date||pinnedComparisons[day]||'unavailable'])),dispatch:dispatchChartStyle,shed:shedChartStyle,fuel:fuelMixStyle,regional:regionalSnapshotStyle,curve:enCurveChartStyle,table:enCurveTableMode,layers:codec.visibilityOverrides([...chartVisibility]),...trends,trendLayers:codec.visibilityOverrides(trends.trendLayers,true)};
  }
  function commit({replace=false}={}){
    if(!started||restoring)return;
    const state=capture(),url=codec.encode(location.href,state);
    if(url===lastURL)return;
    history[replace?'replaceState':'pushState']({begd:state},'',url);lastURL=url;
  }
  async function restore(state,warnings=[]){
    const token=++revision;restoring=true;status('Restoring dashboard view…');
    // Cancel pending report/comparison work before applying a history entry.
    request++;previousForecastRequest++;
    for(const day of presets){comparisonRequests[day]++;comparisonData[day]=null;delete pinnedComparisons[day];$('#source-'+day).checked=Object.hasOwn(state.presets,day);if(state.presets[day])pinnedComparisons[day]=state.presets[day];$('#'+day+'-status').textContent='Off';}
    customComparisons.clear();renderCustomComparisons();
    dispatchChartStyle=state.dispatch;shedChartStyle=state.shed;fuelMixStyle=state.fuel;regionalSnapshotStyle=state.regional;enCurveChartStyle=state.curve;enCurveTableMode=state.table;
    chartVisibility.clear();for(const pair of state.layers)chartVisibility.set(...pair);
    root.BEGDTrends.setViewState(state);
    if(state.date&&state.date!==data?.date){
      try{
        const report=await reportForOperatingDate(state.date);if(token!==revision)return;
        const select=$('#date'),id=String(report.report_id);
        if(![...select.options].some(option=>option.value===id)){const option=document.createElement('option');option.value=id;option.textContent=(report.published_date||'Publication unavailable')+' · operating '+report.date;select.add(option);}
        select.value=id;
        if(!await load(id))warnings.push('The selected operating report could not be loaded.');
      }catch(error){if(token!==revision)return;warnings.push(error.message+' Showing the latest loaded report.');}
    }
    if(token!==revision)return;
    await Promise.all([...presets.filter(day=>$('#source-'+day).checked).map(loadComparison),...state.custom.map(date=>addCustomComparison(date,{restoring:true}))]);
    if(token!==revision)return;
    updateReportDayNavigation();render();restoring=false;lastURL=location.href;
    status(warnings.join(' '));
    // Keep the exact history entry, including unavailable dates, for Back/Forward.
    history.replaceState({begd:state},'',location.href);
  }
  async function start(){
    if(started)return;started=true;
    const {state,warnings}=codec.decode(location.href);
    if(location.search)await restore(state,warnings);
    else {lastURL=location.href;history.replaceState({begd:capture()},'',location.href);}
  }
  function queueCommit(){if(queued)return;queued=true;queueMicrotask(()=>{queued=false;commit()});}
  document.addEventListener('change',event=>{
    if(event.target.matches('[data-chart-style], [data-toggle-series], [data-toggle-family], #fuel-mix-style, [data-regional-snapshot-style], [data-trend-layer]'))queueCommit();
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-trend-days], [data-trend-unit], [data-temperature-unit], [data-temperature-detail], [data-en-curve-table-mode]'))queueCommit();
  });
  root.addEventListener('popstate',event=>{
    const decoded=codec.decode(location.href);
    restore(event.state?.begd||decoded.state,decoded.warnings);
  });
  // Native hash navigation already added its history entry. Fill that entry with this view.
  root.addEventListener('hashchange',()=>{if(!restoring)commit({replace:true});});
  $('#copy-link').addEventListener('click',async()=>{
    const button=$('#copy-link'),message=$('#share-status');
    if(!started||restoring){message.textContent='Please wait for the view to finish loading.';return;}
    button.disabled=true;
    try{
      // Wait for any comparison currently in flight rather than save unresolved presets.
      if([...customComparisons.values()].some(item=>!item.report&&!item.error)||presets.some(day=>$('#source-'+day).checked&&$('#'+day+'-status').textContent==='Loading…')){message.textContent='Comparisons are still loading. Try copying again when they finish.';return;}
      commit({replace:true});const url=codec.encode(location.href,capture());
      $('#share-url').value=url;
      try{await navigator.clipboard.writeText(url);message.textContent='Link copied.';$('#share-fallback').hidden=true;}
      catch{message.textContent='Clipboard unavailable. Select and copy the link below.';$('#share-fallback').hidden=false;$('#share-url').focus();$('#share-url').select();}
    }finally{button.disabled=false;}
  });
  root.BEGDView={start,commit,capture,get started(){return started;}};
})(window);
