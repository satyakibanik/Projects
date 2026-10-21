"""Local API regression coverage for exact operating-date lookups."""
import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import server


class OperatingDateRouteTests(unittest.TestCase):
    def handler(self, path):
        handler = object.__new__(server.DashboardHandler)
        handler.path = path
        handler.send_json = lambda status, body: setattr(handler, 'result', (status, body))
        return handler

    def test_operating_date_route_uses_exact_lookup_not_publication_date_or_id(self):
        report = {'report_id': '42', 'date': '2026-10-19', 'published_date': '2026-10-20'}
        handler = self.handler('/api/report?date=2026-10-19')
        with patch.object(server, 'get_historical_report_for_date', return_value=report) as lookup, patch.object(server, 'get_report') as by_id:
            handler.do_GET()
        lookup.assert_called_once_with(dt.date(2026, 10, 19))
        by_id.assert_not_called()
        self.assertEqual(handler.result, (200, report))

    def test_missing_operating_date_returns_404_without_substitution(self):
        handler = self.handler('/api/report?date=1900-01-01')
        with patch.object(server, 'get_historical_report_for_date', side_effect=LookupError('No archived report')):
            handler.do_GET()
        self.assertEqual(handler.result[0], 404)
        self.assertIn('No archived report', handler.result[1]['error'])

    def test_existing_report_id_lookup_is_unchanged(self):
        handler = self.handler('/api/report?id=42')
        with patch.object(server, 'get_report', return_value={'report_id': '42'}) as lookup:
            handler.do_GET()
        lookup.assert_called_once_with('42')
        self.assertEqual(handler.result[0], 200)
