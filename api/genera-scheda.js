import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";

export const config = { api: { bodyParser: false } };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const redis = Redis.fromEnv();

const SYSTEM_PROMPT = `Sei un esperto commercialista italiano specializzato in analisi di dichiarazioni dei redditi per underwriting.

Analizza la dichiarazione allegata ed estrai tutti i dati rilevanti. Rispondi SOLO con un oggetto JSON (nessun testo aggiuntivo, nessun markdown) con questa struttura esatta:

{
  "ragione_sociale": "...",
  "codice_fiscale": "...",
  "partita_iva": "...",
  "tipo_dichiarazione": "...",
  "anno_imposta": "...",
  "periodo_imposta": "...",
  "data_presentazione": "...",
  "forma_giuridica": "...",
  "rappresentante": "...",
  "telefono": "...",
  "email": "...",
  "sede_legale": "...",
  "codice_isa": "...",
  "ricavi": "...",
  "altri_proventi": "...",
  "tot_positivi": "...",
  "tot_negativi": "...",
  "reddito_impresa": "...",
  "reddito_imponibile": "...",
  "debito_credito": "...",
  "debito_credito_segno": "credito",
  "quadri_compilati": "...",
  "isa_allegato": "Si",
  "incaricato": "...",
  "soci": [
    { "cf": "...", "nome": "...", "quota": "50%", "qualifica": "R", "reddito_attribuito": "..." }
  ],
  "note": "..."
}

Se un dato non e' disponibile usa "n.d.". Per debito_credito_segno usa "credito" o "debito". Gli importi vanno formattati con euro e separatore migliaia (es. "32.399").`;

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBoundary(ct) {
  const m = ct.match(/boundary=([^\s;]+)/);
  return m ? m[1] : null;
}

function parseMultipart(body, boundary) {
  const delim = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;
  while (start < body.length) {
    const di = body.indexOf(delim, start);
    if (di === -1) break;
    const ps = di + delim.length;
    if (body[ps] === 45 && body[ps + 1] === 45) break;
    const hs = ps + 2;
    const he = body.indexOf(Buffer.from("\r\n\r\n"), hs);
    if (he === -1) break;
    const headers = body.slice(hs, he).toString();
    const cs = he + 4;
    const nd = body.indexOf(delim, cs);
    const ce = nd === -1 ? body.length : nd - 2;
    parts.push({ headers, content: body.slice(cs, ce) });
    start = nd === -1 ? body.length : nd;
  }
  return parts;
}

function buildHTML(d) {
  const sociSection = d.soci && d.soci.length > 0 ? `
    <div class="section">
      <div class="section-title">Soci</div>
      <table class="soci-table">
        <thead><tr><th>Codice fiscale</th><th>Nome</th><th>Quota</th><th>Qualifica</th></tr></thead>
        <tbody>${d.soci.map(s => `<tr><td class="cf">${s.cf}</td><td>${s.nome}</td><td>${s.quota}</td><td>${s.qualifica}</td></tr>`).join("")}</tbody>
      </table>
    </div>` : "";

  const ripartizione = d.soci && d.soci.length > 0 ? `
    <table class="soci-table">
      <thead><tr><th>Socio</th><th>C.F.</th><th>Quota %</th><th>Reddito attribuito</th></tr></thead>
      <tbody>${d.soci.map(s => `<tr><td>${s.nome}</td><td class="cf">${s.cf}</td><td>${s.quota}</td><td>${s.reddito_attribuito}</td></tr>`).join("")}</tbody>
    </table>` : "<p style='color:var(--text-muted);font-size:0.85rem;'>n.d.</p>";

  return `<div class="scheda">
  <div class="scheda-header">
    <div>
      <div class="ragione-sociale">${d.ragione_sociale}</div>
      <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <span class="badge badge-blue">${d.tipo_dichiarazione}</span>
        <span class="badge badge-green">Anno ${d.anno_imposta}</span>
      </div>
    </div>
    <div class="meta">
      <strong>${d.codice_fiscale}</strong>
      P.IVA: ${d.partita_iva}<br>
      Periodo: ${d.periodo_imposta}<br>
      Presentata: ${d.data_presentazione}
    </div>
  </div>
  <div class="section">
    <div class="section-title">Dati anagrafici</div>
    <div class="grid-2">
      <div class="field"><div class="field-label">Ragione sociale</div><div class="field-value">${d.ragione_sociale}</div></div>
      <div class="field"><div class="field-label">Codice fiscale</div><div class="field-value mono">${d.codice_fiscale}</div></div>
      <div class="field"><div class="field-label">Forma giuridica</div><div class="field-value">${d.forma_giuridica}</div></div>
      <div class="field"><div class="field-label">Rappresentante legale</div><div class="field-value">${d.rappresentante}</div></div>
      <div class="field"><div class="field-label">Telefono</div><div class="field-value">${d.telefono}</div></div>
      <div class="field"><div class="field-label">Email</div><div class="field-value">${d.email}</div></div>
      <div class="field"><div class="field-label">Sede legale</div><div class="field-value">${d.sede_legale || "n.d."}</div></div>
    </div>
  </div>
  ${sociSection}
  <div class="section">
    <div class="section-title">Dati reddituali</div>
    <div class="grid-3">
      <div class="field"><div class="field-label">Ricavi / Compensi</div><div class="amount">${d.ricavi}</div></div>
      <div class="field"><div class="field-label">Altri proventi</div><div class="amount">${d.altri_proventi}</div></div>
      <div class="field"><div class="field-label">Tot. componenti positivi</div><div class="amount">${d.tot_positivi}</div></div>
      <div class="field"><div class="field-label">Tot. componenti negativi</div><div class="amount">${d.tot_negativi}</div></div>
      <div class="field"><div class="field-label">Reddito d'impresa</div><div class="amount positive">${d.reddito_impresa}</div></div>
      <div class="field"><div class="field-label">Codice attivita ISA</div><div class="field-value mono">${d.codice_isa}</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Ripartizione tra soci</div>
    ${ripartizione}
  </div>
  <div class="section">
    <div class="section-title">Imposte e posizione fiscale</div>
    <div class="grid-2">
      <div class="highlight-row"><span class="label">Reddito imponibile netto</span><span class="amount">${d.reddito_imponibile}</span></div>
      <div class="highlight-row"><span class="label">Saldo a debito / credito</span><span class="amount ${d.debito_credito_segno === 'credito' ? 'positive' : 'negative'}">${d.debito_credito}</span></div>
    </div>
    <div class="grid-3" style="margin-top:0.75rem;">
      <div class="field"><div class="field-label">Quadri compilati</div><div class="field-value">${d.quadri_compilati}</div></div>
      <div class="field"><div class="field-label">ISA allegato</div><div class="field-value">${d.isa_allegato}</div></div>
      <div class="field"><div class="field-label">Incaricato trasmissione</div><div class="field-value">${d.incaricato}</div></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Note e osservazioni</div>
    <div class="note-box">${d.note}</div>
  </div>
</div>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = await readBody(req);
    const contentType = req.headers["content-type"] || "";
    const boundary = parseBoundary(contentType);
    if (!boundary) return res.status(400).json({ error: "Nessun boundary trovato" });

    const parts = parseMultipart(body, boundary);
    let fileContent = null;
    for (const part of parts) {
      if (part.headers.includes('name="file"')) { fileContent = part.content; break; }
    }
    if (!fileContent || fileContent.length === 0) return res.status(400).json({ error: "Nessun file ricevuto" });

    const base64Content = fileContent.toString("base64");

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Content } },
          { type: "text", text: "Analizza questa dichiarazione e rispondi SOLO con il JSON." }
        ]
      }]
    });

    let raw = response.content[0].text.trim();
    if (raw.startsWith("```")) {
      raw = raw.split("\n").slice(1).join("\n");
      if (raw.endsWith("```")) raw = raw.slice(0, -3);
    }

    const data = JSON.parse(raw.trim());
    const html = buildHTML(data);

    const id = `scheda:${Date.now()}`;
    await redis.set(id, JSON.stringify({
      id,
      ragione_sociale: data.ragione_sociale,
      codice_fiscale: data.codice_fiscale,
      anno_imposta: data.anno_imposta,
      tipo_dichiarazione: data.tipo_dichiarazione,
      html,
      created_at: new Date().toISOString()
    }));
    await redis.lpush("schede_index", id);

    return res.status(200).json({ html, id });
  } catch (error) {
    console.error("Error:", error);
    if (error.status === 401) return res.status(401).json({ error: "API key Anthropic non valida" });
    return res.status(500).json({ error: "Errore: " + error.message });
  }
}
