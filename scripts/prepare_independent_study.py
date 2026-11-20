#!/usr/bin/env python3
"""Prepare reproducible ERP labels and fixed-lead weather for the local study."""
import argparse
import hashlib
import json
from pathlib import Path

from daily_forecast import atomic_json, load_history, load_weather, shift
from erp_history import load_erp_history
from independent_study import weather_hourly


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook-records',type=Path,help='Reuse parsed workbook metadata; otherwise fetch public history')
    parser.add_argument('--weather-input',type=Path,help='Reuse checksummed four-location previous-runs or normalized hourly JSON')
    parser.add_argument('--cache',type=Path,default=Path('.cache/erp-study'))
    parser.add_argument('--start',default='2026-05-25')
    parser.add_argument('--end',default='2026-10-21')
    parser.add_argument('--forecast-date',help='Also obtain weather through this forward-preview date')
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    if args.workbook_records:
        records=json.loads(args.workbook_records.read_text())
    else:
        from build_pages_data import available_reports
        records,failures=load_history(available_reports(),args.cache,shift(args.end,-2))
        if failures:print('Workbook metadata omissions:',failures,flush=True)
    records=[r for r in records if args.start<=r['operating_date']<=args.end]
    if not records:raise ValueError('No workbook auxiliary metadata in the requested range')
    aligned,provenance=load_erp_history(records,args.start,args.end,args.cache)
    atomic_json(args.cache/'records.json',aligned)
    atomic_json(args.cache/'provenance.json',provenance)
    if args.weather_input:
        body=args.weather_input.read_bytes()
        weather=dict(hourly=weather_hourly(args.weather_input),source_input_sha256=hashlib.sha256(body).hexdigest(),
                     source='Open-Meteo archived GFS previous runs',lead_hours=48)
    else:
        weather=load_weather(shift(args.start,2),args.forecast_date or args.end,args.cache)
    atomic_json(args.cache/'weather.json',weather)
    print(f'Prepared {len(aligned)} ERP target days; omitted {len(provenance["rejected"])}. No models fitted.')


if __name__=='__main__':main()
