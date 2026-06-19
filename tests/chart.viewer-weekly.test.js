"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function makeResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
    text: async () => body,
    headers: { get: () => null },
  };
}

test("weekly flows view uses weekly labels from daily flow history beyond the last brief date", async () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../docs/index.html"), "utf8");
  const chartJs = fs.readFileSync(path.resolve(__dirname, "../docs/chart.js"), "utf8");
  const history = JSON.stringify({
    weeks: ["Jun 5"],
    weekDates: ["2026-06-05"],
    groups: [{ key: "all", label: "All" }],
    notes: "",
    assets: [
      {
        key: "usLarge",
        label: "US Large Cap",
        group: "all",
        color: "#E69F00",
        dash: "0",
        shape: "circle",
        alloc: [0],
        flowIdx: "SPY+IVV+VOO",
      },
    ],
  });
  const daily = JSON.stringify({
    series: [
      { date: "2026-06-01", flows: { usLarge: 1.0 } },
      { date: "2026-06-02", flows: { usLarge: 2.0 } },
      { date: "2026-06-09", flows: { usLarge: 3.0 } },
      { date: "2026-06-10", flows: { usLarge: 4.0 } },
    ],
  });
  const flows = JSON.stringify({ flows: {} });

  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    url: "file:///Users/ipman/Codex/macro-brief-latest/docs/index.html",
  });
  const { window } = dom;
  window.fetch = async (resource) => {
    if (resource === "data/history.json") return makeResponse(history);
    if (resource === "data/flows.json") return makeResponse(flows);
    if (resource === "data/daily-flows.json") return makeResponse(daily);
    throw new Error(`Unexpected fetch: ${resource}`);
  };

  window.eval(chartJs);
  window.Chart.init({
    history: JSON.parse(history),
    flows: JSON.parse(flows),
    dailyFlows: JSON.parse(daily),
  });

  const weeklyChip = [...window.document.querySelectorAll("#viewChips .chip")]
    .find((el) => el.textContent.includes("Weekly Flows"));
  weeklyChip.onclick();

  const textNodes = [...window.document.querySelectorAll("#chart text")].map((el) => el.textContent);
  expect(textNodes).toContain("Jun 2");
  expect(textNodes).toContain("Jun 10");
  expect(window.document.getElementById("subtitle").textContent).toContain("Jun 2");
  expect(window.document.getElementById("subtitle").textContent).toContain("Jun 10");
});
