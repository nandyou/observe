/* ============================================================
RepoRadar — GitLab Repository Dashboard
repo-dashboard.js

Sections:
1. State & constants
2. Mock API data
3. Utilities
4. Summary strip
5. Repo list renderer
6. Expand panel renderers
6a. Branch + quality pane
6b. Perf pane
6c. Deployment pane
7. Toggle logic
8. Filters & search
9. Data loading
10. Init
============================================================ */
‘use strict’;

/* –––––––––––––––––––––––––––––

1. STATE
   ––––––––––––––––––––––––––––– */
   let allRepos    = [];
   let filtered    = [];
   let searchQuery = ‘’;
   // Track which expand panel is open per repo: { repoId: { area: bool, activeTab: ‘branches’|‘perf’|‘deploys’ } }
   const expandState = {};

/* –––––––––––––––––––––––––––––
2. MOCK API
──────────────────────────────────────────────────────────
Replace mockApiResponse() with:
const res = await fetch(’/api/gitlab/repos’);
return res.json();

Response shape documented in JSDoc below.
––––––––––––––––––––––––––––– */

/**

- @typedef {Object} RepoBranch
- @property {string}  name
- @property {boolean} protected
- @property {boolean} default
- @property {{unit:number, integration:number, mutation:number}} coverage
- @property {{blocker:number,critical:number,major:number,minor:number,info:number}} sonar
  */

/**

- @typedef {Object} PerfEndpoint
- @property {string} name
- @property {number} p50Ms
- @property {number} p95Ms
- @property {number} p99Ms
- @property {number} throughputRps
- @property {number} errorPct
- @property {‘pass’|‘warn’|‘fail’} status
  */

/**

- @typedef {Object} DeployInstance
- @property {string} instanceName
- @property {‘dev’|‘sit’|‘uat’|‘prod’} envType
- @property {string} group        // e.g. “SIT-1”, “DEV-A”
- @property {string} apiVersion
- @property {string} webVersion
- @property {‘up’|‘down’|‘degraded’} health
- @property {string} tykUrl
  */

function mockApiResponse() {
const rnd  = (lo, hi)  => Math.floor(Math.random() * (hi - lo + 1)) + lo;
const pct  = ()        => rnd(40, 98);
const pick = arr       => arr[rnd(0, arr.length - 1)];
const ver  = ()        => `${rnd(1,3)}.${rnd(0,9)}.${rnd(0,20)}`;

const SONAR = () => ({
blocker:  rnd(0,4), critical: rnd(0,12), major: rnd(0,30),
minor: rnd(0,60),   info: rnd(0,20),
});

const COVERAGE = () => ({ unit: pct(), integration: pct(), mutation: pct() });

const makeBranch = (name, isProtected, isDefault=false) => ({
name, protected: isProtected, default: isDefault,
coverage: COVERAGE(), sonar: SONAR(),
});

const PERF_ENDPOINTS = (names) => names.map(name => {
const p50  = rnd(12, 350);
const tput = rnd(40, 800);
const err  = parseFloat((Math.random() * 3).toFixed(2));
const st   = err > 2 ? ‘fail’ : p50 > 200 ? ‘warn’ : ‘pass’;
return { name, p50Ms: p50, p95Ms: p50 * rnd(15,25)/10, p99Ms: p50 * rnd(20,35)/10,
throughputRps: tput, errorPct: err, status: st };
});

const DEPLOY_INSTANCES = (envs) => envs.map(e => ({
instanceName: e.name, envType: e.type, group: e.group,
apiVersion: ver(), webVersion: ver(),
health: pick([‘up’,‘up’,‘up’,‘degraded’,‘down’]),
tykUrl: `https://tyk-gateway.internal/${e.type}/${e.name.toLowerCase()}/api`,
}));

const repos = [
/* ── APIs ───────────────────────────────────────────── */
{
id: ‘r1’, name: ‘user-management-api’, group: ‘platform/apis’, type: ‘api’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘release/v2.1’, true),
makeBranch(‘release/v2.0’, true),
makeBranch(‘feature/oauth-refresh’, false),
makeBranch(‘feature/rate-limiting’, false),
makeBranch(‘fix/session-expiry’, false),
],
perf: {
runDate: ‘2026-03-10’, duration: ‘45m’, virtualUsers: 200, rampUp: ‘5m’,
totalRequests: 485200, overallErrorPct: 0.8,
endpoints: PERF_ENDPOINTS([’/api/v1/users’,’/api/v1/users/:id’,’/api/v1/auth/login’,’/api/v1/auth/refresh’]),
},
deployments: DEPLOY_INSTANCES([
{name:‘dev-1’, type:‘dev’, group:‘DEV-A’}, {name:‘dev-2’, type:‘dev’, group:‘DEV-A’},
{name:‘sit-1’, type:‘sit’, group:‘SIT-1’}, {name:‘sit-2’, type:‘sit’, group:‘SIT-1’},
{name:‘sit-3’, type:‘sit’, group:‘SIT-2’}, {name:‘uat-1’, type:‘uat’, group:‘UAT’},
]),
},
{
id: ‘r2’, name: ‘payment-gateway-api’, group: ‘platform/apis’, type: ‘api’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘release/v1.8’, true),
makeBranch(‘hotfix/txn-timeout’, false),
makeBranch(‘feature/pci-compliance’, false),
],
perf: {
runDate: ‘2026-03-08’, duration: ‘30m’, virtualUsers: 100, rampUp: ‘3m’,
totalRequests: 210000, overallErrorPct: 0.3,
endpoints: PERF_ENDPOINTS([’/api/v1/payments’,’/api/v1/payments/:id/status’,’/api/v1/refunds’]),
},
deployments: DEPLOY_INSTANCES([
{name:‘dev-1’, type:‘dev’, group:‘DEV-A’}, {name:‘sit-1’, type:‘sit’, group:‘SIT-1’},
{name:‘uat-1’, type:‘uat’, group:‘UAT’},
]),
},
{
id: ‘r3’, name: ‘notification-service’, group: ‘platform/apis’, type: ‘api’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘develop’, true),
makeBranch(‘feature/sms-provider’, false),
makeBranch(‘feature/push-notifications’, false),
makeBranch(‘fix/email-templates’, false),
],
perf: null,
deployments: DEPLOY_INSTANCES([
{name:‘dev-1’, type:‘dev’, group:‘DEV-A’}, {name:‘sit-1’, type:‘sit’, group:‘SIT-1’},
{name:‘sit-2’, type:‘sit’, group:‘SIT-2’},
]),
},
/* ── Microfrontends ─────────────────────────────────── */
{
id: ‘r4’, name: ‘checkout-mfe’, group: ‘platform/microfrontends’, type: ‘mfe’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘release/v3.2’, true),
makeBranch(‘feature/express-checkout’, false),
makeBranch(‘feature/apple-pay’, false),
makeBranch(‘feature/google-pay’, false),
makeBranch(‘fix/cart-ui-ios’, false),
],
perf: {
runDate: ‘2026-03-09’, duration: ‘20m’, virtualUsers: 500, rampUp: ‘2m’,
totalRequests: 325000, overallErrorPct: 1.2,
endpoints: PERF_ENDPOINTS([’/checkout’,’/checkout/payment’,’/checkout/confirmation’]),
},
deployments: DEPLOY_INSTANCES([
{name:‘dev-1’, type:‘dev’, group:‘DEV-A’}, {name:‘dev-2’, type:‘dev’, group:‘DEV-B’},
{name:‘sit-1’, type:‘sit’, group:‘SIT-1’}, {name:‘sit-2’, type:‘sit’, group:‘SIT-1’},
{name:‘sit-3’, type:‘sit’, group:‘SIT-2’}, {name:‘sit-4’, type:‘sit’, group:‘SIT-2’},
{name:‘uat-1’, type:‘uat’, group:‘UAT’}, {name:‘uat-2’, type:‘uat’, group:‘UAT’},
]),
},
{
id: ‘r5’, name: ‘account-portal-mfe’, group: ‘platform/microfrontends’, type: ‘mfe’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘develop’, true),
makeBranch(‘feature/2fa-setup’, false),
makeBranch(‘feature/dark-mode’, false),
],
perf: null,
deployments: DEPLOY_INSTANCES([
{name:‘dev-1’, type:‘dev’, group:‘DEV-A’},
{name:‘sit-1’, type:‘sit’, group:‘SIT-1’},
{name:‘uat-1’, type:‘uat’, group:‘UAT’},
]),
},
/* ── Libraries ──────────────────────────────────────── */
{
id: ‘r6’, name: ‘ui-component-library’, group: ‘platform/libraries’, type: ‘lib’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘release/v5.0’, true),
makeBranch(‘feature/design-tokens-v2’, false),
makeBranch(‘fix/a11y-button’, false),
],
perf: null,
deployments: [],
},
{
id: ‘r7’, name: ‘api-client-sdk’, group: ‘platform/libraries’, type: ‘lib’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘feature/graphql-support’, false),
makeBranch(‘feature/retry-interceptor’, false),
],
perf: null,
deployments: [],
},
/* ── Tooling ─────────────────────────────────────────── */
{
id: ‘r8’, name: ‘ci-pipeline-templates’, group: ‘platform/tooling’, type: ‘tool’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘feature/trivy-scanning’, false),
makeBranch(‘feature/sbom-generation’, false),
],
perf: null,
deployments: [],
},
{
id: ‘r9’, name: ‘infra-terraform-modules’, group: ‘platform/tooling’, type: ‘tool’,
branches: [
makeBranch(‘main’, true, true),
makeBranch(‘release/eks-v3’, true),
makeBranch(‘feature/rds-aurora’, false),
makeBranch(‘feature/waf-rules’, false),
makeBranch(‘fix/vpc-cidr-overlap’, false),
],
perf: null,
deployments: DEPLOY_INSTANCES([
{name:‘dev-cluster’, type:‘dev’, group:‘DEV’}, {name:‘sit-cluster’, type:‘sit’, group:‘SIT’},
]),
},
];

return {
meta: { fetchedAt: new Date().toISOString(), totalRepos: repos.length },
repos,
};
}

/* –––––––––––––––––––––––––––––
3. UTILITIES
––––––––––––––––––––––––––––– */
const TYPE_LABEL = { api:‘API’, mfe:‘MFE’, lib:‘LIB’, tool:‘TOOL’ };
const TYPE_CLS   = { api:‘type-api’, mfe:‘type-mfe’, lib:‘type-lib’, tool:‘type-tool’ };

function covCls(v) { return v >= 75 ? ‘cov-high’ : v >= 50 ? ‘cov-mid’ : ‘cov-low’; }
function covBarColor(v) { return v >= 75 ? ‘var(–success)’ : v >= 50 ? ‘var(–warn)’ : ‘var(–danger)’; }

function healthCls(h) { return h === ‘up’ ? ‘healthy-inst’ : h === ‘degraded’ ? ‘degraded-inst’ : ‘unhealthy-inst’; }
function deployBtnCls(deployments) {
if (!deployments.length) return ‘healthy’;
return deployments.some(d => d.health === ‘down’) ? ‘has-issues’ :
deployments.some(d => d.health === ‘degraded’) ? ‘has-issues’ : ‘healthy’;
}

function mainBranch(branches) { return branches.find(b => b.default) || branches[0]; }

function groupByEnvType(deployments) {
const map = {};
deployments.forEach(d => {
if (!map[d.envType]) map[d.envType] = [];
map[d.envType].push(d);
});
return map;
}

/* –––––––––––––––––––––––––––––
4. SUMMARY STRIP
––––––––––––––––––––––––––––– */
function renderSummary(repos) {
const total     = repos.length;
const apis      = repos.filter(r => r.type === ‘api’).length;
const mfes      = repos.filter(r => r.type === ‘mfe’).length;
const libs      = repos.filter(r => r.type === ‘lib’).length;
const tools     = repos.filter(r => r.type === ‘tool’).length;
const withPerf  = repos.filter(r => r.perf).length;
const unhealthy = repos.flatMap(r => r.deployments).filter(d => d.health !== ‘up’).length;

const cards = [
{ label:‘TOTAL REPOS’,    value:total,     sub:`${apis} APIs, ${mfes} MFEs`,              color:‘var(–accent)’  },
{ label:‘LIBRARIES’,      value:libs,      sub:‘shared packages’,                         color:‘var(–success)’ },
{ label:‘TOOLING’,        value:tools,     sub:‘infra & CI’,                              color:‘var(–warn)’    },
{ label:‘PERF TESTED’,    value:withPerf,  sub:`of ${total} repos`,                       color:’#818cf8’        },
{ label:‘UNHEALTHY INSTS’,value:unhealthy, sub:‘across all envs’,                         color: unhealthy ? ‘var(–danger)’ : ‘var(–success)’ },
];

document.getElementById(‘summaryStrip’).innerHTML = cards.map(c => ` <div class="stat-card" style="--card-color:${c.color}"> <div class="stat-label">${c.label}</div> <div class="stat-value">${c.value}</div> <div class="stat-sub">${c.sub}</div> </div>`).join(’’);
}

/* –––––––––––––––––––––––––––––
5. REPO LIST RENDERER
––––––––––––––––––––––––––––– */
function renderRepoList(repos) {
const container = document.getElementById(‘repoList’);
if (!repos.length) {
container.innerHTML = `<div class="state-overlay"><div style="font-size:2rem;opacity:.3">⌀</div><div>No repositories match your filters</div></div>`;
return;
}

container.innerHTML = repos.map((repo, idx) => repoCardHtml(repo, idx)).join(’’);
}

function repoCardHtml(repo, idx) {
const main       = mainBranch(repo.branches);
const protected_ = repo.branches.filter(b => b.protected);
const features   = repo.branches.filter(b => !b.protected);
const sonar      = main.sonar;
const cov        = main.coverage;
const deploys    = repo.deployments;
const totalIssues = sonar.blocker + sonar.critical + sonar.major;

// Coverage mini bars (unit, int, mut)
const covBars = [
{ label:‘UT’, val: cov.unit },
{ label:‘IT’, val: cov.integration },
{ label:‘MT’, val: cov.mutation },
].map(c => ` <div class="quality-row"> <span class="quality-label">${c.label}</span> <div class="cov-bar-wrap"><div class="cov-bar-track"><div class="cov-bar-fill" style="width:${c.val}%;background:${covBarColor(c.val)}"></div></div></div> <span class="cov-pct ${covCls(c.val)}">${c.val}%</span> </div>`).join(’’);

// Sonar badges (only non-zero)
const sonarBadges = [
{ key:‘blocker’,  cls:‘sonar-blocker’,  val:sonar.blocker,  label:‘B’ },
{ key:‘critical’, cls:‘sonar-critical’, val:sonar.critical, label:‘C’ },
{ key:‘major’,    cls:‘sonar-major’,    val:sonar.major,    label:‘M’ },
{ key:‘minor’,    cls:‘sonar-minor’,    val:sonar.minor,    label:‘m’ },
{ key:‘info’,     cls:‘sonar-info’,     val:sonar.info,     label:‘I’ },
].filter(s => s.val > 0)
.map(s => `<span class="sonar-badge ${s.cls}" title="${s.key}">${s.label} ${s.val}</span>`)
.join(’’);

// Perf cell
const perfCell = repo.perf
? `<button class="perf-btn" id="perf-btn-${repo.id}" onclick="togglePane('${repo.id}','perf',this)"> ⚡ ${repo.perf.endpoints.length} endpoints </button>`
: `<span class="perf-none">—</span>`;

// Deploy cell
let deployCell = ‘<span class="perf-none">No deploys</span>’;
if (deploys.length) {
const downCount = deploys.filter(d => d.health !== ‘up’).length;
const cls       = deployBtnCls(deploys);
const envTypes  = […new Set(deploys.map(d => d.envType.toUpperCase()))].join(’ · ’);
deployCell = ` <button class="deploy-btn ${cls}" id="dep-btn-${repo.id}" onclick="togglePane('${repo.id}','deploys',this)"> ${downCount > 0 ? '⚠' : '✓'} ${deploys.length} instances </button> <div class="deploy-summary">${envTypes}</div>`;
}

return `

  <div class="repo-card" id="card-${repo.id}" style="animation-delay:${idx*40}ms">
    <div class="repo-row">

```
  <!-- Identity -->
  <div class="repo-identity">
    <div class="repo-type-icon ${TYPE_CLS[repo.type]}">${TYPE_LABEL[repo.type]}</div>
    <div class="repo-name-wrap">
      <div class="repo-name" title="${repo.name}">${repo.name}</div>
      <div class="repo-group">${repo.group}</div>
    </div>
  </div>

  <!-- Branch counts -->
  <div class="branch-counts">
    <button class="branch-btn protected" id="pb-btn-${repo.id}"
      onclick="togglePane('${repo.id}','branches',this,'protected')">
      🔒 ${protected_.length} protected
    </button>
    <button class="branch-btn feature" id="fb-btn-${repo.id}"
      onclick="togglePane('${repo.id}','branches',this,'feature')">
      ⎇ ${features.length} feature
    </button>
  </div>

  <!-- Coverage (main branch) -->
  <div class="quality-cell">${covBars}</div>

  <!-- Sonar (main branch) -->
  <div class="sonar-cell">${sonarBadges || '<span class="no-data">Clean ✓</span>'}</div>

  <!-- Perf -->
  <div>${perfCell}</div>

  <!-- Deployments -->
  <div class="deploy-cell">${deployCell}</div>

  <!-- Row toggle -->
  <button class="row-expand-btn" id="toggle-${repo.id}" onclick="toggleRow('${repo.id}')">▸</button>
</div>

<!-- Expand area -->
<div class="expand-area" id="expand-${repo.id}">
  <div class="expand-tabs" id="tabs-${repo.id}">
    <button class="expand-tab active" onclick="switchTab('${repo.id}','branches',this)">Branches &amp; Quality</button>
    ${repo.perf ? `<button class="expand-tab" onclick="switchTab('${repo.id}','perf',this)">⚡ Perf Report</button>` : ''}
    ${deploys.length ? `<button class="expand-tab" onclick="switchTab('${repo.id}','deploys',this)">🚀 Deployments</button>` : ''}
  </div>
  <div id="pane-branches-${repo.id}" class="expand-pane active">${branchesPaneHtml(repo)}</div>
  ${repo.perf ? `<div id="pane-perf-${repo.id}" class="expand-pane">${perfPaneHtml(repo)}</div>` : ''}
  ${deploys.length ? `<div id="pane-deploys-${repo.id}" class="expand-pane">${deployPaneHtml(repo)}</div>` : ''}
</div>
```

  </div>`;
}

/* –––––––––––––––––––––––––––––
6a. BRANCH + QUALITY PANE
––––––––––––––––––––––––––––– */
function branchesPaneHtml(repo) {
const protBranches = repo.branches.filter(b => b.protected);
const featBranches = repo.branches.filter(b => !b.protected);

function branchTableRows(branches) {
return branches.map(b => {
const c  = b.coverage;
const s  = b.sonar;
const chipCls = b.default ? ‘branch-default-chip’ : b.protected ? ‘branch-protected-chip’ : ‘branch-feature-chip’;
const ttl = s.blocker + s.critical + s.major + s.minor + s.info;

```
  return `
    <tr>
      <td>
        <span class="branch-name-chip ${chipCls}">${b.name}</span>
        ${b.default ? '<span style="font-size:0.6rem;color:var(--muted);margin-left:4px">default</span>' : ''}
      </td>
      <td>
        <div class="inline-cov">
          <div class="inline-cov-bar"><div class="cov-bar-track"><div class="cov-bar-fill" style="width:${c.unit}%;background:${covBarColor(c.unit)}"></div></div></div>
          <span class="cov-pct ${covCls(c.unit)}">${c.unit}%</span>
        </div>
      </td>
      <td>
        <div class="inline-cov">
          <div class="inline-cov-bar"><div class="cov-bar-track"><div class="cov-bar-fill" style="width:${c.integration}%;background:${covBarColor(c.integration)}"></div></div></div>
          <span class="cov-pct ${covCls(c.integration)}">${c.integration}%</span>
        </div>
      </td>
      <td>
        <div class="inline-cov">
          <div class="inline-cov-bar"><div class="cov-bar-track"><div class="cov-bar-fill" style="width:${c.mutation}%;background:${covBarColor(c.mutation)}"></div></div></div>
          <span class="cov-pct ${covCls(c.mutation)}">${c.mutation}%</span>
        </div>
      </td>
      <td>
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${s.blocker  ? `<span class="sonar-badge sonar-blocker">B ${s.blocker}</span>` : ''}
          ${s.critical ? `<span class="sonar-badge sonar-critical">C ${s.critical}</span>` : ''}
          ${s.major    ? `<span class="sonar-badge sonar-major">M ${s.major}</span>` : ''}
          ${s.minor    ? `<span class="sonar-badge sonar-minor">m ${s.minor}</span>` : ''}
          ${s.info     ? `<span class="sonar-badge sonar-info">I ${s.info}</span>` : ''}
          ${ttl === 0  ? '<span style="color:var(--success);font-size:0.65rem;font-family:JetBrains Mono,monospace">Clean ✓</span>' : ''}
        </div>
      </td>
    </tr>`;
}).join('');
```

}

const tableHead = ` <thead><tr> <th>Branch</th> <th>Unit Coverage</th> <th>Integration Coverage</th> <th>Mutation Coverage</th> <th>Sonar Issues</th> </tr></thead>`;

const protSection = protBranches.length ? ` <div class="branch-section-title section-gap">🔒 Protected Branches (${protBranches.length})</div> <div style="overflow-x:auto"><table class="branch-table">${tableHead}<tbody>${branchTableRows(protBranches)}</tbody></table></div>` : ‘’;

const featSection = featBranches.length ? ` <div class="branch-section-title section-gap" style="margin-top:14px">⎇ Feature / Work Branches (${featBranches.length})</div> <div style="overflow-x:auto"><table class="branch-table">${tableHead}<tbody>${branchTableRows(featBranches)}</tbody></table></div>` : ‘’;

return protSection + featSection;
}

/* –––––––––––––––––––––––––––––
6b. PERF PANE
––––––––––––––––––––––––––––– */
function perfPaneHtml(repo) {
if (!repo.perf) return ‘<div class="no-data">No performance data available.</div>’;
const p = repo.perf;
const maxTput = Math.max(…p.endpoints.map(e => e.throughputRps), 1);

const overallStatus = p.overallErrorPct > 2 ? ‘bad’ : p.overallErrorPct > 0.5 ? ‘mid’ : ‘ok’;

const summaryCards = [
{ label:‘RUN DATE’,      value: p.runDate,              cls:’’,    sub:’’ },
{ label:‘DURATION’,      value: p.duration,             cls:’’,    sub:’’ },
{ label:‘VIRTUAL USERS’, value: p.virtualUsers,         cls:’’,    sub:`ramp-up ${p.rampUp}` },
{ label:‘TOTAL REQUESTS’,value: p.totalRequests.toLocaleString(), cls:’’, sub:’’ },
{ label:‘OVERALL ERROR’, value: `${p.overallErrorPct}%`, cls:overallStatus, sub:‘error rate’ },
{ label:‘ENDPOINTS’,     value: p.endpoints.length,     cls:’’,    sub:‘tested’ },
].map(c => `<div class="perf-stat"> <div class="perf-stat-label">${c.label}</div> <div class="perf-stat-value ${c.cls}">${c.value}</div> ${c.sub ?`<div class="perf-stat-sub">${c.sub}</div>` : ''} </div>`).join(’’);

const endpointRows = p.endpoints.map(e => {
const errCls = e.errorPct > 2 ? ‘bad’ : e.errorPct > 0.5 ? ‘mid’ : ‘ok’;
const p99Cls = e.p99Ms > 2000 ? ‘bad’ : e.p99Ms > 1000 ? ‘mid’ : ‘ok’;
const tputPct = ((e.throughputRps / maxTput) * 100).toFixed(1);
return ` <tr> <td><code style="font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:var(--accent)">${e.name}</code></td> <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.7rem">${e.p50Ms}ms</td> <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.7rem">${Math.round(e.p95Ms)}ms</td> <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.7rem;color:${e.p99Ms>1000?'var(--danger)':e.p99Ms>500?'var(--warn)':'var(--text)'}">${Math.round(e.p99Ms)}ms</td> <td> <div class="tput-bar"> <div class="tput-track"><div class="tput-fill" style="width:${tputPct}%"></div></div> <span style="font-family:'JetBrains Mono',monospace;font-size:0.65rem;color:var(--muted);width:52px;text-align:right">${e.throughputRps} rps</span> </div> </td> <td style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:0.7rem" class="${errCls}">${e.errorPct}%</td> <td><span class="status-pill ${e.status === 'pass' ? 'pass' : e.status === 'warn' ? 'warn-pill' : 'fail'}">${e.status.toUpperCase()}</span></td> </tr>`;
}).join(’’);

return ` <div class="perf-summary-grid">${summaryCards}</div> <div class="branch-section-title section-gap">Endpoint Results</div> <div style="overflow-x:auto"> <table class="perf-endpoints-table"> <thead><tr> <th>Endpoint</th><th style="text-align:right">P50</th><th style="text-align:right">P95</th> <th style="text-align:right">P99</th><th>Throughput</th><th style="text-align:right">Error %</th><th>Status</th> </tr></thead> <tbody>${endpointRows}</tbody> </table> </div>`;
}

/* –––––––––––––––––––––––––––––
6c. DEPLOYMENT PANE
––––––––––––––––––––––––––––– */
function deployPaneHtml(repo) {
if (!repo.deployments.length) return ‘<div class="no-data">No deployment data available.</div>’;

const grouped = groupByEnvType(repo.deployments);
const envOrder = [‘dev’,‘sit’,‘uat’,‘prod’];

const envBadgeCls = { dev:‘env-dev’, sit:‘env-sit’, uat:‘env-uat’, prod:‘env-prod’ };

return envOrder.filter(e => grouped[e]).map(envType => {
const instances = grouped[envType];
const instCards = instances.map(inst => ` <div class="deploy-instance ${healthCls(inst.health)}"> <div class="inst-header"> <span class="inst-name">${inst.instanceName}</span> <span class="health-dot ${inst.health}" title="${inst.health}"></span> </div> <div class="inst-row"> <span class="key">GROUP</span> <span class="val">${inst.group}</span> </div> <div class="inst-row"> <span class="key">API ver</span> <span class="val ver">${inst.apiVersion}</span> </div> <div class="inst-row"> <span class="key">Web ver</span> <span class="val ver">${inst.webVersion}</span> </div> <div class="inst-row"> <span class="key">Health</span> <span class="val" style="color:${inst.health==='up'?'var(--success)':inst.health==='degraded'?'var(--warn)':'var(--danger)'}">${inst.health.toUpperCase()}</span> </div> <div class="inst-row" style="margin-top:4px"> <span class="key">TYK</span> <a class="tyk-link" href="${inst.tykUrl}" target="_blank" title="${inst.tykUrl}">↗ ${inst.instanceName}/api</a> </div> </div>`).join(’’);

```
return `
  <div class="deploy-env-group">
    <div class="env-group-title">
      <span class="env-type-badge ${envBadgeCls[envType]}">${envType.toUpperCase()}</span>
      ${envType.toUpperCase()} Environment · ${instances.length} instance${instances.length>1?'s':''}
    </div>
    <div class="deploy-instances-grid">${instCards}</div>
  </div>`;
```

}).join(’’);
}

/* –––––––––––––––––––––––––––––
7. TOGGLE LOGIC
––––––––––––––––––––––––––––– */

/** Toggle the entire expand area open/closed */
function toggleRow(repoId) {
const area = document.getElementById(`expand-${repoId}`);
const btn  = document.getElementById(`toggle-${repoId}`);
const card = document.getElementById(`card-${repoId}`);
const open = area.classList.contains(‘visible’);

area.classList.toggle(‘visible’, !open);
btn.classList.toggle(‘open’, !open);
btn.textContent = open ? ‘▸’ : ‘▾’;
card.classList.toggle(‘expanded’, !open);
}

/** Open expand area and switch to a specific pane */
function togglePane(repoId, pane, triggerBtn, branchFilter) {
const area = document.getElementById(`expand-${repoId}`);
const btn  = document.getElementById(`toggle-${repoId}`);
const card = document.getElementById(`card-${repoId}`);

// If not open, open it
if (!area.classList.contains(‘visible’)) {
area.classList.add(‘visible’);
btn.textContent = ‘▾’;
btn.classList.add(‘open’);
card.classList.add(‘expanded’);
}

// Activate the correct tab
const tabs = document.querySelectorAll(`#tabs-${repoId} .expand-tab`);
const panes = document.querySelectorAll(`#expand-${repoId} .expand-pane`);
const targetPane = document.getElementById(`pane-${pane}-${repoId}`);

tabs.forEach(t  => t.classList.remove(‘active’));
panes.forEach(p => p.classList.remove(‘active’));

// Match tab by pane name
tabs.forEach(t => {
if ((pane === ‘branches’ && t.textContent.includes(‘Branch’)) ||
(pane === ‘perf’     && t.textContent.includes(‘Perf’))   ||
(pane === ‘deploys’  && t.textContent.includes(‘Deploy’))) {
t.classList.add(‘active’);
}
});

if (targetPane) targetPane.classList.add(‘active’);

// Highlight the triggering button as active
[‘pb-btn’,‘fb-btn’,‘perf-btn’,‘dep-btn’].forEach(prefix => {
const el = document.getElementById(`${prefix}-${repoId}`);
if (el) el.classList.remove(‘active’);
});
if (triggerBtn) triggerBtn.classList.add(‘active’);
}

/** Switch tabs from within the expand area */
function switchTab(repoId, pane, tabEl) {
const tabs  = document.querySelectorAll(`#tabs-${repoId} .expand-tab`);
const panes = document.querySelectorAll(`#expand-${repoId} .expand-pane`);
tabs.forEach(t  => t.classList.remove(‘active’));
panes.forEach(p => p.classList.remove(‘active’));
tabEl.classList.add(‘active’);
const target = document.getElementById(`pane-${pane}-${repoId}`);
if (target) target.classList.add(‘active’);
}

/* –––––––––––––––––––––––––––––
8. FILTERS & SEARCH
––––––––––––––––––––––––––––– */
function applyFilters() {
const type = document.getElementById(‘typeFilter’).value;
const group = document.getElementById(‘groupFilter’).value;

filtered = allRepos.filter(r => {
if (type  && r.type  !== type)  return false;
if (group && r.group !== group) return false;
if (searchQuery) {
const q = searchQuery.toLowerCase();
return r.name.toLowerCase().includes(q) || r.group.toLowerCase().includes(q);
}
return true;
});

renderSummary(filtered);
renderRepoList(filtered);
}

function onSearch(val) {
searchQuery = val;
applyFilters();
}

function populateFilters(repos) {
const groups = […new Set(repos.map(r => r.group))].sort();
const gSel   = document.getElementById(‘groupFilter’);
const curG   = gSel.value;
gSel.innerHTML = `<option value="">All groups</option>` +
groups.map(g => `<option value="${g}"${g===curG?' selected':''}>${g}</option>`).join(’’);
}

/* –––––––––––––––––––––––––––––
9. DATA LOADING
––––––––––––––––––––––––––––– */
async function loadData() {
const btn = document.getElementById(‘refreshBtn’);
btn.classList.add(‘spinning’);
try {
await new Promise(r => setTimeout(r, 600));
const json = mockApiResponse(); // ← replace with real fetch()

```
allRepos = json.repos;
populateFilters(allRepos);
renderSummary(allRepos);

// Set period info
const d = new Date(json.meta.fetchedAt);
document.getElementById('lastUpdated').textContent =
  'Updated ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });

applyFilters();
```

} catch(err) {
document.getElementById(‘repoList’).innerHTML = ` <div class="state-overlay"> <div style="font-size:2rem">⚠</div> <div style="color:var(--danger)">Failed to load repository data</div> <div style="color:var(--muted);font-size:0.65rem">${err.message}</div> <button class="retry-btn" onclick="loadData()">↺ Retry</button> </div>`;
} finally {
btn.classList.remove(‘spinning’);
}
}

/* –––––––––––––––––––––––––––––
10. INIT
––––––––––––––––––––––––––––– */
document.addEventListener(‘DOMContentLoaded’, () => {
document.getElementById(‘typeFilter’).addEventListener(‘change’,  applyFilters);
document.getElementById(‘groupFilter’).addEventListener(‘change’, applyFilters);
loadData();
});
