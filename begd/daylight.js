/* Date-specific daylight at Dhaka (23.8103 N, 90.4125 E), UTC+6.
 * NOAA solar equations: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 * Standard apparent horizon: 90.833 degrees. Estimated, not observed times.
 */
(function(root){
 const radians=Math.PI/180, cache=new Map();
 function times(date){
  if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date))return null;
  if(cache.has(date))return cache.get(date);
  const stamp=Date.parse(date+'T12:00:00Z');
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==date)return null;
  const year=Number(date.slice(0,4)),start=Date.UTC(year,0,1),days=(Date.UTC(year+1,0,1)-start)/86400000;
  const day=Math.floor((stamp-start)/86400000)+1,g=2*Math.PI/days*(day-1);
  const equation=229.18*(.000075+.001868*Math.cos(g)-.032077*Math.sin(g)-.014615*Math.cos(2*g)-.040849*Math.sin(2*g));
  const decl=.006918-.399912*Math.cos(g)+.070257*Math.sin(g)-.006758*Math.cos(2*g)+.000907*Math.sin(2*g)-.002697*Math.cos(3*g)+.00148*Math.sin(3*g);
  const lat=23.8103*radians;
  const angle=Math.acos(Math.cos(90.833*radians)/(Math.cos(lat)*Math.cos(decl))-Math.tan(lat)*Math.tan(decl))/radians;
  const noon=720-4*90.4125-equation+360;
  const result={date,sunrise:noon-4*angle,sunset:noon+4*angle};cache.set(date,result);return result;
 }
 const clock=minute=>{const n=Math.round(minute);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
 function shift(date,days){const t=Date.parse(date+'T12:00:00Z');return Number.isFinite(t)?new Date(t+days*86400000).toISOString().slice(0,10):null}
 const title=t=>`${t.date} · Dhaka · estimated sunrise ${clock(t.sunrise)}, sunset ${clock(t.sunset)} BST`;
 function bands(date,{left,right,top,bottom,maxMinute=1440}={}){
  if(!times(date)||![left,right,top,bottom,maxMinute].every(Number.isFinite)||right<=left||bottom<=top||maxMinute<=0)return '';
  let content='';
  const x=minute=>left+minute/maxMinute*(right-left);
  for(let offset=0;offset<maxMinute;offset+=1440){
   const t=times(shift(date,offset/1440));
   for(const [kind,a,b] of [['night',0,t.sunrise],['day',t.sunrise,t.sunset],['night',t.sunset,1440]]){
    const from=Math.max(0,offset+a),to=Math.min(maxMinute,offset+b);if(to<=from)continue;
    content+=`<rect class="daylight-${kind}" data-daylight-date="${t.date}" x="${x(from)}" y="${top}" width="${x(to)-x(from)}" height="${bottom-top}"><title>${title(t)}</title></rect>`;
   }
  }
  return `<g class="daylight-background" pointer-events="none" aria-hidden="true">${content}</g>`;
 }
 function dial(date,cx,cy,radius){
  const t=times(date);if(!t)return '';
  const point=minute=>{const a=minute/1440*2*Math.PI-Math.PI/2;return [cx+radius*Math.cos(a),cy+radius*Math.sin(a)]};
  const a=point(t.sunrise),b=point(t.sunset),large=t.sunset-t.sunrise>720?1:0;
  return `<g class="daylight-background" pointer-events="none" aria-hidden="true"><title>${title(t)}</title><circle class="daylight-night" cx="${cx}" cy="${cy}" r="${radius}"/><path class="daylight-day" d="M${cx},${cy} L${a.join(',')} A${radius},${radius} 0 ${large} 1 ${b.join(',')} Z"/></g>`;
 }
 function legend(date,{days=1}={}){
  if(!times(date))return '';
  const labels=Array.from({length:days},(_,i)=>{const t=times(shift(date,i));return `${days>1?t.date+' · ':''}sunrise ${clock(t.sunrise)} · sunset ${clock(t.sunset)}`}).join(' / ');
  return `<p class="daylight-key"><span><i class="daylight-day"></i>Day</span><span><i class="daylight-night"></i>Night</span><span>Dhaka · ${labels} BST · estimated</span></p>`;
 }
 root.BEGDDaylight={times,bands,dial,legend,shift};
 if(typeof module!=='undefined')module.exports=root.BEGDDaylight;
})(typeof window==='undefined'?globalThis:window);
