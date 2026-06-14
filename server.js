const express = require('express');
const cors = require('cors');
const path = require('path');
const { default: YahooFinance } = require('yahoo-finance2');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ============================================
// 全局请求日志中间件（用于 Render 调试）
// ============================================
app.use((req, res, next) => {
  console.log('[Server Hit]', req.method, req.url);
  next();
});

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// 自定义 User-Agent 列表（伪装成桌面浏览器）
// ============================================
const DESKTOP_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function getRandomUserAgent() {
  return DESKTOP_USER_AGENTS[Math.floor(Math.random() * DESKTOP_USER_AGENTS.length)];
}

// ============================================
// 带重试机制的 Yahoo Finance 请求函数
// ============================================
async function fetchYahooFinance(ticker) {
  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 每次请求创建新实例，使用不同 User-Agent
      const yf = new YahooFinance({
        suppressNotices: ['yahooSurvey']
      });

      console.log(`[API] 尝试 ${attempt}/${maxRetries} - 获取 ${ticker} 数据...`);

      // 并行请求三个数据源
      const [quoteSummary, chartResult, fundamentals] = await Promise.all([
        yf.quoteSummary(ticker, {
          modules: ['price', 'financialData', 'defaultKeyStatistics']
        }),
        yf.chart(ticker, { period1: '2021-01-01', interval: '1d' }),
        yf.fundamentalsTimeSeries(ticker, {
          period1: '2020-09-30',
          period2: '2026-09-30',
          module: 'all'
        })
      ]);

      return { quoteSummary, chartResult, fundamentals };

    } catch (err) {
      lastError = err;
      const errMsg = err.message || '';

      // 限流或 crumb 错误 → 指数退避重试
      if (errMsg.includes('429') || errMsg.includes('Too Many Requests') ||
          errMsg.includes('crumb') || errMsg.includes('Failed to get crumb')) {
        if (attempt < maxRetries) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1) + Math.random() * 2000, 15000);
          console.log(`[Retry] ${attempt}/${maxRetries} - 限流，等待 ${Math.round(delay)}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        // 最后一次重试也失败，抛出一个明确的限流错误
        const rateLimitError = new Error('429 Too Many Requests - Yahoo Finance rate limit exceeded after retries');
        rateLimitError.isRateLimit = true;
        throw rateLimitError;
      }

      // 其他错误直接抛出
      throw err;
    }
  }

  throw lastError;
}

// ============================================
// 从季度数据聚合为年度数据
// ============================================
function aggregateAnnualData(records) {
  const incomeMap = {};
  const balanceMap = {};

  records.forEach(r => {
    const year = r.date.getFullYear();

    if (r.totalRevenue !== undefined && r.totalRevenue !== null) {
      if (!incomeMap[year]) {
        incomeMap[year] = { revenue: 0, netIncome: 0, count: 0 };
      }
      incomeMap[year].revenue += r.totalRevenue || 0;
      incomeMap[year].netIncome += r.netIncome || 0;
      incomeMap[year].count++;
    }

    if (r.totalAssets !== undefined && r.totalAssets !== null) {
      balanceMap[year] = {
        totalAssets: r.totalAssets,
        totalLiabilities: r.totalLiabilitiesNetMinorityInterest,
        totalEquity: r.totalEquityGrossMinorityInterest,
        cash: r.cashAndCashEquivalents,
        longTermDebt: r.longTermDebt
      };
    }
  });

  const yearSet = new Set();
  Object.keys(incomeMap).forEach(y => yearSet.add(parseInt(y)));
  Object.keys(balanceMap).forEach(y => yearSet.add(parseInt(y)));
  const allYears = [...yearSet].sort((a, b) => b - a);

  const years = [];
  const revenue = [];
  const netIncome = [];
  const totalAssets = [];
  const totalLiabilities = [];
  const totalStockholdersEquity = [];
  const cashAndCashEquivalents = [];
  const longTermDebt = [];

  for (const year of allYears.slice(0, 6)) {
    years.push(year.toString());
    const inc = incomeMap[year] || { revenue: 0, netIncome: 0 };
    revenue.push(inc.revenue);
    netIncome.push(inc.netIncome);

    const bal = balanceMap[year] || {};
    totalAssets.push(bal.totalAssets || 0);
    totalLiabilities.push(bal.totalLiabilities || 0);
    totalStockholdersEquity.push(bal.totalEquity || 0);
    cashAndCashEquivalents.push(bal.cash || 0);
    longTermDebt.push(bal.longTermDebt || 0);
  }

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
// API: 获取股票完整数据
// ============================================
app.get('/api/stocks/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  console.log(`[API] 正在从 Yahoo Finance 获取 ${ticker} 真实数据...`);

  try {
    // 使用带重试机制的请求函数
    const { quoteSummary, chartResult, fundamentals } = await fetchYahooFinance(ticker);

    if (!quoteSummary || !quoteSummary.price) {
      throw new Error('Symbol not found');
    }

    const price = quoteSummary.price;
    const stats = quoteSummary.defaultKeyStatistics || {};
    const finData = quoteSummary.financialData || {};

    // 格式化 K 线数据
    const klineData = chartResult.quotes.map(q => ({
      time: q.date.toISOString().split('T')[0],
      open: q.open,
      high: q.high,
      low: q.low,
      close: q.close,
      volume: q.volume
    })).filter(item => item.open && item.close);

    // 从 fundamentals 聚合年度数据
    const annualData = aggregateAnnualData(fundamentals);

    // 计算比率
    const peRatio = annualData.years.map(() => stats.forwardPE ? +stats.forwardPE.toFixed(2) : 0);
    const roe = annualData.totalStockholdersEquity.map((eq, i) => eq > 0 ? +(annualData.netIncome[i] / eq).toFixed(4) : 0);
    const grossProfitMargin = annualData.years.map(() => finData.grossMargins ? +finData.grossMargins.toFixed(4) : 0);
    const debtToEquity = annualData.totalStockholdersEquity.map((eq, i) => eq > 0 ? +(annualData.totalLiabilities[i] / eq).toFixed(4) : 0);
    const currentRatio = annualData.years.map(() => finData.currentRatio ? +finData.currentRatio.toFixed(2) : 0);
    const assetTurnover = annualData.totalAssets.map((ta, i) => ta > 0 ? +(annualData.revenue[i] / ta).toFixed(4) : 0);
    const equityMultiplier = annualData.totalStockholdersEquity.map((eq, i) => eq > 0 ? +(annualData.totalAssets[i] / eq).toFixed(4) : 0);

    // 组装返回数据
    const responseData = {
      ticker: ticker,
      companyName: price.longName || price.shortName || ticker,
      sector: price.market || 'Technology',
      financialData: {
        years: annualData.years,
        revenue: annualData.revenue,
        netIncome: annualData.netIncome,
        totalAssets: annualData.totalAssets,
        totalLiabilities: annualData.totalLiabilities,
        totalStockholdersEquity: annualData.totalStockholdersEquity,
        cashAndCashEquivalents: annualData.cashAndCashEquivalents,
        longTermDebt: annualData.longTermDebt,
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

    console.log(`[API] ✅ ${ticker} 成功! 价格:$${price.regularMarketPrice}, K线:${klineData.length}条, 营收:${annualData.revenue[0]}, 净利润:${annualData.netIncome[0]}`);
    res.json(responseData);

  } catch (error) {
    const errMsg = error.message || '';
    console.error(`[API] ❌ ${ticker} 失败:`, errMsg);

    // 判断是否为限流错误 (429)
    if (error.isRateLimit || errMsg.includes('429') || errMsg.includes('Too Many Requests') ||
        errMsg.includes('crumb') || errMsg.includes('Failed to get crumb')) {
      return res.status(429).json({
        error: '当前公网 IP 被 Yahoo 限流，请稍后重试',
        details: errMsg,
        retryAfter: 60
      });
    }

    // 其他错误统一返回 500
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
  console.log(`  数据源: Yahoo Finance (真实数据)`);
  console.log(`  ========================================\n`);
});
