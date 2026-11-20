"""BPDB issuer discovery must retain root and hostname verification."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from verify_bpdb_tls import HOST, issuer_url, verified_bundle


class BPDBTLSTests(unittest.TestCase):
    def test_issuer_discovery_allows_only_expected_public_ca_endpoints(self):
        url='http://crt.sectigo.com/SectigoPublicServerAuthenticationCADVR36.crt'
        self.assertEqual(issuer_url('CA Issuers - URI:'+url), url)
        for value in ['https://attacker.test/root.crt','file:///tmp/root.pem','http://crt.sectigo.com.attacker.test/root.crt']:
            with self.assertRaises(ValueError):
                issuer_url('CA Issuers - URI:'+value)

    def test_bundle_is_written_only_after_trusted_chain_and_hostname_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            roots,output=Path(directory)/'roots.pem',Path(directory)/'verified.pem'
            roots.write_bytes(b'test trusted roots')
            def run(args, **kwargs):
                if args[1]=='s_client':
                    return subprocess.CompletedProcess(args,0,b'-----BEGIN CERTIFICATE-----\npeer\n-----END CERTIFICATE-----',b'')
                self.assertEqual(args[1], 'verify')
                self.assertIn(str(roots),args)
                self.assertIn('sslserver',args)
                return subprocess.CompletedProcess(args,0,b'OK',b'')
            with patch('verify_bpdb_tls.subprocess.run',side_effect=run), patch('verify_bpdb_tls.ssl.create_default_context') as context, patch('verify_bpdb_tls.socket.create_connection'):
                verified_bundle(output, roots)
                context.assert_called_once_with(cafile=str(roots))
                self.assertEqual(context.return_value.wrap_socket.call_args.kwargs['server_hostname'],HOST)
                self.assertEqual(output.read_bytes(),b'test trusted roots\n')
            output.unlink()
            with patch('verify_bpdb_tls.subprocess.run',side_effect=run), patch('verify_bpdb_tls.ssl.create_default_context') as context, patch('verify_bpdb_tls.socket.create_connection'):
                context.return_value.wrap_socket.side_effect=ValueError('hostname mismatch')
                with self.assertRaises(ValueError):
                    verified_bundle(output, roots)
                self.assertFalse(output.exists())
