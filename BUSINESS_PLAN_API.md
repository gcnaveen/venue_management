# Business Plan API

Monthly expected targets vs actual performance (venue-level).

## Endpoints

- `GET /api/venues/{venueId}/business-plan?month=5&year=2026`
- `POST /api/venues/{venueId}/business-plan`
- `GET /api/venues/{venueId}/business-plan/yearly?year=2026`

Auth: `owner` and `incharge` (venue-scoped)

## Request / response behavior

### GET Monthly

- Returns saved plan rows for month/year.
- Also attaches computed:
  - `actualBookings`
  - `actualBusiness`
  - `actualExpenses`

If no plan exists, returns:

```json
{
  "success": true,
  "data": {
    "venueId": "…",
    "month": 5,
    "year": 2026,
    "rows": []
  }
}
```

### POST Monthly (upsert)

Body:

```json
{
  "month": 5,
  "year": 2026,
  "rows": [
    {
      "rowType": "venue_buyout",
      "spaceId": null,
      "spaceName": "Complete Venue Buyout",
      "expectedBookings": 10,
      "expectedBusiness": 500000,
      "expectedExpenses": 100000
    }
  ]
}
```

Rules:
- Upsert by `{ venueId, month, year }`
- Replaces entire `rows` array each save

Response:
- Same shape as monthly GET (includes computed actuals)

### GET Yearly Summary

Returns only months that have either:
- saved expected plan, or
- any actual data in that month

Each month row includes:
- `totalExpectedBookings`
- `totalExpectedBusiness`
- `totalExpectedExpenses`
- `totalActualBookings`
- `totalActualBusiness`
- `totalActualExpenses`

## Actual calculation rules implemented

### Monthly row actuals

- Quote bookings/revenue:
  - source: `quotes`
  - filter: `confirmed=true`, `eventWindow.startAt` in month/year, `venueId`
- `venue_buyout` row:
  - bookings/revenue from `bookingType=venue_buyout`
  - business adds commission inflow
  - expenses includes commission outflow + labour amount
- `space` row:
  - bookings/revenue from `bookingType=space_buyout` and matching `spaceId`
  - expenses currently 0 at space-row level (no space mapping in commissions/labours schema)

### Yearly summary actuals (month totals)

- bookings = confirmed quotes count
- business = quote revenue + commission inflow
- expenses = commission outflow + labour amount

