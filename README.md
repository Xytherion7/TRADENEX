# TRADENEX 0.4.0 — Market Intelligence Terminal

TRADENEX is a Windows desktop market-research and educational historical-simulation workspace for public crypto-market data and user-configured equity data. It is deliberately **research-only**: it does not connect to brokerage accounts, submit orders, hold funds, use leverage, or provide personalized financial recommendations.

## User installation: one file

The intended user-facing release is a single file: **`TRADENEX-Setup-x64.exe`**. The end user runs that installer once. It installs the compiled desktop app, creates Start Menu shortcuts and registers an uninstaller. Node.js, Rust, Visual Studio, C++ Build Tools, npm packages and developer scripts are build-machine requirements only; they are not required on a user's computer.

The NSIS bundle uses Tauri's `downloadBootstrapper` WebView2 mode. The installer invokes Microsoft's WebView2 bootstrapper only when the runtime is not already present. Windows 11 normally includes the Evergreen WebView2 runtime. TRADENEX does not download development dependencies on each application launch. Internet access is needed for remote market data.

**Release status:** this repository/archive contains source code and a Windows build workflow, not a compiled installer. A Windows runner must complete the release build before the single-file installer can be distributed. Do not rename this source archive to `.exe`.

## What's new in 0.4.0

- **Interactive chart engine:** replaced the static SVG plot with TradingView Lightweight Charts 5.3.0. Includes native candlesticks, volume, EMA 9/21 overlays, crosshair OHLC readout, mouse-wheel zoom, drag-to-pan, touch gestures and resize handling. The required TradingView attribution logo remains visible.
- **Chart state preservation:** candle refreshes preserve the user's zoom/scroll position when they are inspecting older history and follow the newest bars when the view was already at the right edge.
- **Scanner controls:** symbol search, working `Ctrl+K` shortcut, 24-hour positive/negative filters and sort by price, change or the correct volume field. Watchlist instruments can be removed directly, and equity class symbols such as `BRK.B` retain their separators.
- **Market breadth:** Overview now reports the percentage of returned crypto pairs with a positive rolling 24-hour change instead of presenting a pair count as a market insight.
- **Research journal and backtest exports:** journal JSON export and a CSV trade log, plus a recent-trades table.
- **Stronger data validation:** invalid OHLC bars and non-finite indicator values are rejected before they can poison calculations; duplicate timestamps are rejected in simulations. Indicators and market briefs use completed candles, not an unfinished bar. Stock ticker timestamps are separated from crypto stream updates, and stock quotes refresh at a measured five-minute cadence.
- **More accurate stock quotes:** the UI uses the currency code returned by the stock data provider rather than blindly labelling every quote as USD. Custom stock symbols preserve class separators such as `BRK.B`.
- **More conservative drawdown accounting:** open simulation positions are marked net of estimated exit fees and slippage.
- **Automated core tests:** a Vitest suite covers indicator initialization, flat/rising/falling RSI, ATR/MACD output, invalid inputs, unfinished-candle exclusion, duplicate timestamps, transaction-cost treatment and the market-context rule engine.
- **Current stable frontend baseline:** React 19.3.1, Vite 8.3.8, TypeScript 7.0.2, Tauri 2.12.x and Lightweight Charts 5.3.0, pinned to explicit package versions in `package.json`.

## App navigation

1. **Overview** — current market snapshot, leaders, breadth and local watchlists.
2. **Market Scanner** — filter the selected market by symbol and 24-hour direction; sort by price, change or volume.
3. **Market Terminal** — interactive candles, volume, EMA overlays and RSI/ATR readouts.
4. **Market Intelligence** — transparent rule-based context with evidence and limitations. It is not a generative AI model or forecast.
5. **Strategy Lab** — simplified historical simulation, cost-adjusted benchmark, equity curve, trade log and CSV export.
6. **Risk Engine** — hypothetical arithmetic only, without leverage or execution.
7. **Research Journal** — local research notes and JSON export.
8. **Settings** — provider key and local workspace controls.

## Data providers

### Cryptocurrency

The app reads public Binance spot market data. It first requests a REST 24-hour ticker snapshot, then merges incremental public `!miniTicker@arr` WebSocket updates. If the stream is unavailable, it retries with bounded backoff and falls back to periodic REST snapshots. The socket is rotated before Binance's documented 24-hour connection lifetime. It never requests Binance account credentials or trading permissions. Provider coverage, rate limits and availability can change.

### Equities

Stock quotes and candles use Twelve Data. Open **Settings → Stock market data** and supply a provider API key with appropriate access. The early desktop build stores this data-only key in the current Windows user's WebView local storage; it does not yet use Windows Credential Manager. Do not publish screenshots containing the key or commit it to source control. Quotes may be delayed depending on provider plan and exchange entitlements.

## Research and simulation limitations

- The charting library is an interactive display component; it does not make the data complete, real-time or exchange-certified. Data availability and delays depend on the provider and its plan.
- The strategy model is long-only, spot-style, fully invested and uses the loaded candle sample. It models per-side fees and slippage but not market impact, spread dynamics, taxes, funding, partial fills, intrabar path or broker execution.
- Drawdown is marked at completed candle closes net of estimated exit costs; intrabar extremes can be worse. The final open simulation position is liquidated at the last completed close with the configured exit costs.
- A small backtest sample can be misleading. Walk-forward validation and out-of-sample robustness analysis are not included yet.
- Risk calculations are hypothetical arithmetic, not a recommendation or guaranteed maximum loss.
- AI chat, cloud sync, broker connections, order execution, leverage, derivatives and mobile versions are not part of this build.

TRADENEX is not affiliated with Binance or Twelve Data. Lightweight Charts is an open-source TradingView library; see `NOTICE` for its attribution notice and the chart's visible TradingView link.

## Build the single-file Windows installer (maintainers)

The workflow in `.github/workflows/build-windows.yml` builds on `windows-latest`. The temporary runner has Node.js, stable Rust and MSVC build tooling; those tools are never installed on the end user's PC.

1. Put this source tree in a GitHub repository.
2. Run **Actions → Build TRADENEX for Windows → Run workflow**, or push a tag such as `v0.4.0`.
3. Download only the generated `TRADENEX-Setup-x64.exe` from the workflow artifact / release.

The Windows build itself must complete and be tested on a Windows 11 machine before distribution. An unsigned first-party installer may still trigger Windows SmartScreen; signing requires a legitimate code-signing certificate.
