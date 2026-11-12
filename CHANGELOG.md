# Changelog

## 0.4.0 — 2026-11-12

- Replaced the static chart mockup with an interactive candlestick chart engine.
- Added crosshair OHLC readout, volume, EMA overlays, pan/zoom and chart viewport preservation.
- Added scanner search shortcut, direction filters, sorting and direct watchlist removal.
- Added transparent rule-based market context, backtest trade log and export paths.
- Tightened candle, indicator and simulation input validation.
- Marked open simulation positions net of estimated exit costs when calculating drawdown.
- Separated crypto and stock data freshness timestamps; refreshed stock quotes on a five-minute schedule while the stock market is selected.
- Preserved stock share-class separators and provider quote currency.
- Added unit tests for indicators, market context and historical simulation edge cases.
- Pinned frontend and desktop dependencies and configured a Windows NSIS artifact workflow.
