// ============================================================
// DekantPM — Mathematical Analysis Interactive Script
// ============================================================
// Supports multi-market, global traders, per-market fees,
// localStorage save/load with resolve state persistence.
// ============================================================

'use strict';

// ============================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================
var DEFAULT_TRADE_FEE_BPS = 0;
var DEFAULT_LP_FEE_SHARE_PCT = 0;
var DEFAULT_REDEMPTION_FEE_BPS = 0;
var SCALE_WEIGHT = 1e9;
var Z_CUTOFF = 5;
var AUTOSAVE_INTERVAL_MS = 5000;
var STORAGE_KEY = 'dekantpm_improved_math_state_v1';
var DEFAULT_KERNEL_WIDTH = 3;

// ============================================================
// 2. GLOBAL STATE
// ============================================================
var currentLang = 'en';
var currentTheme = 'dark';

// Global traders (shared across all markets)
var globalTraders = {};  // { name: { wallet } }  — per-market spent/received tracked in traderHoldings

// Multi-market
var markets = [];          // { id, question, market, actionCount, tradeHistory }
var currentMarketIdx = -1;
var nextMarketId = 1;
var market = null;         // alias for markets[currentMarketIdx].market

// Charts
var pgChartInstance = null;
var distortionChartInstance = null;
var gaussChartInstance = null;
var lpChartInstance = null;

// Playground
var chartMode = 'bar';
var actionCount = 0;

// Action log
var actionLogEntries = [];

// Save/Load
var stateHasChanged = false;
var autosaveEnabled = false;
var autosaveTimerId = null;

// Settings (user preferences, persisted)
var settings = {
  fontSize: 'md',         // xs, sm, md, lg, xl
  numberFormat: 'short',  // short, long
  decimalPrecision: 1,    // 0-6
};

// ============================================================
// 3. LANGUAGE & THEME
// ============================================================
function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'fa' : 'en';
  applyHtmlClass();
  document.documentElement.lang = currentLang === 'fa' ? 'fa' : 'en';
  document.documentElement.dir = currentLang === 'fa' ? 'rtl' : 'ltr';
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetPromise().catch(function(){});
  }
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyHtmlClass();
  document.getElementById('themeIcon').textContent = currentTheme === 'dark' ? '\u263E' : '\u2600';
  updateAllChartColors();
}

function applyHtmlClass() {
  document.documentElement.className = 'lang-' + currentLang + ' theme-' + currentTheme;
}

applyHtmlClass();

function applyFontSize(size) {
  settings.fontSize = size || 'md';
  var map = { xs: '13px', sm: '14px', md: '16px', lg: '18px', xl: '20px' };
  document.documentElement.style.fontSize = map[settings.fontSize] || '16px';
}

// ============================================================
// 4. SIDEBAR & NAVIGATION
// ============================================================
function toggleSidebar() {
  var sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 1024) {
    sidebar.classList.toggle('open');
  } else {
    sidebar.classList.toggle('collapsed');
  }
}

// ============================================================
// 5. TABS & EXPANDABLE SECTIONS
// ============================================================
function switchTab(tabId, btn) {
  var card = btn.closest('.demo-card') || btn.closest('.expandable-body');
  if (!card) return;
  card.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
  card.querySelectorAll('.tab-content').forEach(function(t) { t.classList.remove('active'); });
  btn.classList.add('active');
  var el = document.getElementById('tab-' + tabId);
  if (el) el.classList.add('active');
}

function toggleExpandable(btn) {
  var demo = btn.closest('.expandable-demo');
  demo.classList.toggle('open');
  if (demo.id === 'demo-gaussian' && demo.classList.contains('open') && !gaussChartInstance) {
    setTimeout(initGaussianDemo, 100);
  }
}

// ============================================================
// 6. CHART UTILITIES
// ============================================================
function getChartColors() {
  var s = getComputedStyle(document.documentElement);
  return {
    primary: s.getPropertyValue('--primary').trim() || '#3b82f6',
    accent: s.getPropertyValue('--accent').trim() || '#06b6d4',
    text: s.getPropertyValue('--text').trim() || '#e2e8f0',
    textMuted: s.getPropertyValue('--text-muted').trim() || '#94a3b8',
    border: s.getPropertyValue('--border').trim() || '#334155',
    success: s.getPropertyValue('--success').trim() || '#22c55e',
    warning: s.getPropertyValue('--warning').trim() || '#f59e0b',
    danger: s.getPropertyValue('--danger').trim() || '#ef4444',
    purple: s.getPropertyValue('--purple').trim() || '#a855f7',
    bg: s.getPropertyValue('--bg-secondary').trim() || '#1e293b',
  };
}

function updateAllChartColors() {
  if (distortionChartInstance) initDistortionChart();
  if (lpChartInstance) updateLP();
  if (pgChartInstance) updatePlaygroundChart();
  if (gaussChartInstance) updateGaussian();
}

// ============================================================
// 7. TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type) {
  var container = document.getElementById('toastContainer');
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + (type || 'init');
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(function() { if (toast.parentNode) toast.remove(); }, 3100);
}

// ============================================================
// 8. ACTION LOG
// ============================================================
function addActionLog(type, summary, details) {
  var now = new Date();
  var time = now.toTimeString().substring(0, 8);
  var entry = { type: type, summary: summary, details: details, time: time,
                marketId: currentMarketIdx >= 0 ? markets[currentMarketIdx].id : 0 };
  actionLogEntries.push(entry);

  var body = document.getElementById('actionLogBody');
  var entryEl = document.createElement('div');
  entryEl.className = 'log-entry';

  var badge = document.createElement('span');
  badge.className = 'log-badge ' + type;
  badge.textContent = type.toUpperCase();

  var content = document.createElement('div');
  content.style.flex = '1';
  var sumEl = document.createElement('div');
  sumEl.className = 'log-summary';
  sumEl.textContent = summary;
  content.appendChild(sumEl);
  if (details) {
    var detEl = document.createElement('div');
    detEl.className = 'log-details';
    detEl.textContent = details;
    content.appendChild(detEl);
  }

  var timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;

  entryEl.appendChild(badge);
  entryEl.appendChild(content);
  entryEl.appendChild(timeEl);
  body.insertBefore(entryEl, body.firstChild);

  document.getElementById('logCount').textContent = '(' + actionLogEntries.length + ')';
  showToast(summary, type);
}

function toggleActionLog() {
  document.getElementById('actionLogPanel').classList.toggle('open');
  var arrow = document.getElementById('logArrow');
  arrow.textContent = document.getElementById('actionLogPanel').classList.contains('open') ? '\u25BC' : '\u25B2';
}

function clearActionLog() {
  actionLogEntries = [];
  document.getElementById('actionLogBody').innerHTML = '';
  document.getElementById('logCount').textContent = '(0)';
}

// ============================================================
// 9. RANDOM QUESTION GENERATOR
// ============================================================
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateRandomQuestion() {
  var tokens = ['BTC','ETH','SOL','DOGE','ADA','DOT','AVAX','LINK','UNI','MATIC',
                'ATOM','NEAR','APT','ARB','OP','FIL','LTC','XRP','BNB','TON'];
  var months = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var cities = ['New York','London','Tokyo','Dubai','Sydney','Berlin','Paris','Singapore'];
  var years = ['2025','2026','2027'];
  var templates = [
    function() { return 'What will be the ' + pick(tokens) + ' price by end of ' + pick(months) + ' ' + pick(years) + '?'; },
    function() { return 'What will the max temperature in ' + pick(cities) + ' be on ' + pick(months) + ' ' + randInt(1,28) + ', ' + pick(years) + '?'; },
    function() { return 'How many daily active users will ' + pick(tokens) + ' have in ' + pick(months) + ' ' + pick(years) + '?'; },
    function() { return 'What will ' + pick(tokens) + '/' + pick(tokens) + ' exchange rate be on ' + pick(months) + ' 1, ' + pick(years) + '?'; },
    function() { return 'What will total crypto market cap ($T) be by ' + pick(months) + ' ' + pick(years) + '?'; },
    function() { return 'How many TPS will ' + pick(tokens) + ' achieve in ' + pick(months) + ' ' + pick(years) + '?'; },
  ];
  return pick(templates)();
}

// ============================================================
// 10. BINS SELECT HANDLER
// ============================================================
function onBinSelectChange() {
  var sel = document.getElementById('pgBins');
  var custom = document.getElementById('pgBinsCustom');
  if (sel.value === 'custom') {
    custom.style.display = '';
    custom.focus();
  } else {
    custom.style.display = 'none';
  }
}

function getSelectedBins() {
  var sel = document.getElementById('pgBins');
  if (sel.value === 'custom') {
    var v = parseInt(document.getElementById('pgBinsCustom').value);
    return (v >= 2 && v <= 10000) ? v : 16;
  }
  return parseInt(sel.value);
}

// ============================================================
// 11. CONTINUOUS MARKET ENGINE
// ============================================================
function ContinuousMarket(N, rangeMin, rangeMax, liquidity, fees) {
  this.N = N;
  this.rangeMin = rangeMin;
  this.rangeMax = rangeMax;
  this.binWidth = (rangeMax - rangeMin) / N;
  this.k = liquidity;

  // Per-market fee config
  this.tradeFeeBps = (fees && typeof fees.tradeFeeBps === 'number') ? fees.tradeFeeBps : DEFAULT_TRADE_FEE_BPS;
  this.lpFeeSharePct = (fees && typeof fees.lpFeeSharePct === 'number') ? fees.lpFeeSharePct : DEFAULT_LP_FEE_SHARE_PCT;
  this.redemptionFeeBps = (fees && typeof fees.redemptionFeeBps === 'number') ? fees.redemptionFeeBps : DEFAULT_REDEMPTION_FEE_BPS;
  this.kernelWidth = (fees && typeof fees.kernelWidth === 'number') ? fees.kernelWidth : DEFAULT_KERNEL_WIDTH;

  var xUniform = Math.sqrt(liquidity * liquidity / N);
  this.positions = [];
  this.centers = [];
  for (var j = 0; j < N; j++) {
    this.positions.push(xUniform);
    this.centers.push(rangeMin + (2 * j + 1) * this.binWidth / 2);
  }

  this.totalLpShares = liquidity;
  this.lpProviders = {};
  this.lpProviders['Creator'] = { shares: liquidity, deposited: liquidity, withdrawn: 0 };
  this.accumulatedLpFees = 0;
  // Per-market holdings: { traderName: { holdings: [...] } }
  this.traderHoldings = {};
  this.resolved = false;
  this.winningBin = -1;
  this.lastResolveValue = null;
  this.lastResolvePayouts = null;
}

ContinuousMarket.prototype.getProbabilities = function() {
  var sum = 0;
  for (var i = 0; i < this.N; i++) sum += this.positions[i];
  var probs = [];
  for (var i = 0; i < this.N; i++) {
    probs.push(sum > 0 ? this.positions[i] / sum : 1 / this.N);
  }
  return probs;
};

ContinuousMarket.prototype.getSettlementKernel = function(winBin) {
  var W = this.kernelWidth;
  var weights = [];
  var total = 0;
  for (var i = 0; i < this.N; i++) {
    var d = Math.abs(i - winBin);
    var w = Math.max(0, 1 - d / (W + 1));
    weights.push(w);
    total += w;
  }
  // Normalize so max = 1 (winning bin)
  if (total > 0) {
    var maxW = weights[winBin];
    for (var i = 0; i < this.N; i++) weights[i] /= maxW;
  }
  return weights;
};

ContinuousMarket.prototype.getLabels = function() {
  var labels = [];
  for (var i = 0; i < this.N; i++) {
    var lo = this.rangeMin + i * this.binWidth;
    var hi = lo + this.binWidth;
    if (this.N > 100) {
      labels.push(Math.round(lo).toString());
    } else {
      labels.push(Math.round(lo) + '-' + Math.round(hi));
    }
  }
  return labels;
};

ContinuousMarket.prototype.ensureTrader = function(name) {
  if (!this.traderHoldings[name]) {
    var holdings = [];
    for (var i = 0; i < this.N; i++) holdings.push(0);
    this.traderHoldings[name] = { holdings: holdings, spent: 0, received: 0 };
  }
};

ContinuousMarket.prototype.addLpProvider = function(name) {
  if (this.lpProviders[name]) return false;
  this.lpProviders[name] = { shares: 0, deposited: 0, withdrawn: 0 };
  return true;
};

ContinuousMarket.prototype.discreteBuy = function(traderName, binIdx, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var kNew = this.k + net;
  var sumOtherSq = 0;
  for (var j = 0; j < this.N; j++) {
    if (j !== binIdx) sumOtherSq += this.positions[j] * this.positions[j];
  }
  var newXi = Math.sqrt(kNew * kNew - sumOtherSq);
  if (isNaN(newXi) || newXi < 0) return { error: 'Math error: sqrt of negative' };

  var tokensOut = newXi - this.positions[binIdx];
  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] += tokensOut;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  // Peak payout with smooth kernel: if this bin wins, kernel = 1.0
  var peakPayout = tokensOut * (1 - this.redemptionFeeBps / 10000);

  // Linear probability: x_i / sum(x_j)
  var sumPos = 0;
  for (var j = 0; j < this.N; j++) sumPos += this.positions[j];
  var newProb = sumPos > 0 ? newXi / sumPos : 1 / this.N;

  return { tokensOut: tokensOut, fee: fee, lpFee: lpFee, net: net,
           newProb: newProb,
           peakPayout: peakPayout, cost: grossCollateral,
           maxProfit: peakPayout - grossCollateral };
};

ContinuousMarket.prototype.discreteSell = function(traderName, binIdx, tokenAmount) {
  if (this.resolved) return { error: 'Market is resolved' };
  if (binIdx < 0 || binIdx >= this.N) return { error: 'Invalid bin index' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];
  if (th.holdings[binIdx] < tokenAmount - 0.01) return { error: 'Insufficient tokens in bin ' + binIdx };

  var newXi = this.positions[binIdx] - tokenAmount;
  if (newXi < 0) return { error: 'Position would go negative' };

  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    var xj = (j === binIdx) ? newXi : this.positions[j];
    sumSq += xj * xj;
  }
  var kNew = Math.sqrt(sumSq);
  var grossOut = this.k - kNew;

  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.positions[binIdx] = newXi;
  this.k = kNew;
  this.accumulatedLpFees += lpFee;

  th.holdings[binIdx] -= tokenAmount;
  th.received += netOut;
  gt.wallet += netOut;

  return { collateralOut: netOut, grossOut: grossOut, fee: fee, lpFee: lpFee,
           tokensReturned: tokenAmount };
};

ContinuousMarket.prototype._computeWeights = function(mu, sigma) {
  if (!isFinite(sigma) || sigma <= 0) return null;
  var rawWeights = [];
  var weightSum = 0;
  for (var j = 0; j < this.N; j++) {
    var z = (this.centers[j] - mu) / sigma;
    if (Math.abs(z) > Z_CUTOFF) {
      rawWeights.push(0);
    } else {
      var w = Math.exp(-z * z / 2);
      rawWeights.push(w);
      weightSum += w;
    }
  }
  if (weightSum === 0) return null;
  var W = [];
  for (var j = 0; j < this.N; j++) W.push((rawWeights[j] / weightSum) * SCALE_WEIGHT);
  return W;
};

ContinuousMarket.prototype.distributionBuy = function(traderName, mu, sigma, grossCollateral) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };
  if (gt.wallet < grossCollateral) return { error: 'Insufficient wallet balance' };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var fee = Math.floor(grossCollateral * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var net = grossCollateral - fee;

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var XW = 0, W2 = 0;
  for (var j = 0; j < this.N; j++) {
    XW += this.positions[j] * W[j];
    W2 += W[j] * W[j];
  }

  var kNew = this.k + net;
  var excess = kNew * kNew - this.k * this.k;
  var disc = XW * XW + W2 * excess;
  if (disc < 0) return { error: 'Negative discriminant' };
  var lambda = Math.sqrt(disc) - XW;

  var tokensPerBin = [];
  var totalTokens = 0;
  var maxTokensInBin = 0;
  var peakBin = 0;
  for (var j = 0; j < this.N; j++) {
    var t = (lambda * W[j]) / W2;
    tokensPerBin.push(t);
    this.positions[j] += t;
    th.holdings[j] += t;
    totalTokens += t;
    if (t > maxTokensInBin) { maxTokensInBin = t; peakBin = j; }
  }
  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.spent += grossCollateral;
  gt.wallet -= grossCollateral;

  // Peak payout: find the winning bin that maximizes kernel-weighted payout
  var peakPayout = 0;
  for (var w = 0; w < this.N; w++) {
    var wKernel = this.getSettlementKernel(w);
    var payoutW = 0;
    for (var jj = 0; jj < this.N; jj++) {
      payoutW += tokensPerBin[jj] * wKernel[jj];
    }
    if (payoutW > peakPayout) { peakPayout = payoutW; peakBin = w; }
  }
  peakPayout *= (1 - this.redemptionFeeBps / 10000);

  return { tokensPerBin: tokensPerBin, totalTokens: totalTokens, fee: fee, lpFee: lpFee, net: net,
           peakPayout: peakPayout, peakBin: peakBin, cost: grossCollateral,
           maxProfit: peakPayout - grossCollateral };
};

ContinuousMarket.prototype.distributionSell = function(traderName, mu, sigma, totalTokens) {
  if (this.resolved) return { error: 'Market is resolved' };
  var gt = globalTraders[traderName];
  if (!gt) return { error: 'Unknown trader: ' + traderName };

  this.ensureTrader(traderName);
  var th = this.traderHoldings[traderName];

  var W = this._computeWeights(mu, sigma);
  if (!W) return { error: 'All bins outside 5 sigma' };

  var tokensPerBin = [];
  for (var j = 0; j < this.N; j++) {
    var t = totalTokens * W[j] / SCALE_WEIGHT;
    t = Math.min(t, th.holdings[j]);
    t = Math.min(t, this.positions[j]);
    tokensPerBin.push(t);
  }

  // Check totalSold BEFORE mutating state to avoid invariant drift on error
  var totalSold = 0;
  for (var j = 0; j < this.N; j++) totalSold += tokensPerBin[j];
  if (totalSold < 0.01) return { error: 'No tokens available to sell in this distribution' };

  var oldK = this.k;
  var sumSq = 0;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] -= tokensPerBin[j];
    th.holdings[j] -= tokensPerBin[j];
    sumSq += this.positions[j] * this.positions[j];
  }

  var kNew = Math.sqrt(sumSq);
  var grossOut = oldK - kNew;
  var fee = Math.floor(grossOut * this.tradeFeeBps / 10000);
  var lpFee = Math.floor(fee * this.lpFeeSharePct / 100);
  var netOut = grossOut - fee;

  this.k = kNew;
  this.accumulatedLpFees += lpFee;
  th.received += netOut;
  gt.wallet += netOut;

  return { tokensPerBin: tokensPerBin, totalSold: totalSold, collateralOut: netOut,
           grossOut: grossOut, fee: fee, lpFee: lpFee };
};

ContinuousMarket.prototype.addLiquidity = function(lpName, amount) {
  if (this.resolved) return { error: 'Market is resolved' };
  var lp = this.lpProviders[lpName];
  if (!lp) return { error: 'Unknown LP: ' + lpName + '. Register first.' };

  var shares = this.totalLpShares * amount / this.k;
  var ratio = (this.k + amount) / this.k;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] *= ratio;
  }
  this.k += amount;

  lp.shares += shares;
  lp.deposited += amount;
  this.totalLpShares += shares;

  return { shares: shares, newK: this.k, ratio: ratio };
};

ContinuousMarket.prototype.removeLiquidity = function(lpName, sharesToRemove) {
  if (this.resolved) return { error: 'Use resolve payouts for resolved markets' };
  var lp = this.lpProviders[lpName];
  if (!lp) return { error: 'Unknown LP: ' + lpName };
  if (lp.shares < sharesToRemove - 0.01) return { error: 'Insufficient LP shares' };

  var fraction = sharesToRemove / this.totalLpShares;
  var collateralOut = this.k * fraction;

  var ratio = (this.k - collateralOut) / this.k;
  for (var j = 0; j < this.N; j++) {
    this.positions[j] *= ratio;
  }
  this.k -= collateralOut;

  var feeShare = this.accumulatedLpFees * fraction;
  this.accumulatedLpFees -= feeShare;

  lp.shares -= sharesToRemove;
  lp.withdrawn += collateralOut + feeShare;
  this.totalLpShares -= sharesToRemove;

  return { collateralOut: collateralOut, feeShare: feeShare, totalOut: collateralOut + feeShare };
};

// Resolve / Re-resolve: does NOT mutate positions or holdings,
// so calling again with a different value is mathematically valid.
// IMPROVED: Smooth kernel resolution — nearby bins contribute proportionally.
ContinuousMarket.prototype.resolve = function(value) {
  var bin = Math.floor((value - this.rangeMin) * this.N / (this.rangeMax - this.rangeMin));
  bin = Math.max(0, Math.min(this.N - 1, bin));
  this.resolved = true;
  this.winningBin = bin;
  this.lastResolveValue = value;

  var kernel = this.getSettlementKernel(bin);
  var payouts = [];

  // Compute total kernel-weighted trader claims
  var totalKernelClaim = 0;
  var traderClaims = {};
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var claim = 0;
    for (var i = 0; i < this.N; i++) {
      claim += th.holdings[i] * kernel[i];
    }
    traderClaims[name] = claim;
    totalKernelClaim += claim;
  }

  // Solvency guard: with smooth kernel, total claims can exceed k
  // when traders hold tokens in multiple nearby bins.  Scale down
  // proportionally so trader payouts never exceed the vault.
  var claimScale = 1;
  if (totalKernelClaim > this.k && totalKernelClaim > 0) {
    claimScale = this.k / totalKernelClaim;
  }
  var lpResidual = this.k - totalKernelClaim * claimScale;

  var totalRedemptionFees = 0;
  for (var name in this.traderHoldings) {
    var th = this.traderHoldings[name];
    var grossPayout = traderClaims[name] * claimScale;
    var redemptionFee = grossPayout * this.redemptionFeeBps / 10000;
    totalRedemptionFees += redemptionFee;
    var payout = grossPayout - redemptionFee;

    // Build detail string showing kernel contributions
    var kernelBins = [];
    for (var i = 0; i < this.N; i++) {
      if (th.holdings[i] > 0.01 && kernel[i] > 0) {
        kernelBins.push({ bin: i, value: Math.floor(th.holdings[i] * kernel[i] * claimScale) });
      }
    }
    var scaleSuffix = claimScale < 1 ? ' (scaled ' + (claimScale * 100).toFixed(1) + '%)' : '';
    var shortDetail;
    if (kernelBins.length === 0) {
      shortDetail = 'No tokens';
    } else if (kernelBins.length === 1) {
      shortDetail = 'bin ' + kernelBins[0].bin + ': ' + kernelBins[0].value.toLocaleString() + scaleSuffix;
    } else {
      shortDetail = kernelBins.length + ' bins' + scaleSuffix;
    }
    var fullDetail = kernelBins.length > 0
      ? kernelBins.map(function(b) { return { bin: b.bin, value: b.value }; })
      : [];

    payouts.push({
      name: name, type: 'Trader',
      detail: shortDetail, detailBins: fullDetail, detailScale: scaleSuffix,
      payout: payout, spent: th.spent, received: th.received,
      netPnL: payout + th.received - th.spent
    });
  }

  var lpPool = lpResidual + totalRedemptionFees;
  for (var name in this.lpProviders) {
    var lp = this.lpProviders[name];
    if (lp.shares <= 0 && lp.deposited <= 0) continue;
    var fraction = (this.totalLpShares > 0) ? lp.shares / this.totalLpShares : 0;
    var reserveShare = lpPool * fraction;
    var feeShare = this.accumulatedLpFees * fraction;
    var totalPayout = reserveShare + feeShare;
    var lpWithdrawn = lp.withdrawn || 0;
    payouts.push({
      name: name, type: 'LP',
      detail: Math.floor(lp.shares).toLocaleString() + ' shares' + (lpWithdrawn > 0 ? ' (+' + Math.floor(lpWithdrawn).toLocaleString() + ' withdrawn)' : ''),
      payout: totalPayout, spent: lp.deposited, received: lpWithdrawn,
      netPnL: totalPayout + lpWithdrawn - lp.deposited
    });
  }

  this.lastResolvePayouts = payouts;
  return { winningBin: bin, payouts: payouts };
};

// Portfolio valuation for a trader (expected payout at current probabilities)
// IMPROVED: Uses smooth kernel for expected & peak payout calculations.
ContinuousMarket.prototype.getTraderPortfolio = function(traderName) {
  var gt = globalTraders[traderName];
  if (!gt) return null;
  var th = this.traderHoldings[traderName];
  var mSpent = th ? th.spent : 0;
  var mReceived = th ? th.received : 0;
  if (!th) {
    return {
      totalHoldings: 0, expectedPayout: 0, peakPayout: 0, peakBin: 0,
      wallet: gt.wallet, totalSpent: mSpent, totalReceived: mReceived,
      unrealizedPnL: mReceived - mSpent,
      pnlPct: 0
    };
  }

  var probs = this.getProbabilities();
  var expectedPayout = 0;
  var totalHoldings = 0;
  var peakBin = 0;
  var peakTokens = 0;

  // For each possible winning bin, compute kernel-weighted payout
  for (var winBin = 0; winBin < this.N; winBin++) {
    var kernel = this.getSettlementKernel(winBin);
    var payoutIfWin = 0;
    for (var j = 0; j < this.N; j++) {
      payoutIfWin += th.holdings[j] * kernel[j];
    }
    expectedPayout += probs[winBin] * payoutIfWin * (1 - this.redemptionFeeBps / 10000);
  }

  // Find best-case winning bin (max kernel-weighted payout across all possible outcomes)
  var peakPayout = 0;
  for (var w = 0; w < this.N; w++) {
    var kernel = this.getSettlementKernel(w);
    var payoutIfW = 0;
    for (var j = 0; j < this.N; j++) {
      payoutIfW += th.holdings[j] * kernel[j];
    }
    if (payoutIfW > peakPayout) { peakPayout = payoutIfW; peakBin = w; }
  }
  peakPayout *= (1 - this.redemptionFeeBps / 10000);

  for (var j = 0; j < this.N; j++) {
    totalHoldings += th.holdings[j];
  }

  var unrealizedPnL = expectedPayout + mReceived - mSpent;
  var pnlPct = mSpent > 0 ? (unrealizedPnL / mSpent * 100) : 0;

  return {
    totalHoldings: totalHoldings,
    expectedPayout: expectedPayout,
    peakPayout: peakPayout,
    peakBin: peakBin,
    wallet: gt.wallet,
    totalSpent: mSpent,
    totalReceived: mReceived,
    unrealizedPnL: unrealizedPnL,
    pnlPct: pnlPct
  };
};

// ============================================================
// 12. SERIALIZATION (for save/load)
// ============================================================
function serializeMarket(m) {
  return {
    N: m.N, rangeMin: m.rangeMin, rangeMax: m.rangeMax, binWidth: m.binWidth,
    k: m.k, positions: m.positions.slice(), centers: m.centers.slice(),
    tradeFeeBps: m.tradeFeeBps, lpFeeSharePct: m.lpFeeSharePct, redemptionFeeBps: m.redemptionFeeBps, kernelWidth: m.kernelWidth,
    totalLpShares: m.totalLpShares,
    lpProviders: JSON.parse(JSON.stringify(m.lpProviders)),
    accumulatedLpFees: m.accumulatedLpFees,
    traderHoldings: JSON.parse(JSON.stringify(m.traderHoldings)),
    resolved: m.resolved, winningBin: m.winningBin,
    lastResolveValue: m.lastResolveValue,
    lastResolvePayouts: m.lastResolvePayouts,
  };
}

function deserializeMarket(data) {
  var m = Object.create(ContinuousMarket.prototype);
  m.N = data.N; m.rangeMin = data.rangeMin; m.rangeMax = data.rangeMax;
  m.binWidth = data.binWidth; m.k = data.k;
  m.positions = data.positions; m.centers = data.centers;
  m.tradeFeeBps = typeof data.tradeFeeBps === 'number' ? data.tradeFeeBps : DEFAULT_TRADE_FEE_BPS;
  m.lpFeeSharePct = typeof data.lpFeeSharePct === 'number' ? data.lpFeeSharePct : DEFAULT_LP_FEE_SHARE_PCT;
  m.redemptionFeeBps = typeof data.redemptionFeeBps === 'number' ? data.redemptionFeeBps : DEFAULT_REDEMPTION_FEE_BPS;
  m.kernelWidth = typeof data.kernelWidth === 'number' ? data.kernelWidth : DEFAULT_KERNEL_WIDTH;
  m.totalLpShares = data.totalLpShares;
  m.lpProviders = data.lpProviders;
  m.accumulatedLpFees = data.accumulatedLpFees;
  m.traderHoldings = data.traderHoldings || {};
  // Ensure per-market accounting fields exist on deserialized holdings
  for (var name in m.traderHoldings) {
    var th = m.traderHoldings[name];
    if (th.spent === undefined) th.spent = 0;
    if (th.received === undefined) th.received = 0;
  }
  // Ensure LP withdrawn field exists (added for correct P&L tracking)
  for (var name in m.lpProviders) {
    if (m.lpProviders[name].withdrawn === undefined) m.lpProviders[name].withdrawn = 0;
  }
  m.resolved = data.resolved; m.winningBin = data.winningBin;
  m.lastResolveValue = (data.lastResolveValue !== undefined && data.lastResolveValue !== null) ? data.lastResolveValue : null;
  m.lastResolvePayouts = data.lastResolvePayouts || null;
  return m;
}

// ============================================================
// 13. SAVE / LOAD SYSTEM
// ============================================================
function markChanged() {
  stateHasChanged = true;
  var indicator = document.getElementById('saveIndicator');
  if (indicator) indicator.style.display = '';
}

function saveState() {
  try {
    var state = {
      version: 3,
      globalTraders: JSON.parse(JSON.stringify(globalTraders)),
      markets: markets.map(function(entry) {
        return {
          id: entry.id, question: entry.question, actionCount: entry.actionCount,
          market: serializeMarket(entry.market),
          tradeHistory: (entry.tradeHistory || []).slice(-500)
        };
      }),
      currentMarketIdx: currentMarketIdx,
      nextMarketId: nextMarketId,
      actionLog: actionLogEntries.slice(-200),
      settings: { fontSize: settings.fontSize, numberFormat: settings.numberFormat, decimalPrecision: settings.decimalPrecision },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    stateHasChanged = false;
    var indicator = document.getElementById('saveIndicator');
    if (indicator) indicator.style.display = 'none';
    showToast(currentLang === 'fa' ? '\u0630\u062E\u06CC\u0631\u0647 \u0634\u062F' : 'State saved', 'init');
  } catch (e) {
    showToast('Save failed: ' + e.message, 'sell');
  }
}

function loadState() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    var state = JSON.parse(raw);
    if (!state || !Array.isArray(state.markets)) return false;

    // Restore global traders
    globalTraders = state.globalTraders || {};

    markets = state.markets.map(function(entry) {
      return {
        id: entry.id, question: entry.question, actionCount: entry.actionCount || 0,
        market: deserializeMarket(entry.market),
        tradeHistory: entry.tradeHistory || []
      };
    });

    // Restore settings
    if (state.settings) {
      if (state.settings.fontSize) settings.fontSize = state.settings.fontSize;
      if (state.settings.numberFormat) settings.numberFormat = state.settings.numberFormat;
      if (typeof state.settings.decimalPrecision === 'number') settings.decimalPrecision = state.settings.decimalPrecision;
      applyFontSize(settings.fontSize);
    }
    currentMarketIdx = state.currentMarketIdx;
    nextMarketId = state.nextMarketId || (markets.length + 1);

    // Restore action log
    if (Array.isArray(state.actionLog)) {
      actionLogEntries = state.actionLog;
      var body = document.getElementById('actionLogBody');
      body.innerHTML = '';
      for (var i = actionLogEntries.length - 1; i >= 0; i--) {
        var e = actionLogEntries[i];
        var entryEl = document.createElement('div');
        entryEl.className = 'log-entry';
        var badge = document.createElement('span');
        badge.className = 'log-badge ' + e.type;
        badge.textContent = e.type.toUpperCase();
        var content = document.createElement('div');
        content.style.flex = '1';
        var sumEl = document.createElement('div');
        sumEl.className = 'log-summary';
        sumEl.textContent = e.summary;
        content.appendChild(sumEl);
        if (e.details) {
          var detEl = document.createElement('div');
          detEl.className = 'log-details';
          detEl.textContent = e.details;
          content.appendChild(detEl);
        }
        var timeEl = document.createElement('span');
        timeEl.className = 'log-time';
        timeEl.textContent = e.time || '';
        entryEl.appendChild(badge);
        entryEl.appendChild(content);
        entryEl.appendChild(timeEl);
        body.appendChild(entryEl);
      }
      document.getElementById('logCount').textContent = '(' + actionLogEntries.length + ')';
    }

    // Activate current market
    if (currentMarketIdx >= 0 && currentMarketIdx < markets.length) {
      market = markets[currentMarketIdx].market;
      actionCount = markets[currentMarketIdx].actionCount;
    } else {
      market = null;
      actionCount = 0;
    }

    stateHasChanged = false;
    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

function manualSave() {
  saveState();
}

function toggleAutosave() {
  autosaveEnabled = !autosaveEnabled;
  updateAutosaveUI();
  if (autosaveEnabled) {
    autosaveTimerId = setInterval(function() {
      if (stateHasChanged) saveState();
    }, AUTOSAVE_INTERVAL_MS);
  } else {
    if (autosaveTimerId) { clearInterval(autosaveTimerId); autosaveTimerId = null; }
  }
}

function updateAutosaveUI() {
  var dot = document.getElementById('autosaveDot');
  if (dot) { dot.className = 'autosave-dot ' + (autosaveEnabled ? 'on' : 'off'); }
}

function resetAllState() {
  var msg = currentLang === 'fa'
    ? '\u0622\u06CC\u0627 \u0645\u0637\u0645\u0626\u0646 \u0647\u0633\u062A\u06CC\u062F\u061F \u062A\u0645\u0627\u0645 \u062F\u0627\u062F\u0647\u200C\u0647\u0627 \u067E\u0627\u06A9 \u062E\u0648\u0627\u0647\u062F \u0634\u062F.'
    : 'Are you sure? All saved state will be erased.';
  if (!confirm(msg)) return;
  localStorage.removeItem(STORAGE_KEY);
  globalTraders = {};
  markets = [];
  currentMarketIdx = -1;
  nextMarketId = 1;
  market = null;
  actionCount = 0;
  stateHasChanged = false;
  actionLogEntries = [];
  document.getElementById('actionLogBody').innerHTML = '';
  document.getElementById('logCount').textContent = '(0)';
  resetPlaygroundUI();
  updateMarketSelector();
  updateGlobalTradersList();
  var indicator = document.getElementById('saveIndicator');
  if (indicator) indicator.style.display = 'none';
  showToast(currentLang === 'fa' ? '\u0628\u0627\u0632\u0646\u0634\u0627\u0646\u06CC \u0634\u062F' : 'State reset', 'resolve');
}

// ============================================================
// 14. MULTI-MARKET MANAGEMENT
// ============================================================
function updateMarketSelector() {
  var sel = document.getElementById('marketSelector');
  if (!sel) return;
  sel.innerHTML = '';
  if (markets.length === 0) {
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = currentLang === 'fa' ? '-- \u0628\u062F\u0648\u0646 \u0628\u0627\u0632\u0627\u0631 --' : '-- No markets --';
    sel.appendChild(opt);
    return;
  }
  for (var i = 0; i < markets.length; i++) {
    var opt = document.createElement('option');
    opt.value = i;
    var label = markets[i].question || ('Market #' + markets[i].id);
    if (label.length > 40) label = label.substring(0, 37) + '...';
    opt.textContent = '#' + markets[i].id + ': ' + label;
    if (i === currentMarketIdx) opt.selected = true;
    sel.appendChild(opt);
  }
}

function switchMarket(idxStr) {
  var idx = parseInt(idxStr);
  if (isNaN(idx) || idx < 0 || idx >= markets.length) return;

  // Save current action count
  if (currentMarketIdx >= 0 && markets[currentMarketIdx]) {
    markets[currentMarketIdx].actionCount = actionCount;
  }

  currentMarketIdx = idx;
  market = markets[idx].market;
  actionCount = markets[idx].actionCount || 0;

  // Refresh all UI
  updateMarketSelector();
  updateTraderSelect();
  updateLpSelect();
  updateParticipantsList();
  updatePlaygroundStats();
  initTradePreviewControls();

  // Show results & chart
  document.getElementById('pgResults').style.display = '';
  document.getElementById('pgChartContainer').style.display = '';
  document.getElementById('pgToolbar').style.display = '';

  // Auto-select chart mode
  if (market.N > 64 && chartMode === 'bar') setChartMode('line', null);

  updatePlaygroundChart();
  updatePortfolioTab();
  updateResolveButton();
  updateFeeDisplay();

  // Restore payouts display if resolved
  if (market.resolved && market.lastResolvePayouts) {
    renderResolvePayouts({ winningBin: market.winningBin, payouts: market.lastResolvePayouts });
  } else {
    document.getElementById('payoutsSection').style.display = 'none';
    document.getElementById('payoutsSection').innerHTML = '';
  }

  showToast('Switched to Market #' + markets[idx].id, 'init');
}

// ============================================================
// 15. PLAYGROUND UI
// ============================================================
function initPlayground() {
  var N = getSelectedBins();
  var rMin = parseFloat(document.getElementById('pgRangeMin').value);
  var rMax = parseFloat(document.getElementById('pgRangeMax').value);
  var L = parseInt(document.getElementById('pgLiquidity').value);
  var question = (document.getElementById('pgQuestion') || {}).value || '';
  if (isNaN(rMin) || isNaN(rMax) || isNaN(N) || isNaN(L) || rMax <= rMin || N < 2 || L < 1000) { alert('Invalid parameters'); return; }

  // Save current market's action count
  if (currentMarketIdx >= 0 && markets[currentMarketIdx]) {
    markets[currentMarketIdx].actionCount = actionCount;
  }

  // Get fees from the fee modal inputs
  var fees = {
    tradeFeeBps: parseInt(document.getElementById('feeTradeFeeBps').value) || 0,
    lpFeeSharePct: parseInt(document.getElementById('feeLpFeeSharePct').value) || 0,
    redemptionFeeBps: parseInt(document.getElementById('feeRedemptionFeeBps').value) || 0,
    kernelWidth: (function() { var v = parseInt(document.getElementById('feeKernelWidth').value); return isNaN(v) ? DEFAULT_KERNEL_WIDTH : v; })(),
  };

  // Create new market
  var newMarket = new ContinuousMarket(N, rMin, rMax, L, fees);
  var entry = { id: nextMarketId++, question: question, market: newMarket, actionCount: 0, tradeHistory: [] };
  markets.push(entry);
  currentMarketIdx = markets.length - 1;
  market = newMarket;
  actionCount = 0;

  document.getElementById('pgDiscreteBin').max = N - 1;
  document.getElementById('pgResults').style.display = '';
  document.getElementById('pgChartContainer').style.display = '';
  document.getElementById('pgToolbar').style.display = '';
  document.getElementById('payoutsSection').style.display = 'none';
  document.getElementById('payoutsSection').innerHTML = '';

  // Clear trade results
  hideTradeResults();

  if (N > 64 && chartMode === 'bar') setChartMode('line', null);

  updateMarketSelector();
  updateTraderSelect();
  updateLpSelect();
  updateParticipantsList();
  updatePlaygroundChart();
  updatePlaygroundStats();
  initTradePreviewControls();
  updateResolveButton();
  updatePortfolioTab();
  updateFeeDisplay();

  addActionLog('init', 'Market #' + entry.id + ' created: N=' + N + ', [' + rMin + ', ' + rMax + '], L=' + L.toLocaleString(),
    'Q: ' + (question || '(none)') + ' | Bins: ' + N + ' | Width: ' + ((rMax - rMin) / N).toFixed(1) + ' | p: ' + (100 / N).toFixed(2) + '%');
  markChanged();
}

function resetPlayground() {
  resetPlaygroundUI();
}

function resetPlaygroundUI() {
  document.getElementById('pgResults').style.display = 'none';
  document.getElementById('pgChartContainer').style.display = 'none';
  document.getElementById('pgToolbar').style.display = 'none';
  document.getElementById('pgParticipantsSummary').style.display = 'none';
  document.getElementById('payoutsSection').style.display = 'none';
  document.getElementById('payoutsSection').innerHTML = '';
  document.getElementById('discreteSliderRow').style.display = 'none';
  document.getElementById('discretePreview').style.display = 'none';
  document.getElementById('distMuSliderRow').style.display = 'none';
  document.getElementById('distConfSliderRow').style.display = 'none';
  document.getElementById('distPreview').style.display = 'none';
  hideTradeResults();
  if (pgChartInstance) { pgChartInstance.destroy(); pgChartInstance = null; }
}

function hideTradeResults() {
  var ids = ['discreteTradeResult', 'distTradeResult', 'discreteTradePreview', 'distTradePreview'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (el) el.style.display = 'none';
  }
}

function getActiveTrader() {
  var sel = document.getElementById('activeTrader');
  return sel.value || '';
}

// -- Global Trader management --
function addGlobalTrader() {
  var name = document.getElementById('traderNameInput').value.trim();
  var balance = parseInt(document.getElementById('traderBalanceInput').value) || 500000;
  if (!name) { alert('Enter a trader name'); return; }
  if (globalTraders[name]) { alert('Trader already exists'); return; }
  globalTraders[name] = { wallet: balance };
  updateGlobalTradersList();
  updateTraderSelect();
  updateParticipantsList();
  addActionLog('init', 'Added global trader: ' + name, 'Wallet: ' + balance.toLocaleString());
  document.getElementById('traderNameInput').value = '';
  markChanged();
}

function addLpUI() {
  if (!market) { alert('Create a market first'); return; }
  var name = document.getElementById('traderNameInput').value.trim();
  if (!name) { alert('Enter an LP provider name'); return; }
  if (!market.addLpProvider(name)) { alert('LP provider already exists'); return; }
  updateLpSelect();
  updateParticipantsList();
  addActionLog('lp', 'Registered LP provider: ' + name, '');
  document.getElementById('traderNameInput').value = '';
  markChanged();
}

function topUpTrader() {
  var sel = document.getElementById('topUpTrader');
  var name = sel ? sel.value : '';
  if (!name || !globalTraders[name]) { alert('Select a trader'); return; }
  var amount = parseInt(document.getElementById('topUpAmount').value) || 0;
  if (amount <= 0) { alert('Enter a positive amount'); return; }
  globalTraders[name].wallet += amount;
  updateTraderSelect();
  updateGlobalTradersList();
  updateParticipantsList();
  updatePortfolioTab();
  addActionLog('init', name + ' topped up +' + amount.toLocaleString(), 'New balance: ' + Math.floor(globalTraders[name].wallet).toLocaleString());
  markChanged();
}

function updateTopUpSelect() {
  var sel = document.getElementById('topUpTrader');
  if (!sel) return;
  sel.innerHTML = '';
  for (var name in globalTraders) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + ' ($' + formatCompact(globalTraders[name].wallet) + ')';
    sel.appendChild(opt);
  }
}

function updateTraderSelect() {
  var sel = document.getElementById('activeTrader');
  var prev = sel.value;
  sel.innerHTML = '';
  for (var name in globalTraders) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + ' ($' + formatCompact(globalTraders[name].wallet) + ')';
    sel.appendChild(opt);
  }
  if (prev && globalTraders[prev]) sel.value = prev;
  updateTopUpSelect();
}

function updateGlobalTradersList() {
  var container = document.getElementById('globalTradersList');
  if (!container) return;
  var names = Object.keys(globalTraders);
  if (names.length === 0) {
    container.innerHTML = '<span style="color:var(--text-muted);font-size:0.8rem;">' + langText('No traders yet', '\u0647\u0646\u0648\u0632 \u0645\u0639\u0627\u0645\u0644\u0647\u200C\u06AF\u0631\u06CC \u0646\u06CC\u0633\u062A') + '</span>';
    return;
  }
  var html = '<div class="participants-row">';
  for (var i = 0; i < names.length; i++) {
    var t = globalTraders[names[i]];
    html += '<span class="participant-chip trader">' + names[i] + ' <span class="chip-balance">$' + formatCompact(t.wallet) + '</span></span>';
  }
  html += '</div>';
  container.innerHTML = html;
}

function updateLpSelect() {
  var sel = document.getElementById('lpProviderSelect');
  var prev = sel.value;
  sel.innerHTML = '';
  if (!market) return;
  for (var name in market.lpProviders) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name + ' (' + Math.floor(market.lpProviders[name].shares).toLocaleString() + ' shares)';
    sel.appendChild(opt);
  }
  if (prev && market.lpProviders[prev]) sel.value = prev;
}

function updateParticipantsList() {
  var container = document.getElementById('participantsList');
  if (!market) { container.innerHTML = ''; return; }
  var html = '<div class="participants-row" style="margin-top:16px;">';

  // Show global traders that have holdings in this market
  for (var name in globalTraders) {
    var t = globalTraders[name];
    var hasHoldings = market.traderHoldings[name] && market.traderHoldings[name].holdings.some(function(h) { return h > 0.01; });
    html += '<span class="participant-chip trader"' + (hasHoldings ? '' : ' style="opacity:0.5"') + '>' + name + ' <span class="chip-balance">$' + formatCompact(t.wallet) + '</span></span>';
  }
  for (var name in market.lpProviders) {
    var lp = market.lpProviders[name];
    html += '<span class="participant-chip lp">' + name + ' <span class="chip-balance">' + Math.floor(lp.shares).toLocaleString() + ' sh</span></span>';
  }
  html += '</div>';
  container.innerHTML = html;

  var summary = document.getElementById('pgParticipantsSummary');
  summary.style.display = '';
  summary.innerHTML = html;
}

// -- Trade result display --
function showDiscreteTradeResult(result, isBuy, traderName) {
  var el = document.getElementById('discreteTradeResult');
  if (!el) return;
  el.style.display = '';
  el.className = 'trade-result';
  var html = '<div class="result-grid result-grid-sm" style="margin:0;">';
  if (isBuy) {
    html += resultItemSm(langText('Tokens', '\u062A\u0648\u06A9\u0646'), formatCompact(result.tokensOut));
    html += resultItemSm(langText('Peak Payout', '\u062D\u062F\u0627\u06A9\u062B\u0631'), formatCompact(result.peakPayout), 'positive');
    var profitPct = result.cost > 0 ? (result.maxProfit / result.cost * 100).toFixed(1) + '%' : '-';
    html += resultItemSm(langText('Max Profit', '\u062D\u062F\u0627\u06A9\u062B\u0631 \u0633\u0648\u062F'), (result.maxProfit >= 0 ? '+' : '') + formatCompact(result.maxProfit) + ' (' + profitPct + ')', result.maxProfit >= 0 ? 'positive' : 'negative');
    html += resultItemSm(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(result.fee));
  } else {
    html += resultItemSm(langText('Received', '\u062F\u0631\u06CC\u0627\u0641\u062A\u06CC'), '$' + formatCompact(result.collateralOut), 'positive');
    html += resultItemSm(langText('Tokens Returned', '\u062A\u0648\u06A9\u0646 \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC'), formatCompact(result.tokensReturned));
    html += resultItemSm(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(result.fee));
  }
  html += '</div>';
  html += traderStateLine(traderName);
  el.innerHTML = html;
}

function showDistTradeResult(result, isBuy, traderName) {
  var el = document.getElementById('distTradeResult');
  if (!el) return;
  el.style.display = '';
  el.className = 'trade-result';
  var html = '<div class="result-grid result-grid-sm" style="margin:0;">';
  if (isBuy) {
    html += resultItemSm(langText('Total Tokens', '\u06A9\u0644 \u062A\u0648\u06A9\u0646'), formatCompact(result.totalTokens));
    html += resultItemSm(langText('Peak Payout', '\u062D\u062F\u0627\u06A9\u062B\u0631') + ' (bin ' + result.peakBin + ')', formatCompact(result.peakPayout), 'positive');
    var profitPct = result.cost > 0 ? (result.maxProfit / result.cost * 100).toFixed(1) + '%' : '-';
    html += resultItemSm(langText('Max Profit', '\u062D\u062F\u0627\u06A9\u062B\u0631 \u0633\u0648\u062F'), (result.maxProfit >= 0 ? '+' : '') + formatCompact(result.maxProfit) + ' (' + profitPct + ')', result.maxProfit >= 0 ? 'positive' : 'negative');
    html += resultItemSm(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(result.fee));
  } else {
    html += resultItemSm(langText('Received', '\u062F\u0631\u06CC\u0627\u0641\u062A\u06CC'), '$' + formatCompact(result.collateralOut), 'positive');
    html += resultItemSm(langText('Tokens Sold', '\u062A\u0648\u06A9\u0646 \u0641\u0631\u0648\u062E\u062A\u0647'), formatCompact(result.totalSold));
    html += resultItemSm(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(result.fee));
  }
  html += '</div>';
  html += traderStateLine(traderName);
  el.innerHTML = html;
}

function traderStateLine(traderName) {
  if (!traderName || !market || !globalTraders[traderName]) return '';
  var p = market.getTraderPortfolio(traderName);
  if (!p) return '';
  var pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
  var pnlClass = p.unrealizedPnL >= 0 ? 'positive' : 'negative';
  return '<div class="trade-result-footer">' + traderName + ': $' + formatCompact(p.wallet) + ' ' + langText('wallet', '\u06A9\u06CC\u0641 \u067E\u0648\u0644') +
    ' &middot; P&L: <span class="' + pnlClass + '">' + pnlSign + formatCompact(p.unrealizedPnL) + ' (' + pnlSign + p.pnlPct.toFixed(1) + '%)</span></div>';
}

// Refresh trader state footers in visible trade result sections when trader changes
function updateTradeResultFooters() {
  var trader = getActiveTrader();
  var ids = ['discreteTradeResult', 'distTradeResult'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el || el.style.display === 'none') continue;
    var footer = el.querySelector('.trade-result-footer');
    if (footer) {
      var newFooter = traderStateLine(trader);
      if (newFooter) {
        footer.outerHTML = newFooter;
      } else {
        footer.remove();
      }
    } else {
      // No footer yet — append one if trader has portfolio data
      var line = traderStateLine(trader);
      if (line) el.insertAdjacentHTML('beforeend', line);
    }
  }
}

function recordTrade(type, trader, detail, amount, result) {
  if (!markets[currentMarketIdx]) return;
  if (!markets[currentMarketIdx].tradeHistory) markets[currentMarketIdx].tradeHistory = [];
  markets[currentMarketIdx].tradeHistory.push({
    type: type, trader: trader, detail: detail,
    amount: amount, result: result,
    time: new Date().toTimeString().substring(0, 8)
  });
}

function langText(en, fa) {
  return '<span class="lang-en">' + en + '</span><span class="lang-fa">' + fa + '</span>';
}

// -- Refresh all previews --
function refreshPreviews() {
  renderDiscretePreview();
  renderDistPreview();
}

// -- Trade functions --
function playgroundDiscreteBuy() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { alert('Add and select a trader first'); return; }
  var bin = parseInt(document.getElementById('pgDiscreteBin').value);
  var amount = parseInt(document.getElementById('pgDiscreteAmount').value);
  var result = market.discreteBuy(trader, bin, amount);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  var label = market.getLabels()[bin] || bin;
  addActionLog('buy', trader + ' bought bin ' + bin + ' [' + label + ']: ' + Math.floor(result.tokensOut).toLocaleString() + ' tokens',
    'Cost: ' + amount.toLocaleString() + ' | Fee: ' + result.fee.toLocaleString() + ' | Peak payout: ' + Math.floor(result.peakPayout).toLocaleString() + ' | New p: ' + (result.newProb * 100).toFixed(2) + '%');
  recordTrade('buy', trader, 'Bin ' + bin + ' [' + label + ']', amount, formatCompact(result.tokensOut) + ' tok, peak ' + formatCompact(result.peakPayout));
  showDiscreteTradeResult(result, true, trader);
  afterTrade();
  markChanged();
}

function playgroundDiscreteSell() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { alert('Add and select a trader first'); return; }
  var bin = parseInt(document.getElementById('pgDiscreteBin').value);
  var tokens = parseFloat(document.getElementById('pgDiscreteAmount').value);
  var result = market.discreteSell(trader, bin, tokens);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  var label = market.getLabels()[bin] || bin;
  addActionLog('sell', trader + ' sold ' + Math.floor(tokens).toLocaleString() + ' tokens from bin ' + bin + ' [' + label + ']',
    'Received: ' + Math.floor(result.collateralOut).toLocaleString() + ' | Fee: ' + result.fee.toLocaleString());
  recordTrade('sell', trader, 'Bin ' + bin + ' [' + label + ']', tokens, '$' + formatCompact(result.collateralOut) + ' received');
  showDiscreteTradeResult(result, false, trader);
  afterTrade();
  markChanged();
}

function playgroundDistBuy() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { alert('Add and select a trader first'); return; }
  var mu = parseFloat(document.getElementById('pgDistMu').value);
  var sigma = parseFloat(document.getElementById('pgDistSigma').value);
  var amount = parseInt(document.getElementById('pgDistAmount').value);
  var result = market.distributionBuy(trader, mu, sigma, amount);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  addActionLog('buy', trader + ' dist-buy N(' + mu + ',' + sigma + '): ' + Math.floor(result.totalTokens).toLocaleString() + ' tokens',
    'Cost: ' + amount.toLocaleString() + ' | Fee: ' + result.fee.toLocaleString() + ' | Peak: ' + Math.floor(result.peakPayout).toLocaleString() + ' (bin ' + result.peakBin + ')');
  recordTrade('dist-buy', trader, 'N(' + mu + ',' + sigma + ')', amount, formatCompact(result.totalTokens) + ' tok, peak ' + formatCompact(result.peakPayout));
  showDistTradeResult(result, true, trader);
  afterTrade();
  markChanged();
}

function playgroundDistSell() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { alert('Add and select a trader first'); return; }
  var mu = parseFloat(document.getElementById('pgDistMu').value);
  var sigma = parseFloat(document.getElementById('pgDistSigma').value);
  var totalTokens = parseFloat(document.getElementById('pgDistAmount').value);
  var result = market.distributionSell(trader, mu, sigma, totalTokens);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  addActionLog('sell', trader + ' dist-sell N(' + mu + ',' + sigma + '): ' + Math.floor(result.totalSold).toLocaleString() + ' tokens sold',
    'Received: ' + Math.floor(result.collateralOut).toLocaleString() + ' | Fee: ' + result.fee.toLocaleString());
  recordTrade('dist-sell', trader, 'N(' + mu + ',' + sigma + ')', totalTokens, '$' + formatCompact(result.collateralOut) + ' received');
  showDistTradeResult(result, false, trader);
  afterTrade();
  markChanged();
}

function playgroundAddLP() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var lpName = document.getElementById('lpProviderSelect').value;
  if (!lpName) { alert('Select an LP provider'); return; }
  var amount = parseInt(document.getElementById('lpAmount').value);
  if (!amount || amount <= 0) { alert('Enter a valid amount'); return; }
  var result = market.addLiquidity(lpName, amount);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  addActionLog('lp', lpName + ' added ' + amount.toLocaleString() + ' liquidity',
    'Shares: ' + Math.floor(result.shares).toLocaleString() + ' | New k: ' + Math.floor(result.newK).toLocaleString() + ' | Ratio: ' + result.ratio.toFixed(6));
  recordTrade('lp-add', lpName, formatCompact(result.shares) + ' shares', amount, 'k=' + formatCompact(result.newK));
  afterTrade();
  markChanged();
}

function playgroundRemoveLP() {
  if (!market) { alert('Create a market first'); return; }
  if (market.resolved) { alert('Market is resolved. Only re-resolving is allowed.'); return; }
  var lpName = document.getElementById('lpProviderSelect').value;
  if (!lpName) { alert('Select an LP provider'); return; }
  var shares = parseFloat(document.getElementById('lpAmount').value);
  if (!shares || shares <= 0) { alert('Enter shares to remove'); return; }
  var result = market.removeLiquidity(lpName, shares);
  if (result.error) { alert(result.error); return; }
  actionCount++;
  addActionLog('lp', lpName + ' removed ' + Math.floor(shares).toLocaleString() + ' LP shares',
    'Out: ' + Math.floor(result.collateralOut).toLocaleString() + ' | Fee share: ' + Math.floor(result.feeShare).toLocaleString() + ' | Total: ' + Math.floor(result.totalOut).toLocaleString());
  recordTrade('lp-remove', lpName, formatCompact(shares) + ' shares', shares, '$' + formatCompact(result.totalOut) + ' out');
  afterTrade();
  markChanged();
}

function afterTrade() {
  updatePlaygroundChart();
  updatePlaygroundStats();
  updateTraderSelect();
  updateLpSelect();
  updateParticipantsList();
  refreshPreviews();
  updatePortfolioTab();
}

// -- Resolve / Re-resolve --
function playgroundResolve() {
  if (!market) { alert('Create a market first'); return; }
  var wasResolved = market.resolved;
  var val = parseFloat(document.getElementById('pgResolveValue').value);
  var result = market.resolve(val);
  var label = market.getLabels()[result.winningBin] || result.winningBin;
  actionCount++;
  var prefix = wasResolved ? 'Re-resolved' : 'Resolved';
  addActionLog('resolve', prefix + ': value=' + val + ' -> bin ' + result.winningBin + ' [' + label + ']',
    'Payouts for ' + result.payouts.length + ' participants');

  updatePlaygroundChart();
  updatePlaygroundStats();
  renderResolvePayouts(result);
  updateResolveButton();
  markChanged();
}

function updateResolveButton() {
  var btn = document.getElementById('resolveBtn');
  if (!btn) return;
  if (market && market.resolved) {
    btn.innerHTML = '<span class="lang-en">Re-Resolve</span><span class="lang-fa">\u062A\u0639\u06CC\u06CC\u0646 \u0645\u062C\u062F\u062F</span>';
  } else {
    btn.innerHTML = '<span class="lang-en">Resolve Market</span><span class="lang-fa">\u062A\u0639\u06CC\u06CC\u0646 \u0646\u062A\u06CC\u062C\u0647 \u0628\u0627\u0632\u0627\u0631</span>';
  }
}

function renderResolvePayouts(result) {
  var section = document.getElementById('payoutsSection');
  section.style.display = '';
  var label = market.getLabels()[result.winningBin] || result.winningBin;
  var html = '<div class="payout-section">';
  html += '<h4><span class="lang-en">Smooth Kernel Payouts (Center bin: ' + result.winningBin + ' [' + label + '], W=' + market.kernelWidth + ')</span>';
  html += '<span class="lang-fa">\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0647\u0633\u062A\u0647 (\u0628\u0627\u0632\u0647 \u0645\u0631\u06A9\u0632\u06CC: ' + result.winningBin + ' [' + label + '], W=' + market.kernelWidth + ')</span></h4>';
  html += '<div class="payout-table-wrapper"><table class="payout-table">';
  html += '<thead><tr>';
  html += '<th><span class="lang-en">Name</span><span class="lang-fa">\u0646\u0627\u0645</span></th>';
  html += '<th><span class="lang-en">Type</span><span class="lang-fa">\u0646\u0648\u0639</span></th>';
  html += '<th><span class="lang-en">Detail</span><span class="lang-fa">\u062C\u0632\u0626\u06CC\u0627\u062A</span></th>';
  html += '<th><span class="lang-en">Payout</span><span class="lang-fa">\u067E\u0631\u062F\u0627\u062E\u062A</span></th>';
  html += '<th><span class="lang-en">Total Spent</span><span class="lang-fa">\u0647\u0632\u06CC\u0646\u0647 \u06A9\u0644</span></th>';
  html += '<th><span class="lang-en">Net P&L</span><span class="lang-fa">\u0633\u0648\u062F/\u0632\u06CC\u0627\u0646</span></th>';
  html += '<th><span class="lang-en">P&L %</span><span class="lang-fa">\u062F\u0631\u0635\u062F</span></th>';
  html += '</tr></thead><tbody>';
  for (var i = 0; i < result.payouts.length; i++) {
    var p = result.payouts[i];
    var pnlClass = p.netPnL >= 0 ? 'pnl-positive' : 'pnl-negative';
    var pnlSign = p.netPnL >= 0 ? '+' : '';
    var pnlPct = p.spent > 0 ? (p.netPnL / p.spent * 100).toFixed(1) : '0.0';
    html += '<tr>';
    html += '<td style="font-weight:700;color:var(--text-heading);">' + p.name + '</td>';
    html += '<td>' + p.type + '</td>';
    if (p.detailBins && p.detailBins.length > 0) {
      var tooltipTotal = 0;
      var tooltipRows = p.detailBins.map(function(b) {
        tooltipTotal += b.value;
        return '<tr><td>Bin ' + b.bin + '</td><td>' + b.value.toLocaleString() + '</td></tr>';
      }).join('');
      var scaleNote = p.detailScale ? '<div class="detail-tooltip-scale">' + p.detailScale.trim() + '</div>' : '';
      var tooltipContent = '<div class="detail-tooltip-title">Kernel Contributions</div>'
        + '<table class="detail-tooltip-table">'
        + '<thead><tr><th>Bin</th><th>Payout</th></tr></thead>'
        + '<tbody>' + tooltipRows + '</tbody></table>'
        + '<div class="detail-tooltip-total">Total: ' + tooltipTotal.toLocaleString() + '</div>'
        + scaleNote;
      html += '<td class="detail-cell"><span class="detail-truncated">' + p.detail + '</span>'
        + '<div class="detail-tooltip-data">' + tooltipContent + '</div></td>';
    } else {
      html += '<td>' + p.detail + '</td>';
    }
    html += '<td>' + Math.floor(p.payout).toLocaleString() + '</td>';
    html += '<td>' + Math.floor(p.spent).toLocaleString() + '</td>';
    html += '<td class="' + pnlClass + '">' + pnlSign + Math.floor(p.netPnL).toLocaleString() + '</td>';
    html += '<td class="' + pnlClass + '">' + pnlSign + pnlPct + '%</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div></div>';
  section.innerHTML = html;
  setupDetailTooltips();
}

function setupDetailTooltips() {
  var overlay = document.getElementById('detailTooltipOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'detailTooltipOverlay';
    overlay.className = 'detail-tooltip-overlay';
    document.body.appendChild(overlay);
  }
  // State
  var hideTimer = null;
  var activeCell = null;
  var pinned = false;

  function positionOverlay(cell) {
    var rect = cell.getBoundingClientRect();
    var oW = overlay.offsetWidth;
    var oH = overlay.offsetHeight;
    var left = rect.left + rect.width / 2 - oW / 2;
    var top = rect.bottom + 8;
    if (left < 8) left = 8;
    if (left + oW > window.innerWidth - 8) left = window.innerWidth - 8 - oW;
    if (top + oH > window.innerHeight - 8) top = rect.top - oH - 8;
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  }

  function showOverlay(cell) {
    var data = cell.querySelector('.detail-tooltip-data');
    if (!data) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    overlay.innerHTML = data.innerHTML;
    overlay.classList.add('visible');
    activeCell = cell;
    positionOverlay(cell);
  }

  function scheduleHide() {
    if (pinned) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function() {
      overlay.classList.remove('visible');
      activeCell = null;
      hideTimer = null;
    }, 150);
  }

  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  function dismissPinned() {
    pinned = false;
    overlay.classList.remove('pinned', 'visible');
    activeCell = null;
  }

  // Overlay hover: keep visible while mouse is inside tooltip
  overlay.addEventListener('mouseenter', cancelHide);
  overlay.addEventListener('mouseleave', scheduleHide);

  // Click outside or on overlay to dismiss pinned tooltip
  document.addEventListener('click', function(e) {
    if (!pinned) return;
    // Click on overlay itself — dismiss
    if (overlay.contains(e.target)) { dismissPinned(); return; }
    // Click on a detail-cell — handled in cell click below
    var clickedCell = e.target.closest('.detail-cell');
    if (clickedCell) return;
    // Click anywhere else — dismiss
    dismissPinned();
  });

  var cells = document.querySelectorAll('.detail-cell');
  for (var i = 0; i < cells.length; i++) {
    (function(cell) {
      cell.addEventListener('mouseenter', function() {
        if (pinned) return;
        showOverlay(cell);
      });
      cell.addEventListener('mouseleave', function() {
        if (pinned) return;
        scheduleHide();
      });
      cell.addEventListener('click', function(e) {
        e.stopPropagation();
        if (pinned && activeCell === cell) {
          // Unpin
          dismissPinned();
        } else {
          // Pin this cell's tooltip
          pinned = false; // reset so showOverlay works
          showOverlay(cell);
          pinned = true;
          overlay.classList.add('pinned');
        }
      });
    })(cells[i]);
  }
}

// ============================================================
// 16. TRADE PREVIEW SYSTEM (SVG)
// ============================================================

// Log-scale confidence mapping (matches frontend lib/normal.ts)
var LN_FRAC_MIN = Math.log(1 / 100);
var LN_FRAC_MAX = Math.log(1 / 2);

function sliderToSigma(slider, rangeWidth) {
  var lnFrac = LN_FRAC_MIN + slider * (LN_FRAC_MAX - LN_FRAC_MIN);
  return rangeWidth * Math.exp(lnFrac);
}

function sigmaToSlider(sigma, rangeWidth) {
  if (rangeWidth <= 0 || sigma <= 0) return 0.5;
  var lnFrac = Math.log(sigma / rangeWidth);
  return Math.max(0, Math.min(1, (lnFrac - LN_FRAC_MIN) / (LN_FRAC_MAX - LN_FRAC_MIN)));
}

function computePreviewWeights(N, rangeMin, rangeMax, mu, sigma) {
  var binWidth = (rangeMax - rangeMin) / N;
  var weights = [];
  var total = 0;
  for (var i = 0; i < N; i++) {
    var center = rangeMin + (i + 0.5) * binWidth;
    var z = (center - mu) / sigma;
    var w = (Math.abs(z) > Z_CUTOFF) ? 0 : Math.exp(-0.5 * z * z);
    weights.push(w);
    total += w;
  }
  if (total === 0) return weights;
  for (var i = 0; i < N; i++) weights[i] /= total;
  return weights;
}

function renderDistPreview() {
  if (!market) return;
  var svg = document.getElementById('distPreviewSvg');
  if (!svg) return;

  var W = 400, H = 120;
  var pad = { top: 8, right: 12, bottom: 22, left: 12 };
  var innerW = W - pad.left - pad.right;
  var innerH = H - pad.top - pad.bottom;
  var baseline = pad.top + innerH;

  var mu = parseFloat(document.getElementById('pgDistMu').value) || 0;
  var sigma = parseFloat(document.getElementById('pgDistSigma').value) || 1;
  var N = market.N;

  var marketProbs = market.getProbabilities();
  var traderWeights = computePreviewWeights(N, market.rangeMin, market.rangeMax, mu, sigma);

  var maxVal = 0.001;
  for (var i = 0; i < N; i++) {
    if (marketProbs[i] > maxVal) maxVal = marketProbs[i];
    if (traderWeights[i] > maxVal) maxVal = traderWeights[i];
  }

  var barW = innerW / N;
  var marketPts = [], traderPts = [];
  for (var i = 0; i < N; i++) {
    var x = pad.left + barW * (i + 0.5);
    marketPts.push({ x: x, y: pad.top + innerH * (1 - marketProbs[i] / maxVal) });
    traderPts.push({ x: x, y: pad.top + innerH * (1 - traderWeights[i] / maxVal) });
  }

  var muFrac = Math.max(0, Math.min(1, (mu - market.rangeMin) / (market.rangeMax - market.rangeMin)));
  var muX = pad.left + muFrac * innerW;

  var areaPath = 'M ' + traderPts[0].x + ' ' + baseline;
  for (var i = 0; i < traderPts.length; i++) areaPath += ' L ' + traderPts[i].x + ' ' + traderPts[i].y;
  areaPath += ' L ' + traderPts[traderPts.length - 1].x + ' ' + baseline + ' Z';

  var marketLine = marketPts.map(function(p) { return p.x + ',' + p.y; }).join(' ');
  var traderLine = traderPts.map(function(p) { return p.x + ',' + p.y; }).join(' ');

  var ticks = [
    { label: formatCompact(market.rangeMin), x: pad.left },
    { label: formatCompact((market.rangeMin + market.rangeMax) / 2), x: pad.left + innerW / 2 },
    { label: formatCompact(market.rangeMax), x: pad.left + innerW }
  ];

  var textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#94a3b8';
  var borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#334155';

  var html = '';
  html += '<defs><linearGradient id="traderGrad" x1="0" x2="0" y1="0" y2="1">';
  html += '<stop offset="0%" stop-color="#3b82f6" stop-opacity="0.35"/>';
  html += '<stop offset="100%" stop-color="#3b82f6" stop-opacity="0.05"/>';
  html += '</linearGradient></defs>';
  html += '<path d="' + areaPath + '" fill="url(#traderGrad)"/>';
  html += '<polyline points="' + traderLine + '" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linejoin="round"/>';
  html += '<polyline points="' + marketLine + '" fill="none" stroke="' + textColor + '" stroke-width="1" stroke-dasharray="5 3" stroke-linejoin="round" stroke-opacity="0.6"/>';
  html += '<line x1="' + muX + '" x2="' + muX + '" y1="' + pad.top + '" y2="' + baseline + '" stroke="#3b82f6" stroke-width="1" stroke-dasharray="3 2" stroke-opacity="0.5"/>';
  html += '<line x1="' + pad.left + '" x2="' + (W - pad.right) + '" y1="' + baseline + '" y2="' + baseline + '" stroke="' + borderColor + '" stroke-opacity="0.2" stroke-width="0.5"/>';
  for (var i = 0; i < ticks.length; i++) {
    html += '<text x="' + ticks[i].x + '" y="' + (H - 4) + '" text-anchor="middle" fill="' + textColor + '" font-size="9" font-family="var(--font-mono)">' + ticks[i].label + '</text>';
  }
  svg.innerHTML = html;
}

function renderDiscretePreview() {
  if (!market) return;
  var svg = document.getElementById('discretePreviewSvg');
  if (!svg) return;

  var W = 400, H = 100;
  var pad = { top: 6, right: 8, bottom: 20, left: 8 };
  var innerW = W - pad.left - pad.right;
  var innerH = H - pad.top - pad.bottom;
  var baseline = pad.top + innerH;
  var N = market.N;

  var probs = market.getProbabilities();
  var selectedBin = parseInt(document.getElementById('pgDiscreteBin').value) || 0;
  selectedBin = Math.max(0, Math.min(N - 1, selectedBin));

  var maxP = 0.001;
  for (var i = 0; i < N; i++) { if (probs[i] > maxP) maxP = probs[i]; }

  var barW = innerW / N;
  var gap = N > 64 ? 0 : (N > 32 ? 0.5 : 1);

  var textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#94a3b8';
  var borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#334155';

  var html = '';
  for (var i = 0; i < N; i++) {
    var barH = innerH * (probs[i] / maxP);
    var x = pad.left + barW * i + gap;
    var y = baseline - barH;
    var w = barW - gap * 2;
    if (w < 0.5) w = 0.5;
    if (i === selectedBin) {
      html += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + barH + '" rx="' + (N > 64 ? 0 : 2) + '" fill="#22c55e" fill-opacity="0.8" stroke="#22c55e" stroke-width="1"/>';
    } else {
      html += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + barH + '" rx="' + (N > 64 ? 0 : 2) + '" fill="' + borderColor + '" fill-opacity="0.3" stroke="' + borderColor + '" stroke-width="0.5" stroke-opacity="0.4"/>';
    }
  }

  html += '<line x1="' + pad.left + '" x2="' + (W - pad.right) + '" y1="' + baseline + '" y2="' + baseline + '" stroke="' + borderColor + '" stroke-opacity="0.2" stroke-width="0.5"/>';

  var labels = market.getLabels();
  var selX = pad.left + barW * (selectedBin + 0.5);
  html += '<text x="' + selX + '" y="' + (H - 3) + '" text-anchor="middle" fill="#22c55e" font-size="9" font-weight="600" font-family="var(--font-mono)">' + labels[selectedBin] + '</text>';
  html += '<text x="' + pad.left + '" y="' + (H - 3) + '" text-anchor="start" fill="' + textColor + '" font-size="8" font-family="var(--font-mono)" opacity="0.5">' + formatCompact(market.rangeMin) + '</text>';
  html += '<text x="' + (W - pad.right) + '" y="' + (H - 3) + '" text-anchor="end" fill="' + textColor + '" font-size="8" font-family="var(--font-mono)" opacity="0.5">' + formatCompact(market.rangeMax) + '</text>';

  var selBarH = innerH * (probs[selectedBin] / maxP);
  var selBarY = baseline - selBarH;
  html += '<text x="' + selX + '" y="' + (selBarY - 3) + '" text-anchor="middle" fill="#22c55e" font-size="8" font-weight="600" font-family="var(--font-mono)">' + (probs[selectedBin] * 100).toFixed(1) + '%</text>';

  svg.innerHTML = html;
}

// -- Slider sync --
function syncDiscreteSlider(source) {
  if (!market) return;
  if (source === 'slider') {
    document.getElementById('pgDiscreteBin').value = document.getElementById('pgDiscreteBinSlider').value;
  } else {
    var val = parseInt(document.getElementById('pgDiscreteBin').value) || 0;
    val = Math.max(0, Math.min(market.N - 1, val));
    document.getElementById('pgDiscreteBinSlider').value = val;
  }
  var bin = parseInt(document.getElementById('pgDiscreteBin').value);
  var labels = market.getLabels();
  document.getElementById('discreteSliderCenter').textContent = labels[bin] || '';
  renderDiscretePreview();
  updateDiscreteTradePreview();
}

function syncDistSliders(source) {
  if (!market) return;
  var rangeWidth = market.rangeMax - market.rangeMin;

  if (source === 'mu-slider') {
    var val = parseFloat(document.getElementById('pgDistMuSlider').value);
    document.getElementById('pgDistMu').value = Math.round(val * 100) / 100;
  } else if (source === 'mu-input') {
    document.getElementById('pgDistMuSlider').value = parseFloat(document.getElementById('pgDistMu').value) || 0;
  } else if (source === 'conf-slider') {
    var slider = parseFloat(document.getElementById('pgConfidenceSlider').value);
    var sigma = sliderToSigma(slider, rangeWidth);
    document.getElementById('pgDistSigma').value = Math.round(sigma * 100) / 100;
  } else if (source === 'sigma-input') {
    var sigma = parseFloat(document.getElementById('pgDistSigma').value) || 1;
    document.getElementById('pgConfidenceSlider').value = sigmaToSlider(sigma, rangeWidth);
  }

  var sigma = parseFloat(document.getElementById('pgDistSigma').value) || 1;
  var hint = document.getElementById('distConfHint');
  if (hint) {
    hint.innerHTML = '<span class="lang-en">\u00B1' + formatCompact(sigma) + ' covers 68% of your prediction</span>' +
                     '<span class="lang-fa">\u00B1' + formatCompact(sigma) + ' \u067E\u0648\u0634\u0634 \u06F6\u06F8\u066A \u067E\u06CC\u0634\u200C\u0628\u06CC\u0646\u06CC \u0634\u0645\u0627</span>';
  }
  renderDistPreview();
  updateDistTradePreview();
}

function initTradePreviewControls() {
  if (!market) return;
  var N = market.N;
  var rMin = market.rangeMin;
  var rMax = market.rangeMax;

  // Discrete
  document.getElementById('pgDiscreteBinSlider').max = N - 1;
  document.getElementById('pgDiscreteBinSlider').value = 0;
  document.getElementById('pgDiscreteBin').value = 0;
  document.getElementById('discreteSliderMin').textContent = '0';
  document.getElementById('discreteSliderMax').textContent = (N - 1);
  document.getElementById('discreteSliderRow').style.display = '';
  document.getElementById('discretePreview').style.display = '';
  syncDiscreteSlider('input');

  // Distribution
  var muSlider = document.getElementById('pgDistMuSlider');
  muSlider.min = rMin; muSlider.max = rMax;
  muSlider.step = (rMax - rMin) / 1000;
  var mid = (rMin + rMax) / 2;
  muSlider.value = mid;
  document.getElementById('pgDistMu').value = mid;
  document.getElementById('distMuSliderMin').textContent = formatCompact(rMin);
  document.getElementById('distMuSliderMax').textContent = formatCompact(rMax);
  document.getElementById('distMuSliderRow').style.display = '';

  document.getElementById('pgConfidenceSlider').value = 0.5;
  var sigmaFromSlider = sliderToSigma(0.5, rMax - rMin);
  document.getElementById('pgDistSigma').value = Math.round(sigmaFromSlider * 100) / 100;
  document.getElementById('distConfSliderRow').style.display = '';
  document.getElementById('distPreview').style.display = '';

  syncDistSliders('conf-slider');
}

// -- Chart mode toggle --
function setChartMode(mode, btn) {
  chartMode = mode;
  var group = document.querySelector('.chart-mode-group');
  if (group) {
    group.querySelectorAll('.chart-mode-btn').forEach(function(b) { b.classList.remove('active'); });
  }
  if (btn) {
    btn.classList.add('active');
  } else if (group) {
    group.querySelectorAll('.chart-mode-btn').forEach(function(b) {
      var en = b.querySelector('.lang-en');
      if (en) {
        if (mode === 'bar' && en.textContent === 'Bars') b.classList.add('active');
        if (mode === 'line' && en.textContent === 'Continuous') b.classList.add('active');
      }
    });
  }
  if (market) updatePlaygroundChart();
}

// -- Main chart --
function updatePlaygroundChart() {
  if (!market) return;
  var ctx = document.getElementById('pgChart').getContext('2d');
  var c = getChartColors();
  var probs = market.getProbabilities();
  var labels = market.getLabels();

  if (pgChartInstance) pgChartInstance.destroy();

  var bgColors, borderColors;
  if (market.resolved) {
    bgColors = probs.map(function(_, i) { return i === market.winningBin ? c.success + 'CC' : c.primary + '30'; });
    borderColors = probs.map(function(_, i) { return i === market.winningBin ? c.success : c.primary + '60'; });
  } else {
    bgColors = probs.map(function() { return c.primary + '80'; });
    borderColors = probs.map(function() { return c.primary; });
  }

  var dataset;
  if (chartMode === 'line') {
    dataset = {
      label: 'Probability', data: probs.map(function(p) { return p * 100; }),
      borderColor: market.resolved ? c.success : c.accent,
      backgroundColor: (market.resolved ? c.success : c.accent) + '20',
      fill: true, tension: 0.4,
      pointRadius: market.N > 100 ? 0 : 2, pointHoverRadius: 4, borderWidth: 2,
    };
  } else {
    dataset = {
      label: 'Probability', data: probs.map(function(p) { return p * 100; }),
      backgroundColor: bgColors, borderColor: borderColors,
      borderWidth: 1, borderRadius: market.N > 64 ? 0 : 4,
    };
  }

  pgChartInstance = new Chart(ctx, {
    type: chartMode === 'line' ? 'line' : 'bar',
    data: { labels: labels, datasets: [dataset] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: market.N > 200 ? 0 : 400, easing: 'easeOutCubic' },
      scales: {
        x: {
          ticks: { color: c.textMuted, maxRotation: 45, font: { size: market.N > 100 ? 8 : 10 }, maxTicksLimit: market.N > 100 ? 20 : undefined },
          grid: { display: false },
        },
        y: {
          min: 0, title: { display: true, text: 'Probability (%)', color: c.textMuted },
          ticks: { color: c.textMuted }, grid: { color: c.border + '30' },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(items) { return 'Bin ' + items[0].dataIndex + ': ' + labels[items[0].dataIndex]; },
            label: function(ctx) { return 'p = ' + ctx.parsed.y.toFixed(3) + '%'; }
          }
        }
      }
    }
  });
}

function updatePlaygroundStats() {
  if (!market) return;
  document.getElementById('pgK').textContent = Math.round(market.k).toLocaleString();
  document.getElementById('pgFees').textContent = Math.round(market.accumulatedLpFees).toLocaleString();
  document.getElementById('pgTrades').textContent = actionCount;
  document.getElementById('pgLpShares').textContent = Math.round(market.totalLpShares).toLocaleString();

  var sumSq = 0;
  for (var i = 0; i < market.N; i++) sumSq += market.positions[i] * market.positions[i];
  var drift = Math.abs(sumSq - market.k * market.k);
  var el = document.getElementById('pgInvariant');
  if (drift < 1) {
    el.textContent = 'OK';
    el.className = 'result-value positive';
  } else {
    el.textContent = drift.toFixed(0);
    el.className = 'result-value neutral';
  }
}

// ============================================================
// 17. PROBABILITY DISTORTION DEMO
// ============================================================
function quadraticProb(p) {
  // OLD model (for comparison): p_hat = p^2/(p^2 + (1-p)^2)
  var p2 = p * p;
  var q2 = (1 - p) * (1 - p);
  return p2 / (p2 + q2);
}

function linearProb(p) {
  // IMPROVED model: displayed = true probability (no distortion)
  return p;
}

function initDistortionChart() {
  var ctx = document.getElementById('distortionChart').getContext('2d');
  var c = getChartColors();
  if (distortionChartInstance) distortionChartInstance.destroy();

  var quadData = [];
  var linearData = [];
  for (var i = 1; i <= 99; i++) {
    quadData.push({ x: i, y: quadraticProb(i / 100) * 100 });
    linearData.push({ x: i, y: linearProb(i / 100) * 100 });
  }

  distortionChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        { label: 'Old: Quadratic', data: quadData, borderColor: c.warning, backgroundColor: c.warning + '10', fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2, borderDash: [6, 3] },
        { label: 'Improved: Linear', data: linearData, borderColor: c.success, backgroundColor: c.success + '20', fill: true, tension: 0, pointRadius: 0, borderWidth: 2 },
        { label: 'y = x', data: [{ x: 0, y: 0 }, { x: 100, y: 100 }], borderColor: c.textMuted, borderDash: [5, 5], pointRadius: 0, borderWidth: 1 },
        { label: 'Linear (current)', data: [{ x: 50, y: 50 }], borderColor: c.success, backgroundColor: c.success, pointRadius: 8, pointHoverRadius: 10, showLine: false },
        { label: 'Quadratic (old)', data: [{ x: 50, y: quadraticProb(0.5) * 100 }], borderColor: c.warning, backgroundColor: c.warning, pointRadius: 8, pointHoverRadius: 10, showLine: false, pointStyle: 'triangle' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      scales: {
        x: { type: 'linear', min: 0, max: 100, title: { display: true, text: 'True Probability (%)', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { color: c.border + '40' } },
        y: { min: 0, max: 100, title: { display: true, text: 'Displayed p (%)', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { color: c.border + '40' } }
      },
      plugins: { legend: { display: true, labels: { color: c.textMuted, font: { size: 11 } } } }
    }
  });
}

function updateDistortion() {
  var p = parseInt(document.getElementById('distortionSlider').value) / 100;
  var pHatQuad = quadraticProb(p);
  var pHatLinear = linearProb(p);
  document.getElementById('distortionSliderVal').textContent = (p * 100).toFixed(0) + '%';
  document.getElementById('trueP1').textContent = (pHatLinear * 100).toFixed(1) + '%';
  document.getElementById('quadP1').textContent = (pHatQuad * 100).toFixed(1) + '%';
  if (distortionChartInstance) {
    distortionChartInstance.data.datasets[3].data = [{ x: p * 100, y: pHatLinear * 100 }];
    distortionChartInstance.data.datasets[4].data = [{ x: p * 100, y: pHatQuad * 100 }];
    distortionChartInstance.update('none');
  }
}

// ============================================================
// 18. GAUSSIAN DISCRETIZATION DEMO
// ============================================================
function initGaussianDemo() { updateGaussian(); }

function updateGaussian() {
  var mu = parseInt(document.getElementById('gaussMu').value);
  var sigma = parseInt(document.getElementById('gaussSigma').value);
  var N = parseInt(document.getElementById('gaussBins').value);
  document.getElementById('gaussMuVal').textContent = mu;
  document.getElementById('gaussSigmaVal').textContent = sigma;

  var rangeMin = 0, rangeMax = 100;
  var binWidth = (rangeMax - rangeMin) / N;

  var curveX = [], curveY = [];
  for (var i = 0; i <= 200; i++) {
    var x = rangeMin + (rangeMax - rangeMin) * i / 200;
    var z = (x - mu) / sigma;
    curveX.push(x);
    curveY.push(Math.exp(-z * z / 2) / (sigma * Math.sqrt(2 * Math.PI)));
  }

  var binCenters = [], binHeights = [];
  var activeBins = 0, maxWeight = 0, maxWeightBin = 0, weightSum = 0;
  for (var j = 0; j < N; j++) {
    var center = rangeMin + (2 * j + 1) * binWidth / 2;
    binCenters.push(center);
    var z = (center - mu) / sigma;
    var w = Math.abs(z) > 5 ? 0 : Math.exp(-z * z / 2);
    weightSum += w;
    binHeights.push(w);
    if (w > 0.001) activeBins++;
    if (w > maxWeight) { maxWeight = w; maxWeightBin = j; }
  }
  for (var j = 0; j < N; j++) binHeights[j] = weightSum > 0 ? (binHeights[j] / weightSum) / binWidth : 0;

  var error = 0;
  for (var j = 0; j < N; j++) {
    var z = (binCenters[j] - mu) / sigma;
    var truePdf = Math.exp(-z * z / 2) / (sigma * Math.sqrt(2 * Math.PI));
    error += (binHeights[j] - truePdf) * (binHeights[j] - truePdf) * binWidth;
  }
  error = Math.sqrt(error);

  document.getElementById('gaussError').textContent = error.toExponential(2);
  document.getElementById('gaussPeak').textContent = maxWeightBin;
  document.getElementById('gaussActive').textContent = activeBins + '/' + N;

  var ctx = document.getElementById('gaussChart').getContext('2d');
  var c = getChartColors();
  if (gaussChartInstance) gaussChartInstance.destroy();

  gaussChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: binCenters.map(function(x) { return x.toFixed(1); }),
      datasets: [
        { type: 'line', label: 'True Gaussian', data: curveX.map(function(x, i) { return { x: x, y: curveY[i] }; }), borderColor: c.accent, borderWidth: 2, tension: 0.4, pointRadius: 0, fill: false, order: 1, xAxisID: 'xLine' },
        { type: 'bar', label: 'Bin Weights', data: binHeights, backgroundColor: c.primary + '60', borderColor: c.primary, borderWidth: 1, borderRadius: N > 64 ? 0 : 3, order: 2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      scales: {
        x: { display: true, ticks: { color: c.textMuted, maxTicksLimit: 15, font: { size: 9 } }, grid: { display: false } },
        xLine: { type: 'linear', display: false, min: rangeMin, max: rangeMax },
        y: { min: 0, title: { display: true, text: 'Density', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { color: c.border + '30' } }
      },
      plugins: { legend: { display: true, labels: { color: c.textMuted, font: { size: 11 } } } }
    }
  });
}

// ============================================================
// 19. LP CALCULATOR
// ============================================================
function updateLP() {
  var pool = parseFloat(document.getElementById('lpPool').value) || 100000;
  var bins = parseInt(document.getElementById('lpBins').value) || 64;
  var feeBps = parseFloat(document.getElementById('lpFee').value) || 30;
  var sharePercent = parseFloat(document.getElementById('lpShare').value) || 50;

  var lpFeeRate = (feeBps / 10000) * (sharePercent / 100);
  var baselineLoss = 0; // Fixed: no baseline loss with correct implementation
  var baselineLossAmt = pool * baselineLoss;
  var breakeven = lpFeeRate > 0 && baselineLossAmt > 0 ? baselineLossAmt / lpFeeRate : 0;
  var multiple = lpFeeRate > 0 && breakeven > 0 ? breakeven / pool : 0;

  document.getElementById('lpLoss').textContent = (baselineLoss * 100).toFixed(1) + '%';
  document.getElementById('lpBreakeven').textContent = breakeven > 0 ? '$' + formatCompact(breakeven) : 'N/A (no loss)';
  document.getElementById('lpMultiple').textContent = multiple > 0 ? Math.round(multiple) + 'x' : 'N/A';

  var ctx = document.getElementById('lpChart').getContext('2d');
  var c = getChartColors();
  if (lpChartInstance) lpChartInstance.destroy();

  if (lpFeeRate <= 0) {
    // With zero fees and zero baseline loss, LP breaks even — show flat zero line
    lpChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['0', formatCompact(pool * 10)],
        datasets: [{
          label: 'LP Net Return (%)', data: [0, 0],
          borderColor: c.textMuted, backgroundColor: c.textMuted + '20',
          fill: true, tension: 0, pointRadius: 2, borderWidth: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
        scales: {
          x: { title: { display: true, text: 'Total Volume', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { display: false } },
          y: { title: { display: true, text: 'Net Return (%)', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { color: c.border + '30' } }
        },
        plugins: { legend: { display: false } }
      }
    });
    return;
  }

  // With fees: LP earns linearly from volume (no baseline loss to overcome)
  var volumes = [], returns = [];
  var maxVol = pool * 10;
  for (var i = 0; i <= 20; i++) {
    var vol = (maxVol / 20) * i;
    volumes.push(vol);
    returns.push(((vol * lpFeeRate - baselineLossAmt) / pool) * 100);
  }

  lpChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: volumes.map(function(v) { return formatCompact(v); }),
      datasets: [{
        label: 'LP Net Return (%)', data: returns,
        borderColor: c.accent,
        backgroundColor: returns.map(function(r) { return r >= 0 ? c.success + '30' : c.danger + '20'; }),
        fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      scales: {
        x: { title: { display: true, text: 'Total Volume', color: c.textMuted }, ticks: { color: c.textMuted, maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
        y: { title: { display: true, text: 'Net Return (%)', color: c.textMuted }, ticks: { color: c.textMuted }, grid: { color: c.border + '30' } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: function(items) { return 'Volume: $' + formatCompact(volumes[items[0].dataIndex]); }, label: function(ctx) { return 'Return: ' + ctx.parsed.y.toFixed(1) + '%'; } } }
      }
    }
  });
}

// ============================================================
// 20. UTILITIES
// ============================================================
function formatCompact(n) {
  var d = settings.decimalPrecision;
  if (settings.numberFormat === 'long') {
    var parts = Number(n).toFixed(d).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d > 0 ? parts.join('.') : parts[0];
  }
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  if (Math.abs(n) < 1 && n !== 0) return Number(n).toFixed(Math.max(d, 2));
  return Math.round(n).toString();
}

function resultItemSm(label, value, colorClass) {
  return '<div class="result-item result-item-sm"><div class="result-label">' + label + '</div><div class="result-value result-value-sm ' + (colorClass || '') + '">' + value + '</div></div>';
}

function previewCell(label, value, colorClass) {
  return '<div class="preview-cell"><div class="preview-cell-label">' + label + '</div><div class="preview-cell-value ' + (colorClass || '') + '">' + value + '</div></div>';
}

// ============================================================
// 21. SETTINGS MODAL
// ============================================================
function openSettingsModal() {
  var modal = document.getElementById('settingsModal');
  if (!modal) return;
  modal.classList.add('open');
  document.querySelectorAll('input[name="setFontSize"]').forEach(function(r) { r.checked = r.value === settings.fontSize; });
  document.querySelectorAll('input[name="setNumFmt"]').forEach(function(r) { r.checked = r.value === settings.numberFormat; });
  var prec = document.getElementById('setPrecision');
  if (prec) { prec.value = settings.decimalPrecision; }
  var precVal = document.getElementById('setPrecisionVal');
  if (precVal) precVal.textContent = settings.decimalPrecision;
  var autoEl = document.getElementById('setAutosave');
  if (autoEl) autoEl.checked = autosaveEnabled;
}

function closeSettingsModal() {
  var modal = document.getElementById('settingsModal');
  if (modal) modal.classList.remove('open');
}

function applySetting(key, value) {
  if (key === 'fontSize') {
    applyFontSize(value);
  } else if (key === 'numberFormat') {
    settings.numberFormat = value;
  } else if (key === 'decimalPrecision') {
    settings.decimalPrecision = Math.max(0, Math.min(6, parseInt(value) || 1));
    var el = document.getElementById('setPrecisionVal');
    if (el) el.textContent = settings.decimalPrecision;
  } else if (key === 'autosave') {
    if (autosaveEnabled !== !!value) toggleAutosave();
    var autoEl = document.getElementById('setAutosave');
    if (autoEl) autoEl.checked = autosaveEnabled;
  } else if (key === 'theme') {
    if ((value === 'light') !== (currentTheme === 'light')) toggleTheme();
  } else if (key === 'language') {
    if ((value === 'fa') !== (currentLang === 'fa')) toggleLanguage();
  }
  refreshAllDisplays();
  markChanged();
}

function refreshAllDisplays() {
  if (!market) return;
  updatePlaygroundStats();
  updateTraderSelect();
  updateLpSelect();
  updateParticipantsList();
  updateGlobalTradersList();
  refreshPreviews();
  updatePortfolioTab();
  updateDiscreteTradePreview();
  updateDistTradePreview();
}

// ============================================================
// 22. FEE CONFIGURATION MODAL
// ============================================================
function openFeeModal() {
  var modal = document.getElementById('feeModal');
  if (modal) modal.classList.add('open');
}

function closeFeeModal() {
  var modal = document.getElementById('feeModal');
  if (modal) modal.classList.remove('open');
}

function updateFeeDisplay() {
  var el = document.getElementById('feeDisplayInfo');
  if (!el || !market) { if (el) el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '<span style="font-size:0.75rem;color:var(--text-muted);">'
    + langText('Fees', '\u06A9\u0627\u0631\u0645\u0632\u062F') + ': '
    + langText('Trade', '\u0645\u0639\u0627\u0645\u0644\u0647') + ' ' + (market.tradeFeeBps / 100).toFixed(1) + '% | '
    + langText('LP Share', '\u0633\u0647\u0645 LP') + ' ' + market.lpFeeSharePct + '% | '
    + langText('Redemption', '\u0628\u0627\u0632\u062E\u0631\u06CC\u062F') + ' ' + (market.redemptionFeeBps / 100).toFixed(1) + '%'
    + ' | ' + langText('Kernel W', '\u0647\u0633\u062A\u0647 W') + ' ' + market.kernelWidth
    + '</span>';
}

// ============================================================
// 23. PORTFOLIO TAB
// ============================================================
function updatePortfolioTab() {
  var container = document.getElementById('portfolioTabContent');
  if (!container) return;
  if (!market) { container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">' + langText('Create a market and make trades to see portfolio data.', '\u06CC\u06A9 \u0628\u0627\u0632\u0627\u0631 \u0628\u0633\u0627\u0632\u06CC\u062F \u0648 \u0645\u0639\u0627\u0645\u0644\u0647 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u062F\u0627\u062F\u0647\u200C\u0647\u0627\u06CC \u0633\u0628\u062F \u0631\u0627 \u0628\u0628\u06CC\u0646\u06CC\u062F.') + '</p>'; return; }

  var html = '';

  // === Trader Portfolio ===
  var trader = getActiveTrader();
  if (trader && globalTraders[trader]) {
    var p = market.getTraderPortfolio(trader);
    var th = market.traderHoldings[trader];

    html += '<div class="portfolio-block">';
    html += '<div class="portfolio-heading">' + langText('Trader: ', '\u0645\u0639\u0627\u0645\u0644\u0647\u200C\u06AF\u0631: ') + '<strong>' + trader + '</strong></div>';

    // Summary cards
    html += '<div class="result-grid result-grid-sm">';
    html += resultItemSm(langText('Wallet', '\u06A9\u06CC\u0641 \u067E\u0648\u0644'), '$' + formatCompact(p.wallet));
    html += resultItemSm(langText('Invested', '\u0633\u0631\u0645\u0627\u06CC\u0647'), '$' + formatCompact(p.totalSpent));
    html += resultItemSm(langText('Received', '\u062F\u0631\u06CC\u0627\u0641\u062A\u06CC'), '$' + formatCompact(p.totalReceived));
    html += resultItemSm(langText('Expected', '\u0645\u0648\u0631\u062F \u0627\u0646\u062A\u0638\u0627\u0631'), '$' + formatCompact(p.expectedPayout));
    html += resultItemSm(langText('Peak Payout', '\u062D\u062F\u0627\u06A9\u062B\u0631'), '$' + formatCompact(p.peakPayout), 'positive');
    var pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
    var pnlClass = p.unrealizedPnL >= 0 ? 'positive' : 'negative';
    html += resultItemSm(langText('Net P&L', '\u0633\u0648\u062F/\u0632\u06CC\u0627\u0646'), pnlSign + formatCompact(p.unrealizedPnL) + ' (' + pnlSign + p.pnlPct.toFixed(1) + '%)', pnlClass);
    html += '</div>';

    // Holdings table
    var hasHoldings = false;
    if (th) {
      for (var j = 0; j < market.N; j++) { if (th.holdings[j] > 0.01) { hasHoldings = true; break; } }
    }
    if (hasHoldings) {
      var probs = market.getProbabilities();
      var labels = market.getLabels();
      html += '<div class="portfolio-sub">';
      html += '<div class="portfolio-subheading">' + langText('Holdings', '\u062F\u0627\u0631\u0627\u06CC\u06CC\u200C\u0647\u0627') + '</div>';
      html += '<div class="ptable-wrap"><table class="ptable">';
      html += '<thead><tr>';
      html += '<th>' + langText('Bin', '\u0628\u0627\u0632\u0647') + '</th>';
      html += '<th>' + langText('Range', '\u0645\u062D\u062F\u0648\u062F\u0647') + '</th>';
      html += '<th>' + langText('Tokens', '\u062A\u0648\u06A9\u0646') + '</th>';
      html += '<th>' + langText('Prob', '\u0627\u062D\u062A\u0645\u0627\u0644') + '</th>';
      html += '<th>' + langText('Exp. Value', '\u0627\u0631\u0632\u0634 \u0645\u0648\u0631\u062F \u0627\u0646\u062A\u0638\u0627\u0631') + '</th>';
      html += '</tr></thead><tbody>';
      for (var j = 0; j < market.N; j++) {
        if (th.holdings[j] < 0.01) continue;
        var ev = probs[j] * th.holdings[j] * (1 - market.redemptionFeeBps / 10000);
        html += '<tr><td>' + j + '</td><td class="td-mono">' + labels[j] + '</td><td>' + formatCompact(th.holdings[j]) + '</td><td>' + (probs[j] * 100).toFixed(2) + '%</td><td>' + formatCompact(ev) + '</td></tr>';
      }
      html += '</tbody></table></div></div>';
    }

    // Trade history for this trader
    var history = (markets[currentMarketIdx] && markets[currentMarketIdx].tradeHistory) || [];
    var traderTrades = history.filter(function(h) { return h.trader === trader; });
    if (traderTrades.length > 0) {
      html += '<div class="portfolio-sub">';
      html += '<div class="portfolio-subheading">' + langText('Trade History', '\u062A\u0627\u0631\u06CC\u062E\u0686\u0647 \u0645\u0639\u0627\u0645\u0644\u0627\u062A') + '</div>';
      html += '<div class="ptable-wrap"><table class="ptable">';
      html += '<thead><tr>';
      html += '<th>#</th>';
      html += '<th>' + langText('Type', '\u0646\u0648\u0639') + '</th>';
      html += '<th>' + langText('Detail', '\u062C\u0632\u0626\u06CC\u0627\u062A') + '</th>';
      html += '<th>' + langText('Amount', '\u0645\u0642\u062F\u0627\u0631') + '</th>';
      html += '<th>' + langText('Result', '\u0646\u062A\u06CC\u062C\u0647') + '</th>';
      html += '<th>' + langText('Time', '\u0632\u0645\u0627\u0646') + '</th>';
      html += '</tr></thead><tbody>';
      for (var i = traderTrades.length - 1; i >= 0; i--) {
        var h = traderTrades[i];
        var badgeClass = (h.type === 'buy' || h.type === 'dist-buy') ? 'badge-buy' : (h.type === 'sell' || h.type === 'dist-sell') ? 'badge-sell' : 'badge-lp';
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td><span class="trade-badge ' + badgeClass + '">' + h.type + '</span></td>';
        html += '<td>' + (h.detail || '-') + '</td>';
        html += '<td>' + formatCompact(h.amount || 0) + '</td>';
        html += '<td>' + (h.result || '-') + '</td>';
        html += '<td class="td-mono td-time">' + (h.time || '') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table></div></div>';
    }
    html += '</div>';
  } else {
    html += '<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:12px;">' + langText('Select a trader in the toolbar above to see their portfolio.', '\u06CC\u06A9 \u0645\u0639\u0627\u0645\u0644\u0647\u200C\u06AF\u0631 \u0627\u0632 \u0646\u0648\u0627\u0631 \u0627\u0628\u0632\u0627\u0631 \u0628\u0627\u0644\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F.') + '</p>';
  }

  // === Market Overview ===
  html += '<div class="portfolio-block">';
  html += '<div class="portfolio-heading">' + langText('Market Overview', '\u0646\u0645\u0627\u06CC \u06A9\u0644\u06CC \u0628\u0627\u0632\u0627\u0631') + '</div>';

  html += '<div class="result-grid result-grid-sm">';
  html += resultItemSm('k ' + langText('(Minted)', '(\u0636\u0631\u0628\u200C\u0634\u062F\u0647)'), formatCompact(market.k));
  html += resultItemSm(langText('Bins', '\u0628\u0627\u0632\u0647\u200C\u0647\u0627'), market.N.toString());
  html += resultItemSm(langText('Range', '\u0645\u062D\u062F\u0648\u062F\u0647'), formatCompact(market.rangeMin) + ' - ' + formatCompact(market.rangeMax));
  html += resultItemSm(langText('LP Fees', '\u06A9\u0627\u0631\u0645\u0632\u062F LP'), formatCompact(market.accumulatedLpFees));
  html += resultItemSm(langText('LP Shares', '\u0633\u0647\u0627\u0645 LP'), formatCompact(market.totalLpShares));
  var sumSq = 0;
  for (var i = 0; i < market.N; i++) sumSq += market.positions[i] * market.positions[i];
  var drift = Math.abs(sumSq - market.k * market.k);
  html += resultItemSm(langText('Invariant', '\u0646\u0627\u0648\u0631\u062F\u0627'), drift < 1 ? 'OK' : drift.toFixed(0), drift < 1 ? 'positive' : 'neutral');
  html += '</div>';

  // Fee info
  html += '<div class="result-grid result-grid-sm">';
  html += resultItemSm(langText('Trade Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F \u0645\u0639\u0627\u0645\u0644\u0647'), (market.tradeFeeBps / 100).toFixed(1) + '%');
  html += resultItemSm(langText('LP Fee Share', '\u0633\u0647\u0645 LP'), market.lpFeeSharePct + '%');
  html += resultItemSm(langText('Redemption Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F \u0628\u0627\u0632\u062E\u0631\u06CC\u062F'), (market.redemptionFeeBps / 100).toFixed(1) + '%');
  html += '</div>';

  // Collateral flow (per-market)
  var totalIn = 0, totalOut = 0;
  for (var name in market.traderHoldings) {
    var th = market.traderHoldings[name];
    totalIn += th.spent || 0;
    totalOut += th.received || 0;
  }
  html += '<div class="result-grid result-grid-sm">';
  html += resultItemSm(langText('Collateral In', '\u0648\u0631\u0648\u062F\u06CC'), '$' + formatCompact(totalIn));
  html += resultItemSm(langText('Collateral Out', '\u062E\u0631\u0648\u062C\u06CC'), '$' + formatCompact(totalOut));
  html += resultItemSm(langText('Net Flow', '\u062C\u0631\u06CC\u0627\u0646 \u062E\u0627\u0644\u0635'), '$' + formatCompact(totalIn - totalOut), (totalIn - totalOut) >= 0 ? 'positive' : 'negative');
  html += '</div>';

  // Top bins
  var probs = market.getProbabilities();
  var labels = market.getLabels();
  var sorted = probs.map(function(p, i) { return { idx: i, prob: p }; }).sort(function(a, b) { return b.prob - a.prob; });
  var topN = Math.min(5, sorted.length);
  html += '<div class="portfolio-sub">';
  html += '<div class="portfolio-subheading">' + langText('Top Bins by Probability', '\u0628\u0627\u0632\u0647\u200C\u0647\u0627\u06CC \u0628\u0631\u062A\u0631') + '</div>';
  html += '<div class="ptable-wrap"><table class="ptable">';
  html += '<thead><tr><th>' + langText('Bin', '\u0628\u0627\u0632\u0647') + '</th><th>' + langText('Range', '\u0645\u062D\u062F\u0648\u062F\u0647') + '</th><th>' + langText('Prob', '\u0627\u062D\u062A\u0645\u0627\u0644') + '</th><th>' + langText('Reserve (x)', '\u0630\u062E\u06CC\u0631\u0647 (x)') + '</th></tr></thead><tbody>';
  for (var i = 0; i < topN; i++) {
    var s = sorted[i];
    html += '<tr><td>' + s.idx + '</td><td class="td-mono">' + labels[s.idx] + '</td><td>' + (s.prob * 100).toFixed(2) + '%</td><td>' + formatCompact(market.positions[s.idx]) + '</td></tr>';
  }
  html += '</tbody></table></div></div>';

  // Participants
  var traderNames = Object.keys(globalTraders);
  var lpNames = Object.keys(market.lpProviders);
  html += '<div class="portfolio-sub">';
  html += '<div class="portfolio-subheading">' + langText('Participants', '\u0634\u0631\u06A9\u062A\u200C\u06A9\u0646\u0646\u062F\u06AF\u0627\u0646') + '</div>';
  html += '<div style="font-size:0.8rem;color:var(--text-muted);">';
  html += langText('Traders', '\u0645\u0639\u0627\u0645\u0644\u0647\u200C\u06AF\u0631\u0627\u0646') + ': ' + (traderNames.length > 0 ? traderNames.join(', ') : '-') + '<br>';
  html += langText('LPs', '\u062A\u0623\u0645\u06CC\u0646\u200C\u06A9\u0646\u0646\u062F\u06AF\u0627\u0646') + ': ' + (lpNames.length > 0 ? lpNames.join(', ') : '-');
  html += '</div></div>';

  html += '</div>';
  container.innerHTML = html;
}

// ============================================================
// 24. INTERACTIVE TRADE PREVIEW
// ============================================================
var discretePreviewMode = 'buy'; // 'buy' or 'sell'
var distPreviewMode = 'buy';     // 'buy' or 'sell'

function toggleDiscretePreviewMode() {
  discretePreviewMode = (discretePreviewMode === 'buy') ? 'sell' : 'buy';
  var btn = document.getElementById('discretePreviewToggle');
  if (btn) {
    btn.textContent = discretePreviewMode === 'buy' ? 'Buy ▸ Sell' : 'Sell ▸ Buy';
    btn.className = 'btn btn-xs ' + (discretePreviewMode === 'buy' ? 'btn-outline' : 'btn-danger-outline');
  }
  updateDiscreteTradePreview();
}

function toggleDistPreviewMode() {
  distPreviewMode = (distPreviewMode === 'buy') ? 'sell' : 'buy';
  var btn = document.getElementById('distPreviewToggle');
  if (btn) {
    btn.textContent = distPreviewMode === 'buy' ? 'Buy ▸ Sell' : 'Sell ▸ Buy';
    btn.className = 'btn btn-xs ' + (distPreviewMode === 'buy' ? 'btn-outline' : 'btn-danger-outline');
  }
  updateDistTradePreview();
}

function updateDiscreteTradePreview() {
  var el = document.getElementById('discreteTradePreview');
  if (!el || !market || market.resolved) { if (el) el.style.display = 'none'; return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { el.style.display = 'none'; return; }
  var bin = parseInt(document.getElementById('pgDiscreteBin').value) || 0;
  var amount = parseFloat(document.getElementById('pgDiscreteAmount').value) || 0;
  if (amount <= 0 || bin < 0 || bin >= market.N) { el.style.display = 'none'; return; }

  var html, fee, tokensOut, collateralOut, newProb;

  if (discretePreviewMode === 'buy') {
    // Buy preview: amount = collateral to spend
    if (globalTraders[trader].wallet < amount) { el.style.display = 'none'; return; }
    fee = Math.floor(amount * market.tradeFeeBps / 10000);
    var net = amount - fee;
    var kNew = market.k + net;
    var sumOtherSq = 0;
    for (var j = 0; j < market.N; j++) {
      if (j !== bin) sumOtherSq += market.positions[j] * market.positions[j];
    }
    var disc = kNew * kNew - sumOtherSq;
    if (disc < 0) { el.style.display = 'none'; return; }
    var newXi = Math.sqrt(disc);
    tokensOut = newXi - market.positions[bin];
    var peakPayout = tokensOut * (1 - market.redemptionFeeBps / 10000);
    var maxProfit = peakPayout - amount;
    // Linear probability: x_i / sum(x_j) after trade
    var sumPosPreview = 0;
    for (var j = 0; j < market.N; j++) sumPosPreview += (j === bin ? newXi : market.positions[j]);
    newProb = sumPosPreview > 0 ? newXi / sumPosPreview : 1 / market.N;

    var profitPct = amount > 0 ? (maxProfit / amount * 100).toFixed(1) + '%' : '-';
    html = '<div class="preview-header">' + langText('Buy Preview', '\u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u062E\u0631\u06CC\u062F') + '</div>';
    html += '<div class="preview-grid">';
    html += previewCell(langText('Tokens', '\u062A\u0648\u06A9\u0646'), formatCompact(tokensOut));
    html += previewCell(langText('Peak Payout', '\u062D\u062F\u0627\u06A9\u062B\u0631'), formatCompact(peakPayout));
    html += previewCell(langText('Max Profit', '\u062D\u062F\u0627\u06A9\u062B\u0631 \u0633\u0648\u062F'), (maxProfit >= 0 ? '+' : '') + formatCompact(maxProfit) + ' (' + profitPct + ')', maxProfit >= 0 ? 'positive' : 'negative');
    html += previewCell(langText('New Prob', '\u0627\u062D\u062A\u0645\u0627\u0644 \u062C\u062F\u06CC\u062F'), (newProb * 100).toFixed(2) + '%');
    html += previewCell(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(fee));
    html += '</div>';
  } else {
    // Sell preview: amount = tokens to sell
    var th = market.traderHoldings[trader];
    if (!th || th.holdings[bin] < amount - 0.01) { el.style.display = 'none'; return; }
    var newXiS = market.positions[bin] - amount;
    if (newXiS < 0) { el.style.display = 'none'; return; }
    var sumSq = 0;
    for (var j = 0; j < market.N; j++) {
      var xj = (j === bin) ? newXiS : market.positions[j];
      sumSq += xj * xj;
    }
    var kNewS = Math.sqrt(sumSq);
    var grossOut = market.k - kNewS;
    fee = Math.floor(grossOut * market.tradeFeeBps / 10000);
    collateralOut = grossOut - fee;
    // Linear probability: x_i / sum(x_j) after trade
    var sumPosSell = 0;
    for (var j = 0; j < market.N; j++) sumPosSell += (j === bin ? newXiS : market.positions[j]);
    newProb = sumPosSell > 0 ? newXiS / sumPosSell : 0;

    html = '<div class="preview-header">' + langText('Sell Preview', '\u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u0641\u0631\u0648\u0634') + '</div>';
    html += '<div class="preview-grid">';
    html += previewCell(langText('Received', '\u062F\u0631\u06CC\u0627\u0641\u062A\u06CC'), '$' + formatCompact(collateralOut), 'positive');
    html += previewCell(langText('Tokens Sold', '\u062A\u0648\u06A9\u0646 \u0641\u0631\u0648\u062E\u062A\u0647'), formatCompact(amount));
    html += previewCell(langText('New Prob', '\u0627\u062D\u062A\u0645\u0627\u0644 \u062C\u062F\u06CC\u062F'), (newProb * 100).toFixed(2) + '%');
    html += previewCell(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(fee));
    html += '</div>';
  }

  el.style.display = '';
  el.className = 'trade-result trade-preview-mode';
  html += previewTraderBar(trader);
  el.innerHTML = html;
}

function updateDistTradePreview() {
  var el = document.getElementById('distTradePreview');
  if (!el || !market || market.resolved) { if (el) el.style.display = 'none'; return; }
  var trader = getActiveTrader();
  if (!trader || !globalTraders[trader]) { el.style.display = 'none'; return; }
  var mu = parseFloat(document.getElementById('pgDistMu').value) || 0;
  var sigma = parseFloat(document.getElementById('pgDistSigma').value) || 1;
  var amount = parseFloat(document.getElementById('pgDistAmount').value) || 0;
  if (amount <= 0) { el.style.display = 'none'; return; }

  var html, fee;

  if (distPreviewMode === 'buy') {
    // Buy preview: amount = collateral
    if (globalTraders[trader].wallet < amount) { el.style.display = 'none'; return; }
    fee = Math.floor(amount * market.tradeFeeBps / 10000);
    var net = amount - fee;
    var W = market._computeWeights(mu, sigma);
    if (!W) { el.style.display = 'none'; return; }

    var XW = 0, W2 = 0;
    for (var j = 0; j < market.N; j++) { XW += market.positions[j] * W[j]; W2 += W[j] * W[j]; }
    var kNew = market.k + net;
    var excess = kNew * kNew - market.k * market.k;
    var discrim = XW * XW + W2 * excess;
    if (discrim < 0) { el.style.display = 'none'; return; }
    var lambda = Math.sqrt(discrim) - XW;

    var tokensPerBinP = [];
    var totalTokens = 0;
    for (var j = 0; j < market.N; j++) {
      var t = (lambda * W[j]) / W2;
      tokensPerBinP.push(t);
      totalTokens += t;
    }
    // Kernel-aware peak payout: find the winning bin that maximizes payout
    var peakPayout = 0, peakBin = 0;
    for (var w = 0; w < market.N; w++) {
      var wKernel = market.getSettlementKernel(w);
      var payoutW = 0;
      for (var jj = 0; jj < market.N; jj++) payoutW += tokensPerBinP[jj] * wKernel[jj];
      if (payoutW > peakPayout) { peakPayout = payoutW; peakBin = w; }
    }
    peakPayout *= (1 - market.redemptionFeeBps / 10000);
    var maxProfit = peakPayout - amount;

    var profitPct = amount > 0 ? (maxProfit / amount * 100).toFixed(1) + '%' : '-';
    html = '<div class="preview-header">' + langText('Buy Preview', '\u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u062E\u0631\u06CC\u062F') + '</div>';
    html += '<div class="preview-grid">';
    html += previewCell(langText('Tokens', '\u06A9\u0644 \u062A\u0648\u06A9\u0646'), formatCompact(totalTokens));
    html += previewCell(langText('Peak Payout', '\u062D\u062F\u0627\u06A9\u062B\u0631') + ' (bin ' + peakBin + ')', formatCompact(peakPayout));
    html += previewCell(langText('Max Profit', '\u062D\u062F\u0627\u06A9\u062B\u0631 \u0633\u0648\u062F'), (maxProfit >= 0 ? '+' : '') + formatCompact(maxProfit) + ' (' + profitPct + ')', maxProfit >= 0 ? 'positive' : 'negative');
    html += previewCell(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(fee));
    html += '</div>';
  } else {
    // Sell preview: amount = total tokens to sell (distributed by weights)
    var th = market.traderHoldings[trader];
    if (!th) { el.style.display = 'none'; return; }
    var W = market._computeWeights(mu, sigma);
    if (!W) { el.style.display = 'none'; return; }

    var tokensPerBin = [];
    var totalSold = 0;
    for (var j = 0; j < market.N; j++) {
      var t = amount * W[j] / SCALE_WEIGHT;
      t = Math.min(t, th.holdings[j]);
      t = Math.min(t, market.positions[j]);
      tokensPerBin.push(t);
      totalSold += t;
    }
    if (totalSold < 0.01) { el.style.display = 'none'; return; }

    var sumSq = 0;
    for (var j = 0; j < market.N; j++) {
      var xj = market.positions[j] - tokensPerBin[j];
      sumSq += xj * xj;
    }
    var kNewS = Math.sqrt(sumSq);
    var grossOut = market.k - kNewS;
    fee = Math.floor(grossOut * market.tradeFeeBps / 10000);
    var collateralOut = grossOut - fee;

    html = '<div class="preview-header">' + langText('Sell Preview', '\u067E\u06CC\u0634\u200C\u0646\u0645\u0627\u06CC\u0634 \u0641\u0631\u0648\u0634') + '</div>';
    html += '<div class="preview-grid">';
    html += previewCell(langText('Received', '\u062F\u0631\u06CC\u0627\u0641\u062A\u06CC'), '$' + formatCompact(collateralOut), 'positive');
    html += previewCell(langText('Tokens Sold', '\u062A\u0648\u06A9\u0646 \u0641\u0631\u0648\u062E\u062A\u0647'), formatCompact(totalSold));
    html += previewCell(langText('Fee', '\u06A9\u0627\u0631\u0645\u0632\u062F'), formatCompact(fee));
    html += '</div>';
  }

  el.style.display = '';
  el.className = 'trade-result trade-preview-mode';
  html += previewTraderBar(trader);
  el.innerHTML = html;
}

// Shared trader bar for previews — always shows current trader state
function previewTraderBar(traderName) {
  if (!traderName || !market || !globalTraders[traderName]) return '';
  var p = market.getTraderPortfolio(traderName);
  if (!p || p.totalSpent <= 0) return '';
  var pnlSign = p.unrealizedPnL >= 0 ? '+' : '';
  return '<div class="preview-trader-bar">' + traderName + ': $' + formatCompact(p.wallet) + ' ' + langText('wallet', '\u06A9\u06CC\u0641 \u067E\u0648\u0644') +
    ' &middot; P&L: ' + pnlSign + formatCompact(p.unrealizedPnL) + ' (' + pnlSign + p.pnlPct.toFixed(1) + '%)</div>';
}

// ============================================================
// 25. INITIALIZATION
// ============================================================
window.addEventListener('DOMContentLoaded', function() {
  // TOC observers
  var tocLinks = document.querySelectorAll('.toc-link');
  var allSections = document.querySelectorAll('.section, .demo-card[id], .expandable-demo[id]');
  var tocObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        tocLinks.forEach(function(l) { l.classList.remove('active'); });
        var link = document.querySelector('.toc-link[href="#' + entry.target.id + '"]');
        if (link) link.classList.add('active');
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  allSections.forEach(function(s) { tocObserver.observe(s); });

  // Fade-in observer
  var fadeObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.1 });
  document.querySelectorAll('.section').forEach(function(s) { fadeObserver.observe(s); });

  // Try to load saved state
  var loaded = loadState();
  if (loaded && markets.length > 0) {
    updateMarketSelector();
    updateGlobalTradersList();
    if (market) {
      document.getElementById('pgResults').style.display = '';
      document.getElementById('pgChartContainer').style.display = '';
      document.getElementById('pgToolbar').style.display = '';
      updateTraderSelect();
      updateLpSelect();
      updateParticipantsList();
      initTradePreviewControls();
      updatePlaygroundStats();
      updateResolveButton();
      updatePortfolioTab();
      updateFeeDisplay();
      setTimeout(function() { updatePlaygroundChart(); }, 100);
      // Restore resolve payouts if market was resolved
      if (market.resolved && market.lastResolvePayouts) {
        renderResolvePayouts({ winningBin: market.winningBin, payouts: market.lastResolvePayouts });
        if (market.lastResolveValue !== null) {
          document.getElementById('pgResolveValue').value = market.lastResolveValue;
        }
      }
    }
    showToast(currentLang === 'fa' ? '\u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0634\u062F' : 'State restored (' + markets.length + ' market' + (markets.length > 1 ? 's' : '') + ')', 'init');
  } else {
    updateMarketSelector();
    updateGlobalTradersList();
  }

  // Init demos
  setTimeout(function() {
    initDistortionChart();
    updateDistortion();
    updateLP();
  }, 500);
});
