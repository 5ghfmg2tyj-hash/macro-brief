"use strict";

const { __test } = require("../electron/fetch-live");

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
