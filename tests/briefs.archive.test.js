"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const index = require("../docs/briefs/index.json");

function response(body, json = true) {
  return {
    ok: true,
    status: 200,
    json: async () => (json ? JSON.parse(body) : body),
    text: async () => body,
    headers: { get: () => null },
  };
}

test("retrospective brief archive is newest-first and every entry has a file", () => {
  expect(index.briefs[0].slug).toBe("2026-10-23");

  const dates = index.briefs.map((brief) => brief.date);
  expect(dates).toEqual([...dates].sort().reverse());
  for (const brief of index.briefs) {
    expect(fs.existsSync(path.join(root, "docs/briefs", `${brief.slug}.md`))).toBe(true);
  }
});

test("brief page loads October 23 and lists all nine retrospectives", async () => {
  const html = fs.readFileSync(path.join(root, "docs/index.html"), "utf8");
  const liveJs = fs.readFileSync(path.join(root, "docs/live.js"), "utf8");
  const chartJs = fs.readFileSync(path.join(root, "docs/chart.js"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "docs/app.js"), "utf8");
  const history = fs.readFileSync(path.join(root, "docs/data/history.json"), "utf8");
  const flows = fs.readFileSync(path.join(root, "docs/data/flows.json"), "utf8");
  const daily = fs.readFileSync(path.join(root, "docs/data/daily-flows.json"), "utf8");
  const shares = fs.readFileSync(path.join(root, "docs/data/shares-history.json"), "utf8");

  const dom = new JSDOM(html, { runScripts: "dangerously", url: "https://example.test/" });
  const { window } = dom;
  window.macroBrief = { isElectron: false };
  window.fetch = async (resource) => {
    if (resource === "data/history.json") return response(history);
    if (resource === "data/flows.json") return response(flows);
    if (resource === "data/daily-flows.json") return response(daily);
    if (resource === "data/shares-history.json") return response(shares);
    if (resource === "briefs/index.json") return response(JSON.stringify(index));
    if (String(resource).startsWith("briefs/")) {
      const file = path.join(root, "docs", String(resource));
      return response(fs.readFileSync(file, "utf8"), false);
    }
    throw new Error(`Unexpected fetch: ${resource}`);
  };

  window.eval(liveJs);
  window.eval(chartJs);
  window.eval(appJs);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  await new Promise((resolve) => setTimeout(resolve, 40));

  expect(window.document.getElementById("brief-title").textContent).toContain("October 23, 2026");
  const links = [...window.document.querySelectorAll("#brief-history a")];
  expect(links.filter((link) => link.dataset.slug >= "2026-08-28")).toHaveLength(9);
  expect(window.document.getElementById("brief-body").textContent).toContain("Small caps rebounded");
});
