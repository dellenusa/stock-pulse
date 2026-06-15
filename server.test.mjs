import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSymbol, fetchStock } from "../server.mjs";

test("normalizeSymbol cleans common tickers", () => {
  assert.equal(normalizeSymbol(" aapl "), "AAPL");
  assert.equal(normalizeSymbol("^gspc"), "^GSPC");
});

test("normalizeSymbol rejects unsafe input", () => {
  assert.throws(() => normalizeSymbol("AAPL<script>"), /valid ticker/);
});

test("fetchStock maps provider data into a stable response", async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      chart: {
        result: [{
          meta: {
            symbol: "TEST",
            currency: "USD",
            regularMarketPrice: 102,
            chartPreviousClose: 100,
            regularMarketTime: 1_750_000_000
          },
          timestamp: [1_749_999_900, 1_750_000_000],
          indicators: {
            quote: [{ open: [99, 101], high: [101, 103], low: [98, 100], close: [100, 102], volume: [10, 20] }]
          }
        }],
        error: null
      }
    })
  });
  const result = await fetchStock("TEST", "1d", fakeFetch);
  assert.equal(result.price, 102);
  assert.equal(result.change, 2);
  assert.equal(result.changePercent, 2);
  assert.equal(result.points.length, 2);
});
