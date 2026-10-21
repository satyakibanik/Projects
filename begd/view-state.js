/* Public, versioned URL contract. Chart/series IDs are independent of render order. */
(function(root){
  const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  const choices={dispatch:['line','bar'],shed:['line','bar'],fuel:['bar','pie','ring'],regional:['line','stacked'],curve:['area','line'],table:['energy','mw'],days:['30','60','90','365','10y'],generationUnit:['GWh','MW'],importsUnit:['GWh','MW'],temperatureUnit:['C','F'],detail:['auto','daily','weekly']};
  const defaults={dispatch:'line',shed:'bar',fuel:'bar',regional:'stacked',curve:'area',table:'energy',days:'30',generationUnit:'GWh',importsUnit:'GWh',temperatureUnit:'C',detail:'auto'};
  const names=['date','compare','yesterday','tomorrow','highest','layers','trendLayers','v',...Object.keys(choices)];
  function decode(input){
    const p=new URL(input,'https://example.test').searchParams,warnings=[],state={...defaults,custom:[],presets:{},layers:[],trendLayers:[]};
    if(p.has('v')&&p.get('v')!=='1')warnings.push('This link uses an unknown view version; supported settings were restored.');
    if(p.has('date')){if(validDate(p.get('date')))state.date=p.get('date');else warnings.push('Invalid operating date; showing the latest available report.');}
    for(const key of Object.keys(choices))if(p.has(key)){if(choices[key].includes(p.get(key)))state[key]=p.get(key);else warnings.push('Unsupported '+key+' setting; using its default.');}
    for(const key of ['yesterday','tomorrow','highest'])if(p.has(key)){const value=p.get(key);if(validDate(value)||value==='unavailable')state.presets[key]=value;else warnings.push('Invalid '+key+' comparison was ignored.');}
    for(const date of p.getAll('compare').flatMap(value=>value.split(','))){if(validDate(date)){if(!state.custom.includes(date)&&!Object.values(state.presets).includes(date))state.custom.push(date);else warnings.push('Duplicate comparison date '+date+' was included once.');}else warnings.push('Invalid comparison date was ignored.');}
    for(const key of ['layers','trendLayers'])if(p.has(key))try{
      const pairs=JSON.parse(p.get(key));
      if(!Array.isArray(pairs)||pairs.length>2000||pairs.some(pair=>!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||pair[0].length>300||typeof pair[1]!=='boolean'))throw Error();
      state[key]=pairs;
    }catch{warnings.push('Invalid chart visibility settings were ignored.');}
    return {state,warnings};
  }
  function encode(input,state){
    const url=new URL(input,'https://example.test');for(const name of names)url.searchParams.delete(name);
    url.searchParams.set('v','1');
    if(validDate(state.date))url.searchParams.set('date',state.date);
    for(const date of state.custom||[])if(validDate(date))url.searchParams.append('compare',date);
    for(const [key,value] of Object.entries(state.presets||{}))if(validDate(value)||value==='unavailable')url.searchParams.set(key,value);
    for(const key of Object.keys(choices))if(choices[key].includes(String(state[key])))url.searchParams.set(key,String(state[key]));
    for(const key of ['layers','trendLayers'])if(state[key]?.length)url.searchParams.set(key,JSON.stringify([...state[key]].sort(([a],[b])=>a.localeCompare(b))));
    return url.href;
  }
  root.BEGDViewCodec={validDate,decode,encode,defaults};
})(window);
