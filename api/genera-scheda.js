import Anthropic from "@anthropic-ai/sdk";

export const config = {
  api: {
    bodyParser: false,
  },
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Sei un esperto commercialista italiano specializzato in analisi di dichiarazioni dei redditi per underwriting.

Analizza la dichiarazione allegata ed estrai tutti i dati rilevanti. Poi genera una scheda cliente HTML completa usando ESATTAMENTE questo template HTML (sostituisci i segnaposto con i dati reali):

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

Regole:
- Per {{SEZIONE_SOCI}}: se è una SNC/SAS/società di persone, includi una tabella soci con i dati del quadro RO. Usa la classe "soci-table".
- Per {{TABELLA_RIPARTIZIONE}}: tabella con colonne Socio | C.F. | Quota % | Reddito attribuito
- Importi: formatta sempre con € e separatore migliaia (es. € 32.399)
- Se un dato non è disponibile usa "n.d."
- Per {{DEBITO_CREDITO_CLASS}}: usa "positive" se credito, "negative" se debito
- Le NOTE devono essere sintetiche: tipo dichiarazione, situazioni particolari, eventuali perdite, superbonus, ecc.
- Rispondi SOLO con l'HTML puro, senza markdown, senza backtick, senza testo aggiuntivo.`;

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBoundary(contentType) {
  const match = contentType.match(/boundary=([^\s;]+)/);
  return match ? match[1] : null;
}

function parseMultipart(body, boundary) {
  const delimiter = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;

  while (start < body.length) {
    const delimIdx = body.indexOf(delimiter, start);
    if (delimIdx === -1) break;

    const partStart = delimIdx + delimiter.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break; // --

    // Skip \r\n after boundary
    const headerStart = partStart + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;

    const headers = body.slice(headerStart, headerEnd).toString();
    const contentStart = headerEnd + 4;

    const nextDelim = body.indexOf(delimiter, contentStart);
    const contentEnd = nextDelim === -1 ? body.length : nextDelim - 2;

    const content = body.slice(contentStart, contentEnd);
    parts.push({ headers, content });
    start = nextDelim === -1 ? body.length : nextDelim;
  }

  return parts;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const contentType = req.headers["content-type"] || "";
    const boundary = parseBoundary(contentType);

    if (!boundary) {
      return res.status(400).json({ error: "Nessun boundary trovato" });
    }

    const parts = parseMultipart(body, boundary);
    let fileContent = null;

    for (const part of parts) {
      if (part.headers.includes('name="file"')) {
        fileContent = part.content;
        break;
      }
    }

    if (!fileContent || fileContent.length === 0) {
      return res.status(400).json({ error: "Nessun file ricevuto" });
    }

    // Convert to base64 for Anthropic API
    const base64Content = fileContent.toString("base64");

    // Call Claude API with PDF as document
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64Content,
              },
            },
            {
              type: "text",
              text: "Analizza questa dichiarazione e genera la scheda HTML come da istruzioni.",
            },
          ],
        },
      ],
    });

    let htmlContent = response.content[0].text.trim();
    // Clean up any accidental markdown
    if (htmlContent.startsWith("```")) {
      htmlContent = htmlContent.split("\n").slice(1).join("\n");
      if (htmlContent.endsWith("```")) {
        htmlContent = htmlContent.slice(0, -3);
      }
    }

    return res.status(200).json({ html: htmlContent.trim() });
  } catch (error) {
    console.error("Error:", error);
    if (error.status === 401) {
      return res.status(401).json({ error: "API key Anthropic non valida" });
    }
    return res.status(500).json({ error: "Errore: " + error.message });
  }
}
