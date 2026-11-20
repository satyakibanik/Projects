import copy
import json
from pathlib import Path
import re
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from fuel_ocr import reconcile, observation_lines, PATTERNS

FIXTURE = json.loads((Path(__file__).parent/'fixtures/fuel/gtcl-ocr-observations.json').read_text())


class OCRTests(unittest.TestCase):
    def parse(self, sets):
        return reconcile(sets, FIXTURE['expected']['url'], FIXTURE['expected']['sha256'])

    def test_real_scan_yields_only_a_uniquely_reconciled_production_reading(self):
        row, proof = self.parse(FIXTURE['observation_sets'])
        self.assertEqual(row, FIXTURE['expected'])
        self.assertEqual(proof, FIXTURE['proof'])
        self.assertIsNone(row['power_supply'])
        self.assertLessEqual(abs(sum(proof['production_components'].values())-row['total']), .00050001)

    def test_missing_or_low_confidence_components_are_not_invented(self):
        sets = []
        for observations in FIXTURE['observation_sets']:
            sets.append([item for text, group in observation_lines(observations)
                         if not re.search(PATTERNS['G'], text, re.I) for item in group])
        with self.assertRaisesRegex(ValueError, 'required labelled'):
            self.parse(sets)
        low = copy.deepcopy(FIXTURE['observation_sets'])
        for observations in low:
            for item in observations:
                item['confidence'] = .5
        with self.assertRaises(ValueError):
            self.parse(low)

    def test_inconsistent_dates_and_multiple_rounding_solutions_are_rejected(self):
        sets = copy.deepcopy(FIXTURE['observation_sets'])
        sets[0].append(dict(text='Reporting Date: 2-Feb-2020', x=0, y=.999, height=.01, confidence=1))
        with self.assertRaisesRegex(ValueError, 'date missing or inconsistent'):
            self.parse(sets)
        component = FIXTURE['proof']['production_components']['G']
        direction = -.0001 if FIXTURE['proof']['validation_difference'] >= 0 else .0001
        variant = [dict(text=f'G. Tullow BD. Ltd. : Bangora Gas Field 103.000 {component+direction:.4f}',
                        x=0, y=.5, height=.01, confidence=1)]
        with self.assertRaisesRegex(ValueError, 'valid solutions'):
            self.parse(FIXTURE['observation_sets']+[variant])


if __name__ == '__main__':
    unittest.main()
