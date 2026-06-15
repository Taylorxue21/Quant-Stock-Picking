const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Finnhub API Key — 从环境变量读取
// 请在 Render 后台设置环境变量: FINNHUB_API_KEY
// 值填入你的 Finnhub API Key
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';

app.use(cors());
app.use(express.json());

// ============================================
// 全局请求日志中间件
// ============================================
app.use((req, res, next) => {
  console.log('[Server Hit]', req.method, req.url);
  next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// Finnhub API 基础 URL
// ============================================
const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// ============================================
// 工具函数：调用 Finnhub API
// ============================================
async function finnhubGet(endpoint, params = {}) {
  const url = `${FINNHUB_BASE}${endpoint}`;
  const response = await axios.get(url, {
    params: { ...params, token: FINNHUB_API_KEY },
    timeout: 15000
  });
  return response.data;
}

// ============================================
// 获取公司基本信息
// ============================================
async function getCompanyProfile(ticker) {
  const data = await finnhubGet('/stock/profile2', { symbol: ticker });
  return {
    name: data.name || ticker,
    sector: data.finaIndustry || data.industry || 'Technology',
    marketCap: data.marketCapitalization || 0,
    ipo: data.ipo || ''
  };
}

// ============================================
// 获取 K 线数据（日线，近 2 年）
// ============================================
async function getKlineData(ticker) {
  const now = Math.floor(Date.now() / 1000);
  const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60;
  const data = await finnhubGet('/stock/candle', {
    symbol: ticker,
    resolution: 'D',
    from: twoYearsAgo,
    to: now
  });

  if (!data || data.s !== 'ok' || !data.t) {
    return [];
  }

  // 转换为前端期望的格式
  return data.t.map((timestamp, i) => ({
    time: new Date(timestamp * 1000).toISOString().split('T')[0],
    open: data.o[i],
    high: data.h[i],
    low: data.l[i],
    close: data.c[i],
    volume: data.v[i]
  })).filter(item => item.open && item.close);
}

// ============================================
// 获取财务报表（年度）
// Finnhub 免费版只提供最近 4-5 年的年度数据
// ============================================
async function getFinancials(ticker) {
  // 并行获取三大报表
  const [incomeData, balanceData, cashFlowData] = await Promise.all([
    finnhubGet('/stock/financials-reported', {
      symbol: ticker,
      statement: 'IC',  // Income Statement
      freq: 'annual'
    }).catch(() => ({ data: [] })),
    finnhubGet('/stock/financials-reported', {
      symbol: ticker,
      statement: 'BS',  // Balance Sheet
      freq: 'annual'
    }).catch(() => ({ data: [] })),
    finnhubGet('/stock/financials-reported', {
      symbol: ticker,
      statement: 'CF',  // Cash Flow
      freq: 'annual'
    }).catch(() => ({ data: [] }))
  ]);

  // 解析 Finnhub 的 financials-reported 格式
  // 返回格式: { data: [{ symbol, year, quarter, report: { ic, bs, cf } }] }
  const incomeReports = incomeData.data || [];
  const balanceReports = balanceData.data || [];
  const cashFlowReports = cashFlowData.data || [];

  // 按年份聚合
  const yearMap = {};

  // 处理利润表
  incomeReports.forEach(report => {
    const year = report.year;
    if (!yearMap[year]) yearMap[year] = {};
    const ic = report.report.ic || {};
    yearMap[year].revenue = parseFloat(ic['SalesRevenueNet']?.[0]?.value || ic['RevenueFromContractWithCustomerExcludingAssessedTax']?.[0]?.value || ic['Revenues']?.[0]?.value || 0);
    yearMap[year].netIncome = parseFloat(ic['NetIncomeLoss']?.[0]?.value || ic['ProfitLoss']?.[0]?.value || 0);
    yearMap[year].grossProfit = parseFloat(ic['GrossProfit']?.[0]?.value || 0);
    yearMap[year].operatingIncome = parseFloat(ic['OperatingIncomeLoss']?.[0]?.value || 0);
  });

  // 处理资产负债表
  balanceReports.forEach(report => {
    const year = report.year;
    if (!yearMap[year]) yearMap[year] = {};
    const bs = report.report.bs || {};
    yearMap[year].totalAssets = parseFloat(bs['Assets']?.[0]?.value || bs['AssetsCurrent']?.[0]?.value || 0);
    yearMap[year].totalLiabilities = parseFloat(bs['Liabilities']?.[0]?.value || bs['LiabilitiesCurrent']?.[0]?.value || 0);
    yearMap[year].totalEquity = parseFloat(bs['StockholdersEquity']?.[0]?.value || bs['EquityAttributableToParent']?.[0]?.value || bs['Equity']?.[0]?.value || 0);
    yearMap[year].cash = parseFloat(bs['CashAndCashEquivalentsAtCarryingValue']?.[0]?.value || bs['Cash']?.[0]?.value || 0);
    yearMap[year].longTermDebt = parseFloat(bs['LongTermDebtNoncurrent']?.[0]?.value || bs['LongTermDebt']?.[0]?.value || 0);
  });

  // 处理现金流量表
  cashFlowReports.forEach(report => {
    const year = report.year;
    if (!yearMap[year]) yearMap[year] = {};
    const cf = report.report.cf || {};
    yearMap[year].operatingCashFlow = parseFloat(cf['NetCashProvidedByOperatingActivities']?.[0]?.value || cf['OperatingCashFlow']?.[0]?.value || 0);
    yearMap[year].freeCashFlow = parseFloat(cf['FreeCashFlow']?.[0]?.value || 0);
  });

  // 排序年份（降序），取最近 6 年
  const sortedYears = Object.keys(yearMap)
    .map(y => parseInt(y))
    .sort((a, b) => b - a)
    .slice(0, 6);

  const years = [];
  const revenue = [];
  const netIncome = [];
  const totalAssets = [];
  const totalLiabilities = [];
  const totalStockholdersEquity = [];
  const cashAndCashEquivalents = [];
  const longTermDebt = [];

  sortedYears.forEach(year => {
    const d = yearMap[year] || {};
    years.push(year.toString());
    revenue.push(d.revenue || 0);
    netIncome.push(d.netIncome || 0);
    totalAssets.push(d.totalAssets || 0);
    totalLiabilities.push(d.totalLiabilities || 0);
    totalStockholdersEquity.push(d.totalEquity || 0);
    cashAndCashEquivalents.push(d.cash || 0);
    longTermDebt.push(d.longTermDebt || 0);
  });

  // 如果不足 6 年，用最后一年补齐
  while (years.length < 6) {
    const lastYear = parseInt(years[years.length - 1]);
    const newYear = lastYear - 1;
    years.push(newYear.toString());
    revenue.push(revenue[revenue.length - 1] || 0);
    netIncome.push(netIncome[netIncome.length - 1] || 0);
    totalAssets.push(totalAssets[totalAssets.length - 1] || 0);
    totalLiabilities.push(totalLiabilities[totalLiabilities.length - 1] || 0);
    totalStockholdersEquity.push(totalStockholdersEquity[totalStockholdersEquity.length - 1] || 0);
    cashAndCashEquivalents.push(cashAndCashEquivalents[cashAndCashEquivalents.length - 1] || 0);
    longTermDebt.push(longTermDebt[longTermDebt.length - 1] || 0);
  }

  return { years, revenue, netIncome, totalAssets, totalLiabilities, totalStockholdersEquity, cashAndCashEquivalents, longTermDebt };
}

// ============================================
// 获取估值指标（PE Ratio 等）
// Finnhub 免费版通过 quote + metric API
// ============================================
async function getMetrics(ticker) {
  try {
    const [quote, metric] = await Promise.all([
      finnhubGet('/quote', { symbol: ticker }),
      finnhubGet('/stock/metric', { symbol: ticker, metric: 'all' })
    ]);

    const metrics = metric.metric || {};
    const currentPrice = quote.c || 0;
    const eps = metrics.epsBasicExclExtraItems || metrics.epsInclExtraItems || 0;
    const pe = eps > 0 ? currentPrice / eps : 0;
    const roe = metrics.roeRtn || metrics.returnOnEquity || 0;
    const grossMargin = metrics.grossMargin || 0;
    const currentRatio = metrics.currentRatio || 0;
    const debtToEquity = metrics.totalDebtToEquity || metrics.longTermDebtEquity || 0;

    return {
      peRatio: pe,
      roe: roe,
      grossProfitMargin: grossMargin,
      debtToEquity: debtToEquity,
      currentRatio: currentRatio,
      currentPrice: currentPrice
    };
  } catch (err) {
    console.warn(`[API] 获取 ${ticker} 指标失败，使用默认值:`, err.message);
    return {
      peRatio: 0,
      roe: 0,
      grossProfitMargin: 0,
      debtToEquity: 0,
      currentRatio: 0,
      currentPrice: 0
    };
  }
}

// ============================================
// API: 获取股票完整数据
// ============================================
app.get('/api/stocks/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log(`[API] 正在从 Finnhub 获取 ${ticker} 数据...`);

  if (!FINNHUB_API_KEY) {
    console.error('[API] ❌ FINNHUB_API_KEY 未设置！请在 Render 环境变量中添加');
    return res.status(500).json({
      error: '服务器未配置 API Key',
      details: '请在 Render 后台设置 FINNHUB_API_KEY 环境变量'
    });
  }

  try {
    // 并行获取所有数据
    const [profile, klineData, financialData, metrics] = await Promise.all([
      getCompanyProfile(ticker),
      getKlineData(ticker),
      getFinancials(ticker),
      getMetrics(ticker)
    ]);

    // 构建比率数组（与年份对齐）
    const numYears = financialData.years.length;
    const peRatio = Array(numYears).fill(metrics.peRatio);
    const roe = financialData.totalStockholdersEquity.map((eq, i) =>
      eq > 0 ? +(financialData.netIncome[i] / eq).toFixed(4) : 0
    );
    const grossProfitMargin = Array(numYears).fill(metrics.grossProfitMargin);
    const debtToEquity = financialData.totalStockholdersEquity.map((eq, i) =>
      eq > 0 ? +(financialData.totalLiabilities[i] / eq).toFixed(4) : 0
    );
    const currentRatio = Array(numYears).fill(metrics.currentRatio);
    const assetTurnover = financialData.totalAssets.map((ta, i) =>
      ta > 0 ? +(financialData.revenue[i] / ta).toFixed(4) : 0
    );
    const equityMultiplier = financialData.totalStockholdersEquity.map((eq, i) =>
      eq > 0 ? +(financialData.totalAssets[i] / eq).toFixed(4) : 0
    );

    // 组装返回数据 — 完全兼容前端 index.html 的期望格式
    const responseData = {
      ticker: ticker,
      companyName: profile.name,
      sector: profile.sector,
      financialData: {
        years: financialData.years,
        revenue: financialData.revenue,
        netIncome: financialData.netIncome,
        totalAssets: financialData.totalAssets,
        totalLiabilities: financialData.totalLiabilities,
        totalStockholdersEquity: financialData.totalStockholdersEquity,
        cashAndCashEquivalents: financialData.cashAndCashEquivalents,
        longTermDebt: financialData.longTermDebt,
        peRatio: peRatio,
        roe: roe,
        grossProfitMargin: grossProfitMargin,
        debtToEquity: debtToEquity,
        currentRatio: currentRatio,
        assetTurnover: assetTurnover,
        equityMultiplier: equityMultiplier
      },
      klineData: klineData
    };

    console.log(`[API] ✅ ${ticker} 成功! 公司:${profile.name}, K线:${klineData.length}条, 营收:${financialData.revenue[0]}, 净利润:${financialData.netIncome[0]}`);
    res.json(responseData);

  } catch (error) {
    const errMsg = error.message || '';
    console.error(`[API] ❌ ${ticker} 失败:`, errMsg);

    // 判断是否为 API Key 问题
    if (errMsg.includes('401') || errMsg.includes('Unauthorized') || errMsg.includes('Forbidden')) {
      return res.status(401).json({
        error: 'Finnhub API Key 无效或未设置',
        details: errMsg
      });
    }

    // 判断是否为限流
    if (errMsg.includes('429') || errMsg.includes('Too Many Requests') || errMsg.includes('rate limit')) {
      return res.status(429).json({
        error: 'Finnhub API 限流，请稍后重试',
        details: errMsg,
        retryAfter: 60
      });
    }

    // 其他错误
    res.status(500).json({
      error: '服务器内部错误，获取股票数据失败',
      details: errMsg
    });
  }
});

// ============================================
// Fallback
// ============================================
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// 启动
// ============================================
app.listen(PORT, () => {
  console.log(`\n  ========================================`);
  console.log(`  Deep Financial Analysis Dashboard`);
  console.log(`  ========================================`);
  console.log(`  服务器已启动: http://localhost:${PORT}`);
  console.log(`  数据源: Finnhub.io (通过 API Key)`);
  console.log(`  API Key 状态: ${FINNHUB_API_KEY ? '已配置' : '未配置！请在环境变量设置 FINNHUB_API_KEY'}`);
  console.log(`  ========================================\n`);
});
