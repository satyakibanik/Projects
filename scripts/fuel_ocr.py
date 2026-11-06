"""Optional, conservative recovery of national totals from scanned GTCL reports.

The normal daily collector has no OCR dependency. Archive OCR accepts only one
unambiguous reporting date and a unique set of nine production components that
reconcile with the published national total. Sector values remain unavailable.
"""
from datetime import date, datetime, timedelta
import hashlib
import itertools
import json
from pathlib import Path
import re
import subprocess

PATTERNS = {**{c: rf'^Sub[ -]*total\s*\({c}\)' for c in ['A', 'B', 'C', 'E']},
            'D': r'^D\.\s*Santos', 'F': r'^F\.\s*NIKO', 'G': r'^G\.\s*Tullow',
            'MLNG': r'RLNG Intake.*MLNG', 'SLNG': r'^b\)\s*SLNG',
            'total': r'^(?:2\.?\s*)?Total Production\s*\('}


def observation_lines(observations):
    groups = []
    for item in sorted(observations, key=lambda x: -x['y']):
        if not groups or abs(item['y']-groups[-1][0]['y']) > .003:
            groups.append([item])
        else:
            groups[-1].append(item)
    return [(' '.join(x['text'] for x in sorted(g, key=lambda x: x['x'])), g) for g in groups]


def reconcile(observation_sets, url, sha256):
    slots = {key: set() for key in PATTERNS}
    dates = set()
    for observations in observation_sets:
        for text, group in observation_lines(observations):
            match = re.search(r'Reporting\s*Date\s*:\s*(\d{1,2})[- ]([A-Za-z]+)[- ](\d{4}|\d{2})\b', text, re.I)
            if match and min(x['confidence'] for x in group) >= .9:
                year = int(match[3]) + (2000 if len(match[3]) == 2 else 0)
                reporting = datetime.strptime(f'{match[1]}-{match[2][:3]}-{year}', '%d-%b-%Y').date()
                if date(2020, 1, 1) <= reporting <= date.today()+timedelta(days=1):
                    dates.add(reporting.isoformat())
            for key, pattern in PATTERNS.items():
                if re.search(pattern, text, re.I):
                    numbers = re.findall(r'(?<![\d.,])(\d+[.,]\d{2,4})(?![\d.,])', text)
                    numeric_observations = sorted([x for x in group if re.search(r'\d+[.,]\d{2,4}', x['text'])], key=lambda x: x['x'])
                    if numbers and numeric_observations and numeric_observations[-1]['confidence'] >= .9:
                        slots[key].add(int(round(float(numbers[-1].replace(',', '.'))*10000)))
    if len(dates) != 1:
        raise ValueError('OCR reporting date missing or inconsistent')
    if any(not values for values in slots.values()):
        raise ValueError('OCR lacks required labelled production figures: '+','.join(k for k, v in slots.items() if not v))
    if any(len(values) > 3 for values in slots.values()):
        raise ValueError('Too many OCR variants')
    keys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'MLNG', 'SLNG']
    solutions = []
    for values in itertools.product(*(sorted(slots[k]) for k in keys)):
        for total in slots['total']:
            if abs(sum(values)-total) <= 5:  # At most 0.0005 MMSCF of published rounding.
                solutions.append((values, total))
    if len(solutions) != 1:
        raise ValueError(f'OCR production sum has {len(solutions)} valid solutions')
    values, total = solutions[0]
    components = dict(zip(keys, [value/10000 for value in values]))
    total /= 10000
    lng = round(components['MLNG']+components['SLNG'], 4)
    if not 0 <= lng <= total <= 10000:
        raise ValueError('Implausible OCR gas supply')
    row = dict(date=next(iter(dates)), total=total, lng=lng, domestic=round(total-lng, 4),
               power_demand=None, power_supply=None, source='gtcl', url=url, sha256=sha256,
               extraction_method='ocr', ocr_validation='Nine production components reconcile to the national total within 0.0005 MMSCF')
    return row, dict(production_components=components, validation_difference=round(sum(components.values())-total, 5))


def parse_scanned_gtcl(pdf_path, url, program, cache):
    import pdfplumber
    key = hashlib.sha256(url.encode()).hexdigest()
    observations = []
    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        crop = page.crop((0, 0, page.width, page.height*.65))
        for resolution in [120, 220]:
            image = cache / (key+f'-ocr-{resolution}.png')
            saved = cache / (key+f'-ocr-{resolution}.json')
            if saved.exists():
                result = json.loads(saved.read_text())
            else:
                crop.to_image(resolution=resolution).save(image)
                result = json.loads(subprocess.run([str(program), str(image)], check=True,
                                                  capture_output=True, timeout=45).stdout)
                saved.write_text(json.dumps(result))
            observations.append(result)
    return reconcile(observations, url, hashlib.sha256(Path(pdf_path).read_bytes()).hexdigest())
