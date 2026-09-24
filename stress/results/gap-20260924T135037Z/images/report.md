# Almadel Gap Test Report: Image-heavy product catalog
**Report ID:** gap-20260924T135037Z-images

## Purpose

Measure create/list behavior when products carry image URLs and the image upload endpoint is exercised.

## Bottom line

**PASS.** All 3 measured stages stayed inside pass thresholds.

Uploads used tiny PNG fixtures so the test measures endpoint scalability without filling disk with large photos.

## What was tested

Repeated `POST /products/images` uploads, product creates with imageUrl, and a full product list to capture response payload size.

## Results

| Stage | Concurrency | Requests | Success | Errors | Avg | P95 | Bytes | Grade |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| image-upload | 1 | 200 | 200 | 0 | 5 | 8 | 11400 | PASS |
| product-create-with-imageUrl | 1 | 200 | 200 | 0 | 6 | 8 | 83192 | PASS |
| product-list-image-catalog | 1 | 1 | 1 | 0 | 8 | 8 | 83393 | PASS |

## How to explain this to your lead

Image catalogs increase storage I/O and list payload size. Even with small synthetic PNGs, this shows whether upload and list paths remain healthy as imaged products grow.

