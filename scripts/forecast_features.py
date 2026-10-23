"""Independent daily features matching the Forecast_sb experiment.

No realtime observations or target-day PGCB scenarios enter these features.
"""
import datetime as dt
import numpy as np
LAGS=(2,3,7,14,21,28)
TARGETS=('demand','generation')
def shift(day, n):
    return (dt.date.fromisoformat(day)-dt.timedelta(days=n)).isoformat()

def eligible(days, day):
    cutoff = shift(day, 1)
    return all(shift(day, lag) in days and days[shift(day,lag)]['published_date'] <= cutoff
               for lag in set(LAGS) | {9})

def features(days, day, target):
    """24 direct horizons. No same-day or D-1 actuals enter these features."""
    if not eligible(days,day):
        raise ValueError(f'Unavailable lag inputs for {day}')
    d = dt.date.fromisoformat(day)
    rows = []
    for hour in range(24):
        values = [days[shift(day,lag)][target][hour] for lag in LAGS]
        other = 'generation' if target == 'demand' else 'demand'
        values += [days[shift(day,lag)][other][hour] for lag in (2,7)]
        for lag in (2,7):
            profile = days[shift(day,lag)][target]
            values += [float(profile.mean()), float(profile.max()), float(profile.min())]
        values += [np.sin(2*np.pi*hour/24),np.cos(2*np.pi*hour/24),
                   np.sin(4*np.pi*hour/24),np.cos(4*np.pi*hour/24),
                   np.sin(2*np.pi*d.timetuple().tm_yday/365.25),
                   np.cos(2*np.pi*d.timetuple().tm_yday/365.25)]
        values += [int(d.weekday()==i) for i in range(7)]
        rows.append(values)
    return np.asarray(rows)

class Dataset:
    def __init__(self,records,weather):
        self.days={};self.by_day={};self.weather=weather
        for rec in sorted(records,key=lambda r:(r['published_date'],str(r['report_id']))):
            rows=[r for r in rec['actual'] if r['time'] in {f'{h:02}:00' for h in range(24)}]
            if len(rows)!=24 or len({r['time'] for r in rows})!=24:
                continue
            rows.sort(key=lambda r:r['time'])
            if any(r.get(t) is None or not np.isfinite(r[t]) for r in rows for t in TARGETS):
                continue
            day=rec['operating_date']
            self.days[day]=dict(published_date=rec['published_date'],**{t:np.array([r[t] for r in rows]) for t in TARGETS})
            self.by_day[day]=rec
        self.strict_cache={};self.daily_cache={}
    def eligible(self,day):
        cutoff=shift(day,1)
        return all(shift(day,l) in self.days and self.days[shift(day,l)]['published_date']<=cutoff for l in (2,3,4,5,6,7,9,14,21,28))

    def training_days(self,origin,window=100):
        return [day for day in sorted(self.days) if day<origin and self.days[day]['published_date']<=shift(origin,1)
                and self.eligible(day)][-window:]

    def weather_day(self,day):
        result=np.array([self.weather[f'{day}T{h:02}:00'] for h in range(24)],dtype=float)
        if result.shape!=(24,20) or not np.isfinite(result).all():
            raise ValueError(f'Incomplete four-location 48h forecast weather for {day}')
        return result

    def strict(self,day,target):
        key=(day,target)
        if key in self.strict_cache:return self.strict_cache[key]
        if not self.eligible(day):raise ValueError(f'Unavailable independent inputs for {day}')
        base=features(self.days,day,target)
        weather=self.weather_day(day)
        weather2=self.weather_day(shift(day,2))
        other='generation' if target=='demand' else 'demand'
        d=dt.date.fromisoformat(day)
        rows=[]
        for hour in range(24):
            history=[self.days[shift(day,l)][t][hour] for t in (target,other) for l in (2,3,4,5,6,7,9,14,21,28)]
            history+=[self.days[shift(day,l)][target][(hour+offset)%24] for l in (2,7) for offset in (-2,-1,1,2)]
            history+=list(self.days[shift(day,2)][target])
            history+=[np.mean([self.days[shift(day,l)][target][hour] for l in (2,3,4)]),
                      self.days[shift(day,2)][target][hour]-self.days[shift(day,9)][target][hour]]
            for lag in (2,7):
                record=self.by_day[shift(day,lag)]
                history += [record['temperature_c'],record['energy_mwh']]
            # Prior-report availability concerns D-1, not the target-day scenario.
            record=self.by_day[shift(day,2)]
            availability=record['availability'] if record['availability_forecast_date']==shift(day,1) else {}
            history += [availability.get(k,np.nan) for k in ('forecast_day_mw','forecast_evening_mw','effective_day_mw','effective_evening_mw')]
            clock=[int(hour==h) for h in range(24)]
            clock += [np.sin(2*np.pi*hour/24)*int(d.weekday()==dow) for dow in range(7)]
            rows.append(list(base[hour])+history+list(weather[hour])+list(weather[hour]-weather2[hour])+
                        list(weather.mean(axis=0))+list(weather.max(axis=0))+clock)
        result=np.array(rows,dtype=float)
        self.strict_cache[key]=result
        return result

    def daily(self,day,target):
        key=(day,target)
        if key not in self.daily_cache:
            d=dt.date.fromisoformat(day)
            histories=np.concatenate([self.days[shift(day,l)][target] for l in (2,3,7,14)])
            weather=self.weather_day(day)
            weather_mean_by_variable=weather.reshape(24,4,5).mean(axis=1).ravel()
            self.daily_cache[key]=np.r_[histories,weather_mean_by_variable,weather.mean(axis=0),[int(d.weekday()==i) for i in range(7)]]
        return self.daily_cache[key]
