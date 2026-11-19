/* Scores immutable BEGD forecasts against exact-hour ERP observations. */
(function(root){
  const dayMs=86400000;
  const hours=Array.from({length:24},(_,index)=>String(index).padStart(2,'0')+':00');
  const valid=value=>Number.isFinite(value)&&value>=0;
  const midnight=date=>Date.parse(date+'T00:00:00+06:00');
  const bangladeshOffsetMs=6*3600000;

  function actualByHour(rows,date,key){
    const values=new Map();
    for(const row of rows||[]){
      if((row.date&&row.date!==date)||!hours.includes(row.time)||!valid(row[key]))continue;
      const value=row[key];
      values.set(row.time,values.has(row.time)&&values.get(row.time)!==value?null:value);
    }
    return values;
  }

  function pairs(rows,date,key,predictions){
    const actual=actualByHour(rows,date,key);
    return hours.flatMap((time,index)=>{
      const observed=actual.get(time), forecast=predictions.get(time);
      return valid(observed)&&valid(forecast)?[{index,observed,forecast,error:forecast-observed}]:[];
    });
  }

  function issuedBeforeDay(forecast,date){
    const issue=Date.parse(forecast?.issued_at);
    return forecast?.publication_kind==='daily'&&Number.isFinite(issue)&&issue<midnight(date);
  }

  function summarize(matches){
    const count=matches.length;
    if(!count)return {count,mae:null,bias:null};
    return {count,mae:matches.reduce((sum,row)=>sum+Math.abs(row.error),0)/count,
      bias:matches.reduce((sum,row)=>sum+row.error,0)/count};
  }

  function peakError(matches){
    if(matches.length!==24)return null;
    const peak=key=>matches.reduce((best,row)=>row[key]>best[key]?row:best).index;
    return peak('forecast')-peak('observed');
  }

  function evaluate(days){
    const byHour=hours.map((time,index)=>({time,...summarize(days.flatMap(day=>day.pairs.filter(row=>row.index===index)))}));
    const daily=days.map((day,index)=>{
      const rolling=summarize(days.slice(Math.max(0,index-6),index+1).flatMap(item=>item.pairs));
      return {...summarize(day.pairs),rolling,peak:peakError(day.pairs),date:day.date,index};
    });
    return {byHour,daily,coverage:summarize(days.flatMap(day=>day.pairs))};
  }

  function render({bundle,live,target,model,cohort,validForecast}){
    const history=live?.forecast_history||{};
    const today=live?.today_date;
    const key=target==='demand'?'demand_mw':'generation_mw';
    const modelKey=target+'_models';
    const dates=cohort==='study'?bundle.dates.filter(date=>!bundle.forward_dates.includes(date)):
      [...new Set([...Object.keys(history),...(today?[today]:[])])].filter(date=>{
        const forecast=date===today?live.independent_forecast:history[date]?.forecast;
        return (!today||date<=today)&&validForecast(forecast,date)&&issuedBeforeDay(forecast,date);
      }).sort();
    const days=[],pairedDays=[];
    for(let stamp=midnight(dates[0]);stamp<=midnight(cohort==='issued'?(today||dates.at(-1)):dates.at(-1));stamp+=dayMs){
      const date=new Date(stamp+bangladeshOffsetMs).toISOString().slice(0,10);
      const entry=date===today?live:history[date];
      const forecast=date===today?entry?.independent_forecast:entry?.forecast;
      const useStudy=cohort==='study';
      const studyRows=useStudy&&dates.includes(date)?bundle.days[date]||[]:[];
      const issuedRows=!useStudy&&validForecast(forecast,date)&&issuedBeforeDay(forecast,date)?forecast.hourly:[];
      const actual=useStudy?studyRows:entry?.[target+'_hourly'];
      const actualKey=!useStudy&&target==='generation'?'total_mw':key;
      const predictions=new Map((useStudy?studyRows:issuedRows).map(row=>[row.time,row[modelKey]?.[model]]));
      days.push({date,pairs:pairs(actual,date,actualKey,predictions)});
      const enhanced=new Map(issuedRows.map(row=>[row.time,row['adjusted_'+target+'_mw']]));
      const comparable=pairs(actual,date,actualKey,enhanced)
        .filter(row=>valid(predictions.get(hours[row.index])));
      if(model===forecast?.models?.[target]&&comparable.length)pairedDays.push({date,comparable,
        original:comparable.map(row=>({...row,error:predictions.get(hours[row.index])-row.observed}))});
    }
    const {daily,byHour,coverage}=evaluate(days);
    const controls=`<div class="toolbar">
      <label>Target <select data-performance="target"><option value="demand"${target==='demand'?' selected':''}>Demand · ERP substation side</option><option value="generation"${target==='generation'?' selected':''}>Generation · ERP including imports</option></select></label>
      <label>Forecast history <select data-performance="cohort"><option value="issued"${cohort==='issued'?' selected':''}>Forecasts issued in advance</option><option value="study"${cohort==='study'?' selected':''}>Historical model backtest</option></select></label></div>`;
    const series=(key,name,color,options={})=>({key,name,color,...options});
    const figure=(title,body,description)=>`<section class="forecast-subplot forecast-performance-chart"><h3>${title}</h3><p class="forecast-chart-description">${description}</p>${body}</section>`;
    let charts='<p role="status">No matched forecast and ERP hours for this selection.</p>';
    if(coverage.count){
      const rows=daily.map(row=>({...row,label:shortDate(row.date),rollingMae:row.count?row.rolling.mae:null,rollingBias:row.count?row.rolling.bias:null}));
      const tickIndices=[...new Set([0,1,2,3].map(part=>Math.round(part*(rows.length-1)/3)))];
      const dateOptions={xKey:'index',xMax:Math.max(1,rows.length-1),xTicks:tickIndices.map(index=>({index,label:rows[index].date.slice(5)})),preserveGaps:true,contextLabel:'Operating date · Bangladesh time'};
      const renderChart=(key,values,options)=>chart(values,options.series,{...options.axis,key:'forecast-performance:'+target+':'+key});
      const rollingChart=renderChart('accuracy',rows,{axis:dateOptions,series:[
        series('mae','Daily MAE','#6587ab',{pointsOnly:true}),series('rollingMae','7-day MAE','#29856b')
      ]});
      const biasChart=renderChart('bias',rows,{axis:dateOptions,series:[series('rollingBias','7-day mean forecast error','#b96924')]});
      const latest=rows.filter(row=>row.count).at(-1);
      const worstHour=byHour.filter(row=>row.count).reduce((worst,row)=>row.mae>worst.mae?row:worst);
      const peaks=rows.filter(row=>row.peak!==null);
      const peakMatches=peaks.filter(row=>row.peak===0).length;
      const peakInsight=peaks.length?`${peakMatches} of ${peaks.length} complete days had the exact peak hour.`:'Peak timing requires all 24 hourly pairs.';
      const hourlyChart=renderChart('hourly',byHour,{axis:{preserveGaps:true},series:[series('mae','MAE by clock hour','#4e79a7')]});
      const completed=peaks.length;
      const peakChart=completed?renderChart('peak',rows,{axis:{...dateOptions,unit:'hours'},series:[series('peak','Forecast peak − observed peak','#8d6bb3',{pointsOnly:true})]}):'<p>No complete 24-hour pairs available.</p>';
      charts=`<p class="note" data-keep-visible><strong>${fmt(coverage.count)} matched hours</strong> across ${rows.filter(row=>row.count).length} of ${rows.length} days · ${esc(shortDate(rows[0].date))} – ${esc(shortDate(rows.at(-1).date))} · Overall MAE ${fmt(coverage.mae,1)} MW · Bias ${fmt(coverage.bias,1)} MW</p>
        ${figure('Daily error and 7-day average',rollingChart,`The dots show each day’s mean absolute error (MAE). Follow the green line to see whether errors are getting larger or smaller. The 7-day MAE through ${esc(latest.label)} was <strong>${fmt(latest.rollingMae,1)} MW</strong> across ${latest.rolling.count} matched hours.`)}
        ${figure('7-day forecast bias',biasChart,`Values above zero indicate that BEGD generally forecast too high. Values below zero indicate that it forecast too low. Through ${esc(latest.label)}, bias was <strong>${fmt(latest.rollingBias,1)} MW</strong>.`)}
        ${figure('Mean absolute error by clock hour',hourlyChart,`Look for the hours when BEGD typically missed by the most. In this selection, <strong>${worstHour.time} Bangladesh time</strong> had the highest average error (${fmt(worstHour.mae,1)} MW across ${worstHour.count} observations). Check the coverage table when comparing hours.`)}
        ${figure('Peak timing error',peakChart,`Each dot shows how many hours early (negative) or late (positive) the forecast peak was. Zero means the hour matched. <strong>${peakInsight}</strong> Ties use the earliest hour.`)}
        <details><summary>Daily and hourly coverage</summary><div class="table-wrap"><table><thead><tr><th>Operating date</th><th>Matched hours</th><th>7-day matched hours</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${row.date}</td><td>${row.count}/24</td><td>${row.rolling.count}</td></tr>`).join('')}</tbody></table></div>
        <div class="table-wrap"><table><thead><tr><th>Bangladesh hour</th><th>Matched observations</th><th>MAE (MW)</th></tr></thead><tbody>${byHour.map(row=>`<tr><td>${row.time}</td><td>${row.count}</td><td>${row.mae===null?'—':fmt(row.mae,1)}</td></tr>`).join('')}</tbody></table></div></details>`;
    }
    const enhancedPairs=pairedDays.flatMap(day=>day.comparable);
    const originalPairs=pairedDays.flatMap(day=>day.original);
    const enhancedScore=summarize(enhancedPairs),originalScore=summarize(originalPairs);
    const comparison=cohort==='issued'?(`<section class="forecast-subplot"><h3>Original vs adjusted BEGD forecast</h3>`+
      (enhancedScore.count?`<p>${fmt(enhancedScore.count)} common hours across ${pairedDays.length} days · original MAE ${fmt(originalScore.mae,1)} MW · adjusted MAE ${fmt(enhancedScore.mae,1)} MW.</p>
        <div class="table-wrap"><table><thead><tr><th>Operating date</th><th>Hours</th><th>Original MAE (MW)</th><th>Adjusted MAE (MW)</th></tr></thead><tbody>${pairedDays.map(day=>`<tr><th scope="row">${esc(shortDate(day.date))}</th><td>${day.comparable.length}</td><td>${fmt(summarize(day.original).mae,1)}</td><td>${fmt(summarize(day.comparable).mae,1)}</td></tr>`).join('')}</tbody></table></div>`:
        '<p>Matched scores appear once an adjusted rank-one forecast and its ERP readings are available.</p>')+'</section>'):'';
    const scope=cohort==='issued'?'Only forecasts issued before 00:00 Bangladesh time enter this score.':
      'Scores use bundled historical model-study rows. This cohort represents retrospective evaluation.';
    return `<section class="panel full independent-study-panel forecast-performance-panel" id="forecast-performance" aria-labelledby="forecast-performance-title"><div class="panel-head"><div><h2 id="forecast-performance-title">Forecast performance over time</h2><p data-keep-visible>BEGD forecasts scored against ERP actuals · ${esc(model)}</p></div></div><div class="forecast-body">${controls}<p class="note" data-keep-visible>${scope} The model follows the BEGD selector above. PGCB scenarios are scored in the daily comparison above.</p>${comparison}${charts}</div></section>`;
  }

  root.BEGDForecastPerformance={render,issuedBeforeDay,pairs,evaluate};
})(window);
