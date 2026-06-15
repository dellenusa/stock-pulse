# Stock Pulse for ChatGPT

Stock Pulse is a fast, read-only MCP tool for current stock quotes and price movement. It includes:

- `get_stock_quote` for latest available price, daily change, market state, and timestamp.
- `get_stock_history` for intraday and long-range chart data.
- A responsive dashboard that can render inside ChatGPT or run in a browser.
- Five-second in-memory caching to keep repeat questions fast.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm start
```

Open `http://127.0.0.1:8787`. The MCP endpoint is `http://127.0.0.1:8787/mcp`.

Run tests with:

```powershell
npm test
```

## Connect it to ChatGPT

ChatGPT needs a publicly reachable HTTPS MCP endpoint; it cannot connect directly to `127.0.0.1`.

1. Deploy this folder to a Node-compatible host such as Render, Railway, Fly.io, or your own server.
2. Set the start command to `npm start` and expose the host-provided `PORT`.
3. Confirm `https://YOUR-HOST/health` returns `{"ok":true,...}`.
4. In ChatGPT, open **Settings > Apps & Connectors > Advanced settings** and enable developer mode if your plan or workspace permits it.
5. Create a custom app/connector and enter `https://YOUR-HOST/mcp` as the MCP server URL.
6. Start a new chat, enable Stock Pulse, and ask: “Use Stock Pulse to show AAPL’s movement today.”

Exact ChatGPT labels can vary by plan and workspace policy. A workspace administrator may need to allow custom apps.

The included `Dockerfile` is ready for container hosts. It binds the server to `0.0.0.0` and honors a host-provided `PORT`.

## Data and safety

The default adapter reads Yahoo Finance chart data without credentials. Quotes can be delayed by the exchange or provider and are not suitable for order execution. Every response includes its source and timestamp.

For production or commercial use, replace `fetchStock` with a licensed market-data provider and keep the response shape unchanged. This tool is read-only and does not place trades.
