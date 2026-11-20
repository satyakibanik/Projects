(function(root){
  'use strict';

  const HOURS=Array.from({length:24},(_,hour)=>String(hour).padStart(2,'0')+':00');
  const SEASONS=[
    {name:'Winter',months:[12,1,2],color:'#3a75ba'},
    {name:'Pre-monsoon',months:[3,4,5],color:'#bd682c'},
    {name:'Monsoon',months:[6,7,8,9],color:'#167b70'},
    {name:'Post-monsoon',months:[10,11],color:'#8a56a9'},
  ];
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const format=value=>value.toLocaleString('en-GB',{maximumFractionDigits:1});
  const reading=value=>Number.isFinite(value)&&value>=0;
  const valid=value=>reading(value)?value:null;
  const panel=(title,caption,body)=>`<section class="panel full demand-trends-panel"><div class="panel-head"><div><h2>${title}</h2><p>${caption}</p></div></div>${body}</section>`;

  function seasonalSamples(rows){
    return SEASONS.map(season=>{
      const days=rows.filter(row=>season.months.includes(Number(row.date.slice(5,7))));
      const samples=days.flatMap(row=>HOURS.map((_,hour)=>row.hourly_demand_mw?.[hour]).filter(reading)).sort((a,b)=>b-a);
      return {...season,samples,expected:days.length*24};
    });
  }

  function persistence(rows,names){
    return names.map(name=>{
      const values=rows.map(row=>row.regional_shed_mw?.[name]).filter(reading);
      const positive=values.filter(value=>value>0).length;
      let shedTotal=0,demandTotal=0;
      for(const row of rows){
        const shed=row.regional_shed_mw?.[name],demand=row.regional_demand_mw?.[name];
        if(!reading(shed)||!reading(demand)||demand===0)continue;
        shedTotal+=shed;
        demandTotal+=demand;
      }
      return {name,observed:values.length,positive,share:values.length?100*positive/values.length:null,
        demandShare:demandTotal>0?100*(shedTotal/demandTotal):null};
    }).sort((a,b)=>(b.share??-1)-(a.share??-1)||b.observed-a.observed||a.name.localeCompare(b.name));
  }

  const heatmaps=new Map();
  const palette=['#2153af','#38a6d2','#f3e9a3','#ef8c48','#b51e32'];
  const regionalPalettes={
    purple:{label:'Yellow to purple',colors:['#f5d54b','#e58b66','#ac4c91','#48205e']},
    heat:{label:'Orange to burgundy (original)',colors:['#f28c28','#e75324','#bc242d','#750f32']},
    blue:{label:'Sky to navy',colors:['#7cc8ed','#3b9bd5','#2163ab','#142850']},
    teal:{label:'Teal to plum',colors:['#60d8c3','#269d93','#5962a2','#421650']},
    amber:{label:'Gold to brown',colors:['#ffe063','#e5a42e','#b15d19','#5c2a12']},
  };
  let regionalPalette='purple';
  const colorsFor=key=>key==='regional'?regionalPalettes[regionalPalette].colors:palette;
  const gradientFor=key=>`linear-gradient(90deg,${colorsFor(key).join(',')})`;
  const missingColor='#858a93';
  const zeroSheddingColor='#e7eff5';
  function heatColor(value,min,max,key){
    if(value===null)return missingColor;
    if(key==='regional'&&value===0)return zeroSheddingColor;
    const colors=colorsFor(key);
    const position=(max===min?0:(value-min)/(max-min))*(colors.length-1);
    const index=Math.min(colors.length-2,Math.floor(position));
    const fraction=position-index;
    const channel=(color,i)=>parseInt(color.slice(1+i*2,3+i*2),16);
    return 'rgb('+[0,1,2].map(i=>Math.round(channel(colors[index],i)*(1-fraction)+channel(colors[index+1],i)*fraction)).join(',')+')';
  }

  function heatmap(key,title,rows,columns,valueAt,min,max,describe){
    const values=rows.map(row=>columns.map((column,x)=>valid(valueAt(row,column,x))));
    heatmaps.set(key,{dates:rows.map(row=>row.date),columns,values,min,max,describe});
    const dateTicks=[...new Set([0,.25,.5,.75,1].map(f=>Math.round(f*(rows.length-1))))];
    const axes=dateTicks.map((index,i)=>`<span style="top:${100*(index+.5)/rows.length}%"
      class="${i===0?'first':i===dateTicks.length-1?'last':''}">${escape(rows[index].date)}</span>`).join('');
    const labels=columns.map((column,index)=>key==='regional'||index%4===0||index===23
      ?`<span class="${key==='hourly'&&index%8!==0&&index!==23?'minor':''}" style="left:${100*(index+.5)/columns.length}%">${escape(column)}</span>`:'').join('');
    const regional=key==='regional';
    const zero=regional?`<span class="demand-heatmap-swatch" data-highlight="zero"><span class="demand-heatmap-solid" style="background:${zeroSheddingColor}"></span>0%</span>`:'';
    const scale=min===max
      ? (regional?'':`<span>${format(min)} MW</span><span class="demand-heatmap-solid" style="background:${heatColor(min,min,max,key)}"></span>`)
      : `<span>${regional?'Above 0%':format(min)+' MW'}</span><span class="demand-heatmap-gradient"
          style="background:${gradientFor(key)}"${regional?' title="Hover to highlight cells in this percentage band"':''}></span><span>${format(max)}${regional?'%':' MW'}</span>`;
    const detail=`<p class="demand-heatmap-detail" id="${key}-heatmap-detail" aria-live="polite">Hover, tap or use arrow keys to read a value.</p>`;
    const picker=regional?`<select class="demand-heatmap-palette" aria-label="Color scheme">
      ${Object.entries(regionalPalettes).map(([id,{label}])=>
        `<option value="${id}"${id===regionalPalette?' selected':''}>${label}</option>`).join('')}
    </select>`:'';
    const legend=`<div class="${regional?'':'note '}demand-heatmap-scale">${zero}${scale}
      <span class="demand-heatmap-swatch"${regional?' data-highlight="missing"':''}><span class="demand-heatmap-missing"
        style="background:${missingColor}"></span>${regional?'Share unavailable':'Missing'}</span>${picker}</div>`;
    return `<div class="demand-heatmap" data-demand-heatmap="${key}">
      ${regional?`<div class="demand-heatmap-header">${detail}${legend}</div>`:detail}
      <div class="demand-heatmap-grid">
        <div class="demand-heatmap-dates" aria-hidden="true">${axes}</div>
        <div class="demand-heatmap-plot">
          <canvas width="${columns.length}" height="${rows.length}" tabindex="0" aria-label="${escape(title)}"
            aria-describedby="${key}-heatmap-detail">Use the readout above for individual values.</canvas>
          <span class="demand-heatmap-crosshair" aria-hidden="true" hidden></span>
        </div>
        <div class="demand-heatmap-labels ${key}" aria-hidden="true">${labels}</div>
      </div>
      ${regional?'':legend}
    </div>`;
  }

  function demandPanels(rows,plot){
    const seasons=seasonalSamples(rows);
    const samples=seasons.flatMap(season=>season.samples);
    const coverage=`${format(samples.length)} / ${format(rows.length*24)} reported hours`;
    if(!samples.length)return {
      hourly:panel('Hourly demand heatmap','Generation-side demand · NLDC P4',`<p class="note">No exact-hour demand readings are available for this window. ${coverage}.</p>`),
      duration:panel('Seasonal load-duration curves','NLDC P4 · Generation-side demand','<p>No exact-hour demand readings are available for this window.</p>'),
    };
    const min=Math.min(...samples),max=Math.max(...samples);
    const heat=heatmap('hourly','Hourly generation-side demand in MW',rows,HOURS,(row,_,hour)=>row.hourly_demand_mw?.[hour],min,max);
    const available=seasons.filter(season=>season.samples.length);
    const ranks=Array.from({length:101},(_,rank)=>({label:`${rank}% through ranked reported hours`,rank}));
    const series=available.map(season=>({
      name:season.name,color:season.color,
      value:({rank})=>season.samples[Math.min(season.samples.length-1,Math.floor(rank*season.samples.length/100))],
    }));
    const ticks=[0,25,50,75,100].map(index=>({index,label:index+'%',sparse:true}));
    const curve=plot(ranks,series,'Seasonal load-duration curves','MW',false,{key:'seasonal-load-duration',ticks,fitExtent:true,nonNegative:true});
    const seasonCoverage=seasons.filter(season=>season.expected).map(season=>`${season.name} ${format(season.samples.length)} / ${format(season.expected)} h`).join(' · ');
    return {hourly:panel('Hourly demand heatmap',`NLDC P4 · Generation-side demand · Bangladesh time · ${coverage}`,heat),
      duration:panel('Seasonal load-duration curves','NLDC P4 · Generation-side demand',
        '<p class="demand-curve-description">Each line ranks a season’s reported hourly demand from highest to lowest within the selected dates. At 25% on the horizontal axis, the plotted MW level was met or exceeded in about a quarter of that season’s reported hours. Compare lines at the same percentage to see which season carried higher demand for that share of hours. A steep drop near the left shows how far the highest peaks rise above more typical demand.</p>'
        +curve+`<p class="note">Coverage: ${seasonCoverage}. Seasons: winter Dec–Feb, pre-monsoon Mar–May, monsoon Jun–Sep, post-monsoon Oct–Nov. Curves use only observed hours in the selected window.</p>`)};
  }

  function sheddingPanel(rows,names){
    const ranked=persistence(rows,names);
    const table=`<div class="table-wrap"><table class="demand-persistence-table">
      <caption>Regional load shedding over the selected dates</caption>
      <thead><tr><th scope="col">Region</th><th scope="col">% of reported days with load shedding</th>
        <th scope="col">No. of days with load shedding</th><th scope="col">Reported days / selected days</th>
        <th scope="col">Load shed as % of regional demand</th></tr></thead>
      <tbody>${ranked.map(row=>`<tr><th scope="row">${escape(row.name)}</th>
        <td>${row.share===null?'—':`${format(row.share)}%`}</td>
        <td>${row.observed?row.positive:'—'}</td><td>${row.observed} / ${rows.length}</td>
        <td>${row.demandShare===null?'—':`${format(row.demandShare)}%`}</td></tr>`).join('')}</tbody>
      </table></div>`;
    const shedShare=(row,name)=>{
      const shed=row.regional_shed_mw?.[name],demand=row.regional_demand_mw?.[name];
      return reading(shed)&&reading(demand)&&demand>0?100*(shed/demand):null;
    };
    const maximum=Math.max(0,...rows.flatMap(row=>names.map(name=>shedShare(row,name))).filter(reading));
    const describe=(y,x,share)=>{
      const shed=valid(rows[y].regional_shed_mw?.[names[x]]);
      if(shed===null)return 'Load shed not reported';
      return share===null?`${format(shed)} MW shed · share unavailable`:`${format(share)}% of demand · ${format(shed)} MW shed`;
    };
    return panel('Regional shedding persistence','NLDC P1 · One reported evening-peak observation per region per operating day',
      heatmap('regional','Regional evening-peak shedding as a percentage of demand',rows,names,shedShare,0,maximum,describe)
      +'<p class="note">Heatmap colors show reported load shed divided by reported regional demand at the same evening peak. The scale runs to the highest share in the selected window.</p>'
      +table+`<div class="note"><strong>How to read the table</strong>
        <ul>
          <li><strong>Region</strong> identifies the planning region listed in the NLDC report.</li>
          <li><strong>% of reported days with load shedding</strong> divides the number of days with positive evening-peak shedding by the number of days with a reported evening-peak shedding value, including reported zeros.</li>
          <li><strong>No. of days with load shedding</strong> counts operating days with reported evening-peak shedding above 0 MW.</li>
          <li><strong>Reported days / selected days</strong> shows how many days have a reported evening-peak shedding value for that region out of all operating days in the selected date range.</li>
          <li><strong>Load shed as % of regional demand</strong> divides the sum of evening-peak load shed MW by the sum of evening-peak regional demand MW and multiplies by 100. Both sums use the same days, with a reported shedding value and positive reported demand. A dash means the percentage is unavailable.</li>
        </ul></div>`);
  }

  function bind(host){
    host.querySelectorAll('[data-demand-heatmap]').forEach(section=>{
      const key=section.dataset.demandHeatmap;
      const data=heatmaps.get(key);
      const canvas=section.querySelector('canvas');
      const detail=section.querySelector('.demand-heatmap-detail');
      const crosshair=section.querySelector('.demand-heatmap-crosshair');
      const context=canvas.getContext('2d');
      const width=canvas.width,height=canvas.height;
      let highlighted=null;
      let cellDetail=detail.textContent;
      const bandCount=10;
      const bandFor=fraction=>Math.max(0,Math.min(bandCount-1,Math.floor(fraction*bandCount)));
      function paint(){
        context.clearRect(0,0,width,height);
        data.values.forEach((row,y)=>row.forEach((value,x)=>{
          const band=value===null?'missing':value===0?'zero':bandFor(value/data.max);
          context.globalAlpha=highlighted===null||highlighted===band?1:.18;
          context.fillStyle=heatColor(value,data.min,data.max,key);
          context.fillRect(x,y,1,1);
        }));
        context.globalAlpha=1;
      }
      paint();
      const picker=section.querySelector('.demand-heatmap-palette');
      const gradient=section.querySelector('.demand-heatmap-gradient');
      function highlight(band){
        if(highlighted===band)return;
        highlighted=band;
        if(band===null){
          detail.textContent=cellDetail;
        }else if(band==='zero'||band==='missing'){
          detail.textContent=band==='zero'?'Highlighting 0% load shedding':'Highlighting unavailable shares';
        }else{
          const lower=format(data.max*band/bandCount),upper=format(data.max*(band+1)/bandCount);
          detail.textContent=`Highlighting ${lower}–${upper}% of regional demand`;
        }
        crosshair.hidden=true;
        paint();
      }
      if(key==='regional'){
        gradient?.addEventListener('pointermove',event=>{
          const area=gradient.getBoundingClientRect();
          highlight(bandFor((event.clientX-area.left)/area.width));
        });
        gradient?.addEventListener('pointerleave',()=>highlight(null));
        section.querySelectorAll('[data-highlight]').forEach(swatch=>{
          swatch.addEventListener('pointerenter',()=>highlight(swatch.dataset.highlight));
          swatch.addEventListener('pointerleave',()=>highlight(null));
        });
      }
      picker?.addEventListener('change',()=>{
        regionalPalette=picker.value;
        if(gradient)gradient.style.background=gradientFor(key);
        paint();
      });

      let x=0,y=0;
      const clamp=(value,size)=>Math.max(0,Math.min(size-1,value));
      function select(column,day){
        x=clamp(column,width);
        y=clamp(day,height);
        const value=data.values[y][x];
        const description=data.describe?.(y,x,value)??(value===null?'Not reported':format(value)+' MW');
        cellDetail=`${data.dates[y]} · ${data.columns[x]} · ${description}`;
        if(highlighted===null)detail.textContent=cellDetail;
        crosshair.style.setProperty('--x',`${100*(x+.5)/width}%`);
        crosshair.style.setProperty('--y',`${100*(y+.5)/height}%`);
        crosshair.hidden=false;
      }
      function point(event){
        const area=canvas.getBoundingClientRect();
        const column=Math.floor((event.clientX-area.left)/area.width*width);
        const day=Math.floor((event.clientY-area.top)/area.height*height);
        if(crosshair.hidden||column!==x||day!==y)select(column,day);
      }
      canvas.addEventListener('pointermove',point);
      canvas.addEventListener('pointerdown',point);
      canvas.addEventListener('focus',()=>select(x,y));
      canvas.addEventListener('keydown',event=>{
        const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
        const delta=deltas[event.key];
        if(!delta)return;
        event.preventDefault();
        select(x+delta[0],y+delta[1]);
      });
    });
  }
  root.BEGDDemandTrends={demandPanels,sheddingPanel,bind,seasonalSamples,persistence};
})(typeof window==='undefined'?globalThis:window);
