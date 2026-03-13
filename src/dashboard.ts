// src/dashboard.ts
// Full dashboard HTML with charts (Chart.js), folder-wise analytics, and elegant dark UI.

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Token Counter — Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js"><\/script>
  <style>
    :root {
      --bg: #06080e;
      --surface: rgba(255,255,255,0.03);
      --surface-hover: rgba(255,255,255,0.055);
      --surface-raised: rgba(255,255,255,0.045);
      --border: rgba(255,255,255,0.06);
      --border-bright: rgba(255,255,255,0.13);
      --text: #f1f5f9;
      --text-sec: #94a3b8;
      --text-dim: #475569;
      --purple: #a78bfa;
      --purple-dim: rgba(167,139,250,0.10);
      --blue: #38bdf8;
      --blue-dim: rgba(56,189,248,0.08);
      --pink: #f472b6;
      --pink-dim: rgba(244,114,182,0.10);
      --green: #34d399;
      --green-dim: rgba(52,211,153,0.10);
      --amber: #fbbf24;
      --amber-dim: rgba(251,191,36,0.10);
      --red: #f87171;
      --red-dim: rgba(248,113,113,0.10);
      --cyan: #22d3ee;
      --indigo: #818cf8;
      --radius: 14px;
      --radius-sm: 10px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'SF Pro Display', 'Segoe UI', system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }
    body::before {
      content: '';
      position: fixed; inset: 0; z-index: 0; pointer-events: none;
      background:
        radial-gradient(ellipse 800px 600px at 10% 10%, rgba(167,139,250,0.06) 0%, transparent 60%),
        radial-gradient(ellipse 600px 800px at 90% 90%, rgba(56,189,248,0.04) 0%, transparent 60%),
        radial-gradient(ellipse 500px 400px at 75% 5%, rgba(244,114,182,0.035) 0%, transparent 50%),
        radial-gradient(ellipse 400px 400px at 40% 80%, rgba(52,211,153,0.025) 0%, transparent 50%);
    }
    .wrap { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; padding: 24px 20px 80px; }

    /* ── Header ── */
    .hdr { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; gap: 12px; flex-wrap: wrap; }
    .hdr-left { display: flex; align-items: center; gap: 14px; }
    .logo {
      width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(135deg, #a78bfa 0%, #38bdf8 50%, #f472b6 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; box-shadow: 0 0 24px rgba(167,139,250,0.25), 0 0 48px rgba(56,189,248,0.1);
    }
    .hdr h1 { font-size: 1.1rem; font-weight: 700; letter-spacing: -0.03em; color: var(--text); }
    .hdr-sub { font-size: 0.72rem; color: var(--text-dim); margin-top: 2px; }
    .badge {
      display: flex; align-items: center; gap: 6px;
      border-radius: 100px; padding: 4px 12px;
      font-size: 0.66rem; font-weight: 700; letter-spacing: 0.07em;
      background: var(--green-dim); border: 1px solid rgba(52,211,153,0.2);
      color: var(--green); transition: all 0.3s;
    }
    .badge.off { background: var(--red-dim); border-color: rgba(248,113,113,0.2); color: var(--red); }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.7)} }
    .hdr-right { text-align: right; }
    .hdr-time { font-size: 0.72rem; color: var(--text-dim); line-height: 1.5; }

    /* ── Section titles ── */
    .sec-title {
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em;
      text-transform: uppercase; color: var(--text-dim); margin-bottom: 12px;
      display: flex; align-items: center; gap: 8px;
    }
    .sec-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }

    /* ── Stat cards ── */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(155px, 1fr)); gap: 10px; margin-bottom: 32px; }
    .stat-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 18px 16px;
      transition: border-color 0.2s, background 0.2s, transform 0.15s;
      position: relative; overflow: hidden;
    }
    .stat-card:hover { border-color: var(--border-bright); background: var(--surface-hover); transform: translateY(-1px); }
    .stat-card::before {
      content: ''; position: absolute; top: 0; left: 0; right: 0; height: 2px;
      background: linear-gradient(90deg, transparent, var(--purple), transparent);
      opacity: 0; transition: opacity 0.3s;
    }
    .stat-card:hover::before { opacity: 1; }
    .stat-lbl { font-size: 0.62rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--text-dim); margin-bottom: 10px; }
    .stat-val { font-size: 1.65rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--text); }
    .stat-val.grad {
      background: linear-gradient(130deg, #a78bfa 0%, #f472b6 50%, #38bdf8 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
    }
    .stat-note { font-size: 0.58rem; color: var(--text-dim); margin-top: 6px; }

    /* ── Charts ── */
    .charts-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 32px; }
    @media (max-width: 768px) { .charts-grid { grid-template-columns: 1fr; } }
    .chart-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 20px;
      transition: border-color 0.2s;
    }
    .chart-card:hover { border-color: var(--border-bright); }
    .chart-title { font-size: 0.74rem; font-weight: 600; color: var(--text-sec); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .chart-title-icon { font-size: 0.85rem; opacity: 0.6; }
    .chart-wrap { position: relative; height: 220px; }
    .chart-wrap canvas { width: 100% !important; height: 100% !important; }
    .chart-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-dim); font-size: 0.78rem; }
    .no-charts-msg { text-align: center; padding: 40px 20px; color: var(--text-dim); font-size: 0.82rem; border: 1px dashed var(--border); border-radius: var(--radius); margin-bottom: 32px; }

    /* ── Projects ── */
    .projects-section { margin-bottom: 32px; }
    .proj-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); margin-bottom: 8px; overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.3s;
    }
    .proj-card:hover { border-color: var(--border-bright); box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
    .proj-hdr {
      display: flex; align-items: center; padding: 14px 18px;
      cursor: pointer; gap: 14px; user-select: none;
      transition: background 0.15s;
    }
    .proj-hdr:hover { background: rgba(255,255,255,0.015); }
    .proj-icon {
      width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center; font-size: 16px;
      border: 1px solid rgba(167,139,250,0.12);
    }
    .proj-icon.tier-high { background: linear-gradient(135deg, rgba(167,139,250,0.2), rgba(244,114,182,0.15)); }
    .proj-icon.tier-mid  { background: linear-gradient(135deg, rgba(56,189,248,0.15), rgba(52,211,153,0.1)); }
    .proj-icon.tier-low  { background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03)); }
    .proj-info { flex: 1; min-width: 0; }
    .proj-name { font-size: 0.88rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proj-path { font-size: 0.64rem; color: var(--text-dim); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'SF Mono', 'Fira Code', monospace; }
    .proj-metrics { display: flex; align-items: center; gap: 24px; flex-shrink: 0; }
    .proj-metric { text-align: right; }
    .proj-metric-val { font-size: 0.88rem; font-weight: 700; }
    .proj-metric-val.cost { color: var(--purple); }
    .proj-metric-val.tokens { color: var(--blue); }
    .proj-metric-lbl { font-size: 0.58rem; color: var(--text-dim); margin-top: 2px; letter-spacing: 0.03em; }
    .chevron {
      width: 14px; height: 14px; flex-shrink: 0; color: var(--text-dim);
      transition: transform 0.25s ease;
    }
    .proj-card.open .chevron { transform: rotate(90deg); }
    .proj-bar-wrap { height: 3px; background: rgba(255,255,255,0.04); margin: 0 18px; border-radius: 3px; overflow: hidden; }
    .proj-bar { height: 100%; border-radius: 3px; transition: width 0.6s ease; }
    .proj-bar.tier-high { background: linear-gradient(90deg, #a78bfa, #f472b6); }
    .proj-bar.tier-mid  { background: linear-gradient(90deg, #38bdf8, #34d399); }
    .proj-bar.tier-low  { background: linear-gradient(90deg, rgba(148,163,184,0.4), rgba(148,163,184,0.2)); }

    /* Project detail panel */
    .proj-detail { display: none; border-top: 1px solid var(--border); }
    .proj-card.open .proj-detail { display: block; }
    .proj-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--border); }
    .proj-detail-grid > div { background: var(--bg); padding: 14px 18px; }
    .proj-detail-label { font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); margin-bottom: 4px; }
    .proj-detail-value { font-size: 0.92rem; font-weight: 600; color: var(--text-sec); }
    .proj-sessions-title { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); padding: 12px 18px 6px; }
    .sess-row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 18px 10px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      transition: background 0.15s;
    }
    .sess-row:last-child { border-bottom: none; }
    .sess-row:hover { background: rgba(255,255,255,0.015); }
    .sess-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--text-dim); }
    .sess-dot.active { background: var(--green); box-shadow: 0 0 8px rgba(52,211,153,0.5); }
    .sess-time { font-size: 0.76rem; color: var(--text-sec); flex: 1; }
    .sess-tokens { font-size: 0.68rem; color: var(--text-dim); }
    .sess-calls { font-size: 0.68rem; color: var(--text-dim); min-width: 50px; text-align: right; }
    .sess-cost { font-size: 0.82rem; font-weight: 600; color: var(--purple); min-width: 72px; text-align: right; }

    /* ── Table ── */
    .tbl-section { margin-bottom: 32px; }
    .tbl-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
    table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    thead th {
      padding: 11px 14px; text-align: left; white-space: nowrap;
      font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--text-dim); background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border);
    }
    tbody td { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.03); white-space: nowrap; vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr { transition: background 0.12s; }
    tbody tr:hover td { background: rgba(255,255,255,0.018); }
    .model-tag {
      display: inline-block; padding: 2px 8px; border-radius: 6px;
      font-size: 0.66rem; font-weight: 600;
    }
    .model-tag.opus { background: var(--purple-dim); color: var(--purple); border: 1px solid rgba(167,139,250,0.12); }
    .model-tag.sonnet { background: var(--blue-dim); color: var(--blue); border: 1px solid rgba(56,189,248,0.12); }
    .model-tag.haiku { background: var(--green-dim); color: var(--green); border: 1px solid rgba(52,211,153,0.12); }
    .model-tag.other { background: rgba(255,255,255,0.04); color: var(--text-sec); border: 1px solid var(--border); }
    .cost-cell { color: var(--purple); font-weight: 600; }
    .dim { color: var(--text-dim); }
    .sec { color: var(--text-sec); }
    @keyframes flash-in { 0% { background: rgba(167,139,250,0.1); } 100% { background: transparent; } }
    .flash td { animation: flash-in 1.8s ease forwards; }
    .empty-cell { text-align: center; padding: 48px 24px; }
    .empty-icon { font-size: 1.8rem; opacity: 0.25; margin-bottom: 10px; }
    .empty-text { font-size: 0.8rem; color: var(--text-dim); }
    .no-proj { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 32px; text-align: center; color: var(--text-dim); font-size: 0.82rem; line-height: 1.7; }
    .no-proj code { background: rgba(255,255,255,0.06); border-radius: 4px; padding: 1px 6px; font-family: 'SF Mono', monospace; font-size: 0.78rem; color: var(--text-sec); }

    /* ── Pagination ── */
    .pager {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-top: 1px solid var(--border);
      background: rgba(0,0,0,0.12);
    }
    .pager-info { font-size: 0.7rem; color: var(--text-dim); }
    .pager-btns { display: flex; align-items: center; gap: 4px; }
    .pager-btn {
      width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--border);
      background: var(--surface); color: var(--text-sec);
      font-size: 0.72rem; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.15s;
    }
    .pager-btn:hover:not(:disabled) { border-color: var(--border-bright); background: var(--surface-hover); color: var(--text); }
    .pager-btn:disabled { opacity: 0.3; cursor: default; }
    .pager-btn.active { background: var(--purple-dim); border-color: rgba(167,139,250,0.3); color: var(--purple); }
    .pager-btn.nav { font-size: 0.82rem; width: 36px; }
    .pager-ellipsis { width: 24px; text-align: center; color: var(--text-dim); font-size: 0.7rem; }

    /* ── Footer ── */
    .footer { text-align: center; padding: 24px; font-size: 0.65rem; color: var(--text-dim); }
    .footer a { color: var(--purple); text-decoration: none; }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }

    /* ── Responsive ── */
    @media (max-width: 640px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .proj-metrics { gap: 14px; }
      .proj-metric:nth-child(n+3) { display: none; }
      thead th:nth-child(4), tbody td:nth-child(4),
      thead th:nth-child(7), tbody td:nth-child(7) { display: none; }
    }
  </style>
</head>
<body>
<div class="wrap">

  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <div class="logo">&#x2B21;</div>
      <div>
        <h1>Token Counter</h1>
        <div class="hdr-sub" id="session-line">Connecting&hellip;</div>
      </div>
      <div class="badge" id="badge"><div class="badge-dot"></div><span id="badge-txt">LIVE</span></div>
    </div>
    <div class="hdr-right">
      <div class="hdr-time" id="hdr-time"></div>
    </div>
  </div>

  <!-- Stats -->
  <div class="sec-title" id="sess-section-label">Current Session</div>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-lbl">Total Cost</div><div class="stat-val grad" id="c-cost">&mdash;</div><div class="stat-note" id="c-cost-note"></div></div>
    <div class="stat-card"><div class="stat-lbl">Input Tokens</div><div class="stat-val" id="c-in">&mdash;</div></div>
    <div class="stat-card"><div class="stat-lbl">Output Tokens</div><div class="stat-val" id="c-out">&mdash;</div></div>
    <div class="stat-card"><div class="stat-lbl">Cache Read</div><div class="stat-val" id="c-cr">&mdash;</div></div>
    <div class="stat-card"><div class="stat-lbl">Cache Write</div><div class="stat-val" id="c-cw">&mdash;</div></div>
    <div class="stat-card"><div class="stat-lbl">API Calls</div><div class="stat-val" id="c-n">&mdash;</div><div class="stat-note" id="c-proj-count"></div></div>
  </div>

  <!-- Charts -->
  <div class="sec-title">Analytics</div>
  <div id="charts-section">
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title"><span class="chart-title-icon">&#x1F4C8;</span> Spending Trend</div>
        <div class="chart-wrap"><canvas id="chart-trend"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title"><span class="chart-title-icon">&#x1F4C1;</span> Cost by Project</div>
        <div class="chart-wrap"><canvas id="chart-proj-cost"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title"><span class="chart-title-icon">&#x1F4CA;</span> Token Breakdown</div>
        <div class="chart-wrap"><canvas id="chart-tokens"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title"><span class="chart-title-icon">&#x2699;</span> Model Distribution</div>
        <div class="chart-wrap"><canvas id="chart-models"></canvas></div>
      </div>
    </div>
  </div>

  <!-- Projects -->
  <div class="projects-section">
    <div class="sec-title">Projects</div>
    <div id="proj-list"><div class="no-proj">Loading&hellip;</div></div>
  </div>

  <!-- Recent calls -->
  <div class="tbl-section">
    <div class="sec-title">Recent Calls</div>
    <div class="tbl-wrap">
      <table>
        <thead>
          <tr><th>Time</th><th>Model</th><th>Project</th><th>Description</th><th>Input</th><th>Output</th><th>Cache R/W</th><th>Cost</th></tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="8"><div class="empty-cell"><div class="empty-icon">&#x25CE;</div><div class="empty-text">Waiting for first log_usage call&hellip;</div></div></td></tr>
        </tbody>
      </table>
      <div class="pager" id="pager" style="display:none">
        <div class="pager-info" id="pager-info"></div>
        <div class="pager-btns" id="pager-btns"></div>
      </div>
    </div>
  </div>

  <div class="footer">Token Counter MCP &middot; Real-time usage tracking</div>
</div>

<script>
(function() {
  'use strict';

  // ── Chart.js check ──
  var hasChartJs = typeof Chart !== 'undefined';
  if (!hasChartJs) {
    document.getElementById('charts-section').innerHTML = '<div class="no-charts-msg">Charts require internet connection (Chart.js CDN). Live stats are still updating.</div>';
  }

  // ── Chart.js global defaults ──
  if (hasChartJs) {
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';
    Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.padding = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
  }

  var COLORS = ['#a78bfa','#38bdf8','#f472b6','#34d399','#fbbf24','#f87171','#818cf8','#22d3ee','#fb923c','#a3e635'];
  var COLORS_DIM = COLORS.map(function(c) { return c + '18'; });

  // ── Utility functions ──
  function fmt(n) { n = n || 0; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }
  function fmtCost(u) { if (!u || u < 0.0001) return '~\\$0.00'; var s = parseFloat(u.toPrecision(2)); if (s < 0.01) return '~\\$'+s.toFixed(4); if (s < 1) return '~\\$'+s.toFixed(3); return '~\\$'+s.toFixed(2); }
  function fmtCostShort(u) { if (!u || u < 0.001) return '\\$0'; if (u < 1) return '\\$'+u.toFixed(2); return '\\$'+u.toFixed(1); }
  function hhmm(ts) { return new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'}); }
  function dtFmt(ts) { var d = new Date(ts); var today = new Date(); var isToday = d.toDateString() === today.toDateString(); var t = d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); return isToday ? 'Today '+t : d.toLocaleDateString([], {month:'short', day:'numeric'})+' '+t; }
  function mdl(m) { return m ? m.replace('claude-','').replace(/-\\d{8}$/, '') : '\\u2014'; }
  function mdlClass(m) { if (!m) return 'other'; if (m.indexOf('opus') !== -1) return 'opus'; if (m.indexOf('sonnet') !== -1) return 'sonnet'; if (m.indexOf('haiku') !== -1) return 'haiku'; return 'other'; }
  function projBase(p) { if (!p || p === '(no project)') return '\\u2014'; var parts = p.split('/').filter(Boolean); return parts[parts.length - 1] || p; }
  function dateFmt(iso) { var d = new Date(iso); return d.toLocaleDateString([], {month:'short', day:'numeric'}); }

  // ── State ──
  var token = new URLSearchParams(location.search).get('token') || '';
  var isRemote = !!token;
  var LS_KEY = 'tc_v2_' + token;
  var localEntries = [];
  var allHistory = [];
  var openProjects = {};

  var badge = document.getElementById('badge');
  var badgeTxt = document.getElementById('badge-txt');
  var sessionLine = document.getElementById('session-line');
  var hdrTime = document.getElementById('hdr-time');

  // Chart instances
  var chartTrend = null;
  var chartProjCost = null;
  var chartTokens = null;
  var chartModels = null;

  if (isRemote) {
    document.getElementById('sess-section-label').textContent = 'All Time Stats';
    try { localEntries = JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch(e) {}
    if (localEntries.length) {
      var st = buildState(localEntries);
      renderState(st, false);
      updateCharts(localEntries, st.grouped);
    }
  }

  // ── SSE ──
  var sseUrl = isRemote ? '/events?token=' + encodeURIComponent(token) : '/events';
  var es = new EventSource(sseUrl);
  es.onerror = function() { badge.className = 'badge off'; badgeTxt.textContent = 'OFFLINE'; };
  es.onopen = function() { badge.className = 'badge'; badgeTxt.textContent = 'LIVE'; };

  es.onmessage = function(ev) {
    var d = JSON.parse(ev.data);
    if (isRemote) {
      var map = {};
      localEntries.forEach(function(e) { map[e.id] = e; });
      (d.entries || []).forEach(function(e) { map[e.id] = e; });
      localEntries = Object.values(map).sort(function(a, b) { return a.timestamp < b.timestamp ? -1 : 1; });
      if (localEntries.length > 1000) localEntries = localEntries.slice(-1000);
      try { localStorage.setItem(LS_KEY, JSON.stringify(localEntries)); } catch(e) {}
      var st = buildState(localEntries);
      renderState(st, true);
      updateCharts(localEntries, st.grouped);
    } else {
      renderLocalState(d);
      var entries = (d.history || d.session.entries || []);
      updateCharts(entries, d.grouped || []);
    }
  };

  // ── Build state (remote mode) ──
  function buildState(entries) {
    var totals = {inputTokens:0, outputTokens:0, cacheReadTokens:0, cacheWriteTokens:0, totalCost:0};
    entries.forEach(function(e) {
      totals.inputTokens += e.inputTokens || 0;
      totals.outputTokens += e.outputTokens || 0;
      totals.cacheReadTokens += e.cacheReadTokens || 0;
      totals.cacheWriteTokens += e.cacheWriteTokens || 0;
      totals.totalCost += e.totalCost || 0;
    });
    var pm = {};
    entries.forEach(function(e) {
      var proj = e.project || '(no project)';
      if (!pm[proj]) pm[proj] = {};
      var sid = e.sessionId || 'default';
      if (!pm[proj][sid]) pm[proj][sid] = { entries: [], startedAt: e.timestamp };
      pm[proj][sid].entries.push(e);
    });
    var grouped = Object.keys(pm).map(function(project) {
      var sm = pm[project];
      var allE = [];
      var sessions = Object.keys(sm).map(function(sid) {
        var s = sm[sid];
        allE = allE.concat(s.entries);
        return {
          sessionId: sid, startedAt: s.startedAt,
          totalInputTokens: s.entries.reduce(function(a, e) { return a + (e.inputTokens||0); }, 0),
          totalOutputTokens: s.entries.reduce(function(a, e) { return a + (e.outputTokens||0); }, 0),
          totalCost: s.entries.reduce(function(a, e) { return a + (e.totalCost||0); }, 0),
          entryCount: s.entries.length,
        };
      }).sort(function(a, b) { return b.startedAt.localeCompare(a.startedAt); });
      var parts = project.split('/').filter(Boolean);
      return {
        project: project, sessions: sessions,
        displayName: project === '(no project)' ? '(no project)' : parts[parts.length-1] || project,
        totalCost: allE.reduce(function(a, e) { return a + (e.totalCost||0); }, 0),
        totalInputTokens: allE.reduce(function(a, e) { return a + (e.inputTokens||0); }, 0),
        totalOutputTokens: allE.reduce(function(a, e) { return a + (e.outputTokens||0); }, 0),
        lastActiveAt: sessions[0] ? sessions[0].startedAt : '',
      };
    }).sort(function(a, b) { return b.totalCost - a.totalCost; });
    return { totals: totals, grouped: grouped, entries: entries };
  }

  // ── Render: remote mode ──
  function renderState(st, isLive) {
    var t = st.totals;
    var n = st.entries.length;
    sessionLine.textContent = n + ' call' + (n===1?'':'s') + ' \\u00B7 ' + st.grouped.length + ' project' + (st.grouped.length===1?'':'s') + (isLive ? '' : ' \\u00B7 cached');
    hdrTime.innerHTML = 'Updated ' + new Date().toLocaleTimeString();
    updateStatCards(t, n, st.grouped.length);
    renderProjects(st.grouped, null);
    renderTable(st.entries.slice().reverse());
  }

  // ── Render: local mode ──
  function renderLocalState(d) {
    var sess = d.session, t = sess.totals, entries = sess.entries || [], grouped = d.grouped || [];
    var started = new Date(sess.startedAt);
    sessionLine.textContent = 'Session since ' + started.toLocaleTimeString() + ' \\u00B7 ' + entries.length + ' call' + (entries.length===1?'':'s');
    hdrTime.innerHTML = 'Updated ' + new Date().toLocaleTimeString() + '<br><span style="color:var(--text-dim);font-size:.64rem">' + started.toLocaleDateString([], {weekday:'short', month:'short', day:'numeric'}) + '</span>';
    updateStatCards(t, entries.length, grouped.length);
    renderProjects(grouped, sess.sessionId);
    renderTable(entries.slice().reverse());
  }

  function updateStatCards(t, callCount, projCount) {
    document.getElementById('c-cost').textContent = fmtCost(t.totalCost);
    document.getElementById('c-in').textContent = fmt(t.inputTokens);
    document.getElementById('c-out').textContent = fmt(t.outputTokens);
    document.getElementById('c-cr').textContent = fmt(t.cacheReadTokens);
    document.getElementById('c-cw').textContent = fmt(t.cacheWriteTokens);
    document.getElementById('c-n').textContent = callCount;
    document.getElementById('c-proj-count').textContent = projCount + ' project' + (projCount === 1 ? '' : 's');
  }

  // ── Chart data aggregators ──
  function aggregateByDate(entries) {
    var byDate = {};
    entries.forEach(function(e) {
      var date = e.timestamp ? e.timestamp.slice(0, 10) : '';
      if (!date) return;
      if (!byDate[date]) byDate[date] = 0;
      byDate[date] += e.totalCost || 0;
    });
    var result = [];
    var today = new Date();
    for (var i = 29; i >= 0; i--) {
      var d = new Date(today);
      d.setDate(d.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      result.push({ date: key, label: dateFmt(key), cost: byDate[key] || 0 });
    }
    return result;
  }

  function aggregateByModel(entries) {
    var byModel = {};
    entries.forEach(function(e) {
      var m = mdl(e.model || 'unknown');
      if (!byModel[m]) byModel[m] = { count: 0, cost: 0, tokens: 0 };
      byModel[m].count++;
      byModel[m].cost += e.totalCost || 0;
      byModel[m].tokens += (e.inputTokens || 0) + (e.outputTokens || 0);
    });
    return Object.keys(byModel).map(function(m) {
      return { model: m, count: byModel[m].count, cost: byModel[m].cost, tokens: byModel[m].tokens };
    }).sort(function(a, b) { return b.cost - a.cost; });
  }

  function aggregateTokensByProject(grouped) {
    return grouped.slice(0, 8).map(function(g) {
      return {
        name: g.displayName,
        input: g.totalInputTokens || 0,
        output: g.totalOutputTokens || 0,
      };
    });
  }

  // ── Chart rendering ──
  function updateCharts(entries, grouped) {
    if (!hasChartJs || !entries.length) return;

    // 1. Spending Trend (area line chart)
    var trendData = aggregateByDate(entries);
    var trendLabels = trendData.map(function(d) { return d.label; });
    var trendValues = trendData.map(function(d) { return d.cost; });

    if (!chartTrend) {
      var ctx1 = document.getElementById('chart-trend').getContext('2d');
      var gradient1 = ctx1.createLinearGradient(0, 0, 0, 220);
      gradient1.addColorStop(0, 'rgba(167,139,250,0.25)');
      gradient1.addColorStop(1, 'rgba(167,139,250,0.0)');
      chartTrend = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: trendLabels,
          datasets: [{
            label: 'Daily Cost',
            data: trendValues,
            borderColor: '#a78bfa',
            backgroundColor: gradient1,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: '#a78bfa',
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(15,17,25,0.95)',
              borderColor: 'rgba(167,139,250,0.3)',
              borderWidth: 1,
              titleColor: '#f1f5f9',
              bodyColor: '#94a3b8',
              padding: 10,
              callbacks: {
                label: function(ctx) { return '\\$' + ctx.parsed.y.toFixed(4); }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { maxTicksLimit: 7, font: { size: 10 } }
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.03)' },
              ticks: { font: { size: 10 }, callback: function(v) { return '\\$' + v.toFixed(2); } }
            }
          }
        }
      });
    } else {
      chartTrend.data.labels = trendLabels;
      chartTrend.data.datasets[0].data = trendValues;
      chartTrend.update('none');
    }

    // 2. Cost by Project (doughnut)
    var projData = grouped.slice(0, 8).filter(function(g) { return g.totalCost > 0; });
    var projLabels = projData.map(function(g) { return g.displayName; });
    var projValues = projData.map(function(g) { return g.totalCost; });

    if (!chartProjCost) {
      var ctx2 = document.getElementById('chart-proj-cost').getContext('2d');
      chartProjCost = new Chart(ctx2, {
        type: 'doughnut',
        data: {
          labels: projLabels,
          datasets: [{
            data: projValues,
            backgroundColor: COLORS.slice(0, projValues.length),
            borderColor: 'rgba(6,8,14,0.8)',
            borderWidth: 2,
            hoverBorderColor: '#fff',
            hoverBorderWidth: 2,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'right',
              labels: { font: { size: 10 }, padding: 8, boxWidth: 10 }
            },
            tooltip: {
              backgroundColor: 'rgba(15,17,25,0.95)',
              borderColor: 'rgba(167,139,250,0.3)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: function(ctx) { return ' ' + ctx.label + ': \\$' + ctx.parsed.toFixed(4); }
              }
            }
          }
        }
      });
    } else {
      chartProjCost.data.labels = projLabels;
      chartProjCost.data.datasets[0].data = projValues;
      chartProjCost.data.datasets[0].backgroundColor = COLORS.slice(0, projValues.length);
      chartProjCost.update('none');
    }

    // 3. Token Breakdown by Project (stacked horizontal bar)
    var tokenData = aggregateTokensByProject(grouped);
    var tokenLabels = tokenData.map(function(d) { return d.name; });
    if (!tokenLabels.length) tokenLabels = ['No data'];

    if (!chartTokens) {
      var ctx3 = document.getElementById('chart-tokens').getContext('2d');
      chartTokens = new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: tokenLabels,
          datasets: [
            { label: 'Input', data: tokenData.map(function(d) { return d.input; }), backgroundColor: '#a78bfa', borderRadius: 3 },
            { label: 'Output', data: tokenData.map(function(d) { return d.output; }), backgroundColor: '#38bdf8', borderRadius: 3 },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { position: 'top', labels: { font: { size: 10 }, padding: 8, boxWidth: 10 } },
            tooltip: {
              backgroundColor: 'rgba(15,17,25,0.95)',
              borderColor: 'rgba(167,139,250,0.3)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: function(ctx) { return ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.x); }
              }
            }
          },
          scales: {
            x: {
              stacked: true,
              grid: { color: 'rgba(255,255,255,0.03)' },
              ticks: { font: { size: 10 }, callback: function(v) { return fmt(v); } }
            },
            y: {
              stacked: true,
              grid: { display: false },
              ticks: { font: { size: 10 } }
            }
          }
        }
      });
    } else {
      chartTokens.data.labels = tokenLabels;
      chartTokens.data.datasets[0].data = tokenData.map(function(d) { return d.input; });
      chartTokens.data.datasets[1].data = tokenData.map(function(d) { return d.output; });
      chartTokens.update('none');
    }

    // 4. Model Distribution (doughnut)
    var modelData = aggregateByModel(entries);
    var modelLabels = modelData.map(function(d) { return d.model; });
    var modelValues = modelData.map(function(d) { return d.cost; });

    if (!chartModels) {
      var ctx4 = document.getElementById('chart-models').getContext('2d');
      chartModels = new Chart(ctx4, {
        type: 'doughnut',
        data: {
          labels: modelLabels,
          datasets: [{
            data: modelValues,
            backgroundColor: ['#a78bfa','#38bdf8','#34d399','#fbbf24','#f472b6','#f87171'],
            borderColor: 'rgba(6,8,14,0.8)',
            borderWidth: 2,
            hoverBorderColor: '#fff',
            hoverBorderWidth: 2,
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          cutout: '62%',
          plugins: {
            legend: {
              position: 'right',
              labels: { font: { size: 10 }, padding: 8, boxWidth: 10 }
            },
            tooltip: {
              backgroundColor: 'rgba(15,17,25,0.95)',
              borderColor: 'rgba(167,139,250,0.3)',
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: function(ctx) { return ' ' + ctx.label + ': \\$' + ctx.parsed.toFixed(4) + ' (' + modelData[ctx.dataIndex].count + ' calls)'; }
              }
            }
          }
        }
      });
    } else {
      chartModels.data.labels = modelLabels;
      chartModels.data.datasets[0].data = modelValues;
      chartModels.update('none');
    }
  }

  // ── Render projects ──
  function renderProjects(grouped, currentSessId) {
    var pl = document.getElementById('proj-list');
    if (!grouped || !grouped.length) {
      pl.innerHTML = '<div class="no-proj">No project data yet.<br>Pass a <code>project</code> param to <code>log_usage</code> to track by folder.</div>';
      return;
    }
    var maxCost = Math.max.apply(null, grouped.map(function(g) { return g.totalCost; }).concat([0.001]));
    var totalCost = grouped.reduce(function(a, g) { return a + g.totalCost; }, 0);

    pl.innerHTML = grouped.map(function(g) {
      var isOpen = openProjects[g.project];
      var barPct = Math.max(4, Math.round(g.totalCost / maxCost * 100));
      var costPct = totalCost > 0 ? ((g.totalCost / totalCost) * 100).toFixed(1) : '0';
      var tier = g.totalCost / maxCost > 0.5 ? 'high' : (g.totalCost / maxCost > 0.15 ? 'mid' : 'low');
      var totalTokens = (g.totalInputTokens || 0) + (g.totalOutputTokens || 0);

      var sessHtml = (g.sessions || []).map(function(s) {
        var isActive = currentSessId && s.sessionId === currentSessId;
        return '<div class="sess-row">' +
          '<div class="sess-dot' + (isActive ? ' active' : '') + '"></div>' +
          '<span class="sess-time">' + dtFmt(s.startedAt) + '</span>' +
          '<span class="sess-tokens">' + fmt((s.totalInputTokens||0)+(s.totalOutputTokens||0)) + ' tok</span>' +
          '<span class="sess-calls">' + s.entryCount + ' call' + (s.entryCount===1?'':'s') + '</span>' +
          '<span class="sess-cost">' + fmtCost(s.totalCost) + '</span>' +
        '</div>';
      }).join('');

      return '<div class="proj-card' + (isOpen ? ' open' : '') + '" data-proj="' + g.project + '">' +
        '<div class="proj-hdr" onclick="window._toggleProj(this.parentElement)">' +
          '<div class="proj-icon tier-' + tier + '">&#x1F4C1;</div>' +
          '<div class="proj-info">' +
            '<div class="proj-name">' + g.displayName + '</div>' +
            '<div class="proj-path">' + g.project + '</div>' +
          '</div>' +
          '<div class="proj-metrics">' +
            '<div class="proj-metric"><div class="proj-metric-val cost">' + fmtCost(g.totalCost) + '</div><div class="proj-metric-lbl">cost (' + costPct + '%)</div></div>' +
            '<div class="proj-metric"><div class="proj-metric-val tokens">' + fmt(totalTokens) + '</div><div class="proj-metric-lbl">tokens</div></div>' +
            '<div class="proj-metric"><div class="proj-metric-val" style="color:var(--text-sec)">' + (g.sessions||[]).length + '</div><div class="proj-metric-lbl">sessions</div></div>' +
          '</div>' +
          '<svg class="chevron" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>' +
        '</div>' +
        '<div class="proj-bar-wrap"><div class="proj-bar tier-' + tier + '" style="width:' + barPct + '%"></div></div>' +
        '<div class="proj-detail">' +
          '<div class="proj-detail-grid">' +
            '<div><div class="proj-detail-label">Input Tokens</div><div class="proj-detail-value">' + fmt(g.totalInputTokens) + '</div></div>' +
            '<div><div class="proj-detail-label">Output Tokens</div><div class="proj-detail-value">' + fmt(g.totalOutputTokens) + '</div></div>' +
            '<div><div class="proj-detail-label">Total Cost</div><div class="proj-detail-value" style="color:var(--purple)">' + fmtCost(g.totalCost) + '</div></div>' +
            '<div><div class="proj-detail-label">Last Active</div><div class="proj-detail-value">' + (g.lastActiveAt ? dtFmt(g.lastActiveAt) : '\\u2014') + '</div></div>' +
          '</div>' +
          '<div class="proj-sessions-title">Sessions</div>' +
          sessHtml +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ── Pagination state ──
  var PAGE_SIZE = 10;
  var currentPage = 1;
  var allRows = [];

  function renderTable(rows) {
    allRows = rows || [];
    // When new data arrives, stay on page 1 if new entries were added, otherwise keep current page
    var totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    renderTablePage();
  }

  function renderTablePage() {
    var tbody = document.getElementById('tbody');
    var pager = document.getElementById('pager');

    if (!allRows.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="empty-cell"><div class="empty-icon">&#x25CE;</div><div class="empty-text">Waiting for first log_usage call&hellip;</div></div></td></tr>';
      pager.style.display = 'none';
      return;
    }

    var totalPages = Math.ceil(allRows.length / PAGE_SIZE);
    var start = (currentPage - 1) * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, allRows.length);
    var pageRows = allRows.slice(start, end);

    tbody.innerHTML = pageRows.map(function(en, i) {
      var mc = mdlClass(en.model);
      var isFirst = (currentPage === 1 && i === 0);
      return '<tr class="' + (isFirst ? 'flash' : '') + '">' +
        '<td class="dim">' + hhmm(en.timestamp) + '</td>' +
        '<td><span class="model-tag ' + mc + '">' + mdl(en.model) + '</span></td>' +
        '<td class="dim" title="' + (en.project || '') + '">' + projBase(en.project) + '</td>' +
        '<td class="' + (en.description ? 'sec' : 'dim') + '">' + (en.description || '\\u2014') + '</td>' +
        '<td class="sec">' + fmt(en.inputTokens) + '</td>' +
        '<td class="sec">' + fmt(en.outputTokens) + '</td>' +
        '<td class="dim">' + fmt(en.cacheReadTokens) + '/' + fmt(en.cacheWriteTokens) + '</td>' +
        '<td class="cost-cell">' + fmtCost(en.totalCost) + '</td>' +
      '</tr>';
    }).join('');

    // Pagination controls
    if (totalPages <= 1) {
      pager.style.display = 'flex';
      document.getElementById('pager-info').textContent = 'Showing ' + allRows.length + ' of ' + allRows.length + ' calls';
      document.getElementById('pager-btns').innerHTML = '';
      return;
    }

    pager.style.display = 'flex';
    document.getElementById('pager-info').textContent = 'Showing ' + (start+1) + '\\u2013' + end + ' of ' + allRows.length + ' calls';

    var btns = '';
    // Prev button
    btns += '<button class="pager-btn nav" ' + (currentPage <= 1 ? 'disabled' : '') + ' onclick="window._goPage(' + (currentPage-1) + ')" title="Previous">&#x2039;</button>';

    // Page number buttons with smart ellipsis
    var pages = buildPageNumbers(currentPage, totalPages);
    for (var i = 0; i < pages.length; i++) {
      if (pages[i] === '...') {
        btns += '<span class="pager-ellipsis">&#x2026;</span>';
      } else {
        var p = pages[i];
        btns += '<button class="pager-btn' + (p === currentPage ? ' active' : '') + '" onclick="window._goPage(' + p + ')">' + p + '</button>';
      }
    }

    // Next button
    btns += '<button class="pager-btn nav" ' + (currentPage >= totalPages ? 'disabled' : '') + ' onclick="window._goPage(' + (currentPage+1) + ')" title="Next">&#x203A;</button>';

    document.getElementById('pager-btns').innerHTML = btns;
  }

  function buildPageNumbers(current, total) {
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var pages = [];
    pages.push(1);
    if (current > 3) pages.push('...');
    var rangeStart = Math.max(2, current - 1);
    var rangeEnd = Math.min(total - 1, current + 1);
    for (var j = rangeStart; j <= rangeEnd; j++) pages.push(j);
    if (current < total - 2) pages.push('...');
    pages.push(total);
    return pages;
  }

  window._goPage = function(page) {
    var totalPages = Math.ceil(allRows.length / PAGE_SIZE);
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    renderTablePage();
    // Scroll table into view
    document.querySelector('.tbl-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Project toggle ──
  window._toggleProj = function(card) {
    var proj = card.getAttribute('data-proj');
    if (card.classList.contains('open')) {
      card.classList.remove('open');
      delete openProjects[proj];
    } else {
      card.classList.add('open');
      openProjects[proj] = true;
    }
  };

})();
<\/script>
</body>
</html>`;
