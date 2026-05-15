import os
import json
import zipfile
import base64
import tempfile
import anthropic
from http.server import BaseHTTPRequestHandler
import cgi

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

SYSTEM_PROMPT = """Sei un esperto commercialista italiano specializzato in analisi di dichiarazioni dei redditi per underwriting.

Analizza la dichiarazione allegata ed estrai tutti i dati rilevanti. Poi genera una scheda cliente HTML completa usando ESATTAMENTE questo template HTML (sostituisci i segnaposto con i dati reali):

```html
<div class="scheda">
  <div class="scheda-header">
    <div>
      <div class="ragione-sociale">{{RAGIONE_SOCIALE}}</div>
      <div style="margin-top:0.5rem; display:flex; gap:0.5rem; flex-wrap:wrap;">
        <span class="badge badge-blue">{{TIPO_DICHIARAZIONE}}</span>
        <span class="badge badge-green">Anno {{ANNO_IMPOSTA}}</span>
      </div>
    </div>
    <div class="meta">
      <strong>{{CODICE_FISCALE}}</strong>
      P.IVA: {{PARTITA_IVA}}<br>
      Periodo: {{PERIODO_IMPOSTA}}<br>
      Presentata: {{DATA_PRESENTAZIONE}}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Dati anagrafici</div>
    <div class="grid-2">
      <div class="field"><div class="field-label">Ragione sociale</div><div class="field-value">{{RAGIONE_SOCIALE}}</div></div>
      <div class="field"><div class="field-label">Codice fiscale</div><div class="field-value mono">{{CODICE_FISCALE}}</div></div>
      <div class="field"><div class="field-label">Forma giuridica</div><div class="field-value">{{FORMA_GIURIDICA}}</div></div>
      <div class="field"><div class="field-label">Rappresentante legale</div><div class="field-value">{{RAPPRESENTANTE}}</div></div>
      <div class="field"><div class="field-label">Telefono</div><div class="field-value">{{TELEFONO}}</div></div>
      <div class="field"><div class="field-label">Email</div><div class="field-value">{{EMAIL}}</div></div>
    </div>
  </div>

  {{SEZIONE_SOCI}}

  <div class="section">
    <div class="section-title">Dati reddituali</div>
    <div class="grid-3">
      <div class="field"><div class="field-label">Ricavi / Compensi</div><div class="amount">{{RICAVI}}</div></div>
      <div class="field"><div class="field-label">Altri proventi</div><div class="amount">{{ALTRI_PROVENTI}}</div></div>
      <div class="field"><div class="field-label">Totale componenti positivi</div><div class="amount">{{TOT_POSITIVI}}</div></div>
      <div class="field"><div class="field-label">Totale componenti negativi</div><div class="amount">{{TOT_NEGATIVI}}</div></div>
      <div class="field"><div class="field-label">Reddito d'impresa</div><div class="amount positive">{{REDDITO_IMPRESA}}</div></div>
      <div class="field"><div class="field-label">Codice attività ISA</div><div class="field-value mono">{{CODICE_ISA}}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Ripartizione tra soci</div>
    {{TABELLA_RIPARTIZIONE}}
  </div>

  <div class="section">
    <div class="section-title">Imposte e posizione fiscale</div>
    <div class="grid-2">
      <div class="highlight-row">
        <span class="label">Reddito imponibile netto</span>
        <span class="amount">{{REDDITO_IMPONIBILE}}</span>
      </div>
      <div class="highlight-row">
        <span class="label">Saldo a debito / credito</span>
        <span class="amount {{DEBITO_CREDITO_CLASS}}">{{DEBITO_CREDITO}}</span>
      </div>
    </div>
    <div class="grid-3" style="margin-top:0.75rem;">
      <div class="field"><div class="field-label">Quadri compilati</div><div class="field-value">{{QUADRI_COMPILATI}}</div></div>
      <div class="field"><div class="field-label">ISA allegato</div><div class="field-value">{{ISA}}</div></div>
      <div class="field"><div class="field-label">Incaricato trasmissione</div><div class="field-value">{{INCARICATO}}</div></div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Note e osservazioni</div>
    <div class="note-box">{{NOTE}}</div>
  </div>
</div>
```

Regole:
- Per {{SEZIONE_SOCI}}: se è una SNC/SAS/società di persone, includi una tabella soci con i dati del quadro RO. Usa la classe "soci-table".
- Per {{TABELLA_RIPARTIZIONE}}: tabella con colonne Socio | C.F. | Quota % | Reddito attribuito
- Importi: formatta sempre con € e separatore migliaia (es. € 32.399)
- Se un dato non è disponibile usa "n.d."
- Per {{DEBITO_CREDITO_CLASS}}: usa "positive" se credito, "negative" se debito
- Le NOTE devono essere sintetiche: tipo dichiarazione, situazioni particolari, eventuali perdite, superbonus, ecc.
- Rispondi SOLO con l'HTML puro, senza markdown, senza backtick, senza testo aggiuntivo.
"""


def extract_text_from_zip(zip_bytes):
    """Extract text files from zip containing jpeg+txt pages."""
    texts = []
    with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as f:
        f.write(zip_bytes)
        tmp_path = f.name

    with zipfile.ZipFile(tmp_path, 'r') as z:
        # Get all .txt files sorted by page number
        txt_files = sorted(
            [n for n in z.namelist() if n.endswith('.txt')],
            key=lambda x: int(x.replace('.txt', '')) if x.replace('.txt', '').isdigit() else 999
        )
        for name in txt_files:
            with z.open(name) as f:
                content = f.read().decode('utf-8', errors='replace')
                if content.strip():
                    texts.append(f"=== Pagina {name} ===\n{content}")

    os.unlink(tmp_path)
    return '\n'.join(texts)


def parse_multipart(environ):
    """Parse multipart form data."""
    content_type = environ.get('CONTENT_TYPE', '')
    content_length = int(environ.get('CONTENT_LENGTH', 0))
    body = environ['wsgi.input'].read(content_length)

    # Parse boundary
    boundary = None
    for part in content_type.split(';'):
        part = part.strip()
        if part.startswith('boundary='):
            boundary = part[9:].strip('"')
            break

    if not boundary:
        return None, None

    # Simple multipart parser
    boundary_bytes = ('--' + boundary).encode()
    parts = body.split(boundary_bytes)

    for part in parts[1:]:
        if b'name="file"' in part:
            # Extract filename
            filename = b''
            if b'filename="' in part:
                start = part.index(b'filename="') + 10
                end = part.index(b'"', start)
                filename = part[start:end]

            # Extract content (after double CRLF)
            if b'\r\n\r\n' in part:
                content = part.split(b'\r\n\r\n', 1)[1]
                # Remove trailing boundary marker
                if content.endswith(b'\r\n'):
                    content = content[:-2]
                return filename.decode('utf-8', errors='replace'), content

    return None, None


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            content_type = self.headers.get('Content-Type', '')
            body = self.rfile.read(content_length)

            # Parse multipart
            boundary = None
            for part in content_type.split(';'):
                part = part.strip()
                if part.startswith('boundary='):
                    boundary = part[9:].strip('"')
                    break

            filename = None
            file_content = None

            if boundary:
                boundary_bytes = ('--' + boundary).encode()
                parts = body.split(boundary_bytes)
                for part in parts[1:]:
                    if b'name="file"' in part:
                        if b'filename="' in part:
                            start = part.index(b'filename="') + 10
                            end = part.index(b'"', start)
                            filename = part[start:end].decode('utf-8', errors='replace')
                        if b'\r\n\r\n' in part:
                            content = part.split(b'\r\n\r\n', 1)[1]
                            if content.endswith(b'\r\n'):
                                content = content[:-2]
                            file_content = content
                        break

            if not file_content:
                self._json_error(400, "Nessun file ricevuto")
                return

            # Determine file type and extract text/images
            is_zip = file_content[:2] == b'PK'
            is_pdf = file_content[:4] == b'%PDF'

            messages_content = []

            if is_zip:
                # Extract text from zip pages
                extracted_text = extract_text_from_zip(file_content)
                messages_content.append({
                    "type": "text",
                    "text": f"Ecco il testo estratto dalle pagine della dichiarazione:\n\n{extracted_text}"
                })
            elif is_pdf:
                # Send PDF directly to Claude
                pdf_b64 = base64.standard_b64encode(file_content).decode('utf-8')
                messages_content.append({
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_b64
                    }
                })
            else:
                self._json_error(400, "Formato non supportato. Carica un PDF o un file ZIP.")
                return

            messages_content.append({
                "type": "text",
                "text": "Analizza questa dichiarazione e genera la scheda HTML come da istruzioni."
            })

            # Call Claude API
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": messages_content}]
            )

            html_content = response.content[0].text.strip()
            # Clean up any accidental markdown wrapping
            if html_content.startswith('```'):
                html_content = html_content.split('\n', 1)[1] if '\n' in html_content else html_content
                if html_content.endswith('```'):
                    html_content = html_content[:-3]
            html_content = html_content.strip()

            self._json_ok({"html": html_content})

        except anthropic.AuthenticationError:
            self._json_error(401, "API key Anthropic non valida o mancante")
        except Exception as e:
            self._json_error(500, f"Errore interno: {str(e)}")

    def _json_ok(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def _json_error(self, code, message):
        body = json.dumps({"error": message}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, format, *args):
        pass
