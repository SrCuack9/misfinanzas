import http.server
import json
import os
import subprocess
import sys
import webbrowser
import threading
import urllib.parse
import urllib.request
from socketserver import ThreadingMixIn

PORT = 3001
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EXTRACTOS_DIR = os.path.join(BASE_DIR, 'extractos')

# Carpeta local donde se guarda la última copia cifrada (respaldo).
SYNC_DIR = os.environ.get('MISFINANZAS_SYNC_DIR', os.path.join(BASE_DIR, 'sync'))

# sync_config.json (junto a server.py, NO se sube a GitHub) contiene:
#   { "gist_id": "..." }
# La copia cifrada se sube a ese Gist secreto usando la credencial de git
# guardada en Windows (la misma con la que haces push). Nunca sale del PC.
SYNC_CONFIG = os.path.join(BASE_DIR, 'sync_config.json')

VALID_EXTENSIONS = {'.xls', '.xlsx', '.csv'}


def _github_token():
    try:
        p = subprocess.run(
            ['git', 'credential', 'fill'],
            input='protocol=https\nhost=github.com\n\n',
            capture_output=True, text=True, timeout=15,
        )
        for line in p.stdout.splitlines():
            if line.startswith('password='):
                return line[len('password='):]
    except Exception:
        pass
    return None


def push_snapshot_to_gist(content_str):
    """Sube la copia cifrada al Gist secreto. Devuelve (ok, raw_url_o_error)."""
    if not os.path.isfile(SYNC_CONFIG):
        return False, 'Falta sync_config.json con el gist_id'
    try:
        with open(SYNC_CONFIG, encoding='utf-8') as f:
            gist_id = json.load(f).get('gist_id')
    except Exception as e:
        return False, f'sync_config.json ilegible: {e}'
    if not gist_id:
        return False, 'sync_config.json no tiene gist_id'

    token = _github_token()
    if not token:
        return False, 'No hay credencial de GitHub guardada en git'

    payload = json.dumps({'files': {'misfinanzas-sync.json': {'content': content_str}}}).encode()
    req = urllib.request.Request(
        f'https://api.github.com/gists/{gist_id}',
        data=payload,
        headers={
            'Authorization': 'token ' + token,
            'User-Agent': 'MisFinanzas',
            'Accept': 'application/vnd.github+json',
        },
        method='PATCH',
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        raw_url = data['files']['misfinanzas-sync.json']['raw_url']
        # URL estable sin SHA de revisión (siempre apunta a la última versión)
        parts = raw_url.split('/raw/')
        stable_url = parts[0] + '/raw/misfinanzas-sync.json' if len(parts) == 2 else raw_url
        return True, stable_url
    except Exception as e:
        return False, f'Error subiendo al gist: {e}'


class MisFinanzasHandler(http.server.SimpleHTTPRequestHandler):
    # Se mantiene HTTP/1.0 (el valor por defecto): con HTTP/1.1 este servidor
    # sencillo reutiliza conexiones y aparecen cuelgues y ERR_CONNECTION_RESET.
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def send_json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/api/extractos':
            self.send_file_list()
        elif self.path.startswith('/api/extracto/'):
            self.send_extracto_file()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/snapshot':
            self.save_snapshot()
        else:
            self.send_error(404, 'Not found')

    def save_snapshot(self):
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            os.makedirs(SYNC_DIR, exist_ok=True)
            out_path = os.path.join(SYNC_DIR, 'misfinanzas-sync.json')
            with open(out_path, 'wb') as f:
                f.write(body)

            pushed, info = push_snapshot_to_gist(body.decode('utf-8'))
            result = {'ok': True, 'path': out_path, 'gist_pushed': pushed}
            if pushed:
                result['raw_url'] = info
            else:
                result['gist_error'] = info

            self.send_json(200, result)
        except Exception as e:
            self.send_error(500, str(e))

    def send_file_list(self):
        files = []
        if os.path.isdir(EXTRACTOS_DIR):
            for name in os.listdir(EXTRACTOS_DIR):
                ext = os.path.splitext(name)[1].lower()
                if ext in VALID_EXTENSIONS:
                    full_path = os.path.join(EXTRACTOS_DIR, name)
                    stat = os.stat(full_path)
                    files.append({
                        'name': name,
                        'size': stat.st_size,
                        'modified': stat.st_mtime,
                    })
        files.sort(key=lambda f: f['modified'], reverse=True)
        self.send_json(200, files)

    def send_extracto_file(self):
        filename = self.path.split('/api/extracto/', 1)[1]
        filename = urllib.parse.unquote(filename)
        filename = os.path.basename(filename)
        filepath = os.path.join(EXTRACTOS_DIR, filename)

        if not os.path.isfile(filepath):
            self.send_error(404, 'File not found')
            return

        ext = os.path.splitext(filename)[1].lower()
        if ext not in VALID_EXTENSIONS:
            self.send_error(403, 'Invalid file type')
            return

        with open(filepath, 'rb') as f:
            data = f.read()

        content_type = 'application/octet-stream'
        if ext == '.xlsx':
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        elif ext == '.xls':
            content_type = 'application/vnd.ms-excel'
        elif ext == '.csv':
            content_type = 'text/csv'

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))
        sys.stderr.flush()


def main():
    no_browser = '--no-browser' in sys.argv

    class ThreadedHTTPServer(ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True

    server = ThreadedHTTPServer(('127.0.0.1', PORT), MisFinanzasHandler)
    print(f'MisFinanzas corriendo en http://localhost:{PORT}', flush=True)
    print(f'Carpeta de extractos: {EXTRACTOS_DIR}', flush=True)
    print('Pulsa Ctrl+C para cerrar.', flush=True)

    if not no_browser:
        def open_browser():
            webbrowser.open(f'http://localhost:{PORT}')
        threading.Timer(0.5, open_browser).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor cerrado.')
        server.server_close()


if __name__ == '__main__':
    main()
