import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const CACHE_MS = Number(process.env.QUOTE_CACHE_MS || 5000);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();

const RANGE_INTERVALS = {
  "1d": "1m",
  "5d": "5m",
  "1mo": "30m",
  "3mo": "1d",
  "6mo": "1d",
  "1y": "1d",
  "5y": "1wk"
};

export function normalizeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9.^=-]{1,15}$/.test(symbol)) {
    throw new Error("Enter a valid ticker, such as AAPL, MSFT, SPY, or ^GSPC.");
  }
  return symbol;
}

function normalizeRange(value) {
  const range = String(value || "1d");
  if (!RANGE_INTERVALS[range]) {
    throw new Error(`Range must be one of: ${Object.keys(RANGE_INTERVALS).join(", ")}.`);
  }
  return range;
}

function round(value, digits = 4) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function summarizeChart(payload, symbol, range) {
  const result = payload?.chart?.result?.[0];
  if (!result) {
    throw new Error(payload?.chart?.error?.description || `No market data found for ${symbol}.`);
  }

  const meta = result.meta || {};
  const quote = result.indicators?.quote?.[0] || {};
  const adjclose = result.indicators?.adjclose?.[0]?.adjclose || [];
  const timestamps = result.timestamp || [];
  const points = timestamps.flatMap((timestamp, index) => {
    const close = adjclose[index] ?? quote.close?.[index];
    if (!Number.isFinite(close)) return [];
    return [{
      timestamp: new Date(timestamp * 1000).toISOString(),
      open: round(quote.open?.[index]),
      high: round(quote.high?.[index]),
      low: round(quote.low?.[index]),
      close: round(close),
      volume: Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : null
    }];
  });

  const price = meta.regularMarketPrice ?? points.at(-1)?.close;
  const previousClose = meta.chartPreviousClose ?? meta.previousClose;
  const change = Number.isFinite(price) && Number.isFinite(previousClose)
    ? price - previousClose
    : null;

  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    marketState: meta.marketState || null,
    price: round(price),
    previousClose: round(previousClose),
    change: round(change),
    changePercent: Number.isFinite(change) && previousClose
      ? round((change / previousClose) * 100, 2)
      : null,
    dayHigh: round(meta.regularMarketDayHigh),
    dayLow: round(meta.regularMarketDayLow),
    fiftyTwoWeekHigh: round(meta.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: round(meta.fiftyTwoWeekLow),
    asOf: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString()
      : points.at(-1)?.timestamp || new Date().toISOString(),
    range,
    interval: RANGE_INTERVALS[range],
    points,
    source: "Yahoo Finance chart data"
  };
}

export async function fetchStock(symbolInput, rangeInput = "1d", fetchImpl = fetch) {
  const symbol = normalizeSymbol(symbolInput);
  const range = normalizeRange(rangeInput);
  const key = `${symbol}:${range}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.savedAt < CACHE_MS) return cached.value;

  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", RANGE_INTERVALS[range]);
  url.searchParams.set("includePrePost", "true");
  url.searchParams.set("events", "div,splits");

  const response = await fetchImpl(url, {
  headers: {
    "Accept": "application/json",
    "User-Agent": "StockPulse/1.0"
  }
});

console.log("Fetching:", url.toString());
console.log("Yahoo status:", response.status);
  if (!response.ok) throw new Error(`Market data provider returned HTTP ${response.status}.`);

  const value = summarizeChart(await response.json(), symbol, range);
  cache.set(key, { savedAt: Date.now(), value });
  return value;
}

function toolDefinitions() {
  return [
    {
      name: "get_stock_quote",
      title: "Get stock quote",
      description: "Get the latest available price, daily movement, market state, and timestamp for a stock, ETF, or index ticker.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, for example AAPL, SPY, or ^GSPC." }
        },
        required: ["symbol"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: {
          resourceUri: "ui://stock-pulse/dashboard.html",
          visibility: ["model", "app"]
        },
        "openai/outputTemplate": "ui://stock-pulse/dashboard.html",
        "openai/toolInvocation/invoking": "Checking the market",
        "openai/toolInvocation/invoked": "Market data loaded"
      }
    },
    {
      name: "get_stock_history",
      title: "View stock movement",
      description: "Get timestamped price history and movement metrics for charting a stock, ETF, or index.",
      inputSchema: {
        type: "object",
        properties: {
          symbol: { type: "string", description: "Ticker symbol, for example NVDA or QQQ." },
          range: {
            type: "string",
            enum: Object.keys(RANGE_INTERVALS),
            default: "1d",
            description: "Chart period."
          }
        },
        required: ["symbol"],
        additionalProperties: false
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: {
        ui: {
          resourceUri: "ui://stock-pulse/dashboard.html",
          visibility: ["model", "app"]
        },
        "openai/outputTemplate": "ui://stock-pulse/dashboard.html",
        "openai/toolInvocation/invoking": "Loading price movement",
        "openai/toolInvocation/invoked": "Price movement loaded"
      }
    }
  ];
}

async function widgetHtml() {
  return readFile(path.join(ROOT, "public", "index.html"), "utf8");
}

async function handleRpc(message) {
  const { id, method, params = {} } = message || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });

  try {
    if (method === "initialize") {
      return ok({
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "stock-pulse", version: "1.0.0" }
      });
    }
    if (method === "notifications/initialized") return null;
    if (method === "ping") return ok({});
    if (method === "tools/list") return ok({ tools: toolDefinitions() });
    if (method === "resources/list") {
      return ok({
        resources: [{
          uri: "ui://stock-pulse/dashboard.html",
          name: "Stock Pulse dashboard",
          mimeType: "text/html;profile=mcp-app"
        }]
      });
    }
    if (method === "resources/read") {
      if (params.uri !== "ui://stock-pulse/dashboard.html") return fail(-32002, "Resource not found.");
      return ok({
        contents: [{
          uri: params.uri,
          mimeType: "text/html;profile=mcp-app",
          text: await widgetHtml(),
          _meta: {
            ui: { prefersBorder: true },
            "openai/widgetDescription": "An interactive stock price and movement chart.",
            "openai/widgetPrefersBorder": true
          }
        }]
      });
    }
    if (method === "tools/call") {
      const symbol = params.arguments?.symbol;
      const range = params.name === "get_stock_quote" ? "1d" : params.arguments?.range || "1d";
      if (!["get_stock_quote", "get_stock_history"].includes(params.name)) {
        return fail(-32602, "Unknown tool.");
      }
      const data = await fetchStock(symbol, range);
      const compact = { ...data };
      if (params.name === "get_stock_quote") delete compact.points;
      return ok({
        content: [{
          type: "text",
          text: `${data.symbol} is ${data.price} ${data.currency || ""}, ${data.changePercent >= 0 ? "up" : "down"} ${Math.abs(data.changePercent ?? 0)}% from the previous close. Data timestamp: ${data.asOf}.`
        }],
        structuredContent: data,
        _meta: { quote: compact }
      });
    }
    return fail(-32601, `Method not found: ${method}`);
  } catch (error) {
    return fail(-32000, error instanceof Error ? error.message : "Unexpected market data error.");
  }
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export function createStockServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "content-type, mcp-protocol-version",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
        });
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/") {
        const html = await widgetHtml();
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return response.end(html);
      }
      if (request.method === "GET" && url.pathname === "/api/stock") {
        return sendJson(response, 200, await fetchStock(url.searchParams.get("symbol"), url.searchParams.get("range")));
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, service: "stock-pulse" });
      }
      if (request.method === "POST" && url.pathname === "/mcp") {
        const result = await handleRpc(await readJson(request));
        if (!result) {
          response.writeHead(202);
          return response.end();
        }
        return sendJson(response, 200, result);
      }
      return sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      return sendJson(response, 500, { error: error instanceof Error ? error.message : "Unexpected error" });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createStockServer().listen(PORT, HOST, () => {
    console.log(`Stock Pulse running at http://${HOST}:${PORT}`);
    console.log(`MCP endpoint: http://${HOST}:${PORT}/mcp`);
  });
}
