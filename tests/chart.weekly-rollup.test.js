const { buildWeeklyFlowRollups } = require("../docs/chart.js");

test("buildWeeklyFlowRollups aggregates populated daily flows into calendar-week buckets", () => {
  const history = {
    assets: [
      { key: "usLarge" },
      { key: "cash" },
      { key: "commod" },
    ],
  };

  const dailyFlows = {
    series: [
      { date: "2026-04-07", flows: { usLarge: 1.2, cash: 0.1 } },
      { date: "2026-04-10", flows: { usLarge: -0.2, cash: 0.2 } },
      { date: "2026-04-13", flows: { usLarge: 0.5, cash: 0.3 } },
      { date: "2026-04-14", flows: { usLarge: 0.1, cash: -0.1 } },
      { date: "2026-04-17", flows: { usLarge: 0.2, cash: 0.4 } },
      { date: "2026-04-20", flows: { usLarge: 0.4, cash: 0.5 } },
      { date: "2026-06-03", flows: { usLarge: 2.0, cash: 0.9 } },
      { date: "2026-06-04", flows: { usLarge: -0.5, cash: 0.2 } },
      { date: "2026-06-05", flows: { usLarge: -0.5, cash: 0.2 } },
      { date: "2026-06-18", flows: { usLarge: null, cash: null } },
    ],
  };

  const weekly = buildWeeklyFlowRollups(history, dailyFlows);

  expect(weekly.labels).toEqual(["Apr 10", "Apr 17", "Apr 20", "Jun 5"]);
  expect(weekly.dates).toEqual(["2026-04-10", "2026-04-17", "2026-04-20", "2026-06-05"]);
  expect(weekly.seriesByAsset.usLarge).toEqual([1.0, 0.8, 0.4, 1.0]);
  expect(weekly.seriesByAsset.cash).toEqual([0.3, 0.6, 0.5, 1.3]);
  expect(weekly.seriesByAsset.commod).toEqual([null, null, null, null]);
});
