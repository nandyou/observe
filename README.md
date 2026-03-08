Recommended API Response Structure for your /metrics/volumetrics endpoint:
```
{
  "meta": {
    "generatedAt": "2026-03-08T12:00:00Z",
    "window": "1h",
    "resolution": "5m"
  },
  "summary": {
    "totalRequests": 142830,
    "totalSuccess": 139200,
    "totalFailures": 3630,
    "p99LatencyMs": 712,
    "activeEndpoints": 8
  },
  "timeSeries": {
    "labels": ["11:00", "11:05", "11:10", "..."]
  },
  "endpoints": [
    {
      "method": "GET",
      "path": "/api/v1/users",
      "service": "user-service",
      "successCount": 18400,
      "failureByStatus": {
        "400": 12, "401": 5, "403": 2,
        "404": 88, "429": 3,
        "500": 14, "502": 6, "503": 2
      },
      "p99LatencyMs": 245,
      "timeSeries": {
        "success": [210, 195, 230, "..."],
        "fail4xx": [8, 12, 6, "..."],
        "fail5xx": [2, 0, 3, "..."]
      }
    }
  ]
}


```

File breakdown:

```
index.html — pure structure only. Has the static header markup and the #mainContent mount point. Loads the font, Chart.js CDN, then links dashboard.css and dashboard.js.
dashboard.css — all design tokens (CSS variables), layout, component styles, animations, and responsive breakpoints, grouped into clearly labelled sections with comments.
dashboard.js — all logic split into distinct, commented sections:

mockApiResponse() — the data layer (swap for a real fetch())
buildTimeSeriesChart() / buildDonutChart() — chart builders
renderTable() / sortTable() — table rendering and sort state
renderSummary() — summary card HTML generation
renderDashboard() — orchestrates a full re-render
loadData() — the single integration point for your real API

```
