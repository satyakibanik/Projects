import sys
from pathlib import Path
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import diagnose_fuel as diagnostic
from fuel import FuelFetchError

PDF_URL='https://objectstorage.ap-dcc-gazipur-1.oraclecloud15.com/report.pdf'


class DiagnosticTests(unittest.TestCase):
    def test_failed_listing_retains_exact_error_and_stops_before_pdf(self):
        error=FuelFetchError(diagnostic.SOURCES['gtcl'],60,'curl: (60) issuer certificate missing\n')
        with patch.object(diagnostic,'fetch',side_effect=error) as fetch:
            result=diagnostic.probe('gtcl')
        self.assertEqual(fetch.call_count,1)
        self.assertEqual((result['status'],result['stage']),('failed','listing'))
        self.assertEqual(result['error_details']['curl_exit_code'],60)
        self.assertEqual(result['error_details']['stderr'],error.stderr)

    def test_pdf_failure_is_distinguished_from_listing_failure(self):
        error=FuelFetchError(PDF_URL,22,'curl: (22) The requested URL returned error: 403\n')
        with patch.object(diagnostic,'fetch',side_effect=[f'<a href="{PDF_URL}">PDF</a>'.encode(),error]):
            result=diagnostic.probe('petrobangla')
        self.assertEqual(result['stage'],'pdf_download')
        self.assertEqual(result['pdf_url'],PDF_URL)
        self.assertEqual(result['error_details']['curl_exit_code'],22)

    def test_success_records_parsed_date_and_hash_without_writing_a_cache(self):
        with patch.object(diagnostic,'fetch',side_effect=[f'<a href="{PDF_URL}">PDF</a>'.encode(),b'pdf']), patch.object(diagnostic,'parse_pdf',return_value={'date':'2026-11-03','total':2561.7,'sha256':'abc'}):
            result=diagnostic.probe('petrobangla')
        self.assertEqual(result['status'],'ok')
        self.assertEqual(result['report_date'],'2026-11-03')
        self.assertEqual(result['sha256'],'abc')

    def test_coal_is_parsed_in_annual_units(self):
        with patch.object(diagnostic,'fetch',return_value='<td>২০২৫-২০২৬</td><td>৭,৬২,৭৫২.৬৩০</td>'.encode()):
            result=diagnostic.probe('coal')
        self.assertEqual(result['status'],'ok')
        self.assertEqual(result['annual_records'],1)
        self.assertEqual(result['latest_year'],'2025–2026')

    def test_summary_exposes_source_failure_instead_of_mislabeling_it_success(self):
        text=diagnostic.summary({'results':[{'source':'gtcl','status':'failed','stage':'listing','error_details':{'curl_exit_code':28}}]})
        self.assertIn('| gtcl | failed | listing | 28 |',text)


if __name__=='__main__':
    unittest.main()
