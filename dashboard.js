/* ============================================================
   ObservX Dashboard — JavaScript
   dashboard.js
   ============================================================ */

'use strict';

// ── Module state ──────────────────────────────────────────────
let tsChart    = null;                              // Chart.js line chart instance
let donutChart = null;                              // Chart.js doughnut chart instance
let currentData = null;                             // Last API response
let currentSort = { col: 'totalReq', dir: 'desc' }; // Active table sort

const AUTO_REFRESH_MS = 60_000; // 1 minute


/* ============================================================
   MOCK API
   Replace the body of loadData() with a real fetch() when
   your backend is ready.  Expected response shape:

   {
     meta: { generatedAt, window, resolution },
     summary: { totalRequests, totalSuccess, totalFailures,
                p99LatencyMs, activeEndpoints },
     timeSeries: { labels: string[] },
     endpoints: [{
       method, path, service,
       successCount,
       failureByStatus: { "4xx/5xx code": count, … },
       p99LatencyMs,
       timeSeries: { labels, success[], fail4xx[], fail5xx[] }
     }]
   }
   ============================================================ */
function mockApiResponse() {
  const now = Date.now();

  // Generate 12 × 5-minute time labels
  const labels = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now - (11 - i) * 5 * 60 * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  const endpointDefs = [
    { method: 'GET',    path: '/api/v1/users',       service: 'user-service'    },
    { method: 'POST',   path: '/api/v1/auth/login',  service: 'auth-service'    },
    { method: 'GET',    path: '/api/v1/orders',       service: 'order-service'   },
    { method: 'POST',   path: '/api/v1/payments',     service: 'payment-service' },
    { method: 'GET',    path: '/api/v1/products',     service: 'catalog-service' },
    { method: 'PUT',    path: '/api/v1/users/:id',    service: 'user-service'    },
    { method: 'DELETE', path: '/api/v1/sessions/:id', service: 'auth-service'    },
    { method: 'PATCH',  path: '/api/v1/orders/:id',   service: 'order-service'   },
  ];

  const rnd    = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const series = (base, variance) =>
    Array.from({ length: 12 }, () => Math.max(0, base + rnd(-variance, variance)));

  const endpoints = endpointDefs.map(def => {
    const successSeries = series(rnd(200, 1200), 80);
    const fail4xxSeries = series(rnd(2,   40),   10);
    const fail5xxSeries = series(rnd(0,   20),    8);

    const sum = arr => arr.reduce((a, b) => a + b, 0);
    const totalSuccess = sum(successSeries);
    const total4xx     = sum(fail4xxSeries);
    const total5xx     = sum(fail5xxSeries);

    return {
      ...def,
      successCount: totalSuccess,
      failureByStatus: {
        '400': rnd(0, Math.floor(total4xx * 0.30)),
        '401': rnd(0, Math.floor(total4xx * 0.20)),
        '403': rnd(0, Math.floor(total4xx * 0.15)),
        '404': rnd(0, Math.floor(total4xx * 0.35)),
        '429': rnd(0, Math.floor(total4xx * 0.10)),
        '500': rnd(0, Math.floor(total5xx * 0.50)),
        '502': rnd(0, Math.floor(total5xx * 0.30)),
        '503': rnd(0, Math.floor(total5xx * 0.20)),
      },
      p99LatencyMs: rnd(45, 850),
      timeSeries: { labels, success: successSeries, fail4xx: fail4xxSeries, fail5xx: fail5xxSeries },
    };
  });

  const sumField = (field) => endpoints.reduce((a, e) => a + e[field], 0);
  const sumFailures = ep => Object.values(ep.failureByStatus).reduce((a, b) => a + b, 0);

  return {
    meta:    { generatedAt: new Date().toISOString(), window: '1h', resolution: '5m' },
    summary: {
      totalRequests:   endpoints.reduce((a, e) => a + e.successCount + sumFailures(e), 0),
      totalSuccess:    sumField('successCount'),
      totalFailures:   endpoints.reduce((a, e) => a + sumFailures(e), 0),
      p99LatencyMs:    Math.max(...endpoints.map(e => e.p99LatencyMs)),
      activeEndpoints: endpoints.length,
    },
    timeSeries: { labels },
    endpoints,
  };
}


/* ============================================================
   SHARED CHART CONFIG
   ============================================================ */
const TOOLTIP_DEFAULTS = {
  backgroundColor: '#0d1117',
  borderColor:     '#1e2736',
  borderWidth:     1,
  titleColor:      '#e2e8f0',
  bodyColor:       '#94a3b8',
  titleFont: { family: 'JetBrains Mono', size: 11 },
  bodyFont:  { family: 'JetBrains Mono', size: 11 },
  padding:   12,
};

const AXIS_DEFAULTS = {
  grid:   { color: 'rgba(30,39,54,0.8)', drawTicks: false },
  ticks:  { color: '#475569', font: { family: 'JetBrains Mono', size: 10 } },
  border: { color: '#1e2736' },
};


/* ============================================================
   CHART BUILDERS
   ============================================================ */

/**
 * Aggregates a per-endpoint time-series field into a single array.
 * @param {object[]} endpoints
 * @param {string}   field       'success' | 'fail4xx' | 'fail5xx'
 * @returns {number[]}
 */
function aggregateSeries(endpoints, field) {
  return endpoints.reduce((acc, ep) => {
    ep.timeSeries[field].forEach((v, i) => { acc[i] = (acc[i] || 0) + v; });
    return acc;
  }, []);
}

/**
 * Renders (or re-renders) the time-series line chart.
 * @param {object} data  Full API response.
 */
function buildTimeSeriesChart(data) {
  if (tsChart) tsChart.destroy();

  const ctx = document.getElementById('tsCanvas').getContext('2d');

  tsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.timeSeries.labels,
      datasets: [
        {
          label:           '2xx Success',
          data:            aggregateSeries(data.endpoints, 'success'),
          borderColor:     '#00c896',
          backgroundColor: 'rgba(0,200,150,0.08)',
          fill: true, tension: 0.4, borderWidth: 2,
          pointRadius: 3, pointHoverRadius: 5,
        },
        {
          label:           '4xx Client Errors',
          data:            aggregateSeries(data.endpoints, 'fail4xx'),
          borderColor:     '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fill: true, tension: 0.4, borderWidth: 2,
          pointRadius: 3, pointHoverRadius: 5,
        },
        {
          label:           '5xx Server Errors',
          data:            aggregateSeries(data.endpoints, 'fail5xx'),
          borderColor:     '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.06)',
          fill: true, tension: 0.4, borderWidth: 2,
          pointRadius: 3, pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: TOOLTIP_DEFAULTS },
      scales: {
        x: { ...AXIS_DEFAULTS, ticks: { ...AXIS_DEFAULTS.ticks, maxTicksLimit: 6 } },
        y: AXIS_DEFAULTS,
      },
    },
  });
}

/**
 * Renders (or re-renders) the error-distribution doughnut chart.
 * @param {object} data  Full API response.
 */
function buildDonutChart(data) {
  if (donutChart) donutChart.destroy();

  const ctx = document.getElementById('donutCanvas').getContext('2d');

  // Aggregate status-code counts across all endpoints
  const agg = {};
  data.endpoints.forEach(ep => {
    Object.entries(ep.failureByStatus).forEach(([code, count]) => {
      agg[code] = (agg[code] || 0) + count;
    });
  });

  const sorted = Object.entries(agg)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a);

  const palette4xx = ['#f59e0b', '#fb923c', '#fbbf24', '#fde68a', '#fdba74'];
  const palette5xx = ['#ef4444', '#f87171', '#dc2626', '#b91c1c', '#fca5a5'];
  const colors = sorted.map(([code], i) =>
    parseInt(code) >= 500
      ? palette5xx[i % palette5xx.length]
      : palette4xx[i % palette4xx.length]
  );

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: sorted.map(([code]) => `HTTP ${code}`),
      datasets: [{
        data:            sorted.map(([, v]) => v),
        backgroundColor: colors,
        borderColor:     '#0d1117',
        borderWidth:     3,
        hoverOffset:     6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: { duration: 600 },
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#64748b', font: { family: 'JetBrains Mono', size: 10 }, boxWidth: 10, padding: 12 },
        },
        tooltip: { ...TOOLTIP_DEFAULTS, padding: 10 },
      },
    },
  });
}


/* ============================================================
   TABLE
   ============================================================ */

/** Column definitions */
const TABLE_COLUMNS = [
  { key: 'endpoint', label: 'ENDPOINT',        sortable: false },
  { key: 'totalReq', label: 'TOTAL REQ',       sortable: true  },
  { key: 'success',  label: '2xx SUCCESS',     sortable: true  },
  { key: 'fail',     label: 'FAILURES',        sortable: true  },
  { key: 'rate',     label: 'SUCCESS RATE',    sortable: true  },
  { key: 'volume',   label: 'VOLUME',          sortable: false },
  { key: 'p99',      label: 'P99 LATENCY',     sortable: true  },
  { key: 'errors',   label: 'ERROR BREAKDOWN', sortable: false },
];

/** Maps table column keys → row data properties */
const SORT_KEY_MAP = {
  totalReq: 'total',
  success:  'successCount',
  fail:     'totalFail',
  rate:     'rate',
  p99:      'p99LatencyMs',
};

/**
 * Toggles sort state and re-renders the table.
 * Exposed globally so inline onclick="sortTable(...)" works.
 * @param {string} col  Column key.
 */
function sortTable(col) {
  currentSort = currentSort.col === col
    ? { col, dir: currentSort.dir === 'asc' ? 'desc' : 'asc' }
    : { col, dir: 'desc' };

  document.getElementById('tableContainer').innerHTML = renderTable(currentData);
}

/**
 * Builds the table HTML string from API data + current sort.
 * @param {object} data  Full API response.
 * @returns {string}
 */
function renderTable(data) {
  const sumValues = obj => Object.values(obj).reduce((a, b) => a + b, 0);

  // Enrich endpoints with computed columns
  const rows = data.endpoints.map(ep => {
    const totalFail = sumValues(ep.failureByStatus);
    const total     = ep.successCount + totalFail;
    const rate      = total > 0 ? (ep.successCount / total * 100) : 100;
    return { ...ep, totalFail, total, rate };
  });

  // Sort rows
  const dir    = currentSort.dir === 'asc' ? 1 : -1;
  const sortBy = SORT_KEY_MAP[currentSort.col] || 'total';
  rows.sort((a, b) => (a[sortBy] - b[sortBy]) * dir);

  const maxReq = Math.max(...rows.map(r => r.total));

  // Build <thead>
  const thead = TABLE_COLUMNS.map(c => {
    const sortCls = c.sortable && currentSort.col === c.key ? `sort-${currentSort.dir}` : '';
    const onclick  = c.sortable ? `onclick="sortTable('${c.key}')"` : '';
    return `<th class="${sortCls}" ${onclick}>${c.label}</th>`;
  }).join('');

  // Build <tbody>
  const tbody = rows.map((r, i) => {
    const rateCls  = r.rate >= 99 ? 'rate-high' : r.rate >= 95 ? 'rate-mid' : 'rate-low';
    const pct      = maxReq > 0 ? (r.total / maxReq * 100).toFixed(1) : 0;
    const barColor = r.rate >= 99 ? 'var(--success)' : r.rate >= 95 ? 'var(--warn)' : 'var(--danger)';

    const badges = Object.entries(r.failureByStatus)
      .filter(([, v]) => v > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([code, count]) => {
        const cls = parseInt(code) >= 500 ? 'err-5xx' : 'err-4xx';
        return `<span class="err-badge ${cls}">${code}: ${count.toLocaleString()}</span>`;
      }).join('');

    return `
      <tr style="animation-delay:${i * 30}ms">
        <td>
          <div class="endpoint-cell">
            <div>
              <span class="method-badge method-${r.method}">${r.method}</span>
              <span class="endpoint-path">${r.path}</span>
            </div>
            <div class="endpoint-svc">${r.service}</div>
          </div>
        </td>
        <td class="num">${r.total.toLocaleString()}</td>
        <td class="num num-success">${r.successCount.toLocaleString()}</td>
        <td class="num num-fail">${r.totalFail.toLocaleString()}</td>
        <td><span class="rate-pill ${rateCls}">${r.rate.toFixed(2)}%</span></td>
        <td class="bar-cell">
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="bar-pct">${pct}%</div>
        </td>
        <td class="p99-cell">${r.p99LatencyMs} ms</td>
        <td>
          <div class="err-badges">
            ${badges || '<span style="color:var(--muted);font-size:0.65rem">—</span>'}
          </div>
        </td>
      </tr>`;
  }).join('');

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;
}


/* ============================================================
   SUMMARY CARDS
   ============================================================ */

/**
 * Builds the summary cards HTML string.
 * @param {object} s  summary object from API response.
 * @returns {string}
 */
function renderSummary(s) {
  const fmt = n => n.toLocaleString();
  const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(2) : '0.00';

  const cards = [
    { label: 'TOTAL REQUESTS', value: fmt(s.totalRequests),  sub: 'last 60 minutes',               accent: 'var(--accent)'  },
    { label: 'SUCCESSFUL',     value: fmt(s.totalSuccess),   sub: `${pct(s.totalSuccess, s.totalRequests)}% success rate`,  accent: 'var(--success)' },
    { label: 'FAILURES',       value: fmt(s.totalFailures),  sub: `${pct(s.totalFailures, s.totalRequests)}% error rate`,   accent: 'var(--danger)'  },
    { label: 'P99 LATENCY',    value: `${s.p99LatencyMs}ms`, sub: 'worst endpoint',                 accent: 'var(--warn)'    },
    { label: 'ENDPOINTS',      value: s.activeEndpoints,     sub: 'instrumented routes',            accent: '#a78bfa'        },
  ];

  return `<div class="summary-grid">
    ${cards.map(c => `
      <div class="summary-card" style="--card-accent:${c.accent}">
        <div class="card-label">${c.label}</div>
        <div class="card-value">${c.value}</div>
        <div class="card-sub">${c.sub}</div>
      </div>`).join('')}
  </div>`;
}


/* ============================================================
   DASHBOARD LAYOUT RENDERER
   ============================================================ */

/**
 * Populates #mainContent with the full dashboard HTML, then
 * delegates to chart and table builders.
 * @param {object} data  Full API response.
 */
function renderDashboard(data) {
  document.getElementById('mainContent').innerHTML = `
    ${renderSummary(data.summary)}

    <div class="controls-row">
      <div class="section-title">Request Volume <span>over time</span></div>
      <div class="time-range-tabs">
        <button class="tab active">1H</button>
        <button class="tab">6H</button>
        <button class="tab">24H</button>
        <button class="tab">7D</button>
      </div>
    </div>

    <div class="chart-grid">
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Request Volume · Time Series</div>
          <div class="panel-badge">5m resolution</div>
        </div>
        <div class="chart-wrap"><canvas id="tsCanvas"></canvas></div>
        <div class="chart-legend">
          <div class="legend-item"><div class="legend-dot" style="background:var(--success)"></div>2xx Success</div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--warn)"></div>4xx Client Errors</div>
          <div class="legend-item"><div class="legend-dot" style="background:var(--danger)"></div>5xx Server Errors</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">Error Distribution</div>
          <div class="panel-badge">by status code</div>
        </div>
        <div class="chart-wrap"><canvas id="donutCanvas"></canvas></div>
      </div>
    </div>

    <div class="controls-row" style="margin-top:8px">
      <div class="section-title">Endpoint Breakdown <span>${data.endpoints.length} routes</span></div>
    </div>

    <div class="panel" style="padding:0;overflow:hidden">
      <div id="tableContainer">${renderTable(data)}</div>
    </div>
  `;

  // Time-range tab switching
  // In production: call loadData(selectedWindow) with the chosen window param
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  buildTimeSeriesChart(data);
  buildDonutChart(data);
}


/* ============================================================
   DATA LOADING
   ============================================================ */

/**
 * Fetches metrics from the API (or mock), updates the dashboard.
 * To connect your real backend, replace the mock below with:
 *
 *   const res  = await fetch('/metrics/volumetrics?window=1h&resolution=5m');
 *   if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   const data = await res.json();
 */
async function loadData() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  try {
    await new Promise(r => setTimeout(r, 700)); // simulate network latency — remove for real API
    const data = mockApiResponse();             // ← replace with real fetch()

    currentData = data;
    renderDashboard(data);

    const ts = new Date(data.meta.generatedAt);
    document.getElementById('lastUpdated').textContent =
      'Updated ' + ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  } catch (err) {
    document.getElementById('mainContent').innerHTML = `
      <div class="state-overlay">
        <div class="error-icon">⚠</div>
        <div style="color:var(--danger)">Failed to load metrics</div>
        <div style="color:var(--muted);font-size:0.68rem">${err.message}</div>
        <button class="retry-btn" onclick="loadData()">↺ Retry</button>
      </div>`;
  } finally {
    btn.classList.remove('spinning');
  }
}


/* ============================================================
   BOOTSTRAP
   ============================================================ */
loadData();
setInterval(loadData, AUTO_REFRESH_MS);
