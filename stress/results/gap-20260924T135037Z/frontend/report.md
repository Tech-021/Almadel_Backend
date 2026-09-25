# Almadel Gap Test Report: Frontend network path and client session
**Report ID:** gap-20260924T135037Z-frontend

## Purpose

Measure end-user-facing network path timing for the public Almadel web app plus a client-perceived API session chain against the stress API.

## Bottom line

**Mostly stable with warnings.** 1 WARNING stage(s), 2 PASS, 0 FAIL.

Authenticated UI against almadel_stress was simulated via API client session because Vercel still targets the normal API.

## What was tested

Document loads for the public Vercel frontend, and a browser-equivalent session chain (health + authenticated product/staff reads) against the local stress API.

## Notes

- Public frontend measured at https://web-app-allmadal.vercel.app. That deployment may still point at a non-stress API.
- Authenticated page flows against the stress database were simulated as a client session chain directly to the stress API, because the public frontend is not wired to almadel_stress.
- Local port 3000 is a different product (tech-021), not the Almadel web app.

## Results

| Stage | Concurrency | Requests | Success | Errors | Avg | P95 | Bytes | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| frontend / | 1 | 10 | 10 | 0 | 225 | 1315 | 196270 | WARNING |
| frontend /login | 1 | 10 | 10 | 0 | 19 | 25 | 196270 | PASS |
| client session chain against stress API | 1 | 3 | 3 | 0 | 6 | 9 | 83416 | PASS |

## How to explain this to your lead

Backend-only numbers miss CDN/frontend latency. This suite adds that layer, while being explicit that the public frontend is not wired to the stress database.

