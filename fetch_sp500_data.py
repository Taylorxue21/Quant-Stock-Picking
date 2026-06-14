"""
S&P 500 Financial Data Fetcher
Fetches 5 years of quarterly financial data + daily stock prices for all S&P 500 companies
Stores data in SQLite database for fast querying
"""

import yfinance as yf
import sqlite3
import json
import time
import os
from datetime import datetime, timedelta

DB_PATH = os.path.join(os.path.dirname(__file__), 'sp500_data.db')

def get_sp500_tickers():
    """Fetch current S&P 500 tickers from Wikipedia"""
    try:
        import pandas as pd
        tables = pd.read_html('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies')
        sp500 = tables[0]
        tickers = sp500['Symbol'].tolist()
        # Clean tickers (remove dots, etc.)
        tickers = [t.replace('.', '-') for t in tickers]
        print(f"Found {len(tickers)} S&P 500 companies")
        return tickers
    except Exception as e:
        print(f"Error fetching S&P 500 list: {e}")
        # Fallback to a smaller set of well-known tickers
        return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK-B', 'JPM', 'V',
                'JNJ', 'WMT', 'PG', 'MA', 'UNH', 'HD', 'DIS', 'BAC', 'ADBE', 'CRM',
                'NFLX', 'CMCSA', 'XOM', 'VZ', 'KO', 'PEP', 'ABT', 'TMO', 'CVX', 'MRK',
                'WFC', 'INTC', 'CSCO', 'PFE', 'T', 'ABBV', 'NKE', 'LLY', 'ORCL', 'ACN',
                'DHR', 'MDT', 'NEE', 'PM', 'QCOM', 'TXN', 'IBM', 'HON', 'UPS', 'BA',
                'SBUX', 'MMM', 'LMT', 'AMGN', 'GE', 'CAT', 'GS', 'MS', 'BLK', 'C',
                'SPGI', 'DE', 'AXP', 'SYK', 'LRCX', 'ADI', 'AMAT', 'GILD', 'ISRG', 'VRTX',
                'REGN', 'MDLZ', 'CI', 'CB', 'MO', 'DUK', 'SO', 'PLD', 'ICE', 'TGT',
                'EL', 'CL', 'ZTS', 'BDX', 'APD', 'SHW', 'ITW', 'ETN', 'EMR', 'MMC',
                'PNC', 'USB', 'TFC', 'COF', 'BK', 'AIG', 'PRU', 'MET', 'ALL', 'TRV']

def init_database():
    """Initialize SQLite database with schema"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Companies table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS companies (
            ticker TEXT PRIMARY KEY,
            name TEXT,
            sector TEXT,
            industry TEXT,
            last_updated TIMESTAMP
        )
    ''')
    
    # Quarterly financial statements
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS financials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            date TEXT,
            statement_type TEXT,  -- 'income', 'balance', 'cashflow'
            data JSON,
            FOREIGN KEY (ticker) REFERENCES companies(ticker)
        )
    ''')
    
    # Daily stock prices (for K-line charts)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT,
            date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            dividends REAL,
            stock_splits REAL,
            FOREIGN KEY (ticker) REFERENCES companies(ticker)
        )
    ''')
    
    # Create indexes for faster queries
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_financials_ticker ON financials(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_financials_date ON financials(date)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stock_prices_ticker ON stock_prices(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stock_prices_date ON stock_prices(date)')
    
    conn.commit()
    conn.close()

def fetch_company_data(ticker, retries=3):
    """Fetch financial data for a single company"""
    for attempt in range(retries):
        try:
            stock = yf.Ticker(ticker)
            
            # Get company info
            info = stock.info
            company_name = info.get('longName', info.get('shortName', ticker))
            sector = info.get('sector', 'Unknown')
            industry = info.get('industry', 'Unknown')
            
            # Get quarterly financials (5 years = ~20 quarters)
            financials = stock.quarterly_financials
            balance_sheet = stock.quarterly_balance_sheet
            cashflow = stock.quarterly_cashflow
            
            # Get daily stock prices (5 years)
            hist = stock.history(period='5y')
            
            return {
                'name': company_name,
                'sector': sector,
                'industry': industry,
                'financials': financials,
                'balance_sheet': balance_sheet,
                'cashflow': cashflow,
                'prices': hist
            }
        except Exception as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 2
                print(f"  Retry {attempt + 1}/{retries} for {ticker} after {wait}s: {e}")
                time.sleep(wait)
            else:
                print(f"  Failed to fetch {ticker} after {retries} attempts: {e}")
                return None

def save_to_database(ticker, data):
    """Save company data to SQLite database"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    try:
        # Save company info
        cursor.execute('''
            INSERT OR REPLACE INTO companies (ticker, name, sector, industry, last_updated)
            VALUES (?, ?, ?, ?, ?)
        ''', (ticker, data['name'], data['sector'], data['industry'], datetime.now()))
        
        # Save financial statements
        for stmt_type, stmt_data in [
            ('income', data['financials']),
            ('balance', data['balance_sheet']),
            ('cashflow', data['cashflow'])
        ]:
            if stmt_data is not None and not stmt_data.empty:
                for date_col in stmt_data.columns:
                    date_str = date_col.strftime('%Y-%m-%d')
                    row_data = {}
                    for idx in stmt_data.index:
                        val = stmt_data.loc[idx, date_col]
                        if pd.notna(val):
                            row_data[idx] = float(val) if isinstance(val, (int, float)) else str(val)
                    
                    cursor.execute('''
                        INSERT OR REPLACE INTO financials (ticker, date, statement_type, data)
                        VALUES (?, ?, ?, ?)
                    ''', (ticker, date_str, stmt_type, json.dumps(row_data)))
        
        # Save stock prices
        if data['prices'] is not None and not data['prices'].empty:
            for date_idx, row in data['prices'].iterrows():
                date_str = date_idx.strftime('%Y-%m-%d')
                cursor.execute('''
                    INSERT OR REPLACE INTO stock_prices 
                    (ticker, date, open, high, low, close, volume, dividends, stock_splits)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    ticker, date_str,
                    float(row['Open']), float(row['High']), float(row['Low']),
                    float(row['Close']), int(row['Volume']),
                    float(row['Dividends']), float(row['Stock Splits'])
                ))
        
        conn.commit()
        return True
    except Exception as e:
        print(f"  Error saving {ticker} to database: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()

def main():
    print("=" * 60)
    print("S&P 500 Financial Data Fetcher")
    print("=" * 60)
    
    # Initialize database
    init_database()
    print(f"Database initialized at: {DB_PATH}")
    
    # Get S&P 500 tickers
    tickers = get_sp500_tickers()
    
    # Check which tickers already have data
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT ticker FROM companies')
    existing = set(row[0] for row in cursor.fetchall())
    conn.close()
    
    print(f"Already have data for {len(existing)} companies")
    
    # Fetch data for each company
    total = len(tickers)
    success_count = 0
    fail_count = 0
    
    for i, ticker in enumerate(tickers):
        if ticker in existing:
            print(f"[{i+1}/{total}] {ticker} - Already in database, skipping")
            success_count += 1
            continue
        
        print(f"[{i+1}/{total}] Fetching {ticker}...", end=' ')
        
        data = fetch_company_data(ticker)
        if data:
            if save_to_database(ticker, data):
                print(f"✓ Saved ({data['name']})")
                success_count += 1
            else:
                print(f"✗ Database error")
                fail_count += 1
        else:
            print(f"✗ Failed")
            fail_count += 1
        
        # Rate limiting - be nice to Yahoo Finance
        if i < total - 1:
            time.sleep(0.5)
    
    print("\n" + "=" * 60)
    print(f"Complete! Success: {success_count}, Failed: {fail_count}")
    print("=" * 60)

if __name__ == '__main__':
    import pandas as pd
    main()
