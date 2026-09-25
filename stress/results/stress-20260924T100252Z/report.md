# Almadel stress report stress-20260924T100252Z

## Executive Summary

- The stages that completed stayed inside the pass thresholds, and inventory checks matched expected quantities.
- Highest concurrency exercised in a completed stage: 0.
- Highest concurrency that still graded PASS: 0.
- API load and database volume are separate measurements. This report only includes suites that were executed in the run.

## Environment

- Date: 2026-09-24T10:02:52.873Z
- Profile: smoke
- Base URL: http://127.0.0.1:4000
- Git: undefined
- Node: undefined
- Host: undefined (undefined)
- CPUs: undefined
- Memory free / total MB: undefined / undefined
- PostgreSQL: unavailable
- Database connections (active/idle/total): - / - / -
- Cache hit ratio: -
- Deadlocks counter: -

## Dataset

- No dataset counts collected.

## Business API Results

Not run.

## Team-Member API Results

Not run.

## Product API Results

Not run.

## Stock API Results

Not run.

## Inventory Correctness

No inventory correctness checks were recorded in this run.

## Large Dataset Performance

Not run. Seed a dataset, then run `npm run stress:reads` with STRESS_READ_TARGET=seed.

## Mixed Workload

Not run.

## Error Analysis

No failed requests were recorded.

## Bottlenecks

- Email timings were not recorded by the API process. Team-create latency includes whatever mail path that server used. Start the API with NODE_ENV=stress and STRESS_TEST=true so credential mail uses the in-process sink.

## Stop Conditions

No ramp was stopped early.

## Thresholds

- PASS: error rate under 1% and p95 under 1 second, with no integrity failure.

- WARNING: error rate from 1% to 5%, or p95 from 1 to 3 seconds.

- FAIL: error rate above 5%, p95 above 3 seconds, or a data-integrity failure.

## Recommendations

These are follow-ups from the measurements above. They were not applied.

- Email timings were not recorded by the API process. Team-create latency includes whatever mail path that server used. Start the API with NODE_ENV=stress and STRESS_TEST=true so credential mail uses the in-process sink.
