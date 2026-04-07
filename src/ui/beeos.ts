/**
 * BeeOS — Operator Interface for OpenClaw Safe (Phase 14).
 *
 * Serves a terminal-inspired single-page application at /ui.
 * The UI is read-only over system truth: it consumes display + replay +
 * policy explain outputs via the /v1/ API and contains no business logic,
 * no policy logic, and no direct DB access.
 *
 * Views:
 *   #sessions           — Session Explorer
 *   #sessions/:id       — Replay Viewer
 *   #diff               — Diff Viewer
 *   #policy             — Policy Editor
 *   #approvals          — Approval Inbox
 *   #artifacts          — Artifact Browser
 */

import { Router } from 'express';

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/** Create an Express router that serves the BeeOS SPA at any /ui/* path. */
export function createBeeOSRouter(): Router {
  const r = Router();
  r.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(BEEOS_HTML);
  });
  r.get('*', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(BEEOS_HTML);
  });
  return r;
}

// ---------------------------------------------------------------------------
// BeeOS HTML — complete self-contained SPA
// ---------------------------------------------------------------------------

const BEEOS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BeeOS \u2014 Bee Pagoda Systems</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#080d08;--bg2:#0d160d;--bg3:#111a11;
  --fg:#00cc00;--fg2:#009900;--fg3:#006600;
  --hi:#00ff44;--hi2:#ffcc00;--err:#ff4444;--warn:#ffcc00;
  --br:#1a2e1a;--br2:#224422;
  --font:'Courier New',Courier,monospace;
  --sz:13px;
}
html,body{height:100%;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:var(--sz)}
a{color:var(--hi);text-decoration:none}
a:hover{text-decoration:underline}
button{
  background:var(--bg3);border:1px solid var(--br2);color:var(--fg);
  font-family:var(--font);font-size:var(--sz);padding:3px 10px;cursor:pointer;
}
button:hover{background:var(--br2);color:var(--hi)}
button.danger{border-color:#442222;color:#cc4444}
button.danger:hover{background:#331111;color:var(--err)}
button.primary{border-color:#224422;color:var(--hi)}
button.primary:hover{background:#224422}
input,select,textarea{
  background:var(--bg3);border:1px solid var(--br);color:var(--fg);
  font-family:var(--font);font-size:var(--sz);padding:3px 6px;
}
input:focus,select:focus,textarea:focus{outline:1px solid var(--br2);border-color:var(--br2)}
textarea{resize:vertical}
table{width:100%;border-collapse:collapse}
th{color:var(--fg2);border-bottom:1px solid var(--br);padding:4px 8px;text-align:left;font-weight:normal}
td{padding:4px 8px;border-bottom:1px solid var(--bg3)}
tr:hover td{background:var(--bg3)}
.dim{color:var(--fg3)}
.hi{color:var(--hi)}
.warn{color:var(--warn)}
.err{color:var(--err)}
.ok{color:#00cc66}
.tag{
  display:inline-block;padding:1px 5px;border:1px solid;font-size:11px;
  border-radius:2px;margin-right:3px;
}
.tag-ok{border-color:#224422;color:#00cc66}
.tag-warn{border-color:#443300;color:var(--warn)}
.tag-err{border-color:#442222;color:var(--err)}
.tag-info{border-color:var(--br2);color:var(--fg2)}

/* Layout */
#shell{display:flex;flex-direction:column;height:100vh}
#topbar{
  background:var(--bg2);border-bottom:1px solid var(--br);
  display:flex;align-items:center;gap:16px;padding:6px 12px;flex-shrink:0;
}
#topbar .logo{color:var(--hi);font-weight:bold;font-size:14px;white-space:nowrap}
#topbar .logo span{color:var(--fg2)}
#nav{display:flex;gap:2px;flex:1;flex-wrap:wrap}
#nav a{
  padding:3px 10px;border:1px solid transparent;color:var(--fg2);
  border-radius:2px;white-space:nowrap;
}
#nav a:hover,#nav a.active{
  border-color:var(--br2);color:var(--hi);background:var(--bg3);
  text-decoration:none;
}
#auth-wrap{display:flex;align-items:center;gap:6px;flex-shrink:0}
#auth-wrap label{color:var(--fg3);font-size:11px}
#token-input{width:160px;font-size:11px;background:var(--bg);border-color:var(--br)}

#content{flex:1;overflow-y:auto;padding:16px}

#statusbar{
  background:var(--bg2);border-top:1px solid var(--br);
  display:flex;justify-content:space-between;padding:3px 12px;
  font-size:11px;color:var(--fg3);flex-shrink:0;
}

/* View chrome */
.view-header{
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid var(--br);
}
.view-title{color:var(--hi);font-size:15px;letter-spacing:1px}
.view-actions{display:flex;gap:6px;align-items:center}

/* Cards / panels */
.panel{background:var(--bg2);border:1px solid var(--br);padding:12px;margin-bottom:12px}
.panel-title{color:var(--fg2);font-size:11px;letter-spacing:1px;margin-bottom:8px;
  text-transform:uppercase;border-bottom:1px solid var(--br);padding-bottom:4px}

/* Collapsible sections */
details{margin-bottom:4px;border:1px solid var(--br);background:var(--bg2)}
details summary{
  padding:6px 10px;cursor:pointer;color:var(--fg2);list-style:none;
  display:flex;align-items:center;gap:6px;user-select:none;
}
details summary::-webkit-details-marker{display:none}
details summary::before{content:'\u25b6';font-size:10px;transition:.1s}
details[open] summary::before{content:'\u25bc'}
details[open] summary{color:var(--fg);border-bottom:1px solid var(--br)}
.details-body{padding:8px 10px;font-size:12px;overflow-x:auto}
.details-body pre{white-space:pre-wrap;word-break:break-all}

/* Timeline */
.event-row{
  display:grid;grid-template-columns:120px 160px 1fr;gap:8px;
  padding:3px 0;border-bottom:1px solid var(--bg3);font-size:12px;
}
.event-row:last-child{border-bottom:none}
.event-type{color:var(--fg2)}
.event-actor{color:var(--fg3)}

/* Forms */
.form-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.form-row label{color:var(--fg2);width:120px;flex-shrink:0;font-size:12px}
.form-row input,.form-row select,.form-row textarea{flex:1}
.form-actions{display:flex;gap:6px;margin-top:10px}

/* Policy rule card */
.rule-card{
  background:var(--bg2);border:1px solid var(--br);padding:8px 12px;
  margin-bottom:6px;display:flex;align-items:flex-start;gap:10px;
}
.rule-card .rule-order{color:var(--fg3);width:24px;flex-shrink:0;font-size:11px;padding-top:2px}
.rule-card .rule-body{flex:1;min-width:0}
.rule-card .rule-mode{
  padding:1px 6px;border:1px solid;font-size:11px;flex-shrink:0;
}
.rule-mode-allow{border-color:#224422;color:#00cc66}
.rule-mode-deny{border-color:#442222;color:var(--err)}
.rule-mode-approval{border-color:#443300;color:var(--warn)}
.rule-mode-other{border-color:var(--br2);color:var(--fg2)}

/* Approval card */
.approval-card{
  background:var(--bg2);border:1px solid var(--br);padding:10px 14px;
  margin-bottom:8px;
}
.approval-header{display:flex;justify-content:space-between;margin-bottom:6px}
.approval-meta{font-size:11px;color:var(--fg3);margin-bottom:8px}
.approval-actions{display:flex;gap:8px}

/* Artifact row */
.artifact-row{
  display:grid;grid-template-columns:200px 100px 100px 80px 1fr 130px;
  gap:8px;padding:4px 8px;border-bottom:1px solid var(--bg3);font-size:12px;
  align-items:center;
}
.artifact-row.header{color:var(--fg3);border-bottom:1px solid var(--br);padding:3px 8px}

/* Filters */
.filter-bar{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.filter-bar label{color:var(--fg3);font-size:11px}
.filter-bar select,.filter-bar input{font-size:11px}

/* Pre/code */
.output-box{
  background:var(--bg);border:1px solid var(--br);padding:10px;
  font-size:11px;max-height:360px;overflow-y:auto;white-space:pre-wrap;
  word-break:break-all;line-height:1.5;
}
.output-box.mono{font-family:var(--font)}

/* Boot screen */
#boot{
  position:fixed;inset:0;background:var(--bg);display:flex;
  flex-direction:column;align-items:center;justify-content:center;
  z-index:9999;transition:opacity .4s;
}
#boot pre{color:var(--fg2);font-size:12px;line-height:1.4;text-align:center}
#boot .boot-log{color:var(--fg3);margin-top:20px;font-size:12px;width:360px}
#boot .boot-line{opacity:0;animation:fadein .3s forwards}
@keyframes fadein{to{opacity:1}}
.progress-bar{
  width:360px;height:2px;background:var(--br);margin-top:12px;overflow:hidden;
}
.progress-fill{height:100%;background:var(--hi);animation:progress 1.8s ease forwards}
@keyframes progress{from{width:0}to{width:100%}}

/* Spinner */
.spinner::after{
  content:'\u25b6\u25b6\u25b6';color:var(--fg3);
  animation:blink .8s step-end infinite;
}
@keyframes blink{50%{opacity:0}}

/* Empty state */
.empty{color:var(--fg3);padding:24px;text-align:center;font-size:12px}

/* Integrity badge */
.integrity-ok::before{content:'\u2022 ';color:#00cc66}
.integrity-fail::before{content:'\u2022 ';color:var(--err)}
.integrity-unknown::before{content:'\u2022 ';color:var(--fg3)}

/* Split layout for diff / policy explain */
.split{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:800px){.split{grid-template-columns:1fr}}
</style>
</head>
<body>
<div id="boot">
<pre>
  ██████╗ ███████╗███████╗ ██████╗ ███████╗
  ██╔══██╗██╔════╝██╔════╝██╔═══██╗██╔════╝
  ██████╔╝█████╗  █████╗  ██║   ██║███████╗
  ██╔══██╗██╔══╝  ██╔══╝  ██║   ██║╚════██║
  ██████╔╝███████╗███████╗╚██████╔╝███████║
  ╚═════╝ ╚══════╝╚══════╝ ╚═════╝ ╚══════╝
        Bee Pagoda Systems — OpenClaw Safe
</pre>
<div class="boot-log" id="boot-log"></div>
<div class="progress-bar"><div class="progress-fill"></div></div>
</div>

<div id="shell">
  <div id="topbar">
    <div class="logo">&#x1F41D; BeeOS <span>v0.4.2</span></div>
    <nav id="nav">
      <a href="#sessions">SESSIONS</a>
      <a href="#replay">REPLAY</a>
      <a href="#diff">DIFF</a>
      <a href="#policy">POLICY</a>
      <a href="#approvals">APPROVALS</a>
      <a href="#artifacts">ARTIFACTS</a>
    </nav>
    <div id="auth-wrap">
      <label for="token-input">TOKEN:</label>
      <input id="token-input" type="password" placeholder="gateway secret (optional)" autocomplete="off">
      <button onclick="saveToken()" title="Set token">SET</button>
    </div>
  </div>
  <div id="content"><div class="empty spinner"> Loading</div></div>
  <div id="statusbar">
    <span id="status-route">&gt;&gt; /sessions</span>
    <span id="status-time"></span>
  </div>
</div>

<script>
(function(){
'use strict';

// ---------------------------------------------------------------------------
// Config & state
// ---------------------------------------------------------------------------
const API = '/v1';
let token = sessionStorage.getItem('beeos-token') || '';
document.getElementById('token-input').value = token;

function saveToken() {
  token = document.getElementById('token-input').value.trim();
  sessionStorage.setItem('beeos-token', token);
  route();
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiFetch(path, options) {
  options = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers['Authorization'] = 'Bearer ' + token;
  try {
    const res = await fetch(API + path, Object.assign({}, options, { headers }));
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      const msg = ct.includes('json') ? (await res.json()).error || res.statusText : res.statusText;
      if (res.status === 401) return { _error: 'Unauthorized — check your token above.', _status: 401 };
      return { _error: msg, _status: res.status };
    }
    if (ct.includes('json')) return res.json();
    return { _text: await res.text() };
  } catch(e) {
    return { _error: e.message };
  }
}

async function apiGet(path) { return apiFetch(path, { method: 'GET' }); }
async function apiPost(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}
async function apiPatch(path, body) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body) });
}
async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function el(id) { return document.getElementById(id); }
function setContent(html) { el('content').innerHTML = html; }
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(); } catch(e) { return iso; }
}
function shortId(id) { return id ? id.slice(0, 8) + '...' : ''; }
function statusTag(state) {
  const cls = { running: 'ok', completed: 'tag-ok', failed: 'tag-err', cancelled: 'tag-err',
    pending: 'tag-info', awaiting_approval: 'tag-warn' }[state] || 'tag-info';
  return '<span class="tag ' + cls + '">' + esc(state) + '</span>';
}
function modeTag(mode) {
  const colors = { allow: 'rule-mode-allow', deny: 'rule-mode-deny',
    allow_with_approval: 'rule-mode-approval' };
  const cls = colors[mode] || 'rule-mode-other';
  return '<span class="rule-mode ' + cls + '">' + esc(mode) + '</span>';
}
function errorBox(msg) {
  return '<div class="panel"><span class="err">ERROR: ' + esc(msg) + '</span></div>';
}
function loadingHtml() { return '<div class="empty spinner"> Loading</div>'; }

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------
function tick() {
  el('status-time') && (el('status-time').textContent = new Date().toLocaleTimeString());
}
setInterval(tick, 1000); tick();

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function updateNav(view) {
  const links = document.querySelectorAll('#nav a');
  links.forEach(function(a) {
    const href = a.getAttribute('href').slice(1); // strip #
    a.classList.toggle('active', view === href || (href !== 'sessions' && view.startsWith(href)));
  });
  el('status-route') && (el('status-route').textContent = '>> /' + view);
}

async function route() {
  const raw = location.hash.slice(1) || 'sessions';
  // parse route: "sessions/abc123" → view=sessions, id=abc123
  const parts = raw.split('/');
  const view = parts[0];
  const arg = parts[1];
  updateNav(raw);
  switch(view) {
    case 'sessions': return arg ? await renderReplay(arg) : await renderSessions();
    case 'replay':   return await renderReplay(arg || '');
    case 'diff':     return await renderDiff();
    case 'policy':   return await renderPolicy();
    case 'approvals':return await renderApprovals();
    case 'artifacts':return await renderArtifacts();
    default:         return await renderSessions();
  }
}

window.addEventListener('hashchange', route);

// ---------------------------------------------------------------------------
// View: Session Explorer
// ---------------------------------------------------------------------------
async function renderSessions() {
  setContent(loadingHtml());
  const data = await apiGet('/sessions');
  if (data._error) { setContent(errorBox(data._error)); return; }
  const sessions = data.sessions || [];
  let html = '<div class="view-header">';
  html += '<div class="view-title">SESSION EXPLORER</div>';
  html += '<div class="view-actions"><button onclick="renderSessions()">REFRESH</button></div>';
  html += '</div>';
  if (!sessions.length) {
    html += '<div class="empty dim">No sessions found. Create a session via the API to begin.</div>';
    setContent(html); return;
  }
  html += '<table>';
  html += '<tr><th>ID</th><th>MODE</th><th>BUDGET</th><th>PRINCIPAL</th><th>CREATED</th><th>INTEGRITY</th><th></th></tr>';
  for (const s of sessions) {
    html += '<tr>';
    html += '<td class="hi" title="' + esc(s.id) + '">' + esc(shortId(s.id)) + '</td>';
    html += '<td><span class="tag tag-info">' + esc(s.mode) + '</span></td>';
    html += '<td>' + (s.budget != null ? '<span class="' + (s.budget > 0 ? 'ok' : 'warn') + '">' + esc(String(s.budget)) + '</span>' : '<span class="dim">—</span>') + '</td>';
    html += '<td class="dim" title="' + esc(s.principalId) + '">' + esc(shortId(s.principalId)) + '</td>';
    html += '<td class="dim">' + esc(fmtDate(s.createdAt)) + '</td>';
    html += '<td id="int-' + esc(s.id.slice(0,8)) + '"><span class="integrity-unknown dim">checking...</span></td>';
    html += '<td><a href="#sessions/' + esc(s.id) + '">VIEW REPLAY</a></td>';
    html += '</tr>';
  }
  html += '</table>';
  setContent(html);
  // async integrity checks
  for (const s of sessions.slice(0, 20)) {
    checkIntegrity(s.id);
  }
}

async function checkIntegrity(sessionId) {
  const key = sessionId.slice(0,8);
  const cell = el('int-' + key);
  if (!cell) return;
  const data = await apiGet('/sessions/' + sessionId + '/audit-integrity');
  if (data._error) { cell.innerHTML = '<span class="integrity-unknown dim">—</span>'; return; }
  if (data.valid) {
    cell.innerHTML = '<span class="integrity-ok ok">VALID</span>';
  } else {
    cell.innerHTML = '<span class="integrity-fail err">FAILED</span>';
  }
}

// ---------------------------------------------------------------------------
// View: Replay Viewer
// ---------------------------------------------------------------------------
async function renderReplay(sessionId) {
  if (!sessionId) {
    setContent('<div class="view-header"><div class="view-title">REPLAY VIEWER</div></div>' +
      '<div class="panel">Enter a session ID:<div class="form-row" style="margin-top:8px">' +
      '<input id="replay-id" placeholder="session ID" style="flex:1">' +
      '<button onclick="goReplay()">LOAD</button></div></div>');
    return;
  }
  setContent(loadingHtml());
  const [summary, integrity, replayData] = await Promise.all([
    apiGet('/sessions/' + sessionId + '/replay-summary'),
    apiGet('/sessions/' + sessionId + '/audit-integrity'),
    apiGet('/sessions/' + sessionId + '/replay-export'),
  ]);
  const valid = !integrity._error && integrity.valid;
  let html = '<div class="view-header">';
  html += '<div class="view-title">REPLAY VIEWER</div>';
  html += '<div class="view-actions">';
  html += '<span class="tag ' + (valid ? 'tag-ok' : 'tag-err') + '">' + (valid ? 'INTEGRITY OK' : 'INTEGRITY FAIL') + '</span>';
  html += '<button onclick="location.hash=\'#sessions\'">BACK</button>';
  html += '</div></div>';

  // Session info bar
  html += '<div class="panel">';
  html += '<div class="panel-title">SESSION</div>';
  html += '<div class="dim" style="font-size:11px;margin-bottom:4px">ID: <span class="hi">' + esc(sessionId) + '</span></div>';
  if (summary && !summary._error && summary._text) {
    html += '<div class="output-box" style="max-height:120px">' + esc(summary._text) + '</div>';
  } else if (summary && !summary._error) {
    // JSON summary
    html += '<div class="output-box" style="max-height:120px">' + esc(JSON.stringify(summary, null, 2)) + '</div>';
  }
  html += '</div>';

  // Replay pack timeline
  if (replayData && !replayData._error) {
    const pack = replayData;
    const records = (pack.auditRecords || pack.records || []);
    const artifacts = (pack.artifacts || []);

    // Group records by type
    const groups = {};
    for (const rec of records) {
      const type = rec.eventType || rec.event || 'other';
      const cat = type.startsWith('decision') || type.includes('policy') || type.includes('capability') ? 'decisions'
        : type.startsWith('approval') ? 'approvals'
        : type.startsWith('tool') || type.startsWith('budget') || type.startsWith('browser') ? 'executions'
        : type.startsWith('task') || type.startsWith('delegation') ? 'tasks'
        : 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(rec);
    }

    // Decisions
    html += buildEventSection('POLICY DECISIONS', groups['decisions'] || [], 'decisions');
    // Executions
    html += buildEventSection('TOOL EXECUTIONS', groups['executions'] || [], 'executions');
    // Approvals
    html += buildEventSection('APPROVALS', groups['approvals'] || [], 'approvals');
    // Tasks
    html += buildEventSection('TASK EVENTS', groups['tasks'] || [], 'tasks');
    // Other
    html += buildEventSection('OTHER EVENTS', groups['other'] || [], 'other');

    // Artifacts
    if (artifacts.length) {
      html += '<details><summary><span>ARTIFACTS (' + artifacts.length + ')</span></summary>';
      html += '<div class="details-body">';
      html += '<div class="artifact-row header"><div>ID</div><div>TYPE</div><div>RETENTION</div><div>SIZE</div><div>LABEL</div><div>CREATED</div></div>';
      for (const a of artifacts) {
        html += '<div class="artifact-row">';
        html += '<div class="hi" title="' + esc(a.id) + '">' + esc(shortId(a.id)) + '</div>';
        html += '<div class="tag tag-info">' + esc(a.type) + '</div>';
        html += '<div class="dim">' + esc(a.retentionClass) + '</div>';
        html += '<div class="dim">' + esc(a.size != null ? a.size + 'b' : '—') + '</div>';
        html += '<div>' + esc(a.label || a.mimeType || '—') + '</div>';
        html += '<div class="dim">' + esc(fmtDate(a.createdAt)) + '</div>';
        html += '</div>';
      }
      html += '</div></details>';
    }
  } else if (replayData && replayData._error) {
    html += '<div class="panel dim">Replay export unavailable: ' + esc(replayData._error) + '</div>';
  }

  setContent(html);
}

function buildEventSection(title, records, key) {
  const open = key === 'decisions' || key === 'executions';
  let h = '<details' + (open ? ' open' : '') + '><summary><span>' + esc(title) + ' (' + records.length + ')</span></summary>';
  if (!records.length) {
    h += '<div class="details-body dim">No events in this category.</div>';
  } else {
    h += '<div class="details-body">';
    for (const rec of records) {
      h += '<div class="event-row">';
      h += '<div class="event-type">' + esc(rec.eventType || rec.event || '—') + '</div>';
      h += '<div class="event-actor dim">' + esc(rec.actorId ? shortId(rec.actorId) : (rec.sessionId ? shortId(rec.sessionId) : '—')) + '</div>';
      h += '<div>';
      if (rec.outcome) h += statusTag(rec.outcome) + ' ';
      if (rec.capability) h += '<span class="hi">' + esc(rec.capability) + '</span> ';
      if (rec.matchedRuleId) h += '<span class="dim">rule:' + esc(rec.matchedRuleId) + '</span> ';
      if (rec.tool) h += '<span class="dim">tool:' + esc(rec.tool) + '</span> ';
      if (rec.timestamp) h += '<span class="dim" style="float:right">' + esc(fmtDate(rec.timestamp)) + '</span>';
      h += '</div>';
      h += '</div>';
    }
    h += '</div>';
  }
  h += '</details>';
  return h;
}

function goReplay() {
  const id = (el('replay-id') || {}).value || '';
  if (id) location.hash = '#sessions/' + id;
}

// ---------------------------------------------------------------------------
// View: Diff Viewer
// ---------------------------------------------------------------------------
async function renderDiff() {
  let html = '<div class="view-header">';
  html += '<div class="view-title">DIFF VIEWER</div>';
  html += '</div>';
  html += '<div class="panel"><div class="panel-title">COMPARE SESSIONS</div>';
  html += '<div class="form-row"><label>Session A ID:</label><input id="diff-a" placeholder="first session ID"></div>';
  html += '<div class="form-row"><label>Session B ID:</label><input id="diff-b" placeholder="second session ID"></div>';
  html += '<div class="form-actions"><button class="primary" onclick="runDiff()">RUN DIFF</button></div>';
  html += '</div>';
  html += '<div id="diff-result"></div>';
  setContent(html);
}

async function runDiff() {
  const a = (el('diff-a') || {}).value || '';
  const b = (el('diff-b') || {}).value || '';
  if (!a || !b) { el('diff-result').innerHTML = errorBox('Enter both session IDs'); return; }
  el('diff-result').innerHTML = loadingHtml();
  const data = await apiPost('/sessions/diff', { sessionIdA: a, sessionIdB: b });
  if (data._error) { el('diff-result').innerHTML = errorBox(data._error); return; }
  let html = '<div class="split">';
  // Summary
  html += '<div><div class="panel-title">DIFF SUMMARY</div>';
  html += '<div class="output-box">' + esc(JSON.stringify(data, null, 2)) + '</div></div>';
  // Changes
  const changes = data.changes || data.diffs || [];
  html += '<div><div class="panel-title">CHANGES</div><div class="panel">';
  if (!changes.length) {
    html += '<div class="dim">No changes detected.</div>';
  } else {
    for (const c of changes) {
      const sign = c.type === 'added' ? '+' : c.type === 'removed' ? '-' : '~';
      const cls = c.type === 'added' ? 'ok' : c.type === 'removed' ? 'err' : 'warn';
      html += '<div class="' + cls + '" style="margin-bottom:3px"><span>' + esc(sign) + '</span> ' + esc(c.description || c.field || JSON.stringify(c)) + '</div>';
    }
  }
  html += '</div></div>';
  html += '</div>';
  el('diff-result').innerHTML = html;
}

// ---------------------------------------------------------------------------
// View: Policy Editor
// ---------------------------------------------------------------------------
async function renderPolicy() {
  setContent(loadingHtml());
  const data = await apiGet('/policy/rules');
  if (data._error) { setContent(errorBox(data._error)); return; }
  const rules = data.rules || [];

  let html = '<div class="view-header">';
  html += '<div class="view-title">POLICY EDITOR</div>';
  html += '<div class="view-actions"><button onclick="renderPolicy()">REFRESH</button></div>';
  html += '</div>';

  // Rule list
  html += '<div class="panel"><div class="panel-title">RULES (' + rules.length + ')</div>';
  if (!rules.length) {
    html += '<div class="dim">No custom rules. Default policy applies.</div>';
  } else {
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      html += '<div class="rule-card">';
      html += '<div class="rule-order dim">' + (i + 1) + '</div>';
      html += '<div class="rule-body">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">';
      html += '<span class="hi">' + esc(r.id ? shortId(r.id) : ('rule-' + i)) + '</span>';
      html += modeTag(r.mode);
      if (r.capability) html += '<span class="dim">capability: <span class="fg">' + esc(r.capability) + '</span></span>';
      if (r.principalType) html += '<span class="dim">principal: ' + esc(r.principalType) + '</span>';
      if (r.riskClass) html += '<span class="dim">risk: <span class="warn">' + esc(r.riskClass) + '</span></span>';
      html += '</div>';
      if (r.reason) html += '<div class="dim" style="font-size:11px">' + esc(r.reason) + '</div>';
      html += '</div>';
      html += '<button class="danger" onclick="deleteRule(' + "'" + esc(r.id) + "'" + ')">DEL</button>';
      html += '</div>';
    }
  }
  html += '</div>';

  // Add rule form
  html += '<div class="panel"><div class="panel-title">ADD RULE</div>';
  html += '<div class="form-row"><label>Capability:</label><input id="rule-cap" placeholder="e.g. browser_doc_fetch (leave blank for wildcard)"></div>';
  html += '<div class="form-row"><label>Mode:</label><select id="rule-mode">';
  for (const m of ['deny','allow','allow_with_approval','sandbox_only','host_elevated_only','readonly_visibility']) {
    html += '<option value="' + m + '">' + m + '</option>';
  }
  html += '</select></div>';
  html += '<div class="form-row"><label>Principal type:</label><select id="rule-ptype"><option value="">any</option>';
  for (const t of ['operator','user','child_agent','system']) html += '<option value="' + t + '">' + t + '</option>';
  html += '</select></div>';
  html += '<div class="form-row"><label>Risk class:</label><select id="rule-risk"><option value="">any</option>';
  for (const rc of ['A','B','C','D','E','F']) html += '<option value="' + rc + '">' + rc + '</option>';
  html += '</select></div>';
  html += '<div class="form-row"><label>Reason:</label><input id="rule-reason" placeholder="optional description"></div>';
  html += '<div class="form-actions"><button class="primary" onclick="addRule()">ADD RULE</button></div>';
  html += '</div>';

  // Policy explain
  html += '<div class="panel"><div class="panel-title">POLICY EXPLAIN PREVIEW</div>';
  html += '<div class="form-row"><label>Capability:</label><input id="exp-cap" placeholder="capability name"></div>';
  html += '<div class="form-row"><label>Principal type:</label><select id="exp-ptype"><option value="operator">operator</option><option value="user">user</option><option value="child_agent">child_agent</option><option value="system">system</option></select></div>';
  html += '<div class="form-row"><label>Trust level:</label><select id="exp-trust"><option value="high">high</option><option value="medium">medium</option><option value="low">low</option></select></div>';
  html += '<div class="form-row"><label>Risk class:</label><select id="exp-risk"><option value="">—</option>';
  for (const rc of ['A','B','C','D','E','F']) html += '<option value="' + rc + '">' + rc + '</option>';
  html += '</select></div>';
  html += '<div class="form-actions"><button class="primary" onclick="runExplain()">EXPLAIN</button></div>';
  html += '<div id="explain-result" style="margin-top:8px"></div>';
  html += '</div>';

  setContent(html);
}

async function deleteRule(id) {
  if (!id) return;
  const data = await apiDelete('/policy/rules/' + id);
  if (data && data._error) { alert('Error: ' + data._error); return; }
  renderPolicy();
}

async function addRule() {
  const cap = (el('rule-cap') || {}).value || '';
  const mode = (el('rule-mode') || {}).value || 'deny';
  const ptype = (el('rule-ptype') || {}).value || '';
  const risk = (el('rule-risk') || {}).value || '';
  const reason = (el('rule-reason') || {}).value || '';
  const body = { mode };
  if (cap) body.capability = cap;
  if (ptype) body.principalType = ptype;
  if (risk) body.riskClass = risk;
  if (reason) body.reason = reason;
  const data = await apiPost('/policy/rules', body);
  if (data && data._error) { alert('Error: ' + data._error); return; }
  renderPolicy();
}

async function runExplain() {
  const cap = (el('exp-cap') || {}).value || '';
  const ptype = (el('exp-ptype') || {}).value || 'operator';
  const trust = (el('exp-trust') || {}).value || 'medium';
  const risk = (el('exp-risk') || {}).value || '';
  const ctx = { capability: cap, principalType: ptype, trustLevel: trust };
  if (risk) ctx.riskClass = risk;
  const data = await apiPost('/policy/explain', { context: ctx });
  const resultEl = el('explain-result');
  if (!resultEl) return;
  if (data && data._error) { resultEl.innerHTML = errorBox(data._error); return; }
  resultEl.innerHTML = '<div class="output-box">' + esc(JSON.stringify(data, null, 2)) + '</div>';
}

// ---------------------------------------------------------------------------
// View: Approval Inbox
// ---------------------------------------------------------------------------
async function renderApprovals() {
  setContent(loadingHtml());
  const data = await apiGet('/approvals');
  if (data._error) { setContent(errorBox(data._error)); return; }
  const approvals = data.approvals || [];

  let html = '<div class="view-header">';
  html += '<div class="view-title">APPROVAL INBOX</div>';
  html += '<div class="view-actions"><button onclick="renderApprovals()">REFRESH</button></div>';
  html += '</div>';

  const pending = approvals.filter(function(a) { return a.outcome === 'pending'; });
  const resolved = approvals.filter(function(a) { return a.outcome !== 'pending'; });

  if (!approvals.length) {
    html += '<div class="empty dim">No approval requests found.</div>';
    setContent(html); return;
  }

  if (pending.length) {
    html += '<div class="panel-title" style="margin-bottom:8px">PENDING (' + pending.length + ')</div>';
    for (const a of pending) {
      html += buildApprovalCard(a, true);
    }
  }

  if (resolved.length) {
    html += '<details style="margin-top:12px"><summary><span>RESOLVED (' + resolved.length + ')</span></summary>';
    html += '<div class="details-body">';
    for (const a of resolved) {
      html += buildApprovalCard(a, false);
    }
    html += '</div></details>';
  }

  setContent(html);
}

function buildApprovalCard(a, showActions) {
  const outCls = a.outcome === 'approved' ? 'ok' : a.outcome === 'denied' ? 'err' : a.outcome === 'pending' ? 'warn' : 'dim';
  let html = '<div class="approval-card">';
  html += '<div class="approval-header">';
  html += '<span class="hi" title="' + esc(a.id) + '">' + esc(shortId(a.id)) + '</span>';
  html += '<span class="' + outCls + '">' + esc(a.outcome) + '</span>';
  html += '</div>';
  html += '<div class="approval-meta">';
  if (a.capability) html += 'Capability: <span class="hi">' + esc(a.capability) + '</span>  ';
  if (a.tool) html += 'Tool: <span class="fg">' + esc(a.tool) + '</span>  ';
  if (a.sessionId) html += 'Session: <span class="dim" title="' + esc(a.sessionId) + '">' + esc(shortId(a.sessionId)) + '</span>  ';
  if (a.taskId) html += 'Task: <span class="dim" title="' + esc(a.taskId) + '">' + esc(shortId(a.taskId)) + '</span>  ';
  if (a.duration) html += 'Duration: <span class="dim">' + esc(a.duration) + '</span>  ';
  if (a.createdAt) html += '<span class="dim">' + esc(fmtDate(a.createdAt)) + '</span>';
  html += '</div>';
  if (a.reason) html += '<div style="font-size:11px;margin-bottom:8px;color:var(--fg3)">' + esc(a.reason) + '</div>';
  if (showActions && a.outcome === 'pending') {
    html += '<div class="approval-actions">';
    html += '<button class="primary" onclick="resolveApproval(' + "'" + esc(a.id) + "','approved'" + ')">APPROVE</button>';
    html += '<button class="danger" onclick="resolveApproval(' + "'" + esc(a.id) + "','denied'" + ')">DENY</button>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

async function resolveApproval(id, outcome) {
  const data = await apiPost('/approvals/' + id + '/resolve', { outcome });
  if (data && data._error) { alert('Error: ' + data._error); return; }
  renderApprovals();
}

// ---------------------------------------------------------------------------
// View: Artifact Browser
// ---------------------------------------------------------------------------
async function renderArtifacts(filterType, filterSession) {
  setContent(loadingHtml());
  let query = '';
  if (filterType) query += '?type=' + encodeURIComponent(filterType);
  if (filterSession) query += (query ? '&' : '?') + 'sessionId=' + encodeURIComponent(filterSession);
  const data = await apiGet('/artifacts' + query);
  if (data._error) { setContent(errorBox(data._error)); return; }
  const artifacts = data.artifacts || [];

  let html = '<div class="view-header">';
  html += '<div class="view-title">ARTIFACT BROWSER</div>';
  html += '<div class="view-actions"><button onclick="renderArtifacts()">REFRESH</button></div>';
  html += '</div>';

  html += '<div class="filter-bar">';
  html += '<label>Type:</label><select id="filt-type" onchange="applyArtifactFilter()">';
  html += '<option value="">all</option>';
  for (const t of ['file','screenshot','pdf','log','diff','structured_data','replay_pack']) {
    html += '<option value="' + t + '" ' + (filterType === t ? 'selected' : '') + '>' + t + '</option>';
  }
  html += '</select>';
  html += '<label>Session:</label><input id="filt-session" placeholder="session ID" value="' + esc(filterSession || '') + '" style="width:200px">';
  html += '<button onclick="applyArtifactFilter()">FILTER</button>';
  html += '</div>';

  if (!artifacts.length) {
    html += '<div class="empty dim">No artifacts match the current filter.</div>';
    setContent(html); return;
  }

  // Group by type
  const groups = {};
  for (const a of artifacts) {
    const t = a.type || 'unknown';
    if (!groups[t]) groups[t] = [];
    groups[t].push(a);
  }

  for (const [type, items] of Object.entries(groups)) {
    html += '<details open><summary><span>' + esc(type.toUpperCase()) + ' (' + items.length + ')</span></summary>';
    html += '<div class="details-body">';
    html += '<div class="artifact-row header"><div>ID</div><div>RETENTION</div><div>SIZE</div><div>REDACT</div><div>SESSION</div><div>CREATED</div></div>';
    for (const a of items) {
      html += '<div class="artifact-row">';
      html += '<div class="hi" title="' + esc(a.id) + '">' + esc(shortId(a.id)) + '</div>';
      html += '<div><span class="tag tag-info">' + esc(a.retentionClass || '—') + '</span></div>';
      html += '<div class="dim">' + esc(a.size != null ? a.size + 'b' : '—') + '</div>';
      html += '<div class="dim">' + esc(a.redactClass || '—') + '</div>';
      html += '<div>' + (a.sessionId ? '<a href="#sessions/' + esc(a.sessionId) + '" title="' + esc(a.sessionId) + '">' + esc(shortId(a.sessionId)) + '</a>' : '<span class="dim">—</span>') + '</div>';
      html += '<div class="dim">' + esc(fmtDate(a.createdAt)) + '</div>';
      html += '</div>';
    }
    html += '</div></details>';
  }
  setContent(html);
}

function applyArtifactFilter() {
  const type = (el('filt-type') || {}).value || '';
  const session = (el('filt-session') || {}).value || '';
  renderArtifacts(type || undefined, session || undefined);
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------
const BOOT_LINES = [
  { text: 'Initializing pollen drive...', delay: 300, ok: true },
  { text: 'Engaging hexagonal grid...', delay: 600, ok: true },
  { text: 'Loading BeeOS v0.4.2...', delay: 1000, ok: false },
  { text: 'All wings operational.', delay: 1400, ok: false },
];

function runBoot() {
  const log = el('boot-log');
  BOOT_LINES.forEach(function(line, i) {
    setTimeout(function() {
      const div = document.createElement('div');
      div.className = 'boot-line';
      div.style.animationDelay = '0s';
      div.innerHTML = esc(line.text) + (line.ok ? '&nbsp;&nbsp;&nbsp;<span class="ok">OK</span>' : '');
      log.appendChild(div);
    }, line.delay);
  });
  setTimeout(function() {
    const boot = el('boot');
    if (boot) { boot.style.opacity = '0'; setTimeout(function() { boot.style.display = 'none'; }, 400); }
    route();
  }, 2000);
}

runBoot();

})();
</script>
</body>
</html>`;
