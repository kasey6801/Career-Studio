# Career Studio

A local web app that turns your LinkedIn profile into a four-part career package — generated in parallel by any OpenAI-compatible LLM and streamed live to your browser.

---

## What it produces

| Output | Description |
|--------|-------------|
| **LinkedIn Update Plan** | New headline options, rewritten About section, experience bullet rewrites, top 10 skills to pin, and a profile hygiene checklist |
| **Master CV** | ATS-safe, reverse-chronological, with `[FILL: …]` placeholders for missing data — never invents employers, dates, or certifications |
| **6–12 Month Dev Plan** | Tiered certification roadmap, hands-on projects, networking milestones, and curated learning resources |
| **10 Target Roles** | Fit scores, gap analysis, and ready-to-paste LinkedIn and Indeed search queries for each role |

All four sections generate in parallel. You watch them stream in live, tab by tab.

---

## Quick start

**Requirements:** Python 3.8+ · Internet access (for the LLM API and pdf.js CDN)

### Mac / Linux

```bash
cd career_studio
./start.sh
```

### Windows

Double-click `start.bat`, or in a terminal:

```bat
cd career_studio
start.bat
```

The script installs dependencies, then opens `http://127.0.0.1:8000` in your browser automatically.

---

## Setup

1. Open the **⚙ API Settings** panel in the app
2. Choose a **provider preset** — this fills in the Base URL automatically
3. Enter your **API key**
4. Enter a **model name**

### Supported providers

| Provider | Base URL | Suggested model |
|----------|----------|-----------------|
| Anthropic | `https://api.anthropic.com/v1` | `claude-haiku-4-5-20251001` · `claude-sonnet-4-6` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` · `gpt-4o` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-8b-instant` · `llama-3.3-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` (or any pulled model) |
| Any OpenAI-compatible endpoint | custom | — |

For Ollama, enter `none` as the API key. No account or billing needed.

Your API key is sent directly to the provider with each request and is never stored on any server.

---

## Inputs

| Field | Required | Notes |
|-------|----------|-------|
| LinkedIn profile content | Yes | Paste text, or upload `.pdf`, `.txt`, `.md`, `.html`, `.rtf` |
| Personal website / portfolio URL | No | Adds tone and brand context |
| GitHub URL | No | Engineering signal for the CV and role targeting |
| Existing CV / résumé | No | Improves continuity of the generated CV |
| Target job titles | Recommended | Drives all four outputs |
| Target industries | Recommended | Drives the jobs section |
| Geography / timeline / constraints | Optional | Affects compensation tone, work-auth notes |

**PDF uploads** use pdf.js as the primary extractor, with a built-in hand-rolled fallback for edge cases. Scanned / image-only PDFs cannot be extracted — paste the text manually in that case.

---

## Exports

From the Results panel, download each section or all four at once as:

- **Markdown** (`.md`) — raw text, one file
- **PDF** — opens a print-preview window; choose *Save as PDF* as the destination
- **Word** (`.doc`) — Microsoft Office HTML format; opens cleanly in Word, Pages, Google Docs, and LibreOffice

---

## Distribution

The `career_studio/` folder is self-contained. Zip it and share it:

```bash
zip -r career_studio.zip career_studio/ --exclude "*.pyc" --exclude "*/__pycache__/*"
```

Recipients unzip, run the start script, and the app is ready. No build step, no Docker, no cloud account required beyond their own LLM API key.

---

## File structure

```
career_studio/
├── server.py               # FastAPI backend — SSE proxy to the LLM API
├── requirements.txt        # openai, fastapi, uvicorn, httpx
├── start.sh                # Mac/Linux launcher
├── start.bat               # Windows launcher
├── public/
│   ├── index.html          # UI shell
│   ├── style.css           # Design tokens, layout, responsive grid
│   └── app.js              # SSE consumer, PDF extractor, Markdown renderer, export
└── data/
    ├── job-sources.json    # 9 curated job-search source categories
    └── sample-profile.txt  # Sample LinkedIn profile for the "Load sample" button
```

---

## Security notes

- The server binds to `127.0.0.1` only — not reachable from other machines on your network
- No shutdown endpoint — stop the server with `Ctrl+C`
- All request fields are validated server-side with strict length caps (LinkedIn / CV ≤ 30 KB, other fields ≤ 2 KB)
- The Markdown renderer sanitises all output and blocks non-`http(s)://` link schemes
- Your API key lives in browser `localStorage` only — it is never written to disk by the app

---

## License

MIT
