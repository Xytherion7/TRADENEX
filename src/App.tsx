import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, BookOpen, BrainCircuit, CandlestickChart,
  Check, CircleHelp, Clock3, Download, ExternalLink, FileDown,
  FlaskConical, LayoutDashboard, Menu, Plus, Radar, RefreshCw, Search,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Wifi, WifiOff, X,
} from 'lucide-react';
import { CandleChart } from './components/CandleChart';
import { EquityCurve } from './components/EquityCurve';
import {
  connectBinanceTickerStream, DEFAULT_CRYPTO_WATCHLIST, DEFAULT_STOCK_WATCHLIST,
  fetchCryptoCandles, fetchCryptoTickers, fetchStockCandles, fetchStockQuote,
  formatCompact, formatPrice,
} from './lib/market';
import { atr, ema, rsi, runEmaBacktest } from './lib/indicators';
import { buildMarketBrief } from './lib/intelligence';
import type { Candle, Interval, JournalEntry, MarketKind, StreamStatus, Ticker } from './lib/types';

const NAV = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'scanner', label: 'Market Scanner', icon: Radar },
  { id: 'terminal', label: 'Market Terminal', icon: CandlestickChart },
  { id: 'intelligence', label: 'Market Intelligence', icon: BrainCircuit },
  { id: 'strategy', label: 'Strategy Lab', icon: FlaskConical },
  { id: 'risk', label: 'Risk Engine', icon: ShieldCheck },
  { id: 'journal', label: 'Research Journal', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type Section = typeof NAV[number]['id'];

const STORAGE = {
  cryptoWatchlist: 'tradenex.crypto-watchlist.v1',
  stockWatchlist: 'tradenex.stock-watchlist.v1',
  twelveKey: 'tradenex.twelvedata-key.v1',
  journal: 'tradenex.journal.v1',
};

function readArray<T>(key: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function money(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function signed(value: number, digits = 2): string {
  return `${value >= 0 ? '+' : ''}${money(value, digits)}%`;
}

function App() {
  const [section, setSection] = useState<Section>('overview');
  const [market, setMarket] = useState<MarketKind>('crypto');
  const [selectedSymbol, setSelectedSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState<Interval>('1h');
  const [cryptoTickers, setCryptoTickers] = useState<Ticker[]>([]);
  const [stockTickers, setStockTickers] = useState<Ticker[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingTickers, setLoadingTickers] = useState(true);
  const [loadingCandles, setLoadingCandles] = useState(true);
  const [dataError, setDataError] = useState('');
  const [cryptoUpdatedAt, setCryptoUpdatedAt] = useState<number | null>(null);
  const [stockUpdatedAt, setStockUpdatedAt] = useState<number | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(STORAGE.twelveKey) ?? '');
  const [cryptoWatchlist, setCryptoWatchlist] = useState<string[]>(() => readArray(STORAGE.cryptoWatchlist, DEFAULT_CRYPTO_WATCHLIST));
  const [stockWatchlist, setStockWatchlist] = useState<string[]>(() => readArray(STORAGE.stockWatchlist, DEFAULT_STOCK_WATCHLIST));
  const [scannerQuery, setScannerQuery] = useState('');
  const [scannerSort, setScannerSort] = useState<'volume' | 'change' | 'price'>('volume');
  const [scannerDirection, setScannerDirection] = useState<'all' | 'positive' | 'negative'>('all');
  const scannerInputRef = useRef<HTMLInputElement | null>(null);
  const [fastPeriod, setFastPeriod] = useState(9);
  const [slowPeriod, setSlowPeriod] = useState(21);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [backtestDone, setBacktestDone] = useState(false);
  const [riskEquity, setRiskEquity] = useState('10000');
  const [riskPercent, setRiskPercent] = useState('1');
  const [stopPercent, setStopPercent] = useState('2');
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => readArray(STORAGE.journal, []));
  const [journalTitle, setJournalTitle] = useState('');
  const [journalBody, setJournalBody] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  const currentTickers = market === 'crypto' ? cryptoTickers : stockTickers;
  const activeTicker = currentTickers.find((ticker) => ticker.symbol === selectedSymbol);

  const loadCrypto = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingTickers(true);
    try {
      const result = await fetchCryptoTickers();
      setCryptoTickers(result);
      setCryptoUpdatedAt(Date.now());
      setDataError('');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Unable to load crypto market data.');
    } finally {
      if (!quiet) setLoadingTickers(false);
    }
  }, []);

  const loadStocks = useCallback(async (quiet = false) => {
    if (!apiKey.trim()) {
      setStockTickers([]);
      if (!quiet) setLoadingTickers(false);
      return;
    }
    if (!quiet) setLoadingTickers(true);
    try {
      const results: Ticker[] = [];
      let firstError = '';
      // Sequential requests are gentler on entry-level market-data plans.
      // One invalid symbol should not prevent the rest of the watchlist from loading.
      for (const symbol of stockWatchlist.slice(0, 12)) {
        try { results.push(await fetchStockQuote(symbol, apiKey)); }
        catch (error) { firstError ||= error instanceof Error ? error.message : `Unable to load ${symbol}.`; }
      }
      setStockTickers(results);
      setStockUpdatedAt(Date.now());
      setDataError(results.length ? '' : firstError || 'No stock quotes returned. Check the symbol and your Twelve Data API key.');
    } catch (error) {
      setDataError(error instanceof Error ? error.message : 'Unable to load stock quotes.');
    } finally {
      if (!quiet) setLoadingTickers(false);
    }
  }, [apiKey, stockWatchlist]);

  const loadCandles = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingCandles(true);
    try {
      const result = market === 'crypto'
        ? await fetchCryptoCandles(selectedSymbol, interval)
        : await fetchStockCandles(selectedSymbol, interval, apiKey);
      setCandles(result);
      if (!result.length) setDataError('The data provider returned no candles for this instrument.');
      else setDataError('');
    } catch (error) {
      setCandles([]);
      setDataError(error instanceof Error ? error.message : 'Unable to load chart data.');
    } finally {
      if (!quiet) setLoadingCandles(false);
    }
  }, [apiKey, interval, market, selectedSymbol]);

  useEffect(() => {
    void loadCrypto();
    const stream = connectBinanceTickerStream((updates) => {
      setCryptoTickers((current) => {
        const merged = new Map(current.map((ticker) => [ticker.symbol, ticker]));
        updates.forEach((ticker) => merged.set(ticker.symbol, ticker));
        return [...merged.values()].sort((a, b) => (b.quoteVolume ?? 0) - (a.quoteVolume ?? 0));
      });
      setCryptoUpdatedAt(Date.now());
    }, setStreamStatus);
    return () => stream.close();
  }, [loadCrypto]);
  useEffect(() => {
    if (streamStatus === 'live') return;
    const id = window.setInterval(() => { void loadCrypto(true); }, 45_000);
    return () => window.clearInterval(id);
  }, [loadCrypto, streamStatus]);
  useEffect(() => {
    if (market === 'stock') void loadStocks();
  }, [market, loadStocks]);
  useEffect(() => {
    if (market !== 'stock' || !apiKey.trim()) return;
    const id = window.setInterval(() => { void loadStocks(true); }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [apiKey, loadStocks, market]);
  useEffect(() => { void loadCandles(); }, [loadCandles]);
  useEffect(() => {
    if (!candles.length) return;
    const id = window.setInterval(() => { void loadCandles(true); }, market === 'crypto' ? 60_000 : 5 * 60_000);
    return () => window.clearInterval(id);
  }, [candles.length, loadCandles, market]);
  useEffect(() => { localStorage.setItem(STORAGE.cryptoWatchlist, JSON.stringify(cryptoWatchlist)); }, [cryptoWatchlist]);
  useEffect(() => { localStorage.setItem(STORAGE.stockWatchlist, JSON.stringify(stockWatchlist)); }, [stockWatchlist]);
  useEffect(() => { localStorage.setItem(STORAGE.journal, JSON.stringify(journalEntries)); }, [journalEntries]);
  useEffect(() => { setBacktestDone(false); }, [candles, market, selectedSymbol, interval]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSection('scanner');
        window.setTimeout(() => scannerInputRef.current?.focus(), 0);
      }
      if (event.key === 'Escape' && document.activeElement === scannerInputRef.current) {
        setScannerQuery('');
        scannerInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const completedCandles = useMemo(() => candles.filter((candle) => candle.closed !== false), [candles]);
  const closeValues = useMemo(() => completedCandles.map((candle) => candle.close), [completedCandles]);
  const latestRsi = useMemo(() => {
    const values = rsi(closeValues);
    return values[values.length - 1] ?? null;
  }, [closeValues]);
  const latestAtr = useMemo(() => {
    const values = atr(completedCandles);
    return values[values.length - 1] ?? null;
  }, [completedCandles]);
  const latestEma9 = useMemo(() => {
    const values = ema(closeValues, 9);
    return values[values.length - 1] ?? null;
  }, [closeValues]);
  const latestEma21 = useMemo(() => {
    const values = ema(closeValues, 21);
    return values[values.length - 1] ?? null;
  }, [closeValues]);
  const filteredTickers = useMemo(() => currentTickers
    .filter((ticker) => `${ticker.symbol} ${ticker.label}`.toLowerCase().includes(scannerQuery.trim().toLowerCase()))
    .filter((ticker) => scannerDirection === 'all' || (scannerDirection === 'positive' ? ticker.changePct > 0 : ticker.changePct < 0))
    .sort((a, b) => scannerSort === 'change' ? b.changePct - a.changePct : scannerSort === 'price' ? b.price - a.price : (b.quoteVolume ?? b.volume ?? 0) - (a.quoteVolume ?? a.volume ?? 0))
    .slice(0, 250), [currentTickers, scannerDirection, scannerQuery, scannerSort]);
  const latestCandle = candles[candles.length - 1];
  const marketBrief = useMemo(() => buildMarketBrief(selectedSymbol, interval, candles), [selectedSymbol, interval, candles]);

  const selectTicker = (ticker: Ticker) => {
    setMarket(ticker.market);
    setSelectedSymbol(ticker.symbol);
    setSection('terminal');
    setMobileNavOpen(false);
  };

  const refreshAll = async () => {
    setBusy(true);
    try {
      await loadCrypto();
      if (market === 'stock') await loadStocks();
      await loadCandles();
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = () => {
    localStorage.setItem(STORAGE.twelveKey, apiKey.trim());
    setSettingsSaved(true);
    if (market === 'stock') void loadStocks();
    window.setTimeout(() => setSettingsSaved(false), 2400);
  };

  const addWatch = () => {
    const cleaned = market === 'crypto'
      ? scannerQuery.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      : scannerQuery.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, '').replace(/^[.-]+|[.-]+$/g, '');
    if (!cleaned) return;
    if (market === 'crypto') {
      const symbol = cleaned.endsWith('USDT') ? cleaned : `${cleaned}USDT`;
      if (!cryptoWatchlist.includes(symbol)) setCryptoWatchlist((items) => [...items, symbol]);
      setSelectedSymbol(symbol);
    } else {
      if (!stockWatchlist.includes(cleaned)) setStockWatchlist((items) => [...items, cleaned]);
      setSelectedSymbol(cleaned);
    }
    setScannerQuery('');
  };

  const removeWatch = (symbol: string) => {
    if (market === 'crypto') setCryptoWatchlist((items) => items.filter((item) => item !== symbol));
    else setStockWatchlist((items) => items.filter((item) => item !== symbol));
  };

  const saveJournal = () => {
    if (!journalTitle.trim() && !journalBody.trim()) return;
    const entry: JournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: journalTitle.trim() || 'Untitled research note',
      body: journalBody.trim(),
      symbol: selectedSymbol,
      createdAt: Date.now(),
    };
    setJournalEntries((entries) => [entry, ...entries]);
    setJournalTitle('');
    setJournalBody('');
  };

  const saveBriefToJournal = () => {
    const body = [marketBrief.summary, '', 'EVIDENCE', ...marketBrief.evidence.map((item) => `• ${item}`), '', 'CAUTIONS', ...marketBrief.cautions.map((item) => `• ${item}`)].join('\n');
    const entry: JournalEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: `${selectedSymbol} · ${interval} market context`,
      body,
      symbol: selectedSymbol,
      createdAt: Date.now(),
    };
    setJournalEntries((entries) => [entry, ...entries]);
    setSection('journal');
  };

  const exportJournal = () => {
    const blob = new Blob([JSON.stringify({ product: 'TRADENEX', exportedAt: new Date().toISOString(), entries: journalEntries }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tradenex-journal-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const exportBacktest = () => {
    if (!backtest) return;
    const rows = [
      ['entry_time_utc', 'exit_time_utc', 'return_pct'],
      ...backtest.trades.map((trade) => [new Date(trade.entryTime * 1000).toISOString(), new Date(trade.exitTime * 1000).toISOString(), trade.returnPct.toFixed(6)]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tradenex-${selectedSymbol}-${interval}-backtest.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const runBacktest = () => setBacktestDone(true);
  const backtest = backtestDone ? runEmaBacktest(candles, fastPeriod, slowPeriod, feeBps, slippageBps) : null;
  const equity = Math.max(0, Number(riskEquity) || 0);
  const riskPct = Math.min(100, Math.max(0, Number(riskPercent) || 0));
  const stopPct = Math.max(0, Number(stopPercent) || 0);
  const maxLoss = equity * riskPct / 100;
  const positionNotional = stopPct > 0 ? Math.min(equity, maxLoss / (stopPct / 100)) : 0;
  const modelledLoss = positionNotional * stopPct / 100;

  const activeNav = NAV.find((item) => item.id === section);
  const pageTitle = activeNav?.label ?? 'Overview';

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span>T</span><i/></div>
          <div className="brand-name">TRADE<span>NEX</span><small>MARKET INTELLIGENCE</small></div>
          <button className="icon-button mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18}/></button>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => { setSection(item.id); setMobileNavOpen(false); }}>
                <Icon size={17}/><span>{item.label}</span>{item.id === 'scanner' && <i className="nav-live-dot"/>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer"/>
        <div className="sidebar-data-card">
          <div className="data-card-head"><span className={`live-pulse ${streamStatus !== 'live' ? 'pulse-muted' : ''}`}/> DATA CONNECTION</div>
          <strong>{streamStatus === 'live' ? 'Binance WebSocket' : streamStatus === 'offline' ? 'REST fallback' : 'Connecting…'}</strong>
          <span className="data-card-foot">{streamStatus === 'live' ? 'Streaming · ~1 sec' : 'Retry + REST fallback'}</span>
        </div>
        <div className="sidebar-footer"><span className="version-pill">v0.4.0 · RESEARCH EDITION</span><span>Research first. Risk aware.</span></div>
      </aside>

      {mobileNavOpen && <button className="mobile-scrim" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"/>}

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={19}/></button>
            <div className="breadcrumb"><span>TRADENEX</span><b>/</b><strong>{pageTitle}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className={`connection-chip ${streamStatus === 'live' ? 'connection-live' : ''}`}><span className={`live-pulse ${(market === 'crypto' && streamStatus !== 'live') || (market === 'stock' && !apiKey) ? 'pulse-muted' : ''}`}/> <span>{market === 'crypto' ? 'CRYPTO FEED' : 'STOCK FEED'}</span><b>{market === 'crypto' ? (streamStatus === 'live' ? 'LIVE' : streamStatus.toUpperCase()) : (apiKey ? 'API POLL' : 'NO KEY')}</b></div>
            <button className={`icon-button refresh-button ${busy ? 'spinning' : ''}`} onClick={() => void refreshAll()} title="Refresh market data" aria-label="Refresh market data"><RefreshCw size={17}/></button>
            <button className="avatar-button" title="Local workspace">TN</button>
          </div>
        </header>

        <div className="page-content">
          {dataError && <div className="notice-banner"><WifiOff size={16}/><span>{dataError}</span><button onClick={() => setSection('settings')}>Check settings</button></div>}

          {section === 'overview' && (
            <>
              <div className="page-heading-row">
                <div><div className="eyebrow">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date()).toUpperCase()} · MARKET DESK</div><h1>Market overview</h1><p className="page-subtitle">A clear view of the market. Evidence first, decisions later.</p></div>
                <button className="button-secondary" onClick={() => void refreshAll()}><RefreshCw size={15}/> Refresh data</button>
              </div>
              <div className="market-switcher-row">
                <div className="segmented"><button className={market === 'crypto' ? 'selected' : ''} onClick={() => { setMarket('crypto'); setSelectedSymbol('BTCUSDT'); }}>Crypto</button><button className={market === 'stock' ? 'selected' : ''} onClick={() => { setMarket('stock'); setSelectedSymbol('AAPL'); }}>Stocks</button></div>
                <div className="updated-label"><Clock3 size={13}/> {(market === 'crypto' ? cryptoUpdatedAt : stockUpdatedAt) ? `Updated ${new Date((market === 'crypto' ? cryptoUpdatedAt : stockUpdatedAt)!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for data'}</div>
              </div>
              {market === 'crypto' ? (
                <>
                  <div className="metric-grid">
                    <MetricCard label="BTC / USDT" value={cryptoTickers.find((t) => t.symbol === 'BTCUSDT') ? formatPrice(cryptoTickers.find((t) => t.symbol === 'BTCUSDT')!.price, 'crypto') : '—'} change={cryptoTickers.find((t) => t.symbol === 'BTCUSDT')?.changePct} sub="24h rolling change"/>
                    <MetricCard label="ETH / USDT" value={cryptoTickers.find((t) => t.symbol === 'ETHUSDT') ? formatPrice(cryptoTickers.find((t) => t.symbol === 'ETHUSDT')!.price, 'crypto') : '—'} change={cryptoTickers.find((t) => t.symbol === 'ETHUSDT')?.changePct} sub="24h rolling change"/>
                    <MetricCard label="Top volume" value={cryptoTickers[0]?.label ?? '—'} sub={cryptoTickers[0] ? `${formatCompact(cryptoTickers[0].quoteVolume)} USDT quote volume` : 'Awaiting feed'}/>
                    <MetricCard label="Positive breadth" value={cryptoTickers.length ? `${((cryptoTickers.filter((t) => t.changePct > 0).length / cryptoTickers.length) * 100).toFixed(1)}%` : '—'} sub="Loaded USDT pairs with positive 24h change"/>
                  </div>
                  <div className="content-grid overview-grid">
                    <section className="panel market-panel">
                      <PanelHeader title="Market leaders" detail="Highest 24h quote volume" action={<button className="text-action" onClick={() => setSection('scanner')}>Open scanner <ArrowUpRight size={14}/></button>}/>
                      <MarketTable market="crypto" tickers={cryptoTickers.slice(0, 8)} onSelect={selectTicker} loading={loadingTickers}/>
                    </section>
                    <section className="panel brief-panel">
                      <PanelHeader title="Market brief" detail="Rule-based context · not a forecast"/>
                      <div className="brief-list">
                        <BriefItem icon={<Activity size={16}/>} title="Momentum snapshot" text={cryptoTickers.length ? `${cryptoTickers.filter((t) => t.changePct > 0).length} of ${cryptoTickers.length} loaded pairs are positive over the rolling 24h window.` : 'Waiting for current ticker data.'}/>
                        <BriefItem icon={<SlidersHorizontal size={16}/>} title="Volume concentration" text={cryptoTickers.length ? `${cryptoTickers.slice(0, 5).map((t) => t.label).join(', ')} currently lead the returned USDT pairs by quote volume.` : 'No volume ranking available yet.'}/>
                        <BriefItem icon={<CircleHelp size={16}/>} title="Read the context" text="A single indicator or market-wide breadth reading is not a reliable trading edge. Compare multiple timeframes and account for fees."/>
                      </div>
                      <div className="brief-disclaimer"><Sparkles size={14}/> Insights are descriptive, not buy/sell recommendations.</div>
                    </section>
                  </div>
                </>
              ) : (
                <StockOverview tickers={stockTickers} apiKey={apiKey} loading={loadingTickers} onOpenSettings={() => setSection('settings')} onSelect={selectTicker}/>
              )}
              <section className="panel watchlist-panel">
                <PanelHeader title="Your watchlist" detail={`${market === 'crypto' ? cryptoWatchlist.length : stockWatchlist.length} saved instruments`} action={<button className="text-action" onClick={() => setSection('terminal')}>Open terminal <ArrowUpRight size={14}/></button>}/>
                <div className="watchlist-row">
                  {(market === 'crypto' ? cryptoWatchlist : stockWatchlist).map((symbol) => {
                    const ticker = currentTickers.find((item) => item.symbol === symbol);
                    return <button key={symbol} className={`watch-chip ${selectedSymbol === symbol ? 'watch-active' : ''}`} onClick={() => ticker ? selectTicker(ticker) : (setSelectedSymbol(symbol), setSection('terminal'))}><span className="coin-avatar">{symbol.slice(0, 1)}</span><span>{symbol.replace(/USDT$/, '')}</span><b>{ticker ? formatPrice(ticker.price, market, ticker.currency) : '—'}</b></button>;
                  })}
                </div>
              </section>
            </>
          )}

          {section === 'scanner' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">DISCOVERY / MARKET UNIVERSE</div><h1>Market scanner</h1><p className="page-subtitle">Filter available instruments across the selected market. No automated trade signals.</p></div><div className="segmented"><button className={market === 'crypto' ? 'selected' : ''} onClick={() => { setMarket('crypto'); setSelectedSymbol('BTCUSDT'); }}>Crypto</button><button className={market === 'stock' ? 'selected' : ''} onClick={() => { setMarket('stock'); setSelectedSymbol('AAPL'); }}>Stocks</button></div></div>
              <div className="panel scanner-panel">
                <div className="scanner-toolbar">
                  <div className="search-field"><Search size={16}/><input ref={scannerInputRef} value={scannerQuery} onChange={(event) => setScannerQuery(event.target.value)} placeholder="Search symbol…" aria-label="Search market symbols"/><kbd>CTRL K</kbd></div>
                  <div className="sort-control"><span>24h move</span><select value={scannerDirection} onChange={(event) => setScannerDirection(event.target.value as typeof scannerDirection)}><option value="all">All assets</option><option value="positive">Positive</option><option value="negative">Negative</option></select></div>
                  <div className="sort-control"><span>Sort by</span><select value={scannerSort} onChange={(event) => setScannerSort(event.target.value as typeof scannerSort)}><option value="volume">{market === 'crypto' ? 'Quote volume' : 'Share volume'}</option><option value="change">24h change</option><option value="price">Price</option></select></div>
                  <button className="button-secondary" onClick={addWatch}><Plus size={15}/> Add current search</button>
                </div>
                <div className="table-scroll"><table className="data-table"><thead><tr><th>ASSET</th><th>LAST PRICE</th><th>24H CHANGE</th><th>24H HIGH</th><th>24H LOW</th><th>{market === 'crypto' ? 'QUOTE VOLUME' : 'SHARE VOLUME'}</th><th/></tr></thead><tbody>
                  {filteredTickers.map((ticker) => <tr key={ticker.symbol} onClick={() => selectTicker(ticker)} className="click-row"><td><div className="asset-cell"><span className="coin-avatar">{ticker.label.slice(0, 1)}</span><div><strong>{ticker.label}</strong><small>{ticker.symbol}</small></div></div></td><td className="mono">{formatPrice(ticker.price, ticker.market, ticker.currency)}</td><td><Change value={ticker.changePct}/></td><td className="mono">{formatPrice(ticker.high24h ?? 0, ticker.market, ticker.currency)}</td><td className="mono">{formatPrice(ticker.low24h ?? 0, ticker.market, ticker.currency)}</td><td className="mono">{formatCompact(ticker.quoteVolume ?? ticker.volume)} <small>{market === 'crypto' ? 'USDT' : 'shares'}</small></td><td><button className="row-open" onClick={(event) => { event.stopPropagation(); selectTicker(ticker); }}>Open <ArrowUpRight size={13}/></button></td></tr>)}
                  {!filteredTickers.length && <tr><td colSpan={7} className="empty-cell">{loadingTickers ? 'Loading market universe…' : market === 'stock' && !apiKey ? 'Add a Twelve Data API key in Settings to scan equities.' : 'No matching assets in the current data feed.'}</td></tr>}
                </tbody></table></div>
                <div className="table-foot"><span>Showing {filteredTickers.length} of {currentTickers.length} returned {market === 'crypto' ? 'USDT spot pairs' : 'equity symbols'}</span><span>{market === 'crypto' ? '24h rolling statistics' : 'Provider quote statistics'}</span></div>
              </div>
            </>
          )}

          {section === 'terminal' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">CHARTING / TECHNICAL CONTEXT</div><h1>Market terminal</h1><p className="page-subtitle">Interactive research workspace with real provider candles.</p></div><button className="button-secondary" onClick={() => void loadCandles()}><RefreshCw size={15}/> Refresh chart</button></div>
              <div className="terminal-layout">
                <section className="panel chart-panel">
                  <div className="chart-titlebar">
                    <div className="instrument-title"><span className="coin-avatar large">{selectedSymbol.slice(0, 1)}</span><div><h2>{selectedSymbol.replace(/USDT$/, '')}<span> / {market === 'crypto' ? 'USDT' : (activeTicker?.currency ?? 'STOCK')}</span></h2><small>{market === 'crypto' ? 'Binance · Spot market' : 'Twelve Data · Stock market'}</small></div></div>
                    <div className="chart-price-block"><strong>{activeTicker ? formatPrice(activeTicker.price, market, activeTicker.currency) : latestCandle ? formatPrice(latestCandle.close, market) : '—'}</strong>{activeTicker && <Change value={activeTicker.changePct}/>}</div>
                  </div>
                  <div className="chart-toolbar"><div className="timeframe-tabs">{(['15m', '1h', '4h', '1d', '1w'] as Interval[]).map((value) => <button key={value} className={interval === value ? 'selected' : ''} onClick={() => setInterval(value)}>{value}</button>)}</div><div className="chart-provider"><span className="live-pulse"/> {market === 'crypto' ? 'BINANCE' : 'TWELVE DATA'} · {candles.length} BARS</div></div>
                  <CandleChart candles={candles} loading={loadingCandles}/>
                  <div className="indicator-strip"><IndicatorMini name="RSI (14)" value={latestRsi === null ? '—' : latestRsi.toFixed(1)} hint={latestRsi === null ? 'Waiting' : latestRsi >= 70 ? 'Upper zone' : latestRsi <= 30 ? 'Lower zone' : 'Mid range'}/><IndicatorMini name="ATR (14)" value={latestAtr === null ? '—' : money(latestAtr, latestAtr < 1 ? 5 : 2)} hint="Absolute range"/><IndicatorMini name="EMA 9" value={latestEma9 === null ? '—' : money(latestEma9, latestEma9 < 1 ? 5 : 2)} hint="Fast average"/><IndicatorMini name="EMA 21" value={latestEma21 === null ? '—' : money(latestEma21, latestEma21 < 1 ? 5 : 2)} hint="Slow average"/></div>
                </section>
                <aside className="panel terminal-watchlist">
                  <PanelHeader title="Watchlist" detail={market === 'crypto' ? 'Crypto spot' : 'Equities'}/>
                  <div className="market-tabs"><button className={market === 'crypto' ? 'selected' : ''} onClick={() => { setMarket('crypto'); setSelectedSymbol('BTCUSDT'); }}>Crypto</button><button className={market === 'stock' ? 'selected' : ''} onClick={() => { setMarket('stock'); setSelectedSymbol('AAPL'); }}>Stocks</button></div>
                  {(market === 'crypto' ? cryptoWatchlist : stockWatchlist).map((symbol) => {
                    const ticker = currentTickers.find((item) => item.symbol === symbol);
                    return <div key={symbol} className="watchlist-row-item"><button className={`watchlist-item ${selectedSymbol === symbol ? 'selected' : ''}`} onClick={() => setSelectedSymbol(symbol)}><span className="coin-avatar">{symbol.slice(0, 1)}</span><span className="watchlist-name"><strong>{symbol.replace(/USDT$/, '')}</strong><small>{symbol}</small></span><span className="watchlist-value"><strong>{ticker ? formatPrice(ticker.price, market, ticker.currency) : '—'}</strong>{ticker && <small className={ticker.changePct >= 0 ? 'positive' : 'negative'}>{signed(ticker.changePct)}</small>}</span></button><button className="watchlist-remove" type="button" aria-label={`Remove ${symbol} from watchlist`} title="Remove from watchlist" onClick={() => removeWatch(symbol)}><X size={13}/></button></div>;
                  })}
                  <div className="watchlist-manage"><button className="text-action" onClick={() => setSection('settings')}>Manage data sources <ArrowUpRight size={13}/></button></div>
                  {market === 'stock' && !apiKey && <div className="inline-callout">Connect a Twelve Data key in Settings to load stock quotes and charts.</div>}
                </aside>
              </div>
            </>
          )}

          {section === 'intelligence' && (
            <>
              <div className="page-heading-row">
                <div><div className="eyebrow">RESEARCH / TRANSPARENT RULE ENGINE</div><h1>Market intelligence</h1><p className="page-subtitle">A repeatable snapshot of trend, momentum, activity and volatility — with the evidence visible.</p></div>
                <button className="button-secondary" onClick={saveBriefToJournal}><BookOpen size={15}/> Save research note</button>
              </div>
              <div className="intelligence-toolbar">
                <div className="segmented"><button className={market === 'crypto' ? 'selected' : ''} onClick={() => { setMarket('crypto'); setSelectedSymbol('BTCUSDT'); }}>Crypto</button><button className={market === 'stock' ? 'selected' : ''} onClick={() => { setMarket('stock'); setSelectedSymbol('AAPL'); }}>Stocks</button></div>
                <label className="intel-select-label">INSTRUMENT<select value={selectedSymbol} onChange={(event) => setSelectedSymbol(event.target.value)}>{[...new Set([...(market === 'crypto' ? cryptoWatchlist : stockWatchlist), selectedSymbol])].map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}</select></label>
                <div className="timeframe-tabs">{(['15m', '1h', '4h', '1d', '1w'] as Interval[]).map((value) => <button key={value} className={interval === value ? 'selected' : ''} onClick={() => setInterval(value)}>{value}</button>)}</div>
                <span className="updated-label"><Clock3 size={13}/> {marketBrief.candleCount} completed bars</span>
              </div>
              <section className="panel intelligence-hero">
                <div className="intelligence-hero-top"><div><span className="eyebrow">CURRENT CONTEXT · {selectedSymbol} · {interval}</span><h2>{marketBrief.classification}</h2></div><span className={`context-state ${marketBrief.classification === 'Positive alignment' ? 'tone-positive' : marketBrief.classification === 'Negative alignment' ? 'tone-negative' : 'tone-neutral'}`}>{marketBrief.classification === 'Insufficient history' ? 'NEED MORE DATA' : 'RULE-BASED SNAPSHOT'}</span></div>
                <p>{marketBrief.summary}</p>
                <div className="intel-disclaimer"><BrainCircuit size={15}/> Deterministic analysis, not generative AI. No price prediction, buy/sell signal or execution.</div>
              </section>
              <div className="intelligence-metric-grid">
                {marketBrief.metrics.map((metric) => <div className="panel intel-metric" key={metric.label}><span>{metric.label}</span><strong className={`tone-${metric.tone}`}>{metric.value}</strong><small>{metric.note}</small></div>)}
              </div>
              <div className="content-grid intelligence-details">
                <section className="panel"><PanelHeader title="Evidence" detail="Why the engine classified the current snapshot"/><div className="intel-list">{marketBrief.evidence.length ? marketBrief.evidence.map((item, index) => <div className="intel-list-item" key={index}><span className="intel-index">{String(index + 1).padStart(2, '0')}</span><p>{item}</p></div>) : <div className="empty-results compact-empty">Load at least 60 completed candles to calculate this context.</div>}</div></section>
                <section className="panel"><PanelHeader title="Cautions" detail="What can make this snapshot misleading"/><div className="intel-list">{marketBrief.cautions.map((item, index) => <div className="intel-list-item caution-item" key={index}><CircleHelp size={15}/><p>{item}</p></div>)}</div><div className="intel-footnote">Calculated {new Date(marketBrief.generatedAt).toLocaleTimeString()} · {marketBrief.candleCount} completed candles</div></section>
              </div>
            </>
          )}

          {section === 'strategy' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">RESEARCH / HISTORICAL SIMULATION</div><h1>Strategy lab</h1><p className="page-subtitle">Test a simple EMA crossover against loaded historical candles.</p></div><span className="simulation-label"><FlaskConical size={14}/> SIMULATION ONLY</span></div>
              <div className="strategy-layout">
                <section className="panel strategy-config">
                  <PanelHeader title="Test configuration" detail={`${selectedSymbol} · ${interval}`}/>
                  <div className="form-grid"><label>Fast EMA period<input type="number" min="2" max="100" value={fastPeriod} onChange={(event) => { setFastPeriod(Math.min(100, Math.max(2, Number.parseInt(event.target.value || '2', 10))));  setBacktestDone(false); }}/></label><label>Slow EMA period<input type="number" min="3" max="200" value={slowPeriod} onChange={(event) => { setSlowPeriod(Math.min(200, Math.max(3, Number.parseInt(event.target.value || '3', 10))));  setBacktestDone(false); }}/></label><label>Fee per side (bps)<input type="number" min="0" max="500" value={feeBps} onChange={(event) => { setFeeBps(Math.min(500, Math.max(0, Number.parseInt(event.target.value || '0', 10)))); setBacktestDone(false); }}/></label><label>Slippage per side (bps)<input type="number" min="0" max="500" value={slippageBps} onChange={(event) => { setSlippageBps(Math.min(500, Math.max(0, Number.parseInt(event.target.value || '0', 10)))); setBacktestDone(false); }}/></label><label>Completed candles<input value={`${candles.filter((candle) => candle.closed !== false).length} / ${candles.length} loaded`} readOnly/></label></div>
                  <div className="strategy-rule"><strong>Rules</strong><span>Signals are evaluated after a completed candle. Entries and exits fill at the next candle open. The spot-style model uses full available capital, applies per-side fees and slippage, and excludes unfinished candles.</span></div>
                  <button className="button-primary full-button" onClick={runBacktest} disabled={!candles.length || fastPeriod < 2 || slowPeriod <= fastPeriod}><FlaskConical size={16}/> Run historical test</button>
                  <p className="microcopy">Educational historical simulation only. It does not model market impact, taxes, partial fills or gaps within a candle. Results are not a forecast or investment recommendation.</p>
                </section>
                <section className="panel results-panel">
                  <PanelHeader title="Simulation results" detail={backtestDone ? 'Computed from currently loaded candles' : 'Run a test to calculate metrics'}/>
                  {!backtestDone ? <div className="empty-results"><div className="empty-icon"><Activity size={22}/></div><strong>Awaiting simulation</strong><span>Choose your parameters and run the test to see the historical results.</span></div> : backtest ? <>
                    <div className="results-grid"><ResultMetric label="Net return" value={signed(backtest.netReturnPct)} tone={backtest.netReturnPct >= 0 ? 'positive' : 'negative'}/><ResultMetric label="Buy & hold baseline" value={signed(backtest.benchmarkReturnPct)} tone={backtest.benchmarkReturnPct >= 0 ? 'positive' : 'negative'}/><ResultMetric label="Win rate" value={`${money(backtest.winRate, 1)}%`}/><ResultMetric label="Profit factor" value={Number.isFinite(backtest.profitFactor) ? backtest.profitFactor.toFixed(2) : '∞'}/><ResultMetric label="Max drawdown" value={`${money(backtest.maxDrawdown, 2)}%`} tone="negative"/><ResultMetric label="Expectancy / trade" value={signed(backtest.expectancy)}/><ResultMetric label="Trades" value={String(backtest.trades.length)}/><ResultMetric label="Market exposure" value={`${money(backtest.exposurePct, 1)}%`}/></div>
                    <div className="equity-panel-head"><strong>Equity curve</strong><button className="text-action" onClick={exportBacktest} disabled={!backtest.trades.length}><FileDown size={14}/> Export trades CSV</button></div><EquityCurve points={backtest.equityCurve}/>
                    {backtest.trades.length > 0 && <div className="recent-trades-panel"><PanelHeader title="Recent simulated trades" detail={`Last ${Math.min(10, backtest.trades.length)} of ${backtest.trades.length} completed trades`}/><div className="table-scroll"><table className="data-table recent-trades-table"><thead><tr><th>ENTRY (UTC)</th><th>EXIT (UTC)</th><th>NET SIMULATED RETURN</th></tr></thead><tbody>{backtest.trades.slice(-10).reverse().map((trade, index) => <tr key={`${trade.entryTime}-${trade.exitTime}-${index}`}><td className="mono">{new Date(trade.entryTime * 1000).toISOString().replace('T', ' ').slice(0, 16)}</td><td className="mono">{new Date(trade.exitTime * 1000).toISOString().replace('T', ' ').slice(0, 16)}</td><td><span className={trade.returnPct >= 0 ? 'positive mono' : 'negative mono'}>{signed(trade.returnPct, 3)}</span></td></tr>)}</tbody></table></div></div>}
                    <div className="result-note"><CircleHelp size={15}/>{backtest.trades.length ? 'Compare against the cost-adjusted buy-and-hold baseline and inspect the trade sample. Drawdown is marked at completed candle closes with estimated exit costs; intrabar extremes, market impact and taxes are not modelled.' : 'No EMA crossovers were detected in the loaded window.'}</div>
                  </> : <div className="empty-results">Not enough candle history or parameters are invalid.</div>}
                </section>
              </div>
              <section className="panel methodology-panel"><PanelHeader title="Methodology checks" detail="Model assumptions and limitations"/><div className="method-grid"><MethodStatus ok title="Next-bar execution" text="Signals use completed bars and fill on the following candle open."/><MethodStatus ok title="Fees and slippage" text="Configurable per-side costs are applied to entry and exit."/><MethodStatus ok title="Incomplete candles" text="Unfinished candles are excluded from signal generation and scoring."/><MethodStatus ok={false} title="Out-of-sample validation" text="Walk-forward splits and robustness tests are not included yet."/></div></section>
            </>
          )}

          {section === 'risk' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">RESEARCH / EXPOSURE MODELLING</div><h1>Risk engine</h1><p className="page-subtitle">Educational position-size arithmetic. No orders or broker connection.</p></div><span className="simulation-label"><ShieldCheck size={14}/> MODEL ONLY</span></div>
              <div className="risk-layout">
                <section className="panel risk-input-panel"><PanelHeader title="Scenario inputs" detail="Change values to model a hypothetical position"/><div className="risk-fields"><label>Hypothetical account value <div className="input-with-prefix"><span>$</span><input type="number" min="0" value={riskEquity} onChange={(event) => setRiskEquity(event.target.value)}/></div></label><label>Risk budget <div className="input-with-suffix"><input type="number" min="0" max="100" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(event.target.value)}/><span>%</span></div></label><label>Stop distance <div className="input-with-suffix"><input type="number" min="0.01" max="100" step="0.1" value={stopPercent} onChange={(event) => setStopPercent(event.target.value)}/><span>%</span></div></label></div><div className="risk-warning"><CircleHelp size={16}/><span>Hypothetical arithmetic only. Position notional is capped at the account value (no leverage). A stop does not guarantee an exit price or cap losses during gaps, illiquidity or fast markets.</span></div></section>
                <section className="panel risk-output-panel"><PanelHeader title="Scenario output" detail="Arithmetic based on your inputs"/><div className="risk-output-main"><span>Hypothetical loss budget</span><strong>{money(maxLoss)} <small>USD</small></strong><div className="risk-progress"><i style={{ width: `${Math.min(100, riskPct * 10)}%` }}/></div></div><div className="risk-output-row"><span>Implied position notional</span><strong>{stopPct > 0 ? money(positionNotional) : '—'} USD</strong></div><div className="risk-output-row"><span>Modelled loss at stop distance</span><strong>{money(modelledLoss)} USD</strong></div><div className="risk-output-row"><span>Stop distance</span><strong>{money(stopPct, 2)}%</strong></div><div className="risk-output-row"><span>Risk budget</span><strong>{money(riskPct, 2)}%</strong></div><div className="risk-output-row"><span>Account allocation cap</span><strong>100% · No leverage</strong></div></section>
              </div>
              <section className="panel risk-explainer"><div className="explainer-icon"><ShieldCheck size={18}/></div><div><strong>Risk is not the same as certainty</strong><p>Position-size calculations are only as reliable as their assumptions. Market gaps, spread, execution quality, leverage and correlations can cause real outcomes to differ substantially from a simple model.</p></div></section>
            </>
          )}

          {section === 'journal' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">WORKSPACE / PERSONAL RESEARCH</div><h1>Research journal</h1><p className="page-subtitle">Save hypotheses, observations and post-test notes locally on this PC.</p></div><span className="local-label">LOCAL ONLY</span></div>
              <div className="journal-layout">
                <section className="panel journal-compose"><PanelHeader title="New research note" detail={`Attached instrument · ${selectedSymbol}`}/><label>Title<input value={journalTitle} onChange={(event) => setJournalTitle(event.target.value)} placeholder="What are you investigating?"/></label><label>Observation<textarea value={journalBody} onChange={(event) => setJournalBody(event.target.value)} placeholder="Write down the hypothesis, evidence, timeframe and what would invalidate it…" rows={7}/></label><button className="button-primary full-button" onClick={saveJournal} disabled={!journalTitle.trim() && !journalBody.trim()}><Plus size={16}/> Save note locally</button><p className="microcopy">Notes stay in this Windows app profile. They are not uploaded to a cloud account.</p></section>
                <section className="panel journal-list"><PanelHeader title="Saved notes" detail={`${journalEntries.length} entries`} action={<button className="text-action" onClick={exportJournal} disabled={!journalEntries.length}><Download size={14}/> Export JSON</button>}/>{journalEntries.length ? journalEntries.map((entry) => <article className="journal-entry" key={entry.id}><div className="journal-entry-head"><span className="journal-symbol">{entry.symbol}</span><time>{new Date(entry.createdAt).toLocaleString()}</time><button className="icon-button danger-icon" onClick={() => setJournalEntries((items) => items.filter((item) => item.id !== entry.id))} title="Delete note" aria-label="Delete note"><Trash2 size={14}/></button></div><h3>{entry.title}</h3><p>{entry.body || 'No additional details.'}</p></article>) : <div className="empty-results compact-empty"><div className="empty-icon"><BookOpen size={22}/></div><strong>Your journal is empty</strong><span>Save your first market observation on the left.</span></div>}</section>
              </div>
            </>
          )}

          {section === 'settings' && (
            <>
              <div className="page-heading-row"><div><div className="eyebrow">APPLICATION / PREFERENCES</div><h1>Settings</h1><p className="page-subtitle">Manage data connections and your local research workspace.</p></div><span className="version-pill">TRADENEX 0.4.0</span></div>
              <div className="settings-layout">
                <section className="panel settings-panel"><PanelHeader title="Stock market data" detail="Twelve Data provider"/><div className="provider-banner"><div className="provider-logo">12</div><div><strong>Twelve Data</strong><span>Stock quotes and historical candles. A provider API key is required.</span></div><a href="https://twelvedata.com/" target="_blank" rel="noreferrer" className="external-link">Provider site <ExternalLink size={13}/></a></div><label className="settings-label">API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your Twelve Data API key" autoComplete="off"/></label><div className="settings-note"><CircleHelp size={15}/><span>The key is saved in this Windows user profile's WebView local storage. Do not share this project folder with your key added, and do not paste it into public screenshots. This early build does not use Windows Credential Manager.</span></div><div className="settings-action-row"><button className="button-primary" onClick={saveSettings}>{settingsSaved ? <Check size={15}/> : <Download size={15}/>} {settingsSaved ? 'Saved' : 'Save data settings'}</button><button className="button-secondary" onClick={() => { setApiKey(''); localStorage.removeItem(STORAGE.twelveKey); setStockTickers([]); setSettingsSaved(false); }}>Forget key</button></div></section>
                <section className="panel settings-panel"><PanelHeader title="Crypto market data" detail="Public market endpoints"/><div className="provider-row"><div className="provider-logo binance-mark">B</div><div className="provider-copy"><strong>Binance public market data</strong><span>REST snapshot + incremental public WebSocket mini-ticker stream. No trading permissions.</span></div><span className={`status-tag ${streamStatus === 'live' ? 'ok' : 'warn'}`}>{streamStatus === 'live' ? 'LIVE STREAM' : streamStatus.toUpperCase()}</span></div><div className="settings-note"><Wifi size={15}/><span>TRADENEX reads public market data only. It does not connect to exchange accounts, place orders or request withdrawal permissions.</span></div></section>
                <section className="panel settings-panel"><PanelHeader title="Local workspace" detail="This device only"/><div className="storage-stat"><span>Saved research notes</span><strong>{journalEntries.length}</strong></div><div className="storage-stat"><span>Crypto watchlist items</span><strong>{cryptoWatchlist.length}</strong></div><div className="storage-stat"><span>Stock watchlist items</span><strong>{stockWatchlist.length}</strong></div><button className="button-secondary danger-button" onClick={() => { if (window.confirm('Clear saved journal notes and both watchlists on this PC?')) { setJournalEntries([]); setCryptoWatchlist(DEFAULT_CRYPTO_WATCHLIST); setStockWatchlist(DEFAULT_STOCK_WATCHLIST); } }}><Trash2 size={15}/> Reset local workspace</button></section>
                <section className="panel settings-panel about-panel"><PanelHeader title="About TRADENEX" detail="Early access build"/><p>TRADENEX is a market-research and educational simulation tool. Values are supplied by third-party providers and may be delayed, incomplete or unavailable. Nothing in this app is financial advice.</p><div className="about-meta"><span>Build</span><strong>0.4.0 · Windows desktop</strong><span>Execution</span><strong>Disabled</strong><span>Cloud sync</span><strong>Not configured</strong></div></section>
              </div>
            </>
          )}

          <footer className="app-footer"><span>TRADENEX 0.4.0</span><span>Market data may be delayed or incomplete. For research and education only.</span><span>{(market === 'crypto' ? cryptoUpdatedAt : stockUpdatedAt) ? `Last ${market === 'crypto' ? 'crypto' : 'stock'} update ${new Date((market === 'crypto' ? cryptoUpdatedAt : stockUpdatedAt)!).toLocaleTimeString()}` : 'No market snapshot yet'}</span></footer>
        </div>
      </main>
    </div>
  );
}

function MetricCard({ label, value, change, sub }: { label: string; value: string; change?: number; sub: string }) {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong>{value}</strong><div className="metric-bottom">{change !== undefined ? <Change value={change}/> : <span className="metric-context">{sub}</span>}{change !== undefined && <span className="metric-context">{sub}</span>}</div><div className="metric-spark"><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div>;
}

function PanelHeader({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="panel-header"><div><h2>{title}</h2>{detail && <span>{detail}</span>}</div>{action}</div>;
}

function Change({ value }: { value: number }) {
  const positive = value >= 0;
  return <span className={`change-value ${positive ? 'positive' : 'negative'}`}>{positive ? <ArrowUpRight size={13}/> : <ArrowDownRight size={13}/>} {signed(value)}</span>;
}

function MarketTable({ market, tickers, onSelect, loading }: { market: MarketKind; tickers: Ticker[]; onSelect: (ticker: Ticker) => void; loading: boolean }) {
  const stockMode = market === 'stock';
  return <div className="table-scroll"><table className="data-table compact-table"><thead><tr><th>ASSET</th><th>PRICE</th><th>24H</th><th>{stockMode ? 'SHARE VOL.' : 'QUOTE VOL.'}</th></tr></thead><tbody>{tickers.map((ticker) => <tr key={ticker.symbol} className="click-row" onClick={() => onSelect(ticker)}><td><div className="asset-cell"><span className="coin-avatar">{ticker.label.slice(0, 1)}</span><div><strong>{ticker.label}</strong><small>{ticker.symbol}</small></div></div></td><td className="mono">{formatPrice(ticker.price, ticker.market, ticker.currency)}</td><td><Change value={ticker.changePct}/></td><td className="mono">{formatCompact(ticker.quoteVolume ?? ticker.volume)} <small>{stockMode ? 'shares' : 'USDT'}</small></td></tr>)}{!tickers.length && <tr><td colSpan={4} className="empty-cell">{loading ? 'Loading market feed…' : 'No market data available.'}</td></tr>}</tbody></table></div>;
}

function BriefItem({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="brief-item"><div className="brief-icon">{icon}</div><div><strong>{title}</strong><p>{text}</p></div></div>;
}

function StockOverview({ tickers, apiKey, loading, onOpenSettings, onSelect }: { tickers: Ticker[]; apiKey: string; loading: boolean; onOpenSettings: () => void; onSelect: (ticker: Ticker) => void }) {
  if (!apiKey) return <div className="panel connect-panel"><div className="connect-icon"><Activity size={24}/></div><h2>Connect stock market data</h2><p>Stock quotes are not bundled or fabricated. Add your own Twelve Data API key to load current quotes and historical candles.</p><button className="button-primary" onClick={onOpenSettings}>Open data settings <ArrowUpRight size={15}/></button></div>;
  return <div className="panel market-panel"><PanelHeader title="Tracked equities" detail="Quotes returned by Twelve Data"/><MarketTable market="stock" tickers={tickers} onSelect={onSelect} loading={loading}/></div>;
}

function IndicatorMini({ name, value, hint }: { name: string; value: string; hint: string }) {
  return <div className="indicator-mini"><span>{name}</span><strong>{value}</strong><small>{hint}</small></div>;
}

function ResultMetric({ label, value, tone }: { label: string; value: string; tone?: 'positive' | 'negative' }) {
  return <div className="result-metric"><span>{label}</span><strong className={tone ?? ''}>{value}</strong></div>;
}

function MethodStatus({ ok, title, text }: { ok: boolean; title: string; text: string }) {
  return <div className="method-status"><span className={ok ? 'method-ok' : 'method-no'}>{ok ? <Check size={14}/> : <CircleHelp size={14}/>}</span><div><strong>{title}</strong><p>{text}</p></div></div>;
}

export default App;
