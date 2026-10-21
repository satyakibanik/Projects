"""Search discovery assets must survive the production Pages build."""
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import build_pages_data as build


class SearchAssetsTests(unittest.TestCase):
    def test_sitemap_contains_only_public_canonical_pages(self):
        doc = ET.parse(ROOT / 'sitemap.xml')
        urls = [node.text for node in doc.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc')]
        self.assertEqual(urls, ['https://satyakibanik.github.io/Projects/',
                               'https://satyakibanik.github.io/Projects/begd/'])
        for url, source in zip(urls, ['index.html', 'begd/index.html']):
            self.assertIn(f'<link rel="canonical" href="{url}">', (ROOT / source).read_text())

    def test_production_build_copies_search_assets_without_live_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            output = (Path(directory) / 'site').resolve()
            with patch.object(sys, 'argv', ['build_pages_data.py', '--output-dir', str(output)]), patch.object(build, 'write_data_bundle') as bundle:
                build.main()
            bundle.assert_called_once_with(output / 'begd')
            self.assertEqual((output / 'sitemap.xml').read_text(), (ROOT / 'sitemap.xml').read_text())
            self.assertIn('BEGD', (output / 'index.html').read_text())
            self.assertIn('About BEGD', (output / 'begd/index.html').read_text())
