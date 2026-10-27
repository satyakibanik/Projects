/* Public, versioned URL contract. Chart/series IDs are independent of render order. */
(function(root){
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const choices={dispatch:['line','bar'],shed:['line','bar'],fuel:['bar','pie','ring'],regional:['line','stacked'],curve:['area','line'],table:['energy','mw'],days:['30','60','90','365','10y'],generationUnit:['GWh','MW'],importsUnit:['GWh','MW'],temperatureUnit:['C','F'],detail:['auto','daily','weekly'],costTrend:['off','linear'],costAverageDays:['7','30','60','90','365']};
  const defaults={dispatch:'line',shed:'bar',fuel:'bar',regional:'stacked',curve:'area',table:'energy',days:'30',generationUnit:'GWh',importsUnit:'GWh',temperatureUnit:'C',detail:'auto',costTrend:'off',costAverageDays:'30'};
  const names=['date','compare','yesterday','tomorrow','highest','layers','trendLayers','hide','show','v',...Object.keys(choices)];
  // Append-only aliases: these IDs must not depend on chart/legend render order.
  const dailyCharts={'overview:dispatch':'od','overview:shed':'os','en-curve:en-curve':'ec','en-curve:shortage_mw':'es','imports:total_mw':'it','realtime:total_mw':'rt'};
  const dailySeries={generation_mw:'g',demand_mw:'d',shed_mw:'s',forecasted_demand_mw:'f',east_grid_mw:'e',west_grid_mw:'w',shortage_mw:'q',total_mw:'i',mw:'m',output_selected:'o',independent_generation_mw:'ig',independent_demand_mw:'id'};
  const trendCharts={'generation-demand':'tg','load-shedding':'tl','fuel-mix':'tf',imports:'ti','dependence-renewables':'td','unserved-share':'tu','historical-generation':'th','temperature-subplot':'tt'};
  const trendSeries={tg:{generation_mwh:'g',demand_mwh:'d',temperature_c:'t'},tl:{shed_peak_mw:'s'},tf:{gas:'g',coal:'c',hfo:'o',hsd:'d',hydro:'h',solar:'s',imports:'i',wind:'w'},ti:{imports_mwh:'i'},td:{'import-share':'i','renewable-share':'r'},tu:{'unserved-share':'u'},th:{'daily-mean':'d','rolling-mean':'r'},tt:{temperature_c:'t'}};
  const lookup=(map,key)=>Object.hasOwn(map,key)?map[key]:undefined;
  const reverse=map=>Object.fromEntries(Object.entries(map).map(([key,value])=>[value,key]));
  const dailyChartNames=reverse(dailyCharts),dailySeriesNames=reverse(dailySeries),trendChartNames=reverse(trendCharts);
  const trendSeriesNames=Object.fromEntries(Object.entries(trendSeries).map(([chart,series])=>[chart,reverse(series)]));
  function defaultVisible(id,trends=false){return trends?(id.startsWith('bpdb-cost|')?id==='bpdb-cost|reported-total':id!=='generation-demand|temperature_c'):!['overview:dispatch|east_grid_mw','overview:dispatch|west_grid_mw','realtime:total_mw|forecasted_demand_mw','realtime:total_mw|independent_generation_mw','realtime:total_mw|independent_demand_mw'].includes(id);}
  function visibilityOverrides(pairs,trends=false){
    return [...new Map(pairs||[])].filter(([id,visible])=>visible!==defaultVisible(id,trends)).sort(([a],[b])=>a.localeCompare(b));
  }
  function packLayer(id,trends){
    const split=id.indexOf('|'),chart=id.slice(0,split),series=id.slice(split+1),alias=lookup(trends?trendCharts:dailyCharts,chart);
    if(trends&&alias&&lookup(trendSeries[alias],series))return alias+'.'+lookup(trendSeries[alias],series);
    if(!trends&&alias){
      if(lookup(dailySeries,series))return alias+'.'+lookup(dailySeries,series);
      const comparison=/^(.*)_(yesterday|tomorrow|highest|custom_(\d{4}-\d{2}-\d{2}))$/.exec(series);
      if(comparison&&lookup(dailySeries,comparison[1]))return alias+'.'+lookup(dailySeries,comparison[1])+'.'+({yesterday:'y',tomorrow:'t',highest:'h'}[comparison[2]]||'c'+comparison[3].replaceAll('-',''));
    }
    // Lossless escape for dynamic workbook/plant/route IDs, including punctuation and Unicode.
    return (trends?'tx-':'dx-')+encodeURIComponent(id);
  }
  function unpackLayer(token){
    if(token.startsWith('tx-')||token.startsWith('dx-')){
      const id=decodeURIComponent(token.slice(3));if(!id.includes('|')||id.length>300)throw Error();
      return {trends:token.startsWith('tx-'),id};
    }
    const [chart,series,source,...extra]=token.split('.');if(extra.length)throw Error();
    if(lookup(trendChartNames,chart)&&lookup(trendSeriesNames[chart],series)&&!source)return {trends:true,id:trendChartNames[chart]+'|'+trendSeriesNames[chart][series]};
    if(lookup(dailyChartNames,chart)&&lookup(dailySeriesNames,series)){
      let suffix='';
      if(source){
        if(['y','t','h'].includes(source))suffix='_'+({y:'yesterday',t:'tomorrow',h:'highest'}[source]);
        else if(/^c\d{8}$/.test(source)){const date=source.slice(1,5)+'-'+source.slice(5,7)+'-'+source.slice(7);if(!validDate(date))throw Error();suffix='_custom_'+date;}
        else throw Error();
      }
      return {trends:false,id:dailyChartNames[chart]+'|'+dailySeriesNames[series]+suffix};
    }
    throw Error();
  }
  function decode(input){
    const p=new URL(input,'https://example.test').searchParams,warnings=[],state={...defaults,custom:[],presets:{},layers:[],trendLayers:[]};
    if(p.has('v')&&!['1','2'].includes(p.get('v')))warnings.push('This link uses an unknown view version; supported settings were restored.');
    if(p.has('date')){if(validDate(p.get('date')))state.date=p.get('date');else warnings.push('Invalid operating date; showing the latest available report.');}
    for(const key of Object.keys(choices))if(p.has(key)){if(choices[key].includes(p.get(key)))state[key]=p.get(key);else warnings.push('Unsupported '+key+' setting; using its default.');}
    for(const key of ['yesterday','tomorrow','highest'])if(p.has(key)){const value=p.get(key);if(validDate(value)||value==='unavailable')state.presets[key]=value;else warnings.push('Invalid '+key+' comparison was ignored.');}
    for(const date of p.getAll('compare').flatMap(value=>value.split(','))){if(validDate(date)){if(!state.custom.includes(date)&&!Object.values(state.presets).includes(date))state.custom.push(date);else warnings.push('Duplicate comparison date '+date+' was included once.');}else warnings.push('Invalid comparison date was ignored.');}
    for(const key of ['layers','trendLayers'])if(p.has(key))try{
      const pairs=JSON.parse(p.get(key));
      if(!Array.isArray(pairs)||pairs.length>2000||pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||pair[0].length>300||typeof pair[1]!=='boolean'))throw Error();
      pairs.forEach(([id])=>encodeURIComponent(id));
      state[key]=pairs;
    }catch{warnings.push('Invalid chart visibility settings were ignored.');}
    for(const key of ['hide','show'])if(p.has(key)){
      const tokens=p.getAll(key).flatMap(value=>value.split(','));
      if(tokens.length>2000){warnings.push('Too many chart visibility settings were ignored.');continue;}
      for(const token of tokens)try{
        const {trends,id}=unpackLayer(token),field=trends?'trendLayers':'layers';
        state[field]=[...new Map([...state[field],[id,key==='show']])];
      }catch{warnings.push('An unsupported chart visibility setting was ignored.');}
    }
    return {state,warnings};
  }
  function encode(input,state){
    const url=new URL(input,'https://example.test');for(const name of names)url.searchParams.delete(name);
    url.searchParams.set('v','2');
    if(validDate(state.date))url.searchParams.set('date',state.date);
    const custom=(state.custom||[]).filter(validDate);if(custom.length)url.searchParams.set('compare',custom.join(','));
    for(const [key,value] of Object.entries(state.presets||{}))if(validDate(value)||value==='unavailable')url.searchParams.set(key,value);
    for(const key of Object.keys(choices))if(choices[key].includes(String(state[key]))&&String(state[key])!==defaults[key])url.searchParams.set(key,String(state[key]));
    const hide=[],show=[];
    for(const field of ['layers','trendLayers'])for(const [id,visible] of visibilityOverrides(state[field],field==='trendLayers'))(visible?show:hide).push(packLayer(id,field==='trendLayers'));
    if(hide.length)url.searchParams.set('hide',hide.join(','));
    if(show.length)url.searchParams.set('show',show.join(','));
    return url.href;
  }
  root.BEGDViewCodec={validDate,decode,encode,defaults,visibilityOverrides};
})(window);
