"""Build a local BPDB-cost demo over the public deployed dashboard snapshots."""
import argparse
import json
import pathlib
import shutil
from bpdb_costs import fetch

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://satyakibanik.github.io/Projects/begd/'


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default='.cache/cost-preview')
    parser.add_argument('--live-data',type=pathlib.Path)
    parser.add_argument('--trends-data',type=pathlib.Path)
    args=parser.parse_args()
    target=pathlib.Path(args.output).resolve()/'begd'
    target.mkdir(parents=True,exist_ok=True)
    shutil.copytree(ROOT/'begd',target,dirs_exist_ok=True)
    live=args.live_data.read_bytes() if args.live_data else fetch(BASE+'live-data.js')
    trends=args.trends_data.read_bytes() if args.trends_data else fetch(BASE+'trends-data.json')
    (target/'live-data.js').write_bytes(live)
    (target/'trends-data.json').write_bytes(trends)
    text=live.decode();bundle=json.loads(text[text.index('=')+1:].strip().rstrip(';'))
    (target/'current-day.json').write_text(json.dumps(bundle['current_day']))
    index=(target/'index.html').read_text().replace('<script src="app.js?v=','<script src="live-data.js"></script><script src="static-api.js?v=current-day-v2"></script><script src="app.js?v=',1)
    (target/'index.html').write_text(index)
    print(f'Local demo: {target.parent}; serve with python -m http.server --directory {target.parent} 8087')


if __name__=='__main__':main()
