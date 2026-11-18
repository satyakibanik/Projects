"""Complete an omitted issuer chain and verify it against system roots and hostname."""
import argparse
from pathlib import Path
import re
import ssl
import socket
import subprocess
import tempfile
from urllib.parse import urlparse

HOST = 'misc.bpdb.gov.bd'
CERTIFICATE = rb'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----'


def issuer_url(text):
    match = re.search(r'CA Issuers - URI:([^\s]+)', text)
    if not match:
        raise ValueError('No certificate issuer URL')
    parsed = urlparse(match.group(1))
    if parsed.scheme not in ('http', 'https') or not (parsed.hostname == 'crt.sectigo.com' or re.fullmatch(r'[a-z0-9]+\.i\.lencr\.org', parsed.hostname or '')):
        raise ValueError('Unexpected certificate issuer URL')
    # Issuer certificates are untrusted inputs until the complete signature chain
    # and publisher hostname validate against system roots below.
    return match.group(1)


def verified_bundle(output, ca_file=None, *, host=HOST):
    candidates = [ca_file] if ca_file else [
        ssl.get_default_verify_paths().cafile, '/etc/ssl/certs/ca-certificates.crt', '/etc/ssl/cert.pem',
    ]
    roots = next((Path(path) for path in candidates if path and Path(path).is_file()), None)
    if roots is None:
        raise ValueError('System CA roots are unavailable')
    def run(args, **kwargs):
        return subprocess.run(args, capture_output=True, timeout=30, **kwargs)
    with tempfile.TemporaryDirectory(prefix='begd-publisher-tls-') as directory:
        folder = Path(directory)
        peer = run(['openssl', 's_client', '-connect', host+':443', '-servername', host, '-showcerts'], input=b'')
        certificates = re.findall(CERTIFICATE, peer.stdout, re.S)
        if not certificates:
            raise ValueError(f'{host} returned no TLS certificate')
        leaf, chain = folder/'leaf.pem', folder/'chain.pem'
        leaf.write_bytes(certificates[0]+b'\n')
        chain.write_bytes(b'\n'.join(certificates[1:]))
        current = leaf
        for depth in range(5):
            command = ['openssl', 'verify', '-purpose', 'sslserver', '-CAfile', str(roots)]
            if chain.stat().st_size:
                command += ['-untrusted', str(chain)]
            verification = run(command+[str(leaf)])
            if verification.returncode == 0:
                context = ssl.create_default_context(cafile=str(roots))
                if chain.stat().st_size:
                    context.load_verify_locations(cafile=str(chain))
                with socket.create_connection((host, 443), timeout=20) as connection:
                    with context.wrap_socket(connection, server_hostname=host):
                        pass
                Path(output).write_bytes(roots.read_bytes()+b'\n'+chain.read_bytes())
                print('Verified TLS chain and hostname:', host)
                return
            if depth == 4:
                raise ValueError('Could not verify certificate chain: '+verification.stderr.decode().strip())
            text = run(['openssl', 'x509', '-in', str(current), '-noout', '-text'], check=True).stdout.decode()
            url = issuer_url(text)
            raw, issuer = folder/f'issuer-{depth}.crt', folder/f'issuer-{depth}.pem'
            run(['curl', '--fail', '--silent', '--show-error', '--location', '--proto', '=http,https', '--max-time', '20', url, '--output', str(raw)], check=True)
            conversion = run(['openssl', 'x509', '-in', str(raw), '-out', str(issuer)])
            if conversion.returncode:
                conversion = run(['openssl', 'x509', '-inform', 'DER', '-in', str(raw), '-out', str(issuer)])
            if conversion.returncode:
                run(['openssl', 'pkcs7', '-inform', 'DER', '-in', str(raw), '-print_certs', '-out', str(issuer)], check=True)
            chain.write_bytes(chain.read_bytes()+b'\n'+issuer.read_bytes())
            current = issuer


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--ca-file')
    args = parser.parse_args()
    verified_bundle(args.output, args.ca_file)
