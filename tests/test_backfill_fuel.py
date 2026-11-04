import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import backfill_fuel


class ArchiveTests(unittest.TestCase):
    def test_archive_follows_pagination_and_deduplicates_boundary_links(self):
        first = b'<a data-page="1"></a><a data-page="2"></a><a href="https://one.pdf"></a>'
        second = b'<a href="https://one.pdf"></a><a href="https://two.pdf"></a>'
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill_fuel.fuel, 'fetch', side_effect=[first, second]) as fetch:
            urls, pages = backfill_fuel.archive_pages('petrobangla', Path(tmp))
            self.assertTrue((Path(tmp)/'petrobangla-page-2.html').exists())
        self.assertEqual(urls, ['https://one.pdf', 'https://two.pdf'])
        self.assertEqual([p['page'] for p in pages], [1, 2])
        self.assertIn('page=2', fetch.call_args.args[0])
        self.assertEqual(pages[0]['sha256'], hashlib.sha256(first).hexdigest())

    def test_explicit_page_limit_and_publisher_formats(self):
        html = '<a data-page="3"></a><a href="https://one.pdf"></a><a href="https://two.xlsx"></a>'
        with tempfile.TemporaryDirectory() as tmp, patch.object(backfill_fuel.fuel, 'fetch', return_value=html.encode()) as fetch:
            urls, pages = backfill_fuel.archive_pages('gtcl', Path(tmp), max_pages=1)
        self.assertEqual(urls, ['https://one.pdf', 'https://two.xlsx'])
        self.assertEqual(len(pages), 1)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(backfill_fuel.report_links(html, 'petrobangla'), ['https://one.pdf'])

    def test_parser_or_pdf_change_invalidates_a_saved_parse(self):
        url = 'https://example.pdf'
        content = b'%PDF source file' + b' ' * 100
        key = hashlib.sha256(url.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root/(key+'.pdf')).write_bytes(content)
            (root/(key+'.parsed.json')).write_text(json.dumps(dict(parser_id='old-parser', sha256=hashlib.sha256(content).hexdigest(), status='ok', row={'total': 1})))
            row = dict(date='2020-01-12', total=3167.9, sha256=hashlib.sha256(content).hexdigest())
            with patch.object(backfill_fuel.fuel, 'parse_report', return_value=row) as parse:
                result = backfill_fuel.read_report(('petrobangla', url, tmp))
                self.assertEqual(result['row']['total'], 3167.9)
                parse.assert_called_once()
            with patch.object(backfill_fuel.fuel, 'parse_report', side_effect=AssertionError('cache was not reused')):
                self.assertEqual(backfill_fuel.read_report(('petrobangla', url, tmp)), result)
            (root/(key+'.pdf')).write_bytes(content+b' changed')
            with patch.object(backfill_fuel.fuel, 'parse_report', return_value=row) as parse:
                backfill_fuel.read_report(('petrobangla', url, tmp))
                parse.assert_called_once()

    def test_failed_parse_is_resumable_and_can_be_explicitly_retried(self):
        url = 'https://example.pdf'
        content = b'%PDF scan' + b' ' * 100
        key = hashlib.sha256(url.encode()).hexdigest()
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp)/(key+'.pdf')).write_bytes(content)
            with patch.object(backfill_fuel.fuel, 'parse_report', side_effect=ValueError('Scanned report')):
                failed = backfill_fuel.read_report(('gtcl', url, tmp))
            self.assertEqual(failed['status'], 'failed')
            with patch.object(backfill_fuel.fuel, 'parse_report', side_effect=AssertionError('should use failed cache')):
                self.assertEqual(backfill_fuel.read_report(('gtcl', url, tmp)), failed)
            row = dict(date='2024-05-05', total=3053.8974, sha256=hashlib.sha256(content).hexdigest())
            with patch.object(backfill_fuel.fuel, 'parse_report', return_value=row) as parse:
                result = backfill_fuel.read_report(('gtcl', url, tmp, None, True))
                self.assertEqual(result['status'], 'ok')
                parse.assert_called_once()


if __name__ == '__main__':
    unittest.main()
