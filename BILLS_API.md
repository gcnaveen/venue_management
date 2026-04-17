# Bills (EMI) API

This module tracks monthly EMI status for recurring bills (per venue).

## Endpoints

- `GET /api/venues/{venueId}/bills`
- `POST /api/venues/{venueId}/bills`
- `GET /api/venues/{venueId}/bills/{billId}`
- `PATCH /api/venues/{venueId}/bills/{billId}`
- `PATCH /api/venues/{venueId}/bills/{billId}/emi-status` (upsert one month/year)
- `DELETE /api/venues/{venueId}/bills/{billId}` (soft delete)

Auth: Admin / Incharge / Owner (venue-scoped)

## Bill fields

- `name` (string, required)
- `emi_end_date` (date, required)
- `emiType` (string, required)
- `emiDate` (date, required) — EMI start date
- `defaultAmount` (number, required)
- `emiStatus[]` (optional) — monthly override + payment tracking

### EMI status item

```json
{
  "month": 4,
  "year": 2026,
  "emiAmount": 15000,
  "paid": true,
  "amountPaid": 15000,
  "remarks": "Paid on time",
  "paymentMode": "Cash",
  "paymentDate": "2026-04-05T00:00:00.000Z"
}
```

Notes:
- `paymentMode` accepts `Cash` / `Account` (stored internally as `cash` / `account`).

## Create bill

`POST /api/venues/{venueId}/bills`

```json
{
  "name": "Generator EMI",
  "emi_end_date": "2026-12-31T00:00:00.000Z",
  "emiType": "monthly",
  "emiDate": "2026-01-05T00:00:00.000Z",
  "defaultAmount": 15000
}
```

## Upsert EMI month status

`PATCH /api/venues/{venueId}/bills/{billId}/emi-status`

```json
{
  "month": 4,
  "year": 2026,
  "emiAmount": 15000,
  "paid": true,
  "amountPaid": 15000,
  "remarks": "Paid",
  "paymentMode": "Account",
  "paymentDate": "2026-04-05T00:00:00.000Z"
}
```

If that month/year already exists it is replaced; otherwise it is added.

## Totals in responses

All GET/POST/PATCH responses include:
- `totalEmiAmount` = sum of `emiStatus[].emiAmount`
- `totalPaid` = sum of `emiStatus[].amountPaid`
- `remainingAmount` = `totalEmiAmount - totalPaid`
