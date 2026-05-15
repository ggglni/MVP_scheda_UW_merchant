# MVP Scheda UW Merchant

App web per la generazione automatica di schede cliente da dichiarazioni dei redditi (Modello Unico SP/PF).

## Struttura

```
├── index.html              # Frontend: upload PDF + visualizzazione scheda
├── api/
│   └── genera-scheda.py    # Serverless function: legge PDF, chiama Claude API
├── vercel.json             # Configurazione deploy Vercel
├── requirements.txt        # Dipendenze Python
└── README.md
```

## Deploy su Vercel (raccomandato)

### 1. Collega il repo a Vercel

1. Vai su [vercel.com](https://vercel.com) e accedi
2. Clicca **Add New → Project**
3. Importa questo repo GitHub
4. Clicca **Deploy** (Vercel rileva automaticamente la configurazione)

### 2. Aggiungi la variabile d'ambiente

Nel dashboard Vercel del progetto:
- **Settings → Environment Variables**
- Aggiungi: `ANTHROPIC_API_KEY` = `sk-ant-...`

### 3. Rideploy

Dopo aver aggiunto la variabile, fai un nuovo deploy (o pusha una modifica).

---

## Formati supportati

- **PDF standard** (`application/pdf`) — dichiarazioni in formato PDF testuale
- **ZIP con immagini** — il formato usato dal software Bluenext (zip contenente `.jpeg` + `.txt` per pagina)

---

## Come funziona

1. L'utente carica il PDF (o ZIP) dalla pagina web
2. Il frontend invia il file all'endpoint `/api/genera-scheda`
3. La serverless function:
   - Se PDF → lo manda direttamente a Claude come documento
   - Se ZIP → estrae i file `.txt` per pagina e li manda come testo
4. Claude analizza la dichiarazione e genera l'HTML della scheda
5. L'HTML viene iniettato nella pagina e visualizzato

---

## Sviluppo locale

```bash
# Installa Vercel CLI
npm i -g vercel

# Installa dipendenze Python
pip install -r requirements.txt

# Avvia in locale
ANTHROPIC_API_KEY=sk-ant-... vercel dev
```

L'app sarà disponibile su `http://localhost:3000`.
# MVP_scheda_UW_merchant
