/* Fiscal-year transmission statistics from Power Grid Bangladesh PLC. */
(function(root){
  const annualReport='https://erp.powergrid.gov.bd/web/files/download?location=erp%2Fweb%2Freport_docs%2F4755.pdf&title=Annual+Report+%28Including+Directors+Report%29+2024-2025';
  // Power Grid FY 2024–25 annual report, pp. 32 and 109. Transmission sector, including other owners.
  // Class values match the report's p. 32 MVA breakdown. HVDC MW is excluded from the AC chart.
  const network=[
    [2016,221,3171,6397,520,9375,12420],
    [2017,560,3171,6504,1690,9675,13365],
    [2018,560,3325,6796,2210,9675,15046],
    [2019,698,3372,7329,3900,13135,22642],
    [2020,861,3500,7758,5070,13385,25885],
    [2021,950,3658,8228,5070,16145,29189],
    [2022,1494,4018,8377,7800,17165,31717],
    [2023,1972,4236,8509,10990,17765,32770],
    [2024,2497,4263,8864,15260,19065,34044],
    [2025,3115,4752,9366,17810,22255,37733],
  ].map(([year,...measurements])=>({date:year+'-06-30',fiscal_year:(year-1)+'–'+String(year).slice(-2),measurements}));

  const transmissionMilestones=[
    ['20 Oct 2024','Bogura West–Barapukuria','224 circuit-km · built for 400 kV · energized at 230 kV'],
    ['30 Apr 2025','Aminbazar–Kaliakoir','50.8 circuit-km · 400 kV'],
    ['2 Jun 2025','Rooppur–Gopalganj','158 circuit-km · 400 kV'],
  ];

  const link=(url,label)=>`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  const panel=(id,title,caption,body)=>`<section id="${id}" class="panel full"><div class="panel-head"><div><h2>${title}</h2><p>${caption}</p></div></div>${body}</section>`;
  const colors=['#aa5e24','#4e79a7','#34826d'];
  function render(plot){
    const fiscalTicks=network.map((row,index)=>({index,label:row.fiscal_year,sparse:index!==0&&index!==network.length-1}));
    const chart=(names,offset,title,unit,key)=>plot(network,names.map((name,index)=>({
      name,color:colors[index],value:row=>row.measurements[offset+index]
    })),title,unit,false,{key,ticks:fiscalTicks,nonNegative:true});
    return panel('transmission-buildout','Transmission buildout','Power Grid Bangladesh · fiscal-year-end snapshots · includes other entities',
      chart(['400 kV','230 kV','132 kV'],0,'Transmission lines by voltage','circuit km','transmission-lines')+
      '<h3>AC grid substation capacity</h3>'+chart(['400/230 and 400/132 kV','230/132 and 230/33 kV','132/33 kV'],3,'AC grid substation capacity by voltage','MVA','transmission-substations')+
      `<h3>Selected line commissioning milestones</h3><ul>${transmissionMilestones.map(([date,name,detail])=>`<li>${date} · <strong>${name}</strong> · ${detail}</li>`).join('')}</ul>
      <p class="note" data-keep-visible>HVDC is reported separately in MW. The year-by-year table labels the AC columns MW, while the annual report’s matching FY2024–25 figures by voltage class are stated in MVA. ${link(annualReport,'Annual Report (Including Directors Report) 2024–2025, pp. 32 and 109–111')}</p>`);
  }

  root.BEGDGridDevelopment={render};
})(window);
