const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Finnhub API Key — 从环境变量读取
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
// 工具函数：调用 Finnhub API（带详细错误日志）
// ============================================
async function finnhubGet(endpoint, params = {}) {
  const url = `${FINNHUB_BASE}${endpoint}`;
  try {
    const response = await axios.get(url, {
      params: { ...params, token: FINNHUB_API_KEY },
      timeout: 15000
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status || 'unknown';
    const data = err.response?.data || {};
    console.error(`[Finnhub ${status} 详情] ${endpoint}:`, JSON.stringify(data));
    throw err;
  }
}

// ============================================
// 获取公司基本信息（防御性）
// ============================================
async function getCompanyProfile(ticker) {
  try {
    const data = await finnhubGet('/stock/profile2', { symbol: ticker });
    return {
      name: data?.name || ticker,
      sector: data?.finaIndustry || data?.industry || 'Technology',
      marketCap: data?.marketCapitalization || 0,
      ipo: data?.ipo || ''
    };
  } catch (err) {
    console.warn(`[API] 获取 ${ticker} 公司信息失败:`, err.message);
    return { name: ticker, sector: 'Technology', marketCap: 0, ipo: '' };
  }
}

// ============================================
// 获取 K 线数据（防御性）
// ============================================
async function getKlineData(ticker) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const twoYearsAgo = now - 2 * 365 * 24 * 60 * 60;
    const data = await finnhubGet('/stock/candle', {
      symbol: ticker,
      resolution: 'D',
      from: twoYearsAgo,
      to: now
    });

    // 防御：检查数据有效性
    if (!data || data.s !== 'ok') {
      console.warn(`[API] ${ticker} K线无数据: s=${data?.s}`);
      return [];
    }

    // 防御：确保数组存在且长度一致
    const timestamps = data?.t;
    const opens = data?.o;
    const highs = data?.h;
    const lows = data?.l;
    const closes = data?.c;
    const volumes = data?.v;

    if (!Array.isArray(timestamps) || timestamps.length === 0) {
      return [];
    }

    const length = timestamps.length;
    const result = [];
    for (let i = 0; i < length; i++) {
      const open = opens?.[i];
      const close = closes?.[i];
      // 只保留有开盘价和收盘价的有效数据
      if (open != null && close != null) {
        result.push({
          time: new Date((timestamps[i] || 0) * 1000).toISOString().split('T')[0],
          open: open,
          high: highs?.[i] ?? open,
          low: lows?.[i] ?? open,
          close: close,
          volume: volumes?.[i] ?? 0
        });
      }
    }
    return result;

  } catch (err) {
    console.warn(`[API] 获取 ${ticker} K线失败:`, err.message);
    return [];
  }
}

// ============================================
// 获取财务报表（防御性）
// ============================================
async function getFinancials(ticker) {
  try {
    // 并行获取三大报表，每个失败都返回空数组
    const [incomeData, balanceData] = await Promise.all([
      finnhubGet('/stock/financials-reported', {
        symbol: ticker, statement: 'IC', freq: 'annual'
      }).catch(() => ({ data: [] })),
      finnhubGet('/stock/financials-reported', {
        symbol: ticker, statement: 'BS', freq: 'annual'
      }).catch(() => ({ data: [] }))
    ]);

    const incomeReports = Array.isArray(incomeData?.data) ? incomeData.data : [];
    const balanceReports = Array.isArray(balanceData?.data) ? balanceData.data : [];

    const yearMap = {};

    // 处理利润表 — 防御性遍历
    incomeReports.forEach(report => {
      try {
        const year = report?.year;
        if (!year) return;
        if (!yearMap[year]) yearMap[year] = {};
        const ic = report?.report?.ic || {};
        // 使用可选链安全提取
        const revItem = ic?.['SalesRevenueNet']?.[0]?.value
          || ic?.['RevenueFromContractWithCustomerExcludingAssessedTax']?.[0]?.value
          || ic?.['Revenues']?.[0]?.value
          || 0;
        const niItem = ic?.['NetIncomeLoss']?.[0]?.value
          || ic?.['ProfitLoss']?.[0]?.value
          || 0;
        yearMap[year].revenue = parseFloat(revItem) || 0;
        yearMap[year].netIncome = parseFloat(niItem) || 0;
      } catch (e) {
        // 单行解析失败跳过
      }
    });

    // 处理资产负债表 — 防御性遍历
    balanceReports.forEach(report => {
      try {
        const year = report?.year;
        if (!year) return;
        if (!yearMap[year]) yearMap[year] = {};
        const bs = report?.report?.bs || {};
        yearMap[year].totalAssets = parseFloat(bs?.['Assets']?.[0]?.value
          || bs?.['AssetsCurrent']?.[0]?.value || 0);
        yearMap[year].totalLiabilities = parseFloat(bs?.['Liabilities']?.[0]?.value
          || bs?.['LiabilitiesCurrent']?.[0]?.value || 0);
        yearMap[year].totalEquity = parseFloat(bs?.['StockholdersEquity']?.[0]?.value
          || bs?.['EquityAttributableToParent']?.[0]?.value
          || bs?.['Equity']?.[0]?.value || 0);
        yearMap[year].cash = parseFloat(bs?.['CashAndCashEquivalentsAtCarryingValue']?.[0]?.value
          || bs?.['Cash']?.[0]?.value || 0);
        yearMap[year].longTermDebt = parseFloat(bs?.['LongTermDebtNoncurrent']?.[0]?.value
          || bs?.['LongTermDebt']?.[0]?.value || 0);
      } catch (e) {
        // 单行解析失败跳过
      }
    });

    // 排序年份
    const sortedYears = Object.keys(yearMap)
      .map(y => parseInt(y))
      .filter(y => !isNaN(y))
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
    while (years.length < 6 && years.length > 0) {
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

    // 如果完全没有数据，返回 6 年默认值
    if (years.length === 0) {
      const currentYear = new Date().getFullYear();
      for (let i = 0; i < 6; i++) {
        years.push((currentYear - i).toString());
        revenue.push(0);
        netIncome.push(0);
        totalAssets.push(0);
        totalLiabilities.push(0);
        totalStockholdersEquity.push(0);
        cashAndCashEquivalents.push(0);
        longTermDebt.push(0);
      }
    }

    return { years, revenue, netIncome, totalAssets, totalLiabilities, totalStockholdersEquity, cashAndCashEquivalents, longTermDebt };

  } catch (err) {
    console.warn(`[API] 获取 ${ticker} 财务报表失败:`, err.message);
    // 返回全零的默认数据
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let i = 0; i < 6; i++) years.push((currentYear - i).toString());
    return {
      years, revenue: [0,0,0,0,0,0], netIncome: [0,0,0,0,0,0],
      totalAssets: [0,0,0,0,0,0], totalLiabilities: [0,0,0,0,0,0],
      totalStockholdersEquity: [0,0,0,0,0,0],
      cashAndCashEquivalents: [0,0,0,0,0,0], longTermDebt: [0,0,0,0,0,0]
    };
  }
}

// ============================================
// 获取估值指标（防御性）
// ============================================
async function getMetrics(ticker) {
  try {
    const [quote, metric] = await Promise.all([
      finnhubGet('/quote', { symbol: ticker }).catch(() => ({ c: 0 })),
      finnhubGet('/stock/metric', { symbol: ticker, metric: 'all' }).catch(() => ({ metric: {} }))
    ]);

    const metrics = metric?.metric || {};
    const currentPrice = quote?.c || 0;
    const eps = metrics?.epsBasicExclExtraItems || metrics?.epsInclExtraItems || 0;
    const pe = eps > 0 ? currentPrice / eps : 0;
    const roe = metrics?.roeRtn || metrics?.returnOnEquity || 0;
    const grossMargin = metrics?.grossMargin || 0;
    const currentRatio = metrics?.currentRatio || 0;
    const debtToEquity = metrics?.totalDebtToEquity || metrics?.longTermDebtEquity || 0;

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
    return { peRatio: 0, roe: 0, grossProfitMargin: 0, debtToEquity: 0, currentRatio: 0, currentPrice: 0 };
  }
}

// ============================================
// API: 获取股票完整数据
// ============================================
app.get('/api/stocks/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log(`[API] 正在从 Finnhub 获取 ${ticker} 数据...`);

  if (!FINNHUB_API_KEY) {
    console.error('[API] ❌ FINNHUB_API_KEY 未设置！');
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

    // 防御：确保 financialData 有 years 数组
    const numYears = financialData?.years?.length || 6;

    // 构建比率数组（与年份对齐）
    const peRatio = Array(numYears).fill(metrics?.peRatio ?? 0);
    const roe = (financialData?.totalStockholdersEquity || []).map((eq, i) =>
      eq > 0 ? +((financialData?.netIncome?.[i] || 0) / eq).toFixed(4) : 0
    );
    const grossProfitMargin = Array(numYears).fill(metrics?.grossProfitMargin ?? 0);
    const debtToEquity = (financialData?.totalStockholdersEquity || []).map((eq, i) =>
      eq > 0 ? +((financialData?.totalLiabilities?.[i] || 0) / eq).toFixed(4) : 0
    );
    const currentRatio = Array(numYears).fill(metrics?.currentRatio ?? 0);
    const assetTurnover = (financialData?.totalAssets || []).map((ta, i) =>
      ta > 0 ? +((financialData?.revenue?.[i] || 0) / ta).toFixed(4) : 0
    );
    const equityMultiplier = (financialData?.totalStockholdersEquity || []).map((eq, i) =>
      eq > 0 ? +((financialData?.totalAssets?.[i] || 0) / eq).toFixed(4) : 0
    );

    // 组装返回数据 — 完全兼容前端 index.html 的期望格式
    const responseData = {
      ticker: ticker,
      companyName: profile?.name || ticker,
      sector: profile?.sector || 'Technology',
      financialData: {
        years: financialData?.years || [],
        revenue: financialData?.revenue || [],
        netIncome: financialData?.netIncome || [],
        totalAssets: financialData?.totalAssets || [],
        totalLiabilities: financialData?.totalLiabilities || [],
        totalStockholdersEquity: financialData?.totalStockholdersEquity || [],
        cashAndCashEquivalents: financialData?.cashAndCashEquivalents || [],
        longTermDebt: financialData?.longTermDebt || [],
        peRatio: peRatio,
        roe: roe,
        grossProfitMargin: grossProfitMargin,
        debtToEquity: debtToEquity,
        currentRatio: currentRatio,
        assetTurnover: assetTurnover,
        equityMultiplier: equityMultiplier
      },
      klineData: klineData || []
    };

    console.log(`[API] ✅ ${ticker} 成功! 公司:${responseData.companyName}, K线:${klineData?.length || 0}条`);
    res.json(responseData);

  } catch (error) {
    // 兜底异常捕获 — 打印完整错误栈
    console.error('[API 崩溃详情]:', error);
    const errMsg = error?.message || '未知错误';

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

    // 其他错误 — 安全返回，绝不崩溃
    res.status(500).json({
      error: '数据解析失败',
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
