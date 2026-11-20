// Deliberately fabricated data: these values do not describe any real grid asset or operating day.
const date='2026-01-15',nextDate='2026-01-16';
const hours=Array.from({length:24},(_,hour)=>({time:String(hour).padStart(2,'0')+':00',generation_mw:800+hour*5,demand_mw:850+hour*5,shed_mw:50}));
const fuels={Gas:8000,Coal:6000,HFO:3000,HSD:100,Hydro:1200,Solar:500,Imports:2600,Wind:200};
const plant={name:'Synthetic plant A',producer:'Synthetic producer',region:'Synthetic region',fuel:'Gas',status:'operating',installed_capacity_mw:100,capacity_mw:100,present_capacity_mw:90,peak_mw:80,peak_generation_mw:80,energy_mwh:1500,operating_hours:24,remarks:'Browser test fixture',hourly:hours.map(row=>({time:row.time,mw:60}))};
const sources=[{key:'gas_mw',name:'Synthetic gas'},{key:'coal_mw',name:'Synthetic coal'},{key:'shortage_mw',name:'Shortage'}];
const curve=Array.from({length:48},(_,index)=>({time:String(Math.floor(index/2)).padStart(2,'0')+':'+(index%2?'30':'00'),gas_mw:500+index,coal_mw:300+index,shortage_mw:50}));
const routes=['Synthetic route A','Synthetic route B'].map((name,index)=>({name,date,energy_mwh:1000+index*100,hourly:hours.map(row=>({time:row.time,mw:40+index*10}))}));
const report={date,published_date:nextDate,report_id:'synthetic-1',source_file:'synthetic.xlsx',report_name:'Synthetic browser fixture',timezone:'Asia/Dhaka',
  summary:{peak_demand_mw:965,peak_generation_mw:915,peak_time:'23:00',energy_mwh:21600,unserved_mwh:1200,temperature_c:30,import_mwh:2600},fuels,hourly:hours,
  grid_generation:hours.map(row=>({time:row.time,east_grid_mw:row.generation_mw*.6,west_grid_mw:row.generation_mw*.4,total_mw:row.generation_mw})),
  en_curve:{date,sources,hourly:curve,totals:{energy_generated_mwh:21600,energy_not_served_mwh:1200,total_requirement_mwh:22800}},
  regions:[{name:'Synthetic region',energy_mwh:21600,fuels,demand_mw:965,shed_mw:50}],plants:[plant],plant_units:[plant],imports:routes,
  substations:[{name:'Synthetic station A',load_mw:50,time:'18:00'}],voltages:[{name:'Synthetic station A',voltage_class:'132 kV',max_kv:134,max_time:'04:00',min_kv:130,min_time:'18:00'}],
  operations:{planned_shutdowns:[],forced_shutdowns:[],events:[],ewic:hours.map(row=>({time:row.time,ishwardi_ghorashal:100,sirajganj_sreepur:50,gopalganj_aminbazar:-20})),east_west:{energy_east_to_west_kwh:1000,energy_west_to_east_kwh:2000,peak_west_to_east_mw:100,max_west_to_east_mw:100}},
  forecast:{date:nextDate,plants:[{...plant,forecast_day_mw:90,forecast_evening_mw:90,effective_day_mw:85,effective_evening_mw:85}],totals:{forecast_day_mw:90,forecast_evening_mw:90,effective_day_mw:85,effective_evening_mw:85},demand_hourly:hours.map(row=>({time:row.time,demand_mw:row.demand_mw+10}))},
};
const current_day={date,today_date:date,source_dates:{demand:date,generation:date,imports:date},updated_at:date+'T18:00:00Z',delivery:'test',source_urls:[],
  demand_hourly:hours.map(row=>({time:row.time,demand_mw:row.demand_mw,supply_mw:row.generation_mw,shed_mw:row.shed_mw})),
  generation_hourly:hours.map(row=>({time:row.time,total_mw:row.generation_mw,gas_mw:400,liquid_mw:100,coal_mw:200,hydro_mw:50,solar_mw:10,wind_mw:5})),imports:routes};
module.exports={report,current_day};
