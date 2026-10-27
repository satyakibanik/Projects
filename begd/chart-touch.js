/* Touch inspection shares the mouse/keyboard chart models; vertical gestures remain page scrolling. */
(function(root){
  let active=null;
  function position(tip,event){
    tip.classList.add('is-touch-tooltip');
    const viewport=root.visualViewport;
    const left=viewport?.offsetLeft||0,top=viewport?.offsetTop||0;
    const width=viewport?.width||root.innerWidth,height=viewport?.height||root.innerHeight;
    const bounds=tip.getBoundingClientRect();
    tip.style.left=Math.max(left+8,Math.min(event.clientX-bounds.width/2,left+width-bounds.width-8))+'px';
    tip.style.top=Math.max(top+8,Math.min(event.clientY-bounds.height-20,top+height-bounds.height-8))+'px';
    tip.style.transform='none';
  }
  function bind(svg,{tip,select,hide}){
    let start=null;
    const inspector={svg,tip,pinned:false,event:null,clear(){
      inspector.pinned=false;start=null;tip.classList.remove('is-touch-tooltip');
      svg.classList.remove('is-touch-selected');hide();if(active===inspector)active=null;
    }};
    const inspect=event=>{
      if(active&&active!==inspector)active.clear();
      active=inspector;inspector.pinned=true;inspector.event=event;
      svg.classList.add('is-touch-selected');select(event);
    };
    svg.addEventListener('pointerdown',event=>{
      if(event.pointerType!=='touch'&&event.pointerType!=='pen'){if(active)active.clear();return}
      start={x:event.clientX,y:event.clientY};inspect(event);
    });
    svg.addEventListener('pointermove',event=>{
      if(!start||!inspector.pinned)return;
      const dx=Math.abs(event.clientX-start.x),dy=Math.abs(event.clientY-start.y);
      if(dy>8&&dy>dx){inspector.clear();return}
      if(dx>4)inspect(event);
    });
    svg.addEventListener('pointerup',()=>{start=null});
    svg.addEventListener('pointercancel',()=>inspector.clear());
    // Some mobile browsers synthesize only a click after a tap.
    svg.addEventListener('click',event=>{
      if(event.pointerType==='touch'||event.pointerType==='pen')inspect(event);
    });
    svg.addEventListener('keydown',event=>{if(event.key==='Escape')inspector.clear()});
    return inspector;
  }
  document.addEventListener('pointerdown',event=>{
    if(active&&!active.svg.contains(event.target)&&!active.tip.contains(event.target))active.clear();
  });
  root.addEventListener('scroll',()=>active?.clear(),{passive:true});
  root.addEventListener('resize',()=>active?.clear());
  root.addEventListener('hashchange',()=>active?.clear());
  root.BEGDChartTouch={bind,position};
})(window);
