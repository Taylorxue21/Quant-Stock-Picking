/* ============================================
   Deep Financial Analysis Dashboard
   Frontend Application Logic
   ============================================ */

// Global state
let currentCompany = 'AAPL';
let currentChartType = 'line';
let chartInstances = {};
let companyData = null;

// Lightweight Charts instances
let klineChart = null;
let klineVolumeChart = null;
let klineCandlestickSeries = null;
let klineVolumeSeries = null;

// Color palette for charts
const COLORS = {
  revenue: '#3b82f6',
  netIncome: '#22c55e',
  grossProfit: '#f59e0b',
  operatingIncome: '#8b5cf6',
  debtRatio: '#ef4444',
  equityRatio: '#06b6d4',
  freeCashFlow: '#22c55e',
  operatingCashFlow: '#3b82f6',
  grossMargin: '#f59e0b',
  roe: '#8b5cf6',
  gridLines: 'rgba(42, 48, 64, 0.5)',
  textColor: '#9aa0b0'
};

// ============================================
// DATA LOADING
// ============================================

async function loadCompanyData(ticker) {
  try {
    const cleanTicker = ticker.trim().toUpperCase();
    const response = await fetch(`/api/stocks/${cleanTicker}`);
    if (response.status === 404) {
      console.warn('[前端] 股票代码未找到 (404):', cleanTicker);
      return null;
    }
    if (!response.ok) throw new Error('Failed to load data');
    companyData = await response.json();
    return companyData;
  } catch (error) {
    console.error('Error loading company data:', error);
    return null;
  }
}

async function loadStockData(ticker) {
  try {
    const cleanTicker = ticker.trim().toUpperCase();
    const response = await fetch(`/api/stocks/${cleanTicker}`);
    if (response.status === 404) {
      console.warn('[前端] 股票代码未找到 (404):', cleanTicker);
      return null;
    }
    if (!response.ok) throw new Error('Failed to load stock data');
    return await response.json();
  } catch (error) {
    console.error('Error loading stock data:', error);
    return null;
  }
}

// ============================================
// K-LINE CHART (Lightweight Charts)
// ============================================

function initKLineChart() {
  const chartContainer = document.getElementById('klineChart');
  const volumeContainer = document.getElementById('klineVolumeChart');

  // Destroy existing charts
  if (klineChart) {
    klineChart.remove();
    klineChart = null;
  }
  if (klineVolumeChart) {
    klineVolumeChart.remove();
    klineVolumeChart = null;
  }

  // Main candlestick chart
  klineChart = LightweightCharts.createChart(chartContainer, {
    layout: {
      background: { type: 'solid', color: '#1a1f2e' },
      textColor: '#9aa0b0',
      fontSize: 11,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(42, 48, 64, 0.5)' },
      horzLines: { color: 'rgba(42, 48, 64, 0.5)' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {
        color: '#3b82f6',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#3b82f6'
      },
      horzLine: {
        color: '#3b82f6',
        width: 1,
        style: LightweightCharts.LineStyle.Dashed,
        labelBackgroundColor: '#3b82f6'
      }
    },
    rightPriceScale: {
      borderColor: '#2a3040',
      scaleMargins: { top: 0.05, bottom: 0.05 }
    },
    timeScale: {
      borderColor: '#2a3040',
      timeVisible: true,
      secondsVisible: false,
      fixLeftEdge: true,
      fixRightEdge: true
    },
    handleScroll: { vertTouchDrag: false },
    handleScale: { axisPressedMouseMove: true }
  });

  // Candlestick series
  klineCandlestickSeries = klineChart.addCandlestickSeries({
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    wickUpColor: '#22c55e',
    priceFormat: {
      type: 'price',
      precision: 2,
      minMove: 0.01
    }
  });

  // Volume chart (separate pane below)
  klineVolumeChart = LightweightCharts.createChart(volumeContainer, {
    layout: {
      background: { type: 'solid', color: '#1a1f2e' },
      textColor: '#9aa0b0',
      fontSize: 10,
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
    },
    grid: {
      vertLines: { color: 'rgba(42, 48, 64, 0.3)' },
      horzLines: { color: 'rgba(42, 48, 64, 0.3)' }
    },
    rightPriceScale: {
      borderColor: '#2a3040',
      scaleMargins: { top: 0.05, bottom: 0.05 },
      visible: false
    },
    timeScale: {
      borderColor: '#2a3040',
      timeVisible: true,
      secondsVisible: false,
      visible: false
    },
    handleScroll: false,
    handleScale: false
  });

  // Volume series
  klineVolumeSeries = klineVolumeChart.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: ''
  });

  // Sync time scales
  klineChart.timeScale().subscribeVisibleTimeRangeChange(function() {
    const range = klineChart.timeScale().getVisibleRange();
    if (range) {
      klineVolumeChart.timeScale().setVisibleRange(range);
    }
  });
}

function updateKLineChart(stockData) {
  if (!stockData || !stockData.stockPrices || stockData.stockPrices.length === 0) return;

  const prices = stockData.stockPrices;

  // Update info bar
  document.getElementById('klineTicker').textContent = stockData.ticker;
  document.getElementById('klineCompany').textContent = stockData.companyName;
  document.getElementById('klineSector').textContent = stockData.sector;

  const latest = prices[prices.length - 1];
  document.getElementById('klineOpen').textContent = '$' + latest.open.toFixed(2);
  document.getElementById('klineHigh').textContent = '$' + latest.high.toFixed(2);
  document.getElementById('klineLow').textContent = '$' + latest.low.toFixed(2);
  document.getElementById('klineClose').textContent = '$' + latest.close.toFixed(2);
  document.getElementById('klineVolume').textContent = formatVolume(latest.volume);

  // Set candlestick data
  klineCandlestickSeries.setData(prices);

  // Set volume data (color based on price movement)
  const volumeData = prices.map((p, i) => {
    const prevClose = i > 0 ? prices[i - 1].close : p.close;
    return {
      time: p.time,
      value: p.volume,
      color: p.close >= prevClose ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)'
    };
  });
  klineVolumeSeries.setData(volumeData);

  // Fit content
  klineChart.timeScale().fitContent();
}

function formatVolume(vol) {
  if (vol >= 1000000000) return (vol / 1000000000).toFixed(2) + 'B';
  if (vol >= 1000000) return (vol / 1000000).toFixed(2) + 'M';
  if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
  return vol.toString();
}

async function queryKLineChart() {
  const input = document.getElementById('klineTickerInput');
  const ticker = input.value.trim().toUpperCase();
  if (!ticker) return;

  input.value = ticker;
  document.getElementById('klineQueryBtn').textContent = '加载中...';
  document.getElementById('klineQueryBtn').disabled = true;

  try {
    const stockData = await loadStockData(ticker);
    if (stockData) {
      updateKLineChart(stockData);
    }
  } catch (err) {
    console.error('K-line query error:', err);
  } finally {
    document.getElementById('klineQueryBtn').textContent = '查询';
    document.getElementById('klineQueryBtn').disabled = false;
  }
}

// ============================================
// METRICS CARDS
// ============================================

function updateMetricsCards(data) {
  const ratios = data.ratios;
  const latestIdx = ratios.peRatio.length - 1;
  
  // P/E Ratio
  const peValue = ratios.peRatio[latestIdx];
  document.getElementById('peRatioValue').textContent = peValue.toFixed(2);
  
  // ROE
  const roeValue = ratios.roe[latestIdx] * 100;
  document.getElementById('roeValue').textContent = roeValue.toFixed(2) + '%';
  
  // Gross Margin
  const gmValue = ratios.grossMargin[latestIdx] * 100;
  document.getElementById('grossMarginValue').textContent = gmValue.toFixed(2) + '%';
  
  // Debt to Equity
  const deValue = ratios.debtToEquity[latestIdx];
  document.getElementById('debtEquityValue').textContent = deValue.toFixed(2);
}

// ============================================
// CHARTS
// ============================================

function getChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: COLORS.textColor,
          font: { size: 11, family: '-apple-system, sans-serif' },
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle'
        }
      },
      tooltip: {
        backgroundColor: '#1a1f2e',
        titleColor: '#e8eaed',
        bodyColor: '#9aa0b0',
        borderColor: '#2a3040',
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
        titleFont: { size: 13, weight: '600' },
        bodyFont: { size: 12 }
      }
    },
    scales: {
      x: {
        grid: { color: COLORS.gridLines, drawBorder: false },
        ticks: { color: COLORS.textColor, font: { size: 11 } }
      },
      y: {
        grid: { color: COLORS.gridLines, drawBorder: false },
        ticks: { color: COLORS.textColor, font: { size: 11 } }
      }
    }
  };
}

function createRevenueProfitChart(data, type) {
  const ctx = document.getElementById('revenueProfitChart').getContext('2d');
  const years = data.financialData.incomeStatement.years;
  const revenue = data.financialData.incomeStatement.totalRevenue;
  const netIncome = data.financialData.incomeStatement.netIncome;
  
  if (chartInstances.revenueProfit) {
    chartInstances.revenueProfit.destroy();
  }
  
  chartInstances.revenueProfit = new Chart(ctx, {
    type: type,
    data: {
      labels: years,
      datasets: [
        {
          label: '营收 (Revenue)',
          data: revenue,
          borderColor: COLORS.revenue,
          backgroundColor: type === 'bar' ? 'rgba(59, 130, 246, 0.7)' : 'rgba(59, 130, 246, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        },
        {
          label: '净利润 (Net Income)',
          data: netIncome,
          borderColor: COLORS.netIncome,
          backgroundColor: type === 'bar' ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        }
      ]
    },
    options: {
      ...getChartDefaults(),
      plugins: {
        ...getChartDefaults().plugins,
        legend: { ...getChartDefaults().plugins.legend, position: 'top' }
      },
      scales: {
        ...getChartDefaults().scales,
        y: {
          ...getChartDefaults().scales.y,
          beginAtZero: false,
          ticks: {
            ...getChartDefaults().scales.y.ticks,
            callback: function(value) { return '$' + (value / 1000).toFixed(0) + 'B'; }
          }
        }
      }
    }
  });
}

function createDebtEquityChart(data, type) {
  const ctx = document.getElementById('debtEquityChart').getContext('2d');
  const years = data.financialData.incomeStatement.years;
  const debtToEquity = data.ratios.debtToEquity;
  const currentRatio = data.ratios.currentRatio;
  
  if (chartInstances.debtEquity) {
    chartInstances.debtEquity.destroy();
  }
  
  chartInstances.debtEquity = new Chart(ctx, {
    type: type,
    data: {
      labels: years,
      datasets: [
        {
          label: '资产负债率 (D/E)',
          data: debtToEquity,
          borderColor: COLORS.debtRatio,
          backgroundColor: type === 'bar' ? 'rgba(239, 68, 68, 0.7)' : 'rgba(239, 68, 68, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        },
        {
          label: '流动比率 (Current Ratio)',
          data: currentRatio,
          borderColor: COLORS.equityRatio,
          backgroundColor: type === 'bar' ? 'rgba(6, 182, 212, 0.7)' : 'rgba(6, 182, 212, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      ...getChartDefaults(),
      plugins: {
        ...getChartDefaults().plugins,
        legend: { ...getChartDefaults().plugins.legend, position: 'top' }
      },
      scales: {
        ...getChartDefaults().scales,
        y: {
          ...getChartDefaults().scales.y,
          position: 'left',
          title: {
            display: true,
            text: 'D/E Ratio',
            color: COLORS.textColor,
            font: { size: 10 }
          }
        },
        y1: {
          position: 'right',
          grid: { drawOnChartArea: false },
          title: {
            display: true,
            text: 'Current Ratio',
            color: COLORS.textColor,
            font: { size: 10 }
          },
          ticks: { color: COLORS.textColor, font: { size: 11 } }
        }
      }
    }
  });
}

function createFreeCashFlowChart(data, type) {
  const ctx = document.getElementById('freeCashFlowChart').getContext('2d');
  const years = data.financialData.cashFlow.years;
  const fcf = data.financialData.cashFlow.freeCashFlow;
  const ocf = data.financialData.cashFlow.operatingCashFlow;
  
  if (chartInstances.freeCashFlow) {
    chartInstances.freeCashFlow.destroy();
  }
  
  chartInstances.freeCashFlow = new Chart(ctx, {
    type: type,
    data: {
      labels: years,
      datasets: [
        {
          label: '经营活动现金流 (OCF)',
          data: ocf,
          borderColor: COLORS.operatingCashFlow,
          backgroundColor: type === 'bar' ? 'rgba(59, 130, 246, 0.7)' : 'rgba(59, 130, 246, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        },
        {
          label: '自由现金流 (FCF)',
          data: fcf,
          borderColor: COLORS.freeCashFlow,
          backgroundColor: type === 'bar' ? 'rgba(34, 197, 94, 0.7)' : 'rgba(34, 197, 94, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        }
      ]
    },
    options: {
      ...getChartDefaults(),
      plugins: {
        ...getChartDefaults().plugins,
        legend: { ...getChartDefaults().plugins.legend, position: 'top' }
      },
      scales: {
        ...getChartDefaults().scales,
        y: {
          ...getChartDefaults().scales.y,
          beginAtZero: false,
          ticks: {
            ...getChartDefaults().scales.y.ticks,
            callback: function(value) { return '$' + (value / 1000).toFixed(0) + 'B'; }
          }
        }
      }
    }
  });
}

function createMarginRoeChart(data, type) {
  const ctx = document.getElementById('marginRoeChart').getContext('2d');
  const years = data.financialData.incomeStatement.years;
  const grossMargin = data.ratios.grossMargin.map(v => v * 100);
  const roe = data.ratios.roe.map(v => v * 100);
  
  if (chartInstances.marginRoe) {
    chartInstances.marginRoe.destroy();
  }
  
  chartInstances.marginRoe = new Chart(ctx, {
    type: type,
    data: {
      labels: years,
      datasets: [
        {
          label: '毛利率 (Gross Margin %)',
          data: grossMargin,
          borderColor: COLORS.grossMargin,
          backgroundColor: type === 'bar' ? 'rgba(245, 158, 11, 0.7)' : 'rgba(245, 158, 11, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        },
        {
          label: 'ROE (%)',
          data: roe,
          borderColor: COLORS.roe,
          backgroundColor: type === 'bar' ? 'rgba(139, 92, 246, 0.7)' : 'rgba(139, 92, 246, 0.1)',
          fill: type === 'line',
          tension: 0.3,
          pointRadius: type === 'line' ? 4 : 0,
          pointHoverRadius: 6,
          borderWidth: 2
        }
      ]
    },
    options: {
      ...getChartDefaults(),
      plugins: {
        ...getChartDefaults().plugins,
        legend: { ...getChartDefaults().plugins.legend, position: 'top' }
      },
      scales: {
        ...getChartDefaults().scales,
        y: {
          ...getChartDefaults().scales.y,
          ticks: {
            ...getChartDefaults().scales.y.ticks,
            callback: function(value) { return value.toFixed(1) + '%'; }
          }
        }
      }
    }
  });
}

function updateAllCharts(data, type) {
  createRevenueProfitChart(data, type);
  createDebtEquityChart(data, type);
  createFreeCashFlowChart(data, type);
  createMarginRoeChart(data, type);
}

// ============================================
// CHART TYPE SWITCH
// ============================================

function switchChartType(type) {
  currentChartType = type;
  
  // Update button states
  document.querySelectorAll('.chart-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.chart === type);
  });
  
  if (companyData) {
    updateAllCharts(companyData, type);
  }
}

// ============================================
// FINANCIAL STATEMENTS TABLES
// ============================================

function formatNumber(num) {
  if (num === undefined || num === null) return '--';
  const abs = Math.abs(num);
  let formatted;
  if (abs >= 1000000) {
    formatted = (num / 1000000).toFixed(2) + 'M';
  } else if (abs >= 1000) {
    formatted = (num / 1000).toFixed(2) + 'K';
  } else {
    formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  return formatted;
}

function formatNumberFull(num) {
  if (num === undefined || num === null) return '--';
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function getColorClass(value) {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return '';
}

function buildIncomeStatement(data) {
  const is = data.financialData.incomeStatement;
  const years = is.years;
  const body = document.getElementById('incomeBody');
  
  // Update year headers
  years.forEach((year, i) => {
    document.getElementById(`incomeYear${i}`).textContent = year;
  });
  
  let html = '';
  
  // Revenue section
  html += `<tr class="section-header"><td>营收 (Revenue)</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(is.totalRevenue[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>营业成本 (Cost of Revenue)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(-is.costOfRevenue[i])}">${formatNumberFull(is.costOfRevenue[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>毛利润 (Gross Profit)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(is.grossProfit[i])}">${formatNumberFull(is.grossProfit[i])}</td>`; });
  html += `</tr>`;
  
  // Operating expenses section
  html += `<tr class="section-header"><td>营业费用 (Operating Expenses)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>研发费用 (R&D)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(-is.operatingExpenses.researchAndDevelopment[i])}">${formatNumberFull(is.operatingExpenses.researchAndDevelopment[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>销售及管理费用 (SG&A)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(-is.operatingExpenses.sellingGeneralAndAdministrative[i])}">${formatNumberFull(is.operatingExpenses.sellingGeneralAndAdministrative[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>营业利润 (Operating Income)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(is.operatingIncome[i])}">${formatNumberFull(is.operatingIncome[i])}</td>`; });
  html += `</tr>`;
  
  // Below operating income
  html += `<tr class="sub-item"><td>利息费用 (Interest Expense)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(-is.interestExpense[i])}">${formatNumberFull(is.interestExpense[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>所得税 (Income Tax)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(-is.incomeTaxExpense[i])}">${formatNumberFull(is.incomeTaxExpense[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>净利润 (Net Income)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(is.netIncome[i])}">${formatNumberFull(is.netIncome[i])}</td>`; });
  html += `</tr>`;
  
  // Per share data
  html += `<tr class="section-header"><td>每股数据 (Per Share Data)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>稀释每股收益 (EPS Diluted)</td>`;
  years.forEach((_, i) => { html += `<td>$${is.epsDiluted[i].toFixed(2)}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>加权平均股数 (Weighted Avg Shares)</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumber(is.weightedAverageShsOut[i])}</td>`; });
  html += `</tr>`;
  
  body.innerHTML = html;
}

function buildBalanceSheet(data) {
  const bs = data.financialData.balanceSheet;
  const years = bs.years;
  const body = document.getElementById('balanceBody');
  
  years.forEach((year, i) => {
    document.getElementById(`balanceYear${i}`).textContent = year;
  });
  
  let html = '';
  
  // Assets
  html += `<tr class="section-header"><td>资产 (Assets)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>现金及现金等价物</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.cashAndCashEquivalents[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>短期投资</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.shortTermInvestments[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>应收账款</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.accountsReceivable[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>存货</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.inventory[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>流动资产合计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalCurrentAssets[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>固定资产 (PP&E)</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.propertyPlantEquipment[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>商誉及无形资产</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.goodwillAndIntangibleAssets[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>长期投资</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.longTermInvestments[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>非流动资产合计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalNonCurrentAssets[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>资产总计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalAssets[i])}</td>`; });
  html += `</tr>`;
  
  // Liabilities
  html += `<tr class="section-header"><td>负债 (Liabilities)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>应付账款</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.accountsPayable[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>短期债务</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.shortTermDebt[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>递延收入</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.deferredRevenue[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>流动负债合计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalCurrentLiabilities[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>长期债务</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.longTermDebt[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>非流动负债合计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalNonCurrentLiabilities[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>负债总计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalLiabilities[i])}</td>`; });
  html += `</tr>`;
  
  // Equity
  html += `<tr class="section-header"><td>股东权益 (Equity)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>留存收益</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.retainedEarnings[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>股东权益合计</td>`;
  years.forEach((_, i) => { html += `<td>${formatNumberFull(bs.totalShareholdersEquity[i])}</td>`; });
  html += `</tr>`;
  
  body.innerHTML = html;
}

function buildCashFlowStatement(data) {
  const cf = data.financialData.cashFlow;
  const years = cf.years;
  const body = document.getElementById('cashflowBody');
  
  years.forEach((year, i) => {
    document.getElementById(`cashflowYear${i}`).textContent = year;
  });
  
  let html = '';
  
  html += `<tr class="section-header"><td>经营活动现金流 (Operating Activities)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>经营活动现金流净额</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.operatingCashFlow[i])}">${formatNumberFull(cf.operatingCashFlow[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="section-header"><td>投资活动现金流 (Investing Activities)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>资本支出 (CapEx)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.capitalExpenditure[i])}">${formatNumberFull(cf.capitalExpenditure[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>自由现金流 (Free Cash Flow)</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.freeCashFlow[i])}">${formatNumberFull(cf.freeCashFlow[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="section-header"><td>融资活动现金流 (Financing Activities)</td>`;
  years.forEach(() => { html += `<td></td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>股息支付</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.dividendsPaid[i])}">${formatNumberFull(cf.dividendsPaid[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>股票回购</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.commonStockRepurchase[i])}">${formatNumberFull(cf.commonStockRepurchase[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="sub-item"><td>债务偿还</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.debtRepayment[i])}">${formatNumberFull(cf.debtRepayment[i])}</td>`; });
  html += `</tr>`;
  
  html += `<tr class="total-row"><td>现金变动净额</td>`;
  years.forEach((_, i) => { html += `<td class="${getColorClass(cf.changeInCash[i])}">${formatNumberFull(cf.changeInCash[i])}</td>`; });
  html += `</tr>`;
  
  body.innerHTML = html;
}

// ============================================
// STATEMENT TAB SWITCHING
// ============================================

function switchStatement(type) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.statement === type);
  });
  
  document.querySelectorAll('.statement-table-wrapper').forEach(wrapper => {
    wrapper.classList.add('hidden');
  });
  
  document.getElementById(type + 'Statement').classList.remove('hidden');
}

// ============================================
// DUPONT ANALYSIS
// ============================================

function updateDuPontAnalysis(data, yearIndex) {
  const is = data.financialData.incomeStatement;
  const bs = data.financialData.balanceSheet;
  const ratios = data.ratios;
  
  const netIncome = is.netIncome[yearIndex];
  const revenue = is.totalRevenue[yearIndex];
  const totalAssets = bs.totalAssets[yearIndex];
  const equity = bs.totalShareholdersEquity[yearIndex];
  
  const profitMargin = netIncome / revenue;
  const assetTurnover = revenue / totalAssets;
  const equityMultiplier = totalAssets / equity;
  const roe = profitMargin * assetTurnover * equityMultiplier;
  
  // Update tree nodes
  document.getElementById('dupontRoe').textContent = (roe * 100).toFixed(2) + '%';
  document.getElementById('dupontProfitMargin').textContent = (profitMargin * 100).toFixed(2) + '%';
  document.getElementById('dupontAssetTurnover').textContent = assetTurnover.toFixed(4);
  document.getElementById('dupontEquityMultiplier').textContent = equityMultiplier.toFixed(4);
  
  // Update detail cards
  document.getElementById('dupontNetIncome').textContent = formatNumberFull(netIncome);
  document.getElementById('dupontRevenue').textContent = formatNumberFull(revenue);
  document.getElementById('dupontCalcMargin').textContent = (profitMargin * 100).toFixed(2) + '%';
  
  document.getElementById('dupontRevenue2').textContent = formatNumberFull(revenue);
  document.getElementById('dupontTotalAssets').textContent = formatNumberFull(totalAssets);
  document.getElementById('dupontCalcTurnover').textContent = assetTurnover.toFixed(4);
  
  document.getElementById('dupontTotalAssets2').textContent = formatNumberFull(totalAssets);
  document.getElementById('dupontEquity').textContent = formatNumberFull(equity);
  document.getElementById('dupontCalcMultiplier').textContent = equityMultiplier.toFixed(4);
}

function populateDuPontYearSelector(data) {
  const select = document.getElementById('dupontYear');
  const years = data.financialData.incomeStatement.years;
  
  select.innerHTML = '';
  years.forEach((year, i) => {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = year;
    select.appendChild(option);
  });
  
  select.addEventListener('change', function() {
    updateDuPontAnalysis(data, parseInt(this.value));
  });
  
  // Initialize with latest year
  updateDuPontAnalysis(data, years.length - 1);
}

// ============================================
// COMPANY SWITCHING
// ============================================

async function switchCompany(ticker) {
  currentCompany = ticker;
  
  const data = await loadCompanyData(ticker);
  if (!data) return;
  
  // Update all sections
  updateMetricsCards(data);
  updateAllCharts(data, currentChartType);
  buildIncomeStatement(data);
  buildBalanceSheet(data);
  buildCashFlowStatement(data);
  populateDuPontYearSelector(data);
  
  // Reset to income statement tab
  switchStatement('income');
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async function() {
  // Initialize K-line chart
  initKLineChart();
  
  // Load initial stock data for K-line
  const initialStockData = await loadStockData(currentCompany);
  if (initialStockData) {
    updateKLineChart(initialStockData);
  }
  
  // Company selector change handler
  document.getElementById('companySelect').addEventListener('change', function() {
    const ticker = this.value;
    document.getElementById('klineTickerInput').value = ticker;
    switchCompany(ticker);
    queryKLineChart();
  });
  
  // K-line Enter key support
  document.getElementById('klineTickerInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      queryKLineChart();
    }
  });
  
  // Load initial company data
  await switchCompany(currentCompany);
});
