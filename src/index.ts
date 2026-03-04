#!/usr/bin/env node
import http from "http";
import { EventEmitter } from "events";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { countTextTokens, countMessageTokens, type MessageParam } from "./tokenizer.js";
import { addUsageEntry, loadSession, resetSession, getHistory, getGroupedHistory, type UsageEntry } from "./storage.js";
import { calculateCost, getPricing, formatCost, formatTokens } from "./costs.js";

// ─── Dashboard event bus ──────────────────────────────────────────────────────
const usageEmitter = new EventEmitter();
usageEmitter.setMaxListeners(100);

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Counter</title>
  <style>
    :root {
      --bg: #07090f;
      --surface: rgba(255,255,255,0.035);
      --surface-hover: rgba(255,255,255,0.06);
      --border: rgba(255,255,255,0.07);
      --border-bright: rgba(255,255,255,0.14);
      --text: #f1f5f9;
      --text-sec: #94a3b8;
      --text-dim: #475569;
      --purple: #a78bfa;
      --purple-dim: rgba(167,139,250,0.12);
      --blue: #38bdf8;
      --blue-dim: rgba(56,189,248,0.1);
      --pink: #f472b6;
      --green: #34d399;
      --green-dim: rgba(52,211,153,0.12);
      --red-dim: rgba(248,113,113,0.12);
      --red: #f87171;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
    }
    /* Ambient mesh */
    body::before {
      content: '';
      position: fixed; inset: 0;
      background:
        radial-gradient(ellipse 700px 500px at 15% 15%, rgba(167,139,250,0.07) 0%, transparent 65%),
        radial-gradient(ellipse 500px 700px at 85% 85%, rgba(56,189,248,0.055) 0%, transparent 65%),
        radial-gradient(ellipse 400px 300px at 70% 5%, rgba(244,114,182,0.045) 0%, transparent 55%);
      pointer-events: none; z-index: 0;
    }
    .wrap { position: relative; z-index: 1; max-width: 1100px; margin: 0 auto; padding: 28px 20px 60px; }

    /* ── Header ── */
    .hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 36px; gap: 12px; }
    .hdr-left { display: flex; align-items: center; gap: 12px; }
    .logo {
      width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
      background: linear-gradient(135deg, #a78bfa 0%, #38bdf8 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 19px; box-shadow: 0 0 20px rgba(167,139,250,0.25);
    }
    .hdr h1 { font-size: 1.05rem; font-weight: 600; letter-spacing: -0.02em; color: var(--text); }
    .hdr-sub { font-size: 0.72rem; color: var(--text-dim); margin-top: 1px; }
    .badge {
      display: flex; align-items: center; gap: 6px;
      border-radius: 100px; padding: 4px 11px;
      font-size: 0.68rem; font-weight: 600; letter-spacing: 0.06em;
      background: var(--green-dim); border: 1px solid rgba(52,211,153,0.22);
      color: var(--green); transition: all 0.3s;
    }
    .badge.off { background: var(--red-dim); border-color: rgba(248,113,113,0.22); color: var(--red); }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: blink 2s ease-in-out infinite; }
    @keyframes blink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.45;transform:scale(.75)} }
    .hdr-time { font-size: 0.72rem; color: var(--text-dim); text-align: right; line-height: 1.5; }

    /* ── Section label ── */
    .sec-label {
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--text-dim); margin-bottom: 11px;
    }

    /* ── Stat cards ── */
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 9px; margin-bottom: 36px; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 13px; padding: 16px 15px; cursor: default;
      transition: border-color 0.2s, background 0.2s, transform 0.15s;
    }
    .card:hover { border-color: var(--border-bright); background: var(--surface-hover); transform: translateY(-1px); }
    .card-lbl { font-size: 0.63rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-dim); margin-bottom: 9px; }
    .card-val { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--text); }
    .card-val.grad {
      background: linear-gradient(130deg, #a78bfa 0%, #f472b6 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .card-note { font-size: 0.6rem; color: var(--text-dim); margin-top: 5px; }

    /* ── Projects ── */
    .projects { margin-bottom: 36px; }
    .proj-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 13px; margin-bottom: 7px; overflow: hidden;
      transition: border-color 0.2s;
    }
    .proj-card:hover { border-color: var(--border-bright); }
    .proj-hdr {
      display: flex; align-items: center; padding: 13px 16px;
      cursor: pointer; gap: 12px; user-select: none;
      transition: background 0.15s;
    }
    .proj-hdr:hover { background: rgba(255,255,255,0.02); }
    .proj-icon {
      width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0;
      background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(56,189,248,0.15));
      border: 1px solid rgba(167,139,250,0.15);
      display: flex; align-items: center; justify-content: center; font-size: 15px;
    }
    .proj-info { flex: 1; min-width: 0; }
    .proj-name { font-size: 0.87rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proj-path { font-size: 0.65rem; color: var(--text-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proj-stats { display: flex; align-items: center; gap: 20px; flex-shrink: 0; }
    .proj-stat { text-align: right; }
    .proj-stat-val { font-size: 0.88rem; font-weight: 600; color: var(--purple); }
    .proj-stat-lbl { font-size: 0.6rem; color: var(--text-dim); margin-top: 1px; }
    .chevron {
      width: 14px; height: 14px; flex-shrink: 0; color: var(--text-dim);
      transition: transform 0.2s;
    }
    .proj-card.open .chevron { transform: rotate(90deg); }
    /* Cost bar under proj header */
    .proj-bar-wrap { height: 2px; background: rgba(255,255,255,0.05); margin: 0 16px; border-radius: 2px; overflow: hidden; }
    .proj-bar { height: 100%; background: linear-gradient(90deg, #a78bfa, #f472b6); border-radius: 2px; transition: width 0.6s ease; }
    /* Sessions */
    .proj-sessions { display: none; border-top: 1px solid var(--border); }
    .proj-card.open .proj-sessions { display: block; }
    .sess-row {
      display: flex; align-items: center; gap: 12px;
      padding: 9px 16px 9px 52px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
      transition: background 0.15s;
    }
    .sess-row:last-child { border-bottom: none; }
    .sess-row:hover { background: rgba(255,255,255,0.02); }
    .sess-indicator { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-dim); }
    .sess-indicator.active { background: var(--green); box-shadow: 0 0 6px rgba(52,211,153,0.5); }
    .sess-time { font-size: 0.78rem; color: var(--text-sec); flex: 1; }
    .sess-tokens { font-size: 0.7rem; color: var(--text-dim); }
    .sess-calls { font-size: 0.7rem; color: var(--text-dim); min-width: 50px; text-align: right; }
    .sess-cost { font-size: 0.82rem; font-weight: 600; color: var(--purple); min-width: 72px; text-align: right; }

    /* ── Table ── */
    .tbl-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 13px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
    thead th {
      padding: 10px 15px; text-align: left; white-space: nowrap;
      font-size: 0.61rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--text-dim); background: rgba(0,0,0,0.18); border-bottom: 1px solid var(--border);
    }
    tbody td { padding: 9px 15px; border-bottom: 1px solid rgba(255,255,255,0.038); white-space: nowrap; vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr { transition: background 0.12s; }
    tbody tr:hover td { background: rgba(255,255,255,0.02); }
    .model-tag {
      display: inline-block; padding: 2px 8px; border-radius: 6px;
      font-size: 0.68rem; font-weight: 600;
      background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(56,189,248,0.15);
    }
    .cost-cell { color: var(--purple); font-weight: 600; }
    .dim { color: var(--text-dim); }
    .sec { color: var(--text-sec); }
    @keyframes flash-in {
      0% { background: rgba(167,139,250,0.12); }
      100% { background: transparent; }
    }
    .flash td { animation: flash-in 1.8s ease forwards; }
    .empty-cell { text-align: center; padding: 52px 24px; }
    .empty-icon { font-size: 1.8rem; opacity: 0.3; margin-bottom: 10px; }
    .empty-text { font-size: 0.82rem; color: var(--text-dim); }
    .no-proj { background: var(--surface); border: 1px solid var(--border); border-radius: 13px; padding: 32px; text-align: center; color: var(--text-dim); font-size: 0.82rem; line-height: 1.7; }
    .no-proj code { background: rgba(255,255,255,0.08); border-radius: 4px; padding: 1px 6px; font-family: monospace; font-size: 0.8rem; color: var(--text-sec); }

    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.09); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); }
  </style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="logo">⬡</div>
      <div>
        <h1>Token Counter</h1>
        <div class="hdr-sub" id="session-line">Connecting…</div>
      </div>
      <div class="badge" id="badge"><div class="badge-dot"></div><span id="badge-txt">LIVE</span></div>
    </div>
    <div class="hdr-time" id="hdr-time"></div>
  </div>

  <!-- Current session -->
  <div class="sec-label" id="sess-section-label">Current Session</div>
  <div class="cards">
    <div class="card"><div class="card-lbl">Est. Cost</div><div class="card-val grad" id="c-cost">—</div><div class="card-note">approximate</div></div>
    <div class="card"><div class="card-lbl">Input Tokens</div><div class="card-val" id="c-in">—</div></div>
    <div class="card"><div class="card-lbl">Output Tokens</div><div class="card-val" id="c-out">—</div></div>
    <div class="card"><div class="card-lbl">Cache Read</div><div class="card-val" id="c-cr">—</div></div>
    <div class="card"><div class="card-lbl">Cache Write</div><div class="card-val" id="c-cw">—</div></div>
    <div class="card"><div class="card-lbl">API Calls</div><div class="card-val" id="c-n">—</div></div>
  </div>

  <!-- Projects -->
  <div class="projects">
    <div class="sec-label">Projects</div>
    <div id="proj-list"><div class="no-proj">Loading…</div></div>
  </div>

  <!-- Recent calls -->
  <div class="sec-label">Recent Calls</div>
  <div class="tbl-wrap">
    <table>
      <thead>
        <tr><th>Time</th><th>Model</th><th>Project</th><th>Description</th><th>Input</th><th>Output</th><th>Cache R/W</th><th>Cost</th></tr>
      </thead>
      <tbody id="tbody">
        <tr><td colspan="8"><div class="empty-cell"><div class="empty-icon">◎</div><div class="empty-text">Waiting for first log_usage call…</div></div></td></tr>
      </tbody>
    </table>
  </div>

</div>
<script>
  // ── Utils ──
  function fmt(n){n=n||0;if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'k';return String(n)}
  function fmtCost(u){if(!u||u<0.0001)return '~$0.00';const s=parseFloat(u.toPrecision(2));if(s<0.01)return '~$'+s.toFixed(4);if(s<1)return '~$'+s.toFixed(3);return '~$'+s.toFixed(2)}
  function hhmm(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
  function dtFmt(ts){const d=new Date(ts);const today=new Date();const isToday=d.toDateString()===today.toDateString();const t=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return isToday?'Today · '+t:d.toLocaleDateString([],{month:'short',day:'numeric'})+' · '+t}
  function mdl(m){return m?(m.replace('claude-','').replace(/-\d{8}$/,'')):'—'}
  function projBase(p){if(!p||p==='(no project)')return '—';try{return p.split('/').filter(Boolean).pop()||p}catch{return p}}

  // ── Mode: token in URL = remote/hosted mode ──
  const token = new URLSearchParams(location.search).get('token') || '';
  const isRemote = !!token;
  const LS_KEY = 'tc_v1_' + token;
  let localEntries = [];

  const badge      = document.getElementById('badge');
  const badgeTxt   = document.getElementById('badge-txt');
  const sessionLine = document.getElementById('session-line');
  const hdrTime    = document.getElementById('hdr-time');
  const openProjects = new Set();

  // Remote mode: load localStorage immediately so dashboard works offline
  if (isRemote) {
    document.getElementById('sess-section-label').textContent = 'All Time Stats';
    try { localEntries = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch {}
    if (localEntries.length) renderState(buildState(localEntries), false);
  }

  // ── SSE connection ──
  const sseUrl = isRemote ? '/events?token=' + encodeURIComponent(token) : '/events';
  const es = new EventSource(sseUrl);
  es.onerror = () => { badge.className='badge off'; badgeTxt.textContent='OFFLINE'; };
  es.onopen  = () => { badge.className='badge';     badgeTxt.textContent='LIVE'; };

  es.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (isRemote) {
      // Merge server entries (in-memory since last deploy) with full localStorage history
      const map = new Map(localEntries.map(e => [e.id, e]));
      for (const e of (d.entries || [])) map.set(e.id, e);
      localEntries = [...map.values()].sort((a, b) => a.timestamp < b.timestamp ? -1 : 1);
      if (localEntries.length > 1000) localEntries = localEntries.slice(-1000);
      try { localStorage.setItem(LS_KEY, JSON.stringify(localEntries)); } catch {}
      renderState(buildState(localEntries), true);
    } else {
      renderLocalState(d);
    }
  };

  // ── Client-side state builder (remote/token mode) ──
  // Groups entries by project → sessionId so the projects panel works across machines
  function buildState(entries) {
    const totals = {inputTokens:0, outputTokens:0, cacheReadTokens:0, cacheWriteTokens:0, totalCost:0};
    for (const e of entries) {
      totals.inputTokens     += e.inputTokens     || 0;
      totals.outputTokens    += e.outputTokens    || 0;
      totals.cacheReadTokens  += e.cacheReadTokens  || 0;
      totals.cacheWriteTokens += e.cacheWriteTokens || 0;
      totals.totalCost       += e.totalCost       || 0;
    }
    const pm = new Map();
    for (const e of entries) {
      const proj = e.project || '(no project)';
      if (!pm.has(proj)) pm.set(proj, new Map());
      const sm = pm.get(proj);
      const sid = e.sessionId || 'default';
      if (!sm.has(sid)) sm.set(sid, {entries:[], startedAt: e.timestamp});
      sm.get(sid).entries.push(e);
    }
    const grouped = [...pm.entries()].map(([project, sm]) => {
      const allE = [...sm.values()].flatMap(s => s.entries);
      const sessions = [...sm.entries()].map(([sid, s]) => ({
        sessionId: sid, startedAt: s.startedAt,
        totalInputTokens:  s.entries.reduce((a, e) => a + e.inputTokens, 0),
        totalOutputTokens: s.entries.reduce((a, e) => a + e.outputTokens, 0),
        totalCost:         s.entries.reduce((a, e) => a + e.totalCost, 0),
        entryCount:        s.entries.length,
      })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return {
        project, sessions,
        displayName:       project.split('/').filter(Boolean).pop() || project,
        totalCost:         allE.reduce((a, e) => a + e.totalCost, 0),
        totalInputTokens:  allE.reduce((a, e) => a + e.inputTokens, 0),
        totalOutputTokens: allE.reduce((a, e) => a + e.outputTokens, 0),
      };
    }).sort((a, b) => b.totalCost - a.totalCost);
    return {totals, grouped, entries};
  }

  // ── Render: remote/token mode (uses buildState output) ──
  function renderState({totals: t, grouped, entries}, isLive) {
    const n = entries.length;
    sessionLine.textContent = n + ' call' + (n===1?'':'s') + ' · ' + grouped.length + ' project' + (grouped.length===1?'':'s') + (isLive ? '' : ' · cached');
    hdrTime.innerHTML = 'Updated ' + new Date().toLocaleTimeString();
    document.getElementById('c-cost').textContent = fmtCost(t.totalCost);
    document.getElementById('c-in').textContent   = fmt(t.inputTokens);
    document.getElementById('c-out').textContent  = fmt(t.outputTokens);
    document.getElementById('c-cr').textContent   = fmt(t.cacheReadTokens);
    document.getElementById('c-cw').textContent   = fmt(t.cacheWriteTokens);
    document.getElementById('c-n').textContent    = n;
    renderProjects(grouped, null);
    renderTable([...entries].reverse().slice(0, 30));
  }

  // ── Render: local mode (server sends {session, grouped}) ──
  function renderLocalState(d) {
    const sess = d.session, t = sess.totals, entries = sess.entries || [], grouped = d.grouped || [];
    const started = new Date(sess.startedAt);
    sessionLine.textContent = 'Session since ' + started.toLocaleTimeString() + ' · ' + entries.length + ' call' + (entries.length===1?'':'s');
    hdrTime.innerHTML = 'Updated ' + new Date().toLocaleTimeString() + '<br><span style="color:var(--text-dim);font-size:.66rem">' + started.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}) + '</span>';
    document.getElementById('c-cost').textContent = fmtCost(t.totalCost);
    document.getElementById('c-in').textContent   = fmt(t.inputTokens);
    document.getElementById('c-out').textContent  = fmt(t.outputTokens);
    document.getElementById('c-cr').textContent   = fmt(t.cacheReadTokens);
    document.getElementById('c-cw').textContent   = fmt(t.cacheWriteTokens);
    document.getElementById('c-n').textContent    = entries.length;
    renderProjects(grouped, sess.sessionId);
    renderTable([...entries].reverse().slice(0, 30));
  }

  // ── Shared renderers ──
  function renderProjects(grouped, currentSessId) {
    const pl = document.getElementById('proj-list');
    if (!grouped.length) {
      pl.innerHTML = '<div class="no-proj">No project data yet.<br>Pass a <code>project</code> param to <code>log_usage</code> to track by folder.</div>';
      return;
    }
    const maxCost = Math.max(...grouped.map(g => g.totalCost), 0.001);
    pl.innerHTML = grouped.map(g => {
      const isOpen = openProjects.has(g.project);
      const barPct = Math.max(4, Math.round(g.totalCost / maxCost * 100));
      const sessHtml = g.sessions.map(s => {
        const isActive = currentSessId && s.sessionId === currentSessId;
        return \`<div class="sess-row">
          <div class="sess-indicator\${isActive ? ' active' : ''}"></div>
          <span class="sess-time">\${dtFmt(s.startedAt)}</span>
          <span class="sess-tokens">\${fmt((s.totalInputTokens||0)+(s.totalOutputTokens||0))} tok</span>
          <span class="sess-calls">\${s.entryCount} call\${s.entryCount===1?'':'s'}</span>
          <span class="sess-cost">\${fmtCost(s.totalCost)}</span>
        </div>\`;
      }).join('');
      return \`<div class="proj-card\${isOpen?' open':''}" data-proj="\${g.project}">
        <div class="proj-hdr" onclick="toggleProj(this.parentElement)">
          <div class="proj-icon">📁</div>
          <div class="proj-info">
            <div class="proj-name">\${g.displayName}</div>
            <div class="proj-path">\${g.project}</div>
          </div>
          <div class="proj-stats">
            <div class="proj-stat"><div class="proj-stat-val">\${fmtCost(g.totalCost)}</div><div class="proj-stat-lbl">total cost</div></div>
            <div class="proj-stat"><div class="proj-stat-val">\${g.sessions.length}</div><div class="proj-stat-lbl">session\${g.sessions.length===1?'':'s'}</div></div>
          </div>
          <svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
          </svg>
        </div>
        <div class="proj-bar-wrap"><div class="proj-bar" style="width:\${barPct}%"></div></div>
        <div class="proj-sessions">\${sessHtml}</div>
      </div>\`;
    }).join('');
  }

  function renderTable(rows) {
    const tbody = document.getElementById('tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty-cell"><div class="empty-icon">◎</div><div class="empty-text">Waiting for first log_usage call…</div></div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((en, i) => \`<tr class="\${i===0?'flash':''}">
      <td class="dim">\${hhmm(en.timestamp)}</td>
      <td><span class="model-tag">\${mdl(en.model)}</span></td>
      <td class="dim" title="\${en.project||''}">\${projBase(en.project)}</td>
      <td class="\${en.description?'sec':'dim'}">\${en.description||'—'}</td>
      <td class="sec">\${fmt(en.inputTokens)}</td>
      <td class="sec">\${fmt(en.outputTokens)}</td>
      <td class="dim">\${fmt(en.cacheReadTokens)}/\${fmt(en.cacheWriteTokens)}</td>
      <td class="cost-cell">\${fmtCost(en.totalCost)}</td>
    </tr>\`).join('');
  }

  function toggleProj(card) {
    const proj = card.dataset.proj;
    if (card.classList.contains('open')) { card.classList.remove('open'); openProjects.delete(proj); }
    else { card.classList.add('open'); openProjects.add(proj); }
  }
</script>
</body>
</html>`;

// ─── Handler registration ─────────────────────────────────────────────────────

function registerHandlers(s: Server): void {

s.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "count_tokens",
      description:
        "Count how many tokens a piece of text or a full conversation will consume when sent to Claude. " +
        "Uses the official Anthropic token-counting API — results are exact, not estimated. " +
        "Pass `text` for a single string, or `messages` (+ optional `system`) for a full conversation.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Plain text to count tokens for (treated as a single user message).",
          },
          messages: {
            type: "array",
            description: "Full conversation array (alternative to `text`).",
            items: {
              type: "object",
              properties: {
                role: { type: "string", enum: ["user", "assistant"] },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
          system: {
            type: "string",
            description: "System prompt to include in the token count (only used with `messages`).",
          },
          model: {
            type: "string",
            description: "Model to use for counting (default: claude-opus-4-6).",
          },
        },
      },
    },
    {
      name: "log_usage",
      description:
        "Record actual token usage from a completed Claude API call. " +
        "Logs input tokens, output tokens, and cache tokens, computes cost, " +
        "and persists everything to ~/.claude/token-counter/ for session and history tracking.",
      inputSchema: {
        type: "object",
        properties: {
          input_tokens: { type: "number", description: "Input tokens from the API response usage object." },
          output_tokens: { type: "number", description: "Output tokens from the API response usage object." },
          cache_read_tokens: { type: "number", description: "Cache read (cache_read_input_tokens) from usage." },
          cache_write_tokens: { type: "number", description: "Cache creation (cache_creation_input_tokens) from usage." },
          model: { type: "string", description: "Model that processed the request (default: claude-opus-4-6)." },
          description: { type: "string", description: "Optional label, e.g. 'chat turn 3' or 'planning phase'." },
          project: { type: "string", description: "Absolute path of the current project directory (e.g. process.cwd()). Used for project-level cost grouping in the dashboard." },
        },
        required: ["input_tokens", "output_tokens"],
      },
    },
    {
      name: "get_session_stats",
      description:
        "Return cumulative token counts and USD cost for the current session. " +
        "A session resets when you call reset_session or when the storage file is cleared.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_usage_history",
      description:
        "Return the N most-recent usage log entries across all sessions (newest first). " +
        "Useful for reviewing past spend or finding expensive calls.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max entries to return (default 20, max 100).",
          },
        },
      },
    },
    {
      name: "reset_session",
      description:
        "Start a fresh session. All in-session totals are zeroed out. " +
        "Global history (in history.json) is NOT cleared.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "estimate_cost",
      description:
        "Estimate the USD cost for a given number of input and output tokens without making an API call.",
      inputSchema: {
        type: "object",
        properties: {
          input_tokens: { type: "number" },
          output_tokens: { type: "number" },
          cache_read_tokens: { type: "number" },
          cache_write_tokens: { type: "number" },
          model: { type: "string", description: "Default: claude-opus-4-6" },
        },
        required: ["input_tokens", "output_tokens"],
      },
    },
  ],
}));

// ─── Tool Handlers ────────────────────────────────────────────────────────────

s.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      // ── count_tokens ──────────────────────────────────────────────────────
      case "count_tokens": {
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";

        let result: { inputTokens: number; model: string; exact: boolean; method: string };
        if (a.messages) {
          const messages = a.messages as MessageParam[];
          const system = a.system as string | undefined;
          result = await countMessageTokens(messages, system, model);
        } else if (a.text) {
          result = await countTextTokens(a.text as string, model);
        } else {
          throw new Error("Provide either `text` or `messages`.");
        }

        const pricing = getPricing(model);
        const estimatedInputCost = (result.inputTokens / 1_000_000) * pricing.inputPerMillion;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input_tokens: result.inputTokens,
                  model: result.model,
                  counting_mode: result.exact
                    ? "exact (Anthropic API)"
                    : "approximate (local — set ANTHROPIC_API_KEY for exact counts)",
                  accuracy: result.exact ? "100% exact" : "~97-99% (cl100k_base approximation)",
                  estimated_input_cost_usd: Number(estimatedInputCost.toFixed(8)),
                  estimated_input_cost_formatted: formatCost(estimatedInputCost),
                  note: "Output tokens are unknown until the request completes — use log_usage after.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── log_usage ─────────────────────────────────────────────────────────
      case "log_usage": {
        const inputTokens = Number(a.input_tokens ?? 0);
        const outputTokens = Number(a.output_tokens ?? 0);
        const cacheReadTokens = Number(a.cache_read_tokens ?? 0);
        const cacheWriteTokens = Number(a.cache_write_tokens ?? 0);
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";
        const description = a.description as string | undefined;
        const project = a.project as string | undefined;

        const entry = addUsageEntry(
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          description,
          project,
        );

        usageEmitter.emit("update");

        // Remote sync: fire-and-forget to REMOTE_DASHBOARD_URL if set
        const remoteUrl = process.env.REMOTE_DASHBOARD_URL;
        if (remoteUrl) {
          const ingestUrl = new URL(`${remoteUrl.replace(/\/$/, "")}/ingest`);
          const dashToken = process.env.DASHBOARD_TOKEN;
          if (dashToken) ingestUrl.searchParams.set("token", dashToken);
          fetch(ingestUrl.toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry),
          }).catch(() => { /* ignore — remote dashboard is optional */ });
        }

        const session = loadSession();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  logged: {
                    id: entry.id,
                    model: entry.model,
                    description: entry.description,
                    project: entry.project,
                    tokens: {
                      input: entry.inputTokens,
                      output: entry.outputTokens,
                      cache_read: entry.cacheReadTokens,
                      cache_write: entry.cacheWriteTokens,
                    },
                    cost_usd: Number(entry.totalCost.toFixed(8)),
                    cost_formatted: formatCost(entry.totalCost),
                  },
                  session_running_total: {
                    tokens: {
                      input: session.totals.inputTokens,
                      output: session.totals.outputTokens,
                      cache_read: session.totals.cacheReadTokens,
                      cache_write: session.totals.cacheWriteTokens,
                    },
                    total_cost_usd: Number(session.totals.totalCost.toFixed(8)),
                    total_cost_formatted: formatCost(session.totals.totalCost),
                    entry_count: session.entries.length,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── get_session_stats ─────────────────────────────────────────────────
      case "get_session_stats": {
        const session = loadSession();
        const t = session.totals;
        const totalTokens =
          t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  session_id: session.sessionId,
                  started_at: session.startedAt,
                  entries: session.entries.length,
                  tokens: {
                    input: t.inputTokens,
                    input_formatted: formatTokens(t.inputTokens),
                    output: t.outputTokens,
                    output_formatted: formatTokens(t.outputTokens),
                    cache_read: t.cacheReadTokens,
                    cache_read_formatted: formatTokens(t.cacheReadTokens),
                    cache_write: t.cacheWriteTokens,
                    cache_write_formatted: formatTokens(t.cacheWriteTokens),
                    total: totalTokens,
                    total_formatted: formatTokens(totalTokens),
                  },
                  total_cost_usd: Number(t.totalCost.toFixed(8)),
                  total_cost_formatted: formatCost(t.totalCost),
                  dashboard_url: "http://localhost:8899",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── get_usage_history ─────────────────────────────────────────────────
      case "get_usage_history": {
        const limit = Math.min(Number(a.limit ?? 20), 100);
        const history = getHistory(limit);

        const summary = history.map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          model: e.model,
          description: e.description,
          project: e.project,
          tokens: {
            input: e.inputTokens,
            output: e.outputTokens,
            cache_read: e.cacheReadTokens,
            cache_write: e.cacheWriteTokens,
          },
          cost_formatted: formatCost(e.totalCost),
          cost_usd: Number(e.totalCost.toFixed(8)),
        }));

        const grandTotal = history.reduce((acc, e) => acc + e.totalCost, 0);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  count: history.length,
                  showing: `Last ${limit} entries (newest first)`,
                  total_cost_in_range: formatCost(grandTotal),
                  entries: summary,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── reset_session ─────────────────────────────────────────────────────
      case "reset_session": {
        const newSession = resetSession();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  message: "Session reset. All running totals are now zero.",
                  new_session_id: newSession.sessionId,
                  started_at: newSession.startedAt,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // ── estimate_cost ─────────────────────────────────────────────────────
      case "estimate_cost": {
        const model = (a.model as string | undefined) ?? "claude-opus-4-6";
        const inputTokens = Number(a.input_tokens ?? 0);
        const outputTokens = Number(a.output_tokens ?? 0);
        const cacheReadTokens = Number(a.cache_read_tokens ?? 0);
        const cacheWriteTokens = Number(a.cache_write_tokens ?? 0);

        const costs = calculateCost(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens);
        const pricing = getPricing(model);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  model,
                  pricing_per_million_tokens: {
                    input: `$${pricing.inputPerMillion.toFixed(2)}`,
                    output: `$${pricing.outputPerMillion.toFixed(2)}`,
                    cache_read: `$${pricing.cacheReadPerMillion.toFixed(2)}`,
                    cache_write: `$${pricing.cacheWritePerMillion.toFixed(2)}`,
                  },
                  tokens: {
                    input: inputTokens,
                    output: outputTokens,
                    cache_read: cacheReadTokens,
                    cache_write: cacheWriteTokens,
                  },
                  cost_breakdown: {
                    input: formatCost(costs.inputCost),
                    output: formatCost(costs.outputCost),
                    cache_read: formatCost(costs.cacheReadCost),
                    cache_write: formatCost(costs.cacheWriteCost),
                    total: formatCost(costs.totalCost),
                  },
                  total_cost_usd: Number(costs.totalCost.toFixed(8)),
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

} // end registerHandlers

// ─── Default server instance (stdio) ─────────────────────────────────────────

const server = new Server(
  { name: "token-counter-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);
registerHandlers(server);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addCorsHeaders(res: http.ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function createMcpServer(): Server {
  const s = new Server(
    { name: "token-counter-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  registerHandlers(s);
  return s;
}

function buildSsePayload(): string {
  const session = loadSession();
  const grouped = getGroupedHistory();
  return JSON.stringify({ session, grouped });
}

// ─── In-memory store for HTTP/Railway mode ────────────────────────────────────
// Per-token, no disk writes, resets on redeploy — pure live relay.

const tokenStore = new Map<string, UsageEntry[]>();

function getTokenEntries(token: string): UsageEntry[] {
  if (!tokenStore.has(token)) tokenStore.set(token, []);
  return tokenStore.get(token)!;
}

// Sends flat entries — client rebuilds state + merges with localStorage
function buildTokenSsePayload(token: string): string {
  return JSON.stringify({ entries: getTokenEntries(token) });
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

interface RateBucket { count: number; resetAt: number }
const rateBuckets = new Map<string, RateBucket>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now >= bucket.resetAt) rateBuckets.delete(ip);
  }
}, RATE_WINDOW_MS);

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function checkRateLimit(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const ip = getClientIp(req);
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > RATE_LIMIT) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfter) });
    res.end(JSON.stringify({ error: "Rate limit exceeded. Max 60 requests/minute." }));
    return false;
  }
  return true;
}

// ─── HTTP server (Railway) ────────────────────────────────────────────────────

async function startHttpServer(port: number) {
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    addCorsHeaders(res);

    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "token-counter-mcp", sessions: transports.size }));
      return;
    }

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url.pathname === "/events" && req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      const send = () => { try { res.write(`data: ${buildTokenSsePayload(token)}\n\n`); } catch { /* client gone */ } };
      send();
      usageEmitter.on(`update:${token}`, send);
      const hb = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(hb); usageEmitter.off(`update:${token}`, send); });
      return;
    }

    if (url.pathname === "/ingest" && req.method === "POST") {
      if (!checkRateLimit(req, res)) return;
      const token = url.searchParams.get("token") ?? "";
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const entry = JSON.parse(body) as UsageEntry;
          if (!entry.id || !entry.timestamp || typeof entry.inputTokens !== "number") {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Missing required fields" }));
            return;
          }
          const entries = getTokenEntries(token);
          entries.push(entry);
          // Cap per-token memory at 500 entries (full history lives in browser localStorage)
          if (entries.length > 500) entries.splice(0, entries.length - 500);
          usageEmitter.emit(`update:${token}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid JSON" }));
        }
      });
      return;
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      if (!checkRateLimit(req, res)) return;
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      transport.onclose = () => transports.delete(transport.sessionId);
      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);
      return;
    }

    if (url.pathname === "/messages" && req.method === "POST") {
      if (!checkRateLimit(req, res)) return;
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end(`Session "${sessionId}" not found — connect via /sse first`);
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404); res.end();
  });

  httpServer.listen(port, () => {
    process.stderr.write(`Token Counter MCP running on port ${port}\n`);
    process.stderr.write(`SSE endpoint: http://0.0.0.0:${port}/sse\n`);
  });
}

// ─── Local dashboard server (stdio mode) ─────────────────────────────────────

function startDashboardServer(port: number) {
  const srv = http.createServer((req, res) => {
    addCorsHeaders(res);
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DASHBOARD_HTML);
      return;
    }

    if (url.pathname === "/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
      const send = () => { try { res.write(`data: ${buildSsePayload()}\n\n`); } catch { /* client gone */ } };
      send();
      usageEmitter.on("update", send);
      const hb = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* ignore */ } }, 25000);
      req.on("close", () => { clearInterval(hb); usageEmitter.off("update", send); });
      return;
    }

    res.writeHead(404); res.end();
  });

  srv.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      process.stderr.write(`Dashboard port ${port} in use, trying ${port + 1}\n`);
      port += 1;
      srv.listen(port);
    } else {
      process.stderr.write(`Dashboard error: ${err}\n`);
    }
  });

  srv.listen(port, () => {
    const addr = srv.address();
    const actualPort = typeof addr === "object" && addr ? addr.port : port;
    process.stderr.write(`Dashboard → http://localhost:${actualPort}\n`);
    server.sendLoggingMessage({
      level: "info",
      data: `Token usage dashboard → http://localhost:${actualPort}`,
    }).catch(() => {/* ignore */});
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (process.argv[2] === "setup") {
    const { runSetup } = await import("./setup.js");
    await runSetup();
    process.exit(0);
  }

  const port = process.env.PORT ? parseInt(process.env.PORT) : null;

  if (port) {
    await startHttpServer(port);
  } else {
    const transport = new StdioServerTransport();
    startDashboardServer(8899);
    await server.connect(transport);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
