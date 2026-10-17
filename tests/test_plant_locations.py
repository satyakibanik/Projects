import json
import pathlib
import sys
import tempfile
import unittest

import openpyxl

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'scripts'))
from import_plant_locations import import_locations


class PlantLocationImportTests(unittest.TestCase):
    def run_import(self, records):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory)
            workbook = folder / 'reviewed.xlsx'
            book = openpyxl.Workbook()
            sheet = book.active
            sheet.title = 'Plant matches'
            sheet.append(['Dashboard plant', 'Match status', 'Latitude (WGS84)', 'Longitude (WGS84)', 'OSM ID'])
            for row in records:
                sheet.append(row)
            book.save(workbook)
            osm = folder / 'osm.json'
            osm.write_text(json.dumps({'elements': [{'type': 'way', 'id': 1, 'center': {'lat': 24, 'lon': 90}}]}))
            boundary = folder / 'boundary.geojson'
            boundary.write_text(json.dumps({'geometry': {'type': 'Polygon', 'coordinates': [[[88, 20], [93, 20], [93, 27], [88, 27], [88, 20]]]}}))
            return import_locations(workbook, osm, boundary, '2026-10-17')

    def test_review_decisions_preserve_explicit_and_candidate_coordinates(self):
        result = self.run_import([
            ['A', 'Use 23.9910, 90.3442?', None, None, None],
            ['B', 'use the candidate', None, None, 'way/1'],
            ['Water Level', 'Not a plant', None, None, None],
        ])
        self.assertEqual(len(result['plants']), 2)
        self.assertEqual(result['plants'][0]['latitude'], 23.991)
        self.assertTrue(result['plants'][0]['approximate'])
        self.assertEqual(result['plants'][1]['longitude'], 90)
        self.assertEqual(result['excluded'][0]['name'], 'Water Level')

    def test_unresolved_decision_is_not_silently_published(self):
        with self.assertRaisesRegex(ValueError, 'Unresolved status'):
            self.run_import([['A', 'Unmatched', None, None, None]])

    def test_outside_country_coordinates_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'outside Bangladesh'):
            self.run_import([['A', 'Use 28.0, 90.0', None, None, None]])

    def test_duplicate_normalized_names_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate plant key'):
            self.run_import([['Plant-A', 'Use 24.0, 90.0', None, None, None], ['Plant A', 'Use 24.0, 90.0', None, None, None]])


if __name__ == '__main__':
    unittest.main()
