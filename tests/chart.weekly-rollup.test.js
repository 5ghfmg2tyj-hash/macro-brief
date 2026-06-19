const { buildWeeklyFlowRollups } = require("../docs/chart.js");

test("buildWeeklyFlowRollups sums trailing 7-day daily flows for each history anchor", () => {
  const history = {
    weekDates: ["2026-04-13", "2026-04-20", "2026-06-05"],
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
      { date: "2026-06-05", flows: { usLarge: -0.5, cash: 0.2 } },
    ],
  };

  const weekly = buildWeeklyFlowRollups(history, dailyFlows);

  expect(weekly.usLarge).toEqual([1.5, 0.7, 1.5]);
  expect(weekly.cash).toEqual([0.6, 0.8, 1.1]);
  expect(weekly.commod).toEqual([null, null, null]);
});
