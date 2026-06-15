const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Finnhub API Key — 从环境变量读取
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
// FMP API Key — 用于获取 K 线数据
const FMP_API_KEY = process.env.FMP_API_KEY || '';

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
// 获取 K 线数据（使用 FMP /stable/ 接口）
// ============================================
async function getKlineData(ticker) {
  try {
    // ===== FMP 诊断日志 =====
    console.log('[FMP 诊断] 检查密钥状态: 是否读取到?', !!FMP_API_KEY, '| 长度:', FMP_API_KEY?.length);

    if (!FMP_API_KEY) {
      console.warn(`[FMP] FMP_API_KEY 未设置，无法获取 K 线`);
      return [];
    }

    // 使用最新的 /stable/ 接口，通过 params 传参
    const url = 'https://financialmodelingprep.com/stable/historical-price-eod/full';
    console.log('[FMP 诊断] 正在请求:', url, '| symbol:', ticker);

    const res = await axios.get(url, {
      params: {
        symbol: ticker,
        apikey: FMP_API_KEY
      },
      timeout: 15000
    });

    // /stable/ 接口直接返回扁平数组，不再嵌套 { historical: [...] }
    const data = res.data;
    console.log('[FMP 诊断] 返回类型:', typeof data, '| 是数组?', Array.isArray(data), '| 长度:', data?.length);

    if (!Array.isArray(data) || data.length === 0) {
      console.warn(`[FMP] ${ticker} 无历史数据`);
      return [];
    }

    console.log(`[FMP] ${ticker} 原始数据: ${data.length} 条`);

    // 截取最近 252 个交易日（约 1 年）
    const sliceCount = Math.min(data.length, 252);
    const recentData = data.slice(0, sliceCount);

    const result = [];
    for (const item of recentData) {
      const open = item.open;
      const high = item.high;
      const low = item.low;
      const close = item.close;
      const volume = item.volume;
      const date = item.date;

      if (open != null && high != null && low != null && close != null && date != null) {
        result.push({
          time: date,
          open: open,
          high: high,
          low: low,
          close: close,
          volume: volume ?? 0
        });
      }
    }

    // FMP 返回按日期降序（最新在前），前端需要升序
    result.reverse();

    console.log(`[后端整理完毕] 成功组装 K 线数据: ${result.length} 条 (FMP /stable/)`);
    return result;

  } catch (err) {
    // 打印 FMP 返回的具体错误详情
    const status = err.response?.status || 'unknown';
    const errData = err.response?.data || {};
    console.error(`[FMP ${status} 详情] ${ticker}:`, JSON.stringify(errData));
    console.warn(`[FMP] 获取 ${ticker} K线失败:`, err.message);
    return [];
  }
}

// ============================================
// 获取财务报表（使用 FMP /stable/income-statement）
// ============================================
async function getFinancials(ticker) {
  try {
    if (!FMP_API_KEY) {
      console.warn(`[FMP] FMP_API_KEY 未设置，无法获取财务报表`);
      return fallbackFinancials();
    }

    // 使用 /stable/ 接口，通过 params 传参
    const url = 'https://financialmodelingprep.com/stable/income-statement';
    console.log(`[FMP] 请求利润表: ${ticker}`);

    const res = await axios.get(url, {
      params: { symbol: ticker, limit: 6, apikey: FMP_API_KEY },
      timeout: 15000
    });
    const incomeData = res.data;

    if (!Array.isArray(incomeData) || incomeData.length === 0) {
      console.warn(`[FMP] ${ticker} 利润表无数据`);
      return fallbackFinancials();
    }

    console.log(`[FMP] ${ticker} 利润表: ${incomeData.length} 年`);

    // FMP 返回按年份降序（最新在前），反转成升序
    const sorted = [...incomeData].reverse();

    const years = [];
    const revenue = [];
    const netIncome = [];

    for (const item of sorted) {
      const year = item?.calendarYear || item?.date?.substring(0, 4);
      if (!year) continue;
      years.push(year);
      revenue.push(item?.revenue ?? 0);
      netIncome.push(item?.netIncome ?? 0);
    }

    return { years, revenue, netIncome };

  } catch (err) {
    const status = err.response?.status || 'unknown';
    const errData = err.response?.data || {};
    console.error(`[FMP ${status} 详情] 利润表 ${ticker}:`, JSON.stringify(errData));
    console.warn(`[FMP] 获取 ${ticker} 财务报表失败:`, err.message);
    return fallbackFinancials();
  }
}

// 全零兜底
function fallbackFinancials() {
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

// ============================================
// 获取估值指标（使用 FMP /stable/key-metrics）
// ============================================
async function getMetrics(ticker) {
  try {
    if (!FMP_API_KEY) {
      console.warn(`[FMP] FMP_API_KEY 未设置，无法获取估值指标`);
      return fallbackMetrics();
    }

    // 使用 /stable/ 接口，通过 params 传参
    const url = 'https://financialmodelingprep.com/stable/key-metrics';
    console.log(`[FMP] 请求关键指标: ${ticker}`);

    const res = await axios.get(url, {
      params: { symbol: ticker, limit: 6, apikey: FMP_API_KEY },
      timeout: 15000
    });
    const metricsData = res.data;

    if (!Array.isArray(metricsData) || metricsData.length === 0) {
      console.warn(`[FMP] ${ticker} 关键指标无数据`);
      return fallbackMetrics();
    }

    console.log(`[FMP] ${ticker} 关键指标: ${metricsData.length} 年`);

    // FMP 返回按年份降序（最新在前），反转成升序
    const sorted = [...metricsData].reverse();

    const years = [];
    const peRatio = [];
    const roe = [];
    const grossProfitMargin = [];
    const debtToEquity = [];
    const currentRatio = [];
    const assetTurnover = [];
    const equityMultiplier = [];
    const totalAssets = [];
    const totalLiabilities = [];
    const totalStockholdersEquity = [];
    const cashAndCashEquivalents = [];
    const longTermDebt = [];

    for (const item of sorted) {
      const year = item?.calendarYear || item?.date?.substring(0, 4);
      if (!year) continue;

      years.push(year);
      peRatio.push(item?.peRatio ?? 0);
      roe.push(item?.roe ?? 0);
      grossProfitMargin.push(item?.grossProfitMargin ?? 0);
      debtToEquity.push(item?.debtToEquity ?? 0);
      currentRatio.push(item?.currentRatio ?? 0);
      assetTurnover.push(item?.assetTurnover ?? 0);
      equityMultiplier.push(item?.equityMultiplier ?? 0);
      totalAssets.push(item?.enterpriseValue ?? 0);
      totalLiabilities.push(item?.totalDebt ?? 0);
      totalStockholdersEquity.push(item?.totalSharesOutstanding ?? 0);
      cashAndCashEquivalents.push(item?.freeCashFlowPerShare ?? 0);
      longTermDebt.push(item?.longTermDebt ?? 0);
    }

    return {
      years,
      peRatio,
      roe,
      grossProfitMargin,
      debtToEquity,
      currentRatio,
      assetTurnover,
      equityMultiplier,
      totalAssets,
      totalLiabilities,
      totalStockholdersEquity,
      cashAndCashEquivalents,
      longTermDebt,
      currentPrice: 0
    };

  } catch (err) {
    const status = err.response?.status || 'unknown';
    const errData = err.response?.data || {};
    console.error(`[FMP ${status} 详情] 关键指标 ${ticker}:`, JSON.stringify(errData));
    console.warn(`[FMP] 获取 ${ticker} 关键指标失败:`, err.message);
    return fallbackMetrics();
  }
}

function fallbackMetrics() {
  return {
    years: [], peRatio: [], roe: [], grossProfitMargin: [],
    debtToEquity: [], currentRatio: [], assetTurnover: [], equityMultiplier: [],
    totalAssets: [], totalLiabilities: [], totalStockholdersEquity: [],
    cashAndCashEquivalents: [], longTermDebt: [], currentPrice: 0
  };
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

    // ===== 合并利润表数据 + 关键指标数据 =====
    // financialData 来自 income-statement: 有 years, revenue, netIncome
    // metrics 来自 key-metrics: 有 years, peRatio, roe, totalAssets 等
    // 以 financialData.years 为基准，从 metrics 中按年份匹配

    const baseYears = financialData?.years || [];
    const numYears = baseYears.length || 6;

    const mergedRevenue = financialData?.revenue || [];
    const mergedNetIncome = financialData?.netIncome || [];

    // 从 metrics 中按年份匹配数据
    const mergedPE = [];
    const mergedROE = [];
    const mergedGrossMargin = [];
    const mergedDebtToEquity = [];
    const mergedCurrentRatio = [];
    const mergedAssetTurnover = [];
    const mergedEquityMultiplier = [];
    const mergedTotalAssets = [];
    const mergedTotalLiabilities = [];
    const mergedTotalEquity = [];
    const mergedCash = [];
    const mergedLongTermDebt = [];

    // 构建 metrics 的年份查找表
    const metricsByYear = {};
    if (metrics?.years) {
      for (let i = 0; i < metrics.years.length; i++) {
        const y = metrics.years[i];
        metricsByYear[y] = {
          peRatio: metrics.peRatio?.[i] ?? 0,
          roe: metrics.roe?.[i] ?? 0,
          grossProfitMargin: metrics.grossProfitMargin?.[i] ?? 0,
          debtToEquity: metrics.debtToEquity?.[i] ?? 0,
          currentRatio: metrics.currentRatio?.[i] ?? 0,
          assetTurnover: metrics.assetTurnover?.[i] ?? 0,
          equityMultiplier: metrics.equityMultiplier?.[i] ?? 0,
          totalAssets: metrics.totalAssets?.[i] ?? 0,
          totalLiabilities: metrics.totalLiabilities?.[i] ?? 0,
          totalEquity: metrics.totalStockholdersEquity?.[i] ?? 0,
          cash: metrics.cashAndCashEquivalents?.[i] ?? 0,
          longTermDebt: metrics.longTermDebt?.[i] ?? 0
        };
      }
    }

    for (const year of baseYears) {
      const m = metricsByYear[year] || {};
      mergedPE.push(m.peRatio ?? 0);
      mergedROE.push(m.roe ?? 0);
      mergedGrossMargin.push(m.grossProfitMargin ?? 0);
      mergedDebtToEquity.push(m.debtToEquity ?? 0);
      mergedCurrentRatio.push(m.currentRatio ?? 0);
      mergedAssetTurnover.push(m.assetTurnover ?? 0);
      mergedEquityMultiplier.push(m.equityMultiplier ?? 0);
      mergedTotalAssets.push(m.totalAssets ?? 0);
      mergedTotalLiabilities.push(m.totalLiabilities ?? 0);
      mergedTotalEquity.push(m.totalEquity ?? 0);
      mergedCash.push(m.cash ?? 0);
      mergedLongTermDebt.push(m.longTermDebt ?? 0);
    }

    // 如果 baseYears 为空，使用 metrics 的年份
    const finalYears = baseYears.length > 0 ? baseYears : (metrics?.years || []);
    const finalRevenue = mergedRevenue.length > 0 ? mergedRevenue : Array(finalYears.length).fill(0);
    const finalNetIncome = mergedNetIncome.length > 0 ? mergedNetIncome : Array(finalYears.length).fill(0);

    // 确保所有数组长度一致
    const finalLen = finalYears.length;
    function pad(arr) {
      while (arr.length < finalLen) arr.push(0);
      return arr.slice(0, finalLen);
    }

    // 组装返回数据 — 完全兼容前端 index.html 的期望格式
    const responseData = {
      ticker: ticker,
      companyName: profile?.name || ticker,
      sector: profile?.sector || 'Technology',
      financialData: {
        years: finalYears,
        revenue: pad(finalRevenue),
        netIncome: pad(finalNetIncome),
        totalAssets: pad(mergedTotalAssets),
        totalLiabilities: pad(mergedTotalLiabilities),
        totalStockholdersEquity: pad(mergedTotalEquity),
        cashAndCashEquivalents: pad(mergedCash),
        longTermDebt: pad(mergedLongTermDebt),
        peRatio: pad(mergedPE),
        roe: pad(mergedROE),
        grossProfitMargin: pad(mergedGrossMargin),
        debtToEquity: pad(mergedDebtToEquity),
        currentRatio: pad(mergedCurrentRatio),
        assetTurnover: pad(mergedAssetTurnover),
        equityMultiplier: pad(mergedEquityMultiplier)
      },
      klineData: klineData || []
    };

    console.log(`[API] ✅ ${ticker} 成功! 公司:${responseData.companyName}, 财务年份:${finalYears.length}, K线:${klineData?.length || 0}条`);
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
