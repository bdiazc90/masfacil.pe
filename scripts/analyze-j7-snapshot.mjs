#!/usr/bin/env node

import { readFileSync } from "node:fs";

const snapshotPath = process.argv[2] ?? "evidence/j7-lima-10kg-2026-08-14.json";
const cutoff = process.argv[3] ?? "2026-08-14";
const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));

const parseDate = (value) => {
  const [day, month, year] = value.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
};

const cutoffEpoch = Date.parse(`${cutoff}T00:00:00Z`);
const ages = Object.entries(snapshot.date_counts)
  .flatMap(([date, count]) => Array(count).fill(Math.floor((cutoffEpoch - parseDate(date)) / 86_400_000)))
  .sort((a, b) => a - b);

const quantileR7 = (probability) => {
  const position = (ages.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return ages[lower] + fraction * (ages[Math.min(lower + 1, ages.length - 1)] - ages[lower]);
};

const histogramTotal = (histogram, multiplier = (key) => Number(key)) =>
  Object.entries(histogram).reduce((sum, [key, groups]) => sum + multiplier(key) * groups, 0);

const exact = snapshot.exact_row_multiplicity_histogram;
const distributor = snapshot.distributor_multiplicity_histogram;
const yearCounts = Object.entries(snapshot.date_counts).reduce((result, [date, count]) => {
  const year = date.slice(-4);
  result[year] = (result[year] ?? 0) + count;
  return result;
}, {});

const checks = {
  dates_equal_row_count: ages.length === snapshot.row_count,
  exact_rows_equal_row_count: histogramTotal(exact) === snapshot.row_count,
  distributor_rows_equal_row_count: histogramTotal(distributor) === snapshot.row_count,
};

if (Object.values(checks).includes(false)) {
  throw new Error(`Snapshot inconsistente: ${JSON.stringify(checks)}`);
}

const duplicateEntries = Object.entries(exact).filter(([multiplicity]) => Number(multiplicity) > 1);
const result = {
  cutoff,
  rows: snapshot.row_count,
  unique_distributors: histogramTotal(distributor, () => 1),
  age_days_r7: {
    min: ages[0],
    p25: quantileR7(0.25),
    median: quantileR7(0.5),
    p75: quantileR7(0.75),
    max: ages.at(-1),
  },
  older_than_180_days: {
    count: ages.filter((age) => age > 180).length,
    percentage: Number((100 * ages.filter((age) => age > 180).length / ages.length).toFixed(1)),
  },
  older_than_365_days: {
    count: ages.filter((age) => age > 365).length,
    percentage: Number((100 * ages.filter((age) => age > 365).length / ages.length).toFixed(1)),
  },
  year_counts: yearCounts,
  exact_duplicates: {
    groups: duplicateEntries.reduce((sum, [, groups]) => sum + groups, 0),
    excess_rows: duplicateEntries.reduce((sum, [multiplicity, groups]) => sum + (Number(multiplicity) - 1) * groups, 0),
    occurrences_in_duplicate_groups: duplicateEntries.reduce((sum, [multiplicity, groups]) => sum + Number(multiplicity) * groups, 0),
  },
  price_ranges: snapshot.price_ranges,
  checks,
};

console.log(JSON.stringify(result, null, 2));
