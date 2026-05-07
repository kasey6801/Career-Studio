/* =============================================================
   Career Positioning Studio — frontend
   ============================================================= */

'use strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTIONS = ['linkedin', 'cv', 'dev', 'jobs'];
const STORAGE_KEY = 'career-positioning-studio-v1';

const SECTION_LABELS = {
  linkedin: 'LinkedIn',
  cv: 'CV',
  dev: 'Dev Plan',
  jobs: 'Jobs',
};

const PROVIDERS = {
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    modelPlaceholder: 'claude-haiku-4-5-20251001',
    hint: 'Get a key at console.anthropic.com. Suggested models: claude-haiku-4-5-20251001 (fast) or claude-sonnet-4-6 (quality).',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-4o-mini',
    hint: 'Get a key at platform.openai.com. Suggested models: gpt-4o-mini (fast) or gpt-4o (quality).',
  },
  ollama: {
    baseUrl: 'http://localhost:11434/v1',
    modelPlaceholder: 'llama3.2',
    hint: 'Ollama must be running locally. Enter "none" as the API key. Use any model you have pulled (e.g. llama3.2).',
  },
  custom: {
    baseUrl: '',
    modelPlaceholder: 'model-name',
    hint: 'Enter the base URL and model name for any OpenAI-compatible API endpoint.',
  },
};

// In-memory output store — not persisted across reloads
const OUTPUT_CACHE = { linkedin: '', cv: '', dev: '', jobs: '' };
let activeTab = 'linkedin';
let isGenerating = false;

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const PERSIST_FIELDS = ['linkedin', 'linkedin-url', 'website', 'github', 'cv', 'q1', 'q2', 'q3', 'api-key', 'base-url', 'model', 'provider'];

function saveStorage() {
  const data = {};
  PERSIST_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) data[id] = el.value;
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    Object.entries(data).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Provider preset UI
// ---------------------------------------------------------------------------

function applyProvider(name) {
  const preset = PROVIDERS[name] || PROVIDERS.custom;
  const baseUrlEl = document.getElementById('base-url');
  const modelEl = document.getElementById('model');
  const hintEl = document.getElementById('provider-hint');

  if (name !== 'custom') {
    baseUrlEl.value = preset.baseUrl;
  }
  modelEl.placeholder = preset.modelPlaceholder;
  hintEl.textContent = preset.hint;
  saveStorage();
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeUrl(url) {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '#';
}

function renderInline(raw) {
  let s = escapeHtml(raw);
  // Bold
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const safe = sanitizeUrl(url);
    return `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });
  return s;
}

function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];

  let inCodeFence = false;
  let codeLang = '';
  let codeLines = [];

  let inTable = false;
  let tableRows = [];

  let listType = null;   // 'ul' | 'ol'
  let listItems = [];

  let paraLines = [];

  function flushCode() {
    if (!codeLines.length) return;
    out.push(`<pre><code${codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
    codeLines = [];
  }

  function flushTable() {
    if (!tableRows.length) return;
    const rows = tableRows;
    tableRows = [];
    inTable = false;

    out.push('<table class="md-table">');
    rows.forEach((row, ri) => {
      // Split on pipe, strip outer empties
      const cells = row.split('|').slice(1, -1);
      if (ri === 0) {
        out.push('<thead><tr>');
        cells.forEach(c => out.push(`<th>${renderInline(c.trim())}</th>`));
        out.push('</tr></thead><tbody>');
      } else if (ri === 1 && /^[\s|:-]+$/.test(row)) {
        // separator row — skip
      } else {
        out.push('<tr>');
        cells.forEach(c => out.push(`<td>${renderInline(c.trim())}</td>`));
        out.push('</tr>');
      }
    });
    out.push('</tbody></table>');
  }

  function flushList() {
    if (!listItems.length) return;
    const tag = listType === 'ol' ? 'ol' : 'ul';
    out.push(`<${tag}>`);
    listItems.forEach(item => out.push(`<li>${item}</li>`));
    out.push(`</${tag}>`);
    listItems = [];
    listType = null;
  }

  function flushPara() {
    if (!paraLines.length) return;
    out.push(`<p>${renderInline(paraLines.join(' '))}</p>`);
    paraLines = [];
  }

  for (const line of lines) {
    // ---- Code fence ----
    if (line.startsWith('```')) {
      if (!inCodeFence) {
        flushPara(); flushList(); flushTable();
        inCodeFence = true;
        codeLang = line.slice(3).trim();
        codeLines = [];
      } else {
        inCodeFence = false;
        flushCode();
        codeLang = '';
      }
      continue;
    }
    if (inCodeFence) { codeLines.push(line); continue; }

    // ---- Table ----
    if (line.startsWith('|')) {
      flushPara(); flushList();
      tableRows.push(line);
      inTable = true;
      continue;
    } else if (inTable) {
      flushTable();
    }

    // ---- HR ----
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushPara(); flushList();
      out.push('<hr>');
      continue;
    }

    // ---- ATX Headings ----
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      flushPara(); flushList();
      const lvl = hm[1].length;
      out.push(`<h${lvl}>${renderInline(hm[2])}</h${lvl}>`);
      continue;
    }

    // ---- Blank line ----
    if (line.trim() === '') {
      flushPara(); flushList();
      continue;
    }

    // ---- Checklist items: - [ ] or - [x] ----
    const checkMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)/);
    if (checkMatch) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      const checked = checkMatch[1].toLowerCase() === 'x';
      const icon = checked ? '&#9989;' : '&#9744;';
      listItems.push(`${icon} ${renderInline(checkMatch[2])}`);
      continue;
    }

    // ---- Unordered list ----
    const ulMatch = line.match(/^[-*]\s+(.*)/);
    if (ulMatch) {
      flushPara();
      if (listType !== 'ul') { flushList(); listType = 'ul'; }
      listItems.push(renderInline(ulMatch[1]));
      continue;
    }

    // ---- Ordered list ----
    const olMatch = line.match(/^\d+\.\s+(.*)/);
    if (olMatch) {
      flushPara();
      if (listType !== 'ol') { flushList(); listType = 'ol'; }
      listItems.push(renderInline(olMatch[1]));
      continue;
    }

    // ---- Paragraph ----
    flushList();
    paraLines.push(line.trim());
  }

  flushPara(); flushList(); flushTable();
  if (inCodeFence) flushCode();

  return `<div class="md-body">${out.join('\n')}</div>`;
}

// ---------------------------------------------------------------------------
// PDF extraction — pdf.js primary, hand-rolled fallback
// ---------------------------------------------------------------------------

async function extractPdfJs(arrayBuffer) {
  if (typeof pdfjsLib === 'undefined') throw new Error('pdf.js not loaded');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageStr = content.items.map(item => item.str || '').join(' ');
    pageTexts.push(pageStr);
  }
  return pageTexts.join('\n').replace(/[ \t]+/g, ' ').trim();
}

// Hand-rolled fallback (§7 of build brief) --------------------------------

function bytesToLatin1(bytes) {
  let result = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    result += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return result;
}

function latin1ToBytes(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

async function inflateBytes(data) {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(data);
  writer.close();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function decodeUtf16Hex(hex) {
  const codepoints = [];
  for (let i = 0; i < hex.length; i += 4) {
    codepoints.push(parseInt(hex.slice(i, i + 4), 16));
  }
  try { return String.fromCharCode(...codepoints); } catch (_) { return ''; }
}

function buildCMap(streams) {
  const cmap = new Map();
  for (const stream of streams) {
    // beginbfchar
    const bfcharRe = /beginbfchar([\s\S]*?)endbfchar/g;
    let m;
    while ((m = bfcharRe.exec(stream)) !== null) {
      const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let p;
      while ((p = pairRe.exec(m[1])) !== null) {
        cmap.set(parseInt(p[1], 16), decodeUtf16Hex(p[2]));
      }
    }
    // beginbfrange
    const bfrangeRe = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = bfrangeRe.exec(stream)) !== null) {
      const block = m[1];
      // Format A: <start> <end> <targetStart>
      const rangeARe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
      let r;
      while ((r = rangeARe.exec(block)) !== null) {
        const start = parseInt(r[1], 16);
        const end   = parseInt(r[2], 16);
        const tgt   = parseInt(r[3], 16);
        const count = Math.min(end - start + 1, 4096);
        for (let i = 0; i < count; i++) {
          cmap.set(start + i, String.fromCodePoint(tgt + i));
        }
      }
      // Format B: <start> <end> [<t1> ...]
      const rangeBRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
      while ((r = rangeBRe.exec(block)) !== null) {
        const start = parseInt(r[1], 16);
        const hexes = r[3].match(/<[0-9a-fA-F]+>/g) || [];
        hexes.forEach((h, i) => cmap.set(start + i, decodeUtf16Hex(h.slice(1, -1))));
      }
    }
  }
  return cmap;
}

function decodePdfString(s) {
  return s.replace(/\\([\\()\n\r\t]|\d{3})/g, (_, ch) => {
    if (ch.length === 3) return String.fromCharCode(parseInt(ch, 8));
    const m = { '\\': '\\', '(': '(', ')': ')', n: '\n', r: '\r', t: '\t' };
    return m[ch] !== undefined ? m[ch] : ch;
  });
}

function looksLikeText(s, threshold) {
  let ok = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x20 && cp <= 0x7e) || cp === 9 || cp === 10 || cp === 13 ||
        (cp >= 0xa0 && cp <= 0xfffd)) ok++;
  }
  return s.length > 0 && ok / s.length >= threshold;
}

function decodePdfHex(hex, cmap) {
  const clean = hex.replace(/\s/g, '');
  if (!clean.length) return '';

  // 1. CMap lookup (2-byte glyph codes)
  if (cmap.size > 0) {
    let res = '';
    let resolved = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16);
      const ch = cmap.get(code);
      if (ch !== undefined) { res += ch; resolved++; } else res += '�';
    }
    if (resolved / (clean.length / 4) >= 0.4) return res;
  }

  // 2. UTF-16BE
  let utf16 = '';
  for (let i = 0; i < clean.length; i += 4) {
    utf16 += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  }
  if (looksLikeText(utf16, 0.55)) return utf16;

  // 3. Latin-1 fallback
  let latin1 = '';
  for (let i = 0; i < clean.length; i += 2) {
    latin1 += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  }
  return latin1;
}

function extractTextOps(content, cmap) {
  const texts = [];

  // 1. Literal paren strings
  const litRe = /\(((?:\\.|[^()\\])*)\)\s*(?:Tj|TJ|'|")/g;
  let m;
  while ((m = litRe.exec(content)) !== null) {
    const d = decodePdfString(m[1]);
    if (d.trim()) texts.push(d);
  }

  // 2. Hex strings
  const hexRe = /<([0-9a-fA-F\s]+)>\s*(?:Tj|TJ|'|")/g;
  while ((m = hexRe.exec(content)) !== null) {
    const d = decodePdfHex(m[1], cmap);
    if (d.trim()) texts.push(d);
  }

  // 3. TJ kerning arrays
  const tjRe = /\[([\s\S]*?)\]\s*TJ/g;
  while ((m = tjRe.exec(content)) !== null) {
    const partRe = /\(((?:\\.|[^()\\])*)\)|<([0-9a-fA-F\s]+)>/g;
    let p;
    let text = '';
    while ((p = partRe.exec(m[1])) !== null) {
      text += p[1] !== undefined ? decodePdfString(p[1]) : decodePdfHex(p[2], cmap);
    }
    if (text.trim()) texts.push(text);
  }

  return texts;
}

async function extractPdfFallback(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const raw = bytesToLatin1(bytes);

  const decodedStreams = [];
  const streamRe = /<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = streamRe.exec(raw)) !== null) {
    const dict = m[1];
    if (/\/Filter\s*\/?FlateDecode/.test(dict) || /\/Filter\s*\[[\s\S]*?\/FlateDecode/.test(dict)) {
      try {
        const inflated = await inflateBytes(latin1ToBytes(m[2]));
        decodedStreams.push(bytesToLatin1(inflated));
      } catch (_) {}
    }
  }

  const cmap = buildCMap(decodedStreams);
  let allText = '';
  for (const stream of decodedStreams) {
    allText += extractTextOps(stream, cmap).join(' ') + '\n';
  }
  return allText.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

async function extractPdf(arrayBuffer) {
  try {
    const text = await extractPdfJs(arrayBuffer);
    if (text.length > 20) return { text, warn: false };
  } catch (_) {}

  // Fallback to hand-rolled extractor
  const text = await extractPdfFallback(arrayBuffer);
  if (text.length < 20) return { text: '', warn: true, empty: true };
  if (text.length < 200) return { text, warn: true };
  return { text, warn: false };
}

// ---------------------------------------------------------------------------
// File upload handler
// ---------------------------------------------------------------------------

async function handleFileUpload(file, textareaId, pillId, nameId) {
  const textarea = document.getElementById(textareaId);
  const pill = document.getElementById(pillId);
  const nameEl = document.getElementById(nameId);

  nameEl.textContent = file.name;
  pill.style.display = 'inline-flex';
  setPillEl(pill, 'running', 'reading…');

  const ext = file.name.split('.').pop().toLowerCase();

  if (['doc', 'docx'].includes(ext)) {
    setPillEl(pill, 'warn', 'DOCX not supported');
    textarea.placeholder = 'DOCX detected — open in Word, copy the text, and paste it here. Or save as PDF and upload that.';
    return;
  }

  if (ext === 'pdf') {
    try {
      const buf = await file.arrayBuffer();
      const { text, warn, empty } = await extractPdf(buf);
      if (empty) {
        setPillEl(pill, 'fail', 'no text layer');
        textarea.placeholder = 'No readable text found — this PDF may be scanned or image-only. Please paste the content manually.';
        return;
      }
      textarea.value = text;
      saveStorage();
      if (warn) {
        setPillEl(pill, 'warn', `partial — ${text.length.toLocaleString()} chars`);
      } else {
        setPillEl(pill, 'done', `${text.length.toLocaleString()} chars`);
      }
    } catch (err) {
      setPillEl(pill, 'fail', 'extraction failed');
      console.error(err);
    }
    return;
  }

  // Plain text types
  try {
    const text = await file.text();
    textarea.value = text;
    saveStorage();
    setPillEl(pill, 'done', `${text.length.toLocaleString()} chars`);
  } catch (_) {
    setPillEl(pill, 'fail', 'read failed');
  }
}

// ---------------------------------------------------------------------------
// Pills
// ---------------------------------------------------------------------------

function setPillEl(el, state, text) {
  el.className = `pill ${state}`;
  el.textContent = text;
}

function setPillState(section, state) {
  const el = document.getElementById(`pill-${section}`);
  if (!el) return;
  el.className = `pill ${state}`;
  const labels = SECTION_LABELS;
  const stateText = { running: `${labels[section]} — generating…`, done: `${labels[section]} ✓`, fail: `${labels[section]} — error` };
  el.textContent = stateText[state] || labels[section];
}

function resetPills() {
  SECTIONS.forEach(s => {
    const el = document.getElementById(`pill-${s}`);
    if (el) { el.className = 'pill'; el.textContent = SECTION_LABELS[s]; }
  });
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function renderTab(section) {
  const pane = document.getElementById(`tab-${section}`);
  if (!pane) return;
  const text = OUTPUT_CACHE[section];
  if (text) {
    pane.innerHTML = renderMarkdown(text);
  }
}

function switchTab(section) {
  activeTab = section;
  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === section);
  });
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === `tab-${section}`);
  });
  renderTab(section);
}

// ---------------------------------------------------------------------------
// Generate — SSE consumer
// ---------------------------------------------------------------------------

async function generate() {
  if (isGenerating) return;

  const linkedinText = document.getElementById('linkedin').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const baseUrl = document.getElementById('base-url').value.trim();
  const model = document.getElementById('model').value.trim();

  if (!linkedinText) {
    alert('Please paste your LinkedIn profile content (or upload a file).');
    return;
  }
  if (!apiKey) {
    openSettings();
    alert('Please enter your API key in the API Settings panel.');
    return;
  }
  if (!baseUrl) {
    openSettings();
    alert('Please enter the Base URL in the API Settings panel.');
    return;
  }
  if (!model) {
    openSettings();
    alert('Please enter a model name in the API Settings panel.');
    return;
  }

  isGenerating = true;
  document.getElementById('btn-generate').disabled = true;

  // Reset output
  SECTIONS.forEach(s => { OUTPUT_CACHE[s] = ''; });
  SECTIONS.forEach(s => {
    const pane = document.getElementById(`tab-${s}`);
    if (pane) pane.innerHTML = '<div class="generating">Generating…</div>';
  });

  // Show status and output panel
  document.getElementById('status-row').style.display = 'flex';
  document.getElementById('output-panel').style.display = 'block';
  resetPills();
  SECTIONS.forEach(s => setPillState(s, 'running'));

  // Switch to linkedin tab to show live streaming
  switchTab('linkedin');
  document.getElementById('output-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const payload = {
    api_key: apiKey,
    base_url: baseUrl,
    model: model,
    linkedin: linkedinText,
    website: document.getElementById('website').value.trim(),
    github: document.getElementById('github').value.trim(),
    cv: document.getElementById('cv').value.trim(),
    q1: document.getElementById('q1').value.trim(),
    q2: document.getElementById('q2').value.trim(),
    q3: document.getElementById('q3').value.trim(),
  };

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { const j = await response.json(); msg = j.detail || msg; } catch (_) {}
      throw new Error(msg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          handleSSEData(data);
        } catch (_) {}
      }
    }

  } catch (err) {
    SECTIONS.forEach(s => {
      if (!OUTPUT_CACHE[s]) {
        setPillState(s, 'fail');
        const pane = document.getElementById(`tab-${s}`);
        if (pane) pane.innerHTML = `<div class="error-msg">Error: ${escapeHtml(err.message)}</div>`;
      }
    });
  } finally {
    isGenerating = false;
    document.getElementById('btn-generate').disabled = false;
  }
}

function handleSSEData(data) {
  // All sections complete
  if (data.done && !data.section) {
    SECTIONS.forEach(s => {
      if (!OUTPUT_CACHE[s]) setPillState(s, 'fail');
    });
    // Show refine panel and reset its chat history for this new run
    document.getElementById('refine-panel').style.display = 'block';
    document.getElementById('refine-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    chatHistory.length = 0;
    document.getElementById('chat-history').innerHTML = '';
    return;
  }

  if (!data.section) return;
  const section = data.section;

  if (data.chunk) {
    OUTPUT_CACHE[section] = (OUTPUT_CACHE[section] || '') + data.chunk;
    if (section === activeTab) renderTab(section);
  }

  if (data.done) {
    setPillState(section, 'done');
    renderTab(section);
  }

  if (data.error) {
    setPillState(section, 'fail');
    const pane = document.getElementById(`tab-${section}`);
    if (pane) pane.innerHTML = `<div class="error-msg">Error: ${escapeHtml(String(data.error).slice(0, 300))}</div>`;
  }
}

// ---------------------------------------------------------------------------
// Refine chat
// ---------------------------------------------------------------------------

const chatHistory = [];   // [{role, content}] — full conversation so far
let isRefining = false;

function appendChatBubble(role, content, streaming = false) {
  const history = document.getElementById('chat-history');
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (role === 'user') {
    bubble.textContent = content;
  } else if (streaming) {
    bubble.innerHTML = '<span class="streaming-cursor"></span>';
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }

  wrap.appendChild(bubble);
  history.appendChild(wrap);
  history.scrollTop = history.scrollHeight;
  return bubble;
}

function updateAssistantBubble(bubble, content, done = false) {
  if (done) {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.innerHTML = escapeHtml(content) + '<span class="streaming-cursor"></span>';
  }
  const history = document.getElementById('chat-history');
  history.scrollTop = history.scrollHeight;
}

async function sendRefine() {
  if (isRefining) return;

  const input = document.getElementById('refine-input');
  const question = input.value.trim();
  if (!question) return;

  const apiKey  = document.getElementById('api-key').value.trim();
  const baseUrl = document.getElementById('base-url').value.trim();
  const model   = document.getElementById('model').value.trim();

  if (!apiKey || !baseUrl || !model) {
    openSettings();
    alert('Please configure API settings first.');
    return;
  }

  isRefining = true;
  document.getElementById('btn-refine-send').disabled = true;
  input.value = '';
  input.style.height = '';

  // Snapshot history before adding new messages
  const historySnapshot = chatHistory.slice(-20);

  appendChatBubble('user', question);
  chatHistory.push({ role: 'user', content: question });

  const assistantBubble = appendChatBubble('assistant', '', true);
  let accumulated = '';

  const payload = {
    api_key:  apiKey,
    base_url: baseUrl,
    model:    model,
    question: question,
    outputs:  { ...OUTPUT_CACHE },
    website:  document.getElementById('website').value.trim(),
    github:   document.getElementById('github').value.trim(),
    q1:       document.getElementById('q1').value.trim(),
    q2:       document.getElementById('q2').value.trim(),
    q3:       document.getElementById('q3').value.trim(),
    history:  historySnapshot,
  };

  try {
    const response = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try { const j = await response.json(); msg = j.detail || msg; } catch (_) {}
      throw new Error(msg);
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.chunk) {
            accumulated += data.chunk;
            updateAssistantBubble(assistantBubble, accumulated, false);
          }
          if (data.done) {
            updateAssistantBubble(assistantBubble, accumulated, true);
            chatHistory.push({ role: 'assistant', content: accumulated });
          }
          if (data.error) {
            const msg = `**Error from model:** ${data.error}`;
            updateAssistantBubble(assistantBubble, msg, true);
            chatHistory.pop(); // remove the failed user turn
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    updateAssistantBubble(
      assistantBubble,
      `**Couldn't reach the model.** ${escapeHtml(err.message)}`,
      true
    );
    chatHistory.pop();
  } finally {
    isRefining = false;
    document.getElementById('btn-refine-send').disabled = false;
    input.focus();
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function combinedMarkdown() {
  return SECTIONS
    .filter(s => OUTPUT_CACHE[s])
    .map(s => OUTPUT_CACHE[s])
    .join('\n\n---\n\n');
}

function downloadMarkdown() {
  const text = combinedMarkdown();
  if (!text) { alert('Nothing to download yet — run Generate first.'); return; }
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const blob = new Blob([text], { type: 'text/markdown' });
  triggerDownload(blob, `career_package_${date}.md`);
}

function buildPrintableHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: Calibri, 'Segoe UI', sans-serif; font-size: 11pt; line-height: 1.5; margin: 0; padding: 0; }
  h1 { font-size: 20pt; margin: .8em 0 .3em; }
  h2 { font-size: 15pt; border-bottom: 1px solid #333; padding-bottom: .15em; margin: .9em 0 .35em; }
  h3 { font-size: 12.5pt; margin: .75em 0 .3em; }
  h4, h5, h6 { font-size: 11pt; margin: .65em 0 .25em; }
  p { margin: 0 0 .5em; }
  ul, ol { margin: 0 0 .5em; padding-left: 1.4em; }
  li { margin-bottom: .15em; }
  table { border-collapse: collapse; width: 100%; font-size: 10pt; margin-bottom: .6em; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; }
  th { background: #f2f2f2; }
  code { font-family: Consolas, monospace; font-size: .9em; background: #f4f4f4; padding: .1em .3em; }
  pre { background: #f4f4f4; padding: .6em; font-size: .88em; overflow-x: auto; }
  hr { border: none; border-top: 1px solid #ccc; margin: .8em 0; }
  a { color: #2563eb; }
  @page { size: Letter; margin: 0.6in; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function downloadPdf() {
  const text = combinedMarkdown();
  if (!text) { alert('Nothing to export yet — run Generate first.'); return; }
  const html = buildPrintableHtml(renderMarkdown(text).replace('<div class="md-body">', '').replace(/<\/div>$/, ''));
  const w = window.open('', '_blank');
  if (!w) { alert('Pop-up blocked — please allow pop-ups for this page and try again.'); return; }
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 350);
}

function buildWordHtml(bodyHtml) {
  return `<html xmlns:o='urn:schemas-microsoft-com:office:office'
  xmlns:w='urn:schemas-microsoft-com:office:word'
  xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset="utf-8">
<!--[if gte mso 9]><xml>
<w:WordDocument>
<w:View>Normal</w:View>
<w:Zoom>0</w:Zoom>
<w:TrackChanges/>
</w:WordDocument>
</xml><![endif]-->
<style>
  @page WordSection1 { size: 8.5in 11.0in; margin: 1.0in; }
  div.WordSection1 { page: WordSection1; }
  body { font-family: Calibri, sans-serif; font-size: 11pt; }
  h1 { font-size: 20pt; }
  h2 { font-size: 15pt; border-bottom: 1px solid #333; }
  h3 { font-size: 12.5pt; }
  p { margin: 0 0 6pt; }
  ul, ol { margin: 0 0 6pt; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bbb; padding: 3px 6px; font-size: 10pt; }
</style>
</head>
<body><div class="WordSection1">${bodyHtml}</div></body>
</html>`;
}

function downloadDocx() {
  const text = combinedMarkdown();
  if (!text) { alert('Nothing to export yet — run Generate first.'); return; }
  const inner = renderMarkdown(text).replace('<div class="md-body">', '').replace(/<\/div>$/, '');
  const html = buildWordHtml(inner);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const blob = new Blob([html], { type: 'application/msword' });
  triggerDownload(blob, `career_package_${date}.doc`);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function copyCurrentTab() {
  const text = OUTPUT_CACHE[activeTab] || '';
  if (!text) { alert('This tab is empty.'); return; }
  navigator.clipboard.writeText(text).catch(() => {
    prompt('Copy the text below:', text);
  });
}

function copyAll() {
  const text = combinedMarkdown();
  if (!text) { alert('Nothing to copy yet — run Generate first.'); return; }
  navigator.clipboard.writeText(text).catch(() => {
    prompt('Copy the text below:', text);
  });
}

// ---------------------------------------------------------------------------
// Clear All
// ---------------------------------------------------------------------------

function clearAll() {
  if (isGenerating) { alert('Please wait for generation to complete before clearing.'); return; }
  if (!confirm('Clear all inputs and results?')) return;

  // Clear all form fields
  ['linkedin', 'linkedin-url', 'website', 'github', 'cv', 'q1', 'q2', 'q3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Reset file upload indicators
  ['linkedin-file-name', 'cv-file-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = 'No file chosen';
  });
  ['linkedin-file-pill', 'cv-file-pill', 'linkedin-file'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id.endsWith('-pill')) el.style.display = 'none';
      if (id === 'linkedin-file') el.value = '';
    }
  });
  const cvFile = document.getElementById('cv-file');
  if (cvFile) cvFile.value = '';

  // Reset output and refine
  SECTIONS.forEach(s => { OUTPUT_CACHE[s] = ''; });
  document.getElementById('output-panel').style.display = 'none';
  document.getElementById('status-row').style.display = 'none';
  document.getElementById('refine-panel').style.display = 'none';
  chatHistory.length = 0;
  document.getElementById('chat-history').innerHTML = '';
  resetPills();

  // Clear localStorage
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Load sample
// ---------------------------------------------------------------------------

let sampleCache = null;

async function loadSample() {
  if (!sampleCache) {
    try {
      const res = await fetch('/api/sample');
      const json = await res.json();
      sampleCache = json.content;
    } catch (err) {
      alert('Could not load sample profile. Is the server running?');
      return;
    }
  }
  document.getElementById('linkedin').value = sampleCache;
  document.getElementById('q1').value = 'Solutions Architect, Cloud Architect, Principal Engineer';
  document.getElementById('q2').value = 'Fintech, Enterprise SaaS, Healthcare tech, Government';
  document.getElementById('q3').value = 'Hybrid or remote in Toronto/Canada; targeting a move within 6–9 months';
  saveStorage();
}

// ---------------------------------------------------------------------------
// Job sources
// ---------------------------------------------------------------------------

async function loadJobSources() {
  const grid = document.getElementById('job-sources-grid');
  try {
    const res = await fetch('/api/job-sources');
    const sources = await res.json();
    grid.innerHTML = sources.map(cat => `
      <div class="source-card">
        <h4>${escapeHtml(cat.title)}</h4>
        <p class="desc">${escapeHtml(cat.desc)}</p>
        <div class="links">
          ${cat.links.map(l => {
            const safeUrl = sanitizeUrl(l.url);
            const safeName = escapeHtml(l.name);
            return safeUrl !== '#'
              ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${safeName}</a>`
              : `<span>${safeName}</span>`;
          }).join('')}
        </div>
      </div>
    `).join('');
  } catch (_) {
    grid.innerHTML = '<p style="color:var(--text-faint);font-size:.88rem">Could not load job sources.</p>';
  }
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function openSettings() {
  const details = document.getElementById('settings-details');
  if (details) details.open = true;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  // Load saved state
  loadStorage();

  // Apply saved or default provider
  const providerEl = document.getElementById('provider');
  if (providerEl) {
    const saved = providerEl.value || 'anthropic';
    applyProvider(saved);
  }

  // If no base-url saved, set default
  const baseUrlEl = document.getElementById('base-url');
  if (baseUrlEl && !baseUrlEl.value) {
    baseUrlEl.value = PROVIDERS.anthropic.baseUrl;
  }

  // Persist all inputs on change
  [...PERSIST_FIELDS, 'linkedin-url'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', saveStorage);
  });

  // Provider preset change
  const providerSel = document.getElementById('provider');
  if (providerSel) {
    providerSel.addEventListener('change', () => applyProvider(providerSel.value));
  }

  // Show/hide API key
  const toggleKeyBtn = document.getElementById('toggle-key');
  const apiKeyInput = document.getElementById('api-key');
  if (toggleKeyBtn && apiKeyInput) {
    toggleKeyBtn.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';
      toggleKeyBtn.textContent = isPassword ? 'Hide' : 'Show';
    });
  }

  // File uploads
  const linkedinFile = document.getElementById('linkedin-file');
  if (linkedinFile) {
    linkedinFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleFileUpload(file, 'linkedin', 'linkedin-file-pill', 'linkedin-file-name');
    });
  }

  const cvFile = document.getElementById('cv-file');
  if (cvFile) {
    cvFile.addEventListener('change', e => {
      const file = e.target.files[0];
      if (file) handleFileUpload(file, 'cv', 'cv-file-pill', 'cv-file-name');
    });
  }

  // Tabs
  document.getElementById('tab-bar')?.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.tab) switchTab(tab.dataset.tab);
  });

  // Action buttons
  document.getElementById('btn-generate')?.addEventListener('click', generate);
  document.getElementById('btn-clear')?.addEventListener('click', clearAll);
  document.getElementById('btn-sample')?.addEventListener('click', loadSample);

  // Export buttons
  document.getElementById('btn-copy-tab')?.addEventListener('click', copyCurrentTab);
  document.getElementById('btn-copy-all')?.addEventListener('click', copyAll);
  document.getElementById('btn-dl-md')?.addEventListener('click', downloadMarkdown);
  document.getElementById('btn-dl-pdf')?.addEventListener('click', downloadPdf);
  document.getElementById('btn-dl-docx')?.addEventListener('click', downloadDocx);

  // Refine
  document.getElementById('btn-refine-send')?.addEventListener('click', sendRefine);
  document.getElementById('refine-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendRefine();
    }
  });

  // Load job sources in the background
  loadJobSources();
}

document.addEventListener('DOMContentLoaded', init);
