"use strict";

const { __test } = require("../electron/fetch-live");
const { __test: briefTest } = require("../electron/generate-brief");

test("startOfYearIso uses the current year from the provided date", () => {
  expect(__test.startOfYearIso("2027-08-10")).toBe("2027-01-01");
});

test("summarizeFlowSeries keeps historical windows populated even when today's daily flow is unavailable", () => {
  const summary = __test.summarizeFlowSeries([
    {
      date: "2026-01-15",
      flows: { usLarge: 1.0, usSmid: 0.2, cash: null },
    },
    {
      date: "2026-04-20",
      flows: { usLarge: 2.0, usSmid: 0.3, cash: null },
    },
    {
      date: "2026-04-24",
      flows: { usLarge: -0.5, usSmid: 0.1, cash: null },
    },
    {
      date: "2026-04-25",
      flows: { usLarge: null, usSmid: null, cash: null },
    },
  ], "2026-04-25");

  expect(summary.usLarge.daily).toBeNull();
  expect(summary.usLarge.wow).toBe(1.5e9);
  expect(summary.usLarge.mom).toBe(1.5e9);
  expect(summary.usLarge.mo6).toBe(2.5e9);
  expect(summary.usLarge.yoy).toBe(2.5e9);
  expect(summary.usSmid.wow).toBe(0.4e9);
  expect(summary.cash.wow).toBeNull();
});

test("renderMoneyFlowSnapshot includes numeric totals from available flow data", () => {
  const markdown = briefTest.renderMoneyFlowSnapshot({
    usLarge: { daily: 1.2e9, wow: 2.5e9, mom: 3.0e9, mo6: 4.0e9, yoy: 5.0e9 },
    usSmid:  { daily: null, wow: 0.5e9, mom: null, mo6: 1.0e9, yoy: 1.5e9 },
    cash:    { daily: 0.3e9, wow: null, mom: 0.8e9, mo6: 1.1e9, yoy: 1.6e9 },
  });

  expect(markdown).toContain("| US Large Cap | SPY+IVV+VOO | +$1.20B | +$2.50B | +$3.00B | +$4.00B | +$5.00B |");
  expect(markdown).toContain("| **Total** | — | **+$1.50B** | **+$3.00B** | **+$3.80B** | **+$6.10B** | **+$8.10B** |");
});

test("mergeBriefWithSnapshot replaces a model-authored snapshot section", () => {
  const merged = briefTest.mergeBriefWithSnapshot(
    "## Money Flow Snapshot\n\nold table\n\n## Macro Cycle Assessment\n\nBody",
    { usLarge: { wow: 2.5e9 } }
  );

  expect(merged).toContain("## Money Flow Snapshot");
  expect(merged).toContain("## Macro Cycle Assessment");
  expect(merged).not.toContain("old table");
  expect(merged).toContain("+$2.50B");
});

test("buildRetryFailureMessage preserves the real OpenAI error details", () => {
  const err = new Error("OpenAI API 429: Rate limit reached for gpt-4o — retrying…");

  expect(briefTest.buildRetryFailureMessage("OpenAI", err))
    .toBe("OpenAI request failed after 4 attempts. OpenAI API 429: Rate limit reached for gpt-4o Please wait a few minutes and try again.");
});
