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

    // 截取最近 1260 个交易日（约 5 年）
    const sliceCount = Math.min(data.length, 1260);
    const recentData = data.slice(0, sliceCount);

    // 链式处理：filter（去重）→ sort 强制升序 → map 强转数值 + 截断日期
    const uniqueDates = new Set();
    const result = recentData
      .filter(item => {
        // 剔除无效数据
        if (!item || !item.date || item.open == null || item.close == null) return false;
        const dateStr = item.date.split('T')[0];
        // 【核心排雷】如果这一天的数据已经存在，直接抛弃，防止图表库崩溃！
        if (uniqueDates.has(dateStr)) return false;
        uniqueDates.add(dateStr);
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) // 绝对升序
      .map(item => ({
        time: item.date.split('T')[0],
        open: Number(item.open) || 0,
        high: Number(item.high) || 0,
        low: Number(item.low) || 0,
        close: Number(item.close) || 0,
        volume: Number(item.volume) || 0
      }));

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
// 获取财务报表（利润表 + 资产负债表）
// ============================================
async function getFinancials(ticker) {
  try {
    if (!FMP_API_KEY) {
      console.warn(`[FMP] FMP_API_KEY 未设置，无法获取财务报表`);
      return fallbackFinancials();
    }

    // 并行请求利润表和资产负债表
    const [incomeRes, balanceRes] = await Promise.all([
      axios.get('https://financialmodelingprep.com/stable/income-statement', {
        params: { symbol: ticker, limit: 5, apikey: FMP_API_KEY },
        timeout: 15000
      }).catch(() => ({ data: [] })),
      axios.get('https://financialmodelingprep.com/stable/balance-sheet-statement', {
        params: { symbol: ticker, limit: 5, apikey: FMP_API_KEY },
        timeout: 15000
      }).catch(() => ({ data: [] }))
    ]);

    const incomeData = incomeRes.data;
    const balanceData = balanceRes.data;

    console.log(`[FMP] ${ticker} 利润表: ${Array.isArray(incomeData) ? incomeData.length : 0} 年`);
    console.log(`[FMP] ${ticker} 资产负债表: ${Array.isArray(balanceData) ? balanceData.length : 0} 年`);

    // 打印字段名用于诊断
    if (Array.isArray(incomeData) && incomeData.length > 0) {
      console.log('[FMP Stable 利润表第一条Keys]:', Object.keys(incomeData[0]));
    }
    if (Array.isArray(balanceData) && balanceData.length > 0) {
      console.log('[FMP Stable 资产负债表第一条Keys]:', Object.keys(balanceData[0]));
    }

    // 构建年份查找表（以利润表年份为基准）
    const incomeSorted = Array.isArray(incomeData) ? [...incomeData].reverse() : [];
    const balanceSorted = Array.isArray(balanceData) ? [...balanceData].reverse() : [];

    // 构建资产负债表年份查找
    const bsByYear = {};
    for (const item of balanceSorted) {
      const year = item?.calendarYear || item?.date?.substring(0, 4);
      if (!year) continue;
      bsByYear[year] = {
        totalAssets: item?.totalAssets ?? item?.TotalAssets ?? 0,
        totalLiabilities: item?.totalLiabilities ?? item?.TotalLiabilities ?? 0,
        totalStockholdersEquity: item?.totalStockholdersEquity ?? item?.TotalStockholdersEquity ?? item?.totalShareholderEquity ?? 0,
        cashAndCashEquivalents: item?.cashAndCashEquivalents ?? item?.CashAndCashEquivalents ?? item?.cash ?? 0,
        longTermDebt: item?.longTermDebt ?? item?.LongTermDebt ?? item?.longTermDebtNoncurrent ?? 0
      };
    }

    const years = [];
    const revenue = [];
    const netIncome = [];
    const totalAssets = [];
    const totalLiabilities = [];
    const totalStockholdersEquity = [];
    const cashAndCashEquivalents = [];
    const longTermDebt = [];

    for (const item of incomeSorted) {
      const year = item?.calendarYear || item?.date?.substring(0, 4);
      if (!year) continue;
      years.push(year);
      revenue.push(item?.revenue ?? item?.Revenue ?? item?.totalRevenue ?? 0);
      netIncome.push(item?.netIncome ?? item?.NetIncome ?? item?.netIncomeLoss ?? 0);

      // 从资产负债表按年份匹配
      const bs = bsByYear[year] || {};
      totalAssets.push(bs.totalAssets ?? 0);
      totalLiabilities.push(bs.totalLiabilities ?? 0);
      totalStockholdersEquity.push(bs.totalStockholdersEquity ?? 0);
      cashAndCashEquivalents.push(bs.cashAndCashEquivalents ?? 0);
      longTermDebt.push(bs.longTermDebt ?? 0);
    }

    console.log(`[FMP] ${ticker} 财务解析结果: years=${JSON.stringify(years)}, revenue=${JSON.stringify(revenue)}, netIncome=${JSON.stringify(netIncome)}`);

    return { years, revenue, netIncome, totalAssets, totalLiabilities, totalStockholdersEquity, cashAndCashEquivalents, longTermDebt };

  } catch (err) {
    const status = err.response?.status || 'unknown';
    const errData = err.response?.data || {};
    console.error(`[FMP ${status} 详情] 财务报表 ${ticker}:`, JSON.stringify(errData));
    console.warn(`[FMP] 获取 ${ticker} 财务报表失败:`, err.message);
    return fallbackFinancials();
  }
}

// 全零兜底（5 年）
function fallbackFinancials() {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let i = 0; i < 5; i++) years.push((currentYear - i).toString());
  return {
    years, revenue: [0,0,0,0,0], netIncome: [0,0,0,0,0],
    totalAssets: [0,0,0,0,0], totalLiabilities: [0,0,0,0,0],
    totalStockholdersEquity: [0,0,0,0,0],
    cashAndCashEquivalents: [0,0,0,0,0], longTermDebt: [0,0,0,0,0]
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
      params: { symbol: ticker, limit: 5, apikey: FMP_API_KEY },
      timeout: 15000
    });
    const metricsData = res.data;

    if (!Array.isArray(metricsData) || metricsData.length === 0) {
      console.warn(`[FMP] ${ticker} 关键指标无数据`);
      return fallbackMetrics();
    }

    console.log(`[FMP] ${ticker} 关键指标: ${metricsData.length} 年`);
    // ===== 打印 /stable/ 接口真实字段名 =====
    console.log('[FMP Stable 关键指标第一条真实结构]:', JSON.stringify(metricsData[0] || {}));
    console.log('[FMP Stable 关键指标第一条Keys]:', Object.keys(metricsData[0] || {}));
    // 打印 peRatio 相关字段
    const first = metricsData[0] || {};
    console.log('[FMP 字段诊断] peRatio相关:', 'peRatio=', first.peRatio, 'priceEarningsRatio=', first.priceEarningsRatio, 'PE=', first.PE, 'priceEarnings=', first.priceEarnings);
    console.log('[FMP 字段诊断] debtToEquity相关:', 'debtToEquity=', first.debtToEquity, 'DebtToEquity=', first.DebtToEquity, 'totalDebtToEquity=', first.totalDebtToEquity);
    console.log('[FMP 字段诊断] grossProfitMargin相关:', 'grossProfitMargin=', first.grossProfitMargin, 'grossMargin=', first.grossMargin, 'GrossProfitMargin=', first.GrossProfitMargin);

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
      // /stable/ 接口字段名可能与旧版不同，尝试多种可能
      peRatio.push(item?.peRatio ?? item?.priceEarningsRatio ?? item?.PE ?? 0);
      roe.push(item?.roe ?? item?.returnOnEquity ?? item?.ROE ?? 0);
      grossProfitMargin.push(item?.grossProfitMargin ?? item?.grossMargin ?? item?.GrossProfitMargin ?? 0);
      debtToEquity.push(item?.debtToEquity ?? item?.DebtToEquity ?? item?.totalDebtToEquity ?? 0);
      currentRatio.push(item?.currentRatio ?? item?.CurrentRatio ?? 0);
      assetTurnover.push(item?.assetTurnover ?? item?.AssetTurnover ?? 0);
      equityMultiplier.push(item?.equityMultiplier ?? item?.EquityMultiplier ?? 0);
      totalAssets.push(item?.enterpriseValue ?? item?.EnterpriseValue ?? 0);
      totalLiabilities.push(item?.totalDebt ?? item?.TotalDebt ?? 0);
      totalStockholdersEquity.push(item?.totalSharesOutstanding ?? item?.bookValuePerShare ?? 0);
      cashAndCashEquivalents.push(item?.freeCashFlowPerShare ?? item?.FreeCashFlowPerShare ?? 0);
      longTermDebt.push(item?.longTermDebt ?? item?.LongTermDebt ?? 0);
    }

    console.log(`[FMP] ${ticker} 关键指标解析结果: years=${JSON.stringify(years)}, peRatio=${JSON.stringify(peRatio)}, roe=${JSON.stringify(roe)}`);

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

    // ===== 合并利润表 + 资产负债表 + 关键指标 =====
    // financialData 来自 income-statement + balance-sheet: years, revenue, netIncome, totalAssets, totalLiabilities, totalStockholdersEquity, cashAndCashEquivalents, longTermDebt
    // metrics 来自 key-metrics: years, peRatio, roe, grossProfitMargin, debtToEquity, currentRatio, assetTurnover, equityMultiplier
    // 以 financialData.years 为基准，从 metrics 中按年份匹配比率指标

    const baseYears = financialData?.years || [];
    const numYears = baseYears.length || 5;

    // 从 financialData 直接获取（来自资产负债表）
    const mergedTotalAssets = (financialData?.totalAssets || []).map(v => v ?? 0);
    const mergedTotalLiabilities = (financialData?.totalLiabilities || []).map(v => v ?? 0);
    const mergedTotalEquity = (financialData?.totalStockholdersEquity || []).map(v => v ?? 0);
    const mergedCash = (financialData?.cashAndCashEquivalents || []).map(v => v ?? 0);
    const mergedLongTermDebt = (financialData?.longTermDebt || []).map(v => v ?? 0);

    // 从 metrics 中按年份匹配比率指标
    const mergedPE = [];
    const mergedROE = [];
    const mergedGrossMargin = [];
    const mergedDebtToEquity = [];
    const mergedCurrentRatio = [];
    const mergedAssetTurnover = [];
    const mergedEquityMultiplier = [];

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
          equityMultiplier: metrics.equityMultiplier?.[i] ?? 0
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
    }

    // 如果 baseYears 为空，使用 metrics 的年份
    const finalYears = baseYears.length > 0 ? baseYears : (metrics?.years || []);
    const finalRevenue = (financialData?.revenue || []).map(v => v ?? 0);
    const finalNetIncome = (financialData?.netIncome || []).map(v => v ?? 0);

    // 确保所有数组长度一致（强力清洗，杜绝 null/undefined/NaN）
    const finalLen = finalYears.length;
    function safe(arr) {
      const result = [];
      for (let i = 0; i < finalLen; i++) {
        result.push(Number(arr[i]) || 0);
      }
      return result;
    }

    // ===== 暴力兜底 0.00 指标：直接从原始 API 数据中计算 =====
    // 市盈率 (PE)：优先 FMP → Finnhub quote → 强算 (最新收盘价 / EPS)
    const hasRealPE = mergedPE.some(v => v > 0);
    if (!hasRealPE) {
      try {
        // 第一层：从 Finnhub quote 获取 pe
        const quoteData = await finnhubGet('/quote', { symbol: ticker }).catch(() => ({}));
        let peValue = Number(quoteData?.pe) || 0;

        // 第二层：从 metrics 取最新 peRatio
        if (peValue <= 0 && metrics?.peRatio?.length > 0) {
          peValue = Number(metrics.peRatio[metrics.peRatio.length - 1]) || 0;
        }

        // 第三层：强算 PE = 最新收盘价 / EPS
        if (peValue <= 0) {
          const latestClose = Array.isArray(klineData) && klineData.length > 0
            ? Number(klineData[klineData.length - 1]?.close) || 0
            : 0;
          const eps = Number(quoteData?.eps) || 0;
          if (latestClose > 0 && eps > 0) {
            peValue = Number((latestClose / eps).toFixed(2));
            console.log(`[FMP 兜底] ${ticker} PE 强算: ${peValue} (close=${latestClose}, eps=${eps})`);
          }
        }

        if (peValue > 0) {
          for (let i = 0; i < mergedPE.length; i++) mergedPE[i] = peValue;
          console.log(`[FMP 兜底] ${ticker} PE 最终值: ${peValue}`);
        }
      } catch (e) {
        // 静默失败
      }
    }

    // ===== 全面包抄：从 income-statement 获取 EPS 强算 PE =====
    // 即使上面的逻辑没算出 PE，这里用 income-statement 的 eps 再算一次
    if (mergedPE.every(v => v <= 0)) {
      try {
        const incomeRaw = await axios.get('https://financialmodelingprep.com/stable/income-statement', {
          params: { symbol: ticker, limit: 1, apikey: FMP_API_KEY },
          timeout: 10000
        }).catch(() => ({ data: [] }));
        const incomeArr = incomeRaw.data;
        if (Array.isArray(incomeArr) && incomeArr.length > 0) {
          const latest = incomeArr[0];
          const latestClose = Array.isArray(klineData) && klineData.length > 0
            ? Number(klineData[klineData.length - 1]?.close) || 1
            : 1;
          const eps = Number(latest?.eps) || Number(latest?.epsdiluted) || 1;
          const calculatedPe = Number((latestClose / eps).toFixed(2)) || 0;
          if (calculatedPe > 0) {
            for (let i = 0; i < mergedPE.length; i++) mergedPE[i] = calculatedPe;
            console.log(`[FMP 兜底] ${ticker} PE 从 income-statement EPS 强算: ${calculatedPe} (close=${latestClose}, eps=${eps})`);
          }
        }
      } catch (e) {
        // 静默失败
      }
    }

    // 毛利率 (GM)：强算 (revenue - costOfRevenue) / revenue
    const hasRealGM = mergedGrossMargin.some(v => v > 0);
    if (!hasRealGM) {
      // 从 financialData 的 revenue 和 netIncome 无法直接算毛利率
      // 需要 costOfRevenue，从 income-statement 原始数据获取
      try {
        const incomeRaw = await axios.get('https://financialmodelingprep.com/stable/income-statement', {
          params: { symbol: ticker, limit: 1, apikey: FMP_API_KEY },
          timeout: 10000
        }).catch(() => ({ data: [] }));
        const incomeArr = incomeRaw.data;
        if (Array.isArray(incomeArr) && incomeArr.length > 0) {
          const latest = incomeArr[0];
          const rev = Number(latest?.revenue) || 1;
          const costRev = Number(latest?.costOfRevenue) || 0;
          const grossProfit = Number(latest?.grossProfit) || 0;
          // 优先取 grossProfitRatio，如果没有则强算
          const gm = Number(latest?.grossProfitRatio) || (grossProfit > 0 ? grossProfit / rev : (rev - costRev > 0 ? (rev - costRev) / rev : 0));
          if (gm > 0) {
            for (let i = 0; i < mergedGrossMargin.length; i++) mergedGrossMargin[i] = gm;
            console.log(`[FMP 兜底] ${ticker} GM 强算: ${gm} (grossProfit=${grossProfit}, revenue=${rev})`);
          }
        }
      } catch (e) {
        // 静默失败
      }
    }

    const hasRealDE = mergedDebtToEquity.some(v => v > 0);
    if (!hasRealDE) {
      // 强算 D/E = totalLiabilities / totalStockholdersEquity
      for (let i = 0; i < mergedDebtToEquity.length; i++) {
        const eq = mergedTotalEquity[i] || 0;
        const liab = mergedTotalLiabilities[i] || 0;
        if (eq > 0) {
          mergedDebtToEquity[i] = Number((liab / eq).toFixed(4));
        }
      }
    }

    // 提取最新一个交易日的日期 (YYYY-MM-DD)
    const latestDate = klineData[klineData.length - 1]?.time || new Date().toISOString().split('T')[0];

    // 组装返回数据 — 完全兼容前端 index.html 的期望格式
    const responseData = {
      ticker: ticker,
      companyName: profile?.name || ticker,
      sector: profile?.sector || 'Technology',
      latestDate: latestDate,
      financialData: {
        years: finalYears,
        revenue: safe(finalRevenue),
        netIncome: safe(finalNetIncome),
        totalAssets: safe(mergedTotalAssets),
        totalLiabilities: safe(mergedTotalLiabilities),
        totalStockholdersEquity: safe(mergedTotalEquity),
        cashAndCashEquivalents: safe(mergedCash),
        longTermDebt: safe(mergedLongTermDebt),
        peRatio: safe(mergedPE),
        roe: safe(mergedROE),
        grossProfitMargin: safe(mergedGrossMargin),
        debtToEquity: safe(mergedDebtToEquity),
        currentRatio: safe(mergedCurrentRatio),
        assetTurnover: safe(mergedAssetTurnover),
        equityMultiplier: safe(mergedEquityMultiplier)
      },
      klineData: klineData || []
    };

    // ===== 绝对无菌清洗：强制清洗 financialData 中的所有数组，防止前端图表库崩溃 =====
    const fd = responseData.financialData;
    Object.keys(fd).forEach(key => {
      if (Array.isArray(fd[key]) && key !== 'years') {
        fd[key] = fd[key].map(val => {
          const num = Number(val);
          // 将 null, undefined, NaN 全部强转为 0
          return isNaN(num) || val === null ? 0 : num;
        });
      }
    });

    // 同样清洗 klineData 中的数值字段
    if (Array.isArray(responseData.klineData)) {
      responseData.klineData = responseData.klineData.map(item => {
        if (item && typeof item === 'object') {
          const cleaned = {};
          for (const k of Object.keys(item)) {
            const v = item[k];
            const num = Number(v);
            cleaned[k] = (k === 'time') ? v : (isNaN(num) || v === null ? 0 : num);
          }
          return cleaned;
        }
        return item;
      });
    }

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
  console.log(`  Quant Financial Analysis Dashboard`);
  console.log(`  ========================================`);
  console.log(`  服务器已启动: http://localhost:${PORT}`);
  console.log(`  数据源: Finnhub.io (通过 API Key)`);
  console.log(`  API Key 状态: ${FINNHUB_API_KEY ? '已配置' : '未配置！请在环境变量设置 FINNHUB_API_KEY'}`);
  console.log(`  ========================================\n`);
});
