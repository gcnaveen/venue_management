# Venue Management API — API documentation

**Version:** 1.0.0  
**Base URLs:**  
- Local: `http://localhost:3000`  
- Production: `https://<api-id>.execute-api.ap-south-1.amazonaws.com`

---

## Overview

Production-grade Serverless API (AWS Lambda + API Gateway HTTP API) for Venue Management.

**Roles**
- **Admin** — Full access: users, venues, block/unblock incharge.
- **Incharge** — Register/login with email + password; manages assigned venue and venue profile (logo, tagline, address, social, legal).

**Authentication**
- **Incharge:** Register via `POST /api/auth/register`. Optional `venueId` to assign to a venue.
- **Admin:** Created via script/DB; login with email + password.
- **Login:** `POST /api/auth/login` with email + password. Returns JWT.
- Protected endpoints: `Authorization: Bearer <token>`.

---

## Authentication

### Register Incharge  
`POST /api/auth/register`  
No auth.

Create an Incharge account. Email, password, name required. Optional `venueId`. Returns user and JWT.

**Request body (JSON)**
| Field    | Type   | Required | Description                    |
|----------|--------|----------|--------------------------------|
| email    | string | ✓        | Email                          |
| password | string | ✓        | Min 8 chars                    |
| name     | string | ✓        | Display name                   |
| venueId  | string |          | Optional venue to assign       |

**Example**
```json
{
  "email": "incharge@venue.com",
  "password": "SecureP@ss1",
  "name": "Venue Manager",
  "venueId": "507f1f77bcf86cd799439011"
}
```

**Responses:** 201 (created), 400 (bad request), 409 (conflict).

---

### Login  
`POST /api/auth/login`  
No auth.

Login with email + password. Returns user and JWT (Admin and Incharge).

**Request body (JSON)**
| Field    | Type   | Required |
|----------|--------|----------|
| email    | string | ✓        |
| password | string | ✓        |

**Responses:** 200 (success), 401 (unauthorized), 403 (forbidden).

---

### Get current user  
`GET /api/auth/me`  
**Auth:** Bearer token.

Returns the authenticated user from JWT.

**Responses:** 200 (user), 401 (unauthorized).

---

## Users (Admin only)

### Create user (Admin)  
`POST /api/users`  
**Auth:** Bearer (Admin).

**Use this URL, not** `POST /api/auth/register` (register always creates incharge). If a user has not registered, Admin can create them with email, password, name and role (admin or incharge). For incharge, optionally set `venueId` to assign to a venue.

**Request body (JSON)**
| Field    | Type   | Required | Description                    |
|----------|--------|----------|--------------------------------|
| email    | string | ✓        | Email (must be unique)         |
| password | string | ✓        | Min 8 chars                    |
| name     | string | ✓        | Display name                   |
| role     | string | ✓        | `admin` or `incharge`          |
| venueId  | string |          | Optional; for incharge only    |

**Example**
```json
{
  "email": "incharge@venue.com",
  "password": "SecureP@ss1",
  "name": "Venue Manager",
  "role": "incharge",
  "venueId": "507f1f77bcf86cd799439011"
}
```

**Responses:** 201 (created user, no token), 400 (validation), 401, 403, 409 (email already registered).

---

### List users  
`GET /api/users`  
**Auth:** Bearer (Admin).

**Responses:** 200 (list), 401, 403.

---

### Get user by ID  
`GET /api/users/{userId}`  
**Auth:** Bearer (Admin).  
**Path:** `userId` — User ObjectId.

**Responses:** 200 (user), 401, 403, 404.

---

### Update user  
`PATCH /api/users/{userId}`  
**Auth:** Bearer (Admin).  
Partial update: name, email, role, venueId.

**Request body (JSON)** — at least one:
| Field   | Type   | Description        |
|---------|--------|--------------------|
| name    | string |                    |
| email   | string |                    |
| role    | string | `admin`, `incharge` |
| venueId | string | nullable            |

**Responses:** 200, 400, 401, 403, 404.

---

### Delete user  
`DELETE /api/users/{userId}`  
**Auth:** Bearer (Admin).

**Responses:** 200, 401, 403, 404.

---

### Block user  
`POST /api/users/{userId}/block`  
**Auth:** Bearer (Admin).

**Responses:** 200, 400, 401, 403, 404.

---

### Unblock user  
`POST /api/users/{userId}/unblock`  
**Auth:** Bearer (Admin).

**Responses:** 200, 401, 403, 404.

---

## Venues

### Create venue  
`POST /api/venues`  
**Auth:** Bearer (**Admin only**).

**Request body (JSON)**
| Field    | Type    | Description |
|----------|---------|-------------|
| name     | string  | Required    |
| isActive | boolean | Default true |
| metadata | object  | Optional    |

**Note:** Venue contact/address/social info is managed via **venue profile** endpoints by the incharge (`PUT /api/profile/venue` or `PUT /api/venues/{venueId}/profile`).

**Responses:** 201 (created), 400, 401, 403.

---

### List venues  
`GET /api/venues`  
**Auth:** Bearer.  
Admin: all venues; Incharge: only assigned venue.

**Responses:** 200 (list), 401, 403.

---

### Get venue by ID  
`GET /api/venues/{venueId}`  
**Auth:** Bearer.  
**Path:** `venueId` — Venue ObjectId.

**Responses:** 200 (venue), 401, 403, 404.

---

### Update venue  
`PATCH /api/venues/{venueId}`  
**Auth:** Bearer (**Admin only**).

**Request body (JSON)** — at least one: name, isActive, metadata.

**Note:** Venue contact/address/social info is managed via **venue profile** endpoints by the incharge.

**Responses:** 200, 400, 401, 403, 404.

---

### Delete venue  
`DELETE /api/venues/{venueId}`  
**Auth:** Bearer (Admin).

**Responses:** 200, 401, 403, 404.

---

## Spaces (multiple spaces per venue)

One venue can have many spaces. Admin can manage any venue’s spaces; Incharge only their assigned venue.

### Add space to a venue  
`POST /api/venues/{venueId}/spaces`  
**Auth:** Bearer.  
**Path:** `venueId` — Venue ObjectId.

**Request body (JSON)**
| Field       | Type    | Required | Description        |
|-------------|---------|----------|--------------------|
| name        | string  | ✓        | Space name         |
| description | string  |          |                    |
| capacity    | number  |          | Capacity (e.g. seats) |
| dimensions  | string  |          | e.g. 40ft x 60ft                        |
| images      | array   |          | Array of image URLs (S3 public URLs)    |
| isActive    | boolean |          | Default true       |
| metadata    | object  |          |                    |

**Example**
```json
{
  "name": "Main Hall",
  "description": "Large event space",
  "capacity": 200,
  "dimensions": "40ft x 60ft",
  "images": ["https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/.../hall-1.jpg"],
  "isActive": true
}
```

**Responses:** 201 (created), 400, 401, 403, 404.

---

### List spaces for a venue  
`GET /api/venues/{venueId}/spaces`  
**Auth:** Bearer.  
**Path:** `venueId` — Venue ObjectId.

**Responses:** 200 (array of spaces), 401, 403, 404.

---

### Get space by ID  
`GET /api/venues/{venueId}/spaces/{spaceId}`  
**Auth:** Bearer.  
**Path:** `venueId`, `spaceId` — ObjectIds.

**Responses:** 200 (space), 401, 403, 404.

---

### Update space  
`PATCH /api/venues/{venueId}/spaces/{spaceId}`  
**Auth:** Bearer.

**Request body (JSON)** — at least one: name, description, capacity, dimensions, images, isActive, metadata.

**Responses:** 200, 400, 401, 403, 404.

---

### Delete space  
`DELETE /api/venues/{venueId}/spaces/{spaceId}`  
**Auth:** Bearer.

**Responses:** 200, 401, 403, 404.

---

## Profile (venue profile — Incharge)

### Get current venue profile  
`GET /api/profile/venue`  
**Auth:** Bearer.  
**Query:** `venueId` (optional) — Required for Admin when not incharge.

Incharge: their venue’s profile. Admin: pass `venueId` to get that venue’s profile.

**Responses:** 200 (profile), 400, 401, 403, 404.

---

### Create or update venue profile  
`PUT /api/profile/venue`  
**Auth:** Bearer.

Upsert venue profile. Incharge: their venue only. Admin: pass `venueId` in body.  
Fields: logo, venueName, tagline, description, address, googleMapUrl, email, instagram, facebook, website, **contactPersons**, legal (businessName, gst).

**Request body (JSON)**
| Field       | Type   | Description                          |
|-------------|--------|--------------------------------------|
| venueId     | string | Required for Admin on PUT /api/profile/venue |
| logo        | string |                                      |
| venueName   | string |                                      |
| tagline     | string |                                      |
| description | string |                                      |
| address     | object | line1, line2, city, state, pincode, country |
| googleMapUrl| string |                                      |
| email       | string |                                      |
| instagram   | string |                                      |
| facebook    | string |                                      |
| website     | string |                                      |
| contactPersons | array | List of contact people (name, designation, contactNumber) |
| legal       | object | businessName, gst                    |

**Responses:** 200, 400, 401, 403.

---

### Get venue profile by venue ID  
`GET /api/venues/{venueId}/profile`  
**Auth:** Bearer.  
**Path:** `venueId` — Venue ObjectId.

**Responses:** 200 (profile), 401, 403, 404.

---

### Create or update venue profile by venue ID  
`PUT /api/venues/{venueId}/profile`  
**Auth:** Bearer.  
**Path:** `venueId` — Venue ObjectId.  
Incharge can only update their assigned venue.

**Request body (JSON):** Same as PUT /api/profile/venue (venueId in path).

**Responses:** 200, 400, 401, 403, 404.

---

### Contact persons (Venue profile)

Contact persons are stored separately and linked to the venue profile using `venueId`.

Send `contactPersons` in the profile PUT body:

```json
{
  "contactPersons": [
    { "name": "John Doe", "designation": "Manager", "contactNumber": "+91-9876543210" },
    { "name": "Jane", "designation": "Reception", "contactNumber": "9876500000" }
  ]
}
```

To **update** an existing contact person, include its `_id`:

```json
{
  "contactPersons": [
    { "_id": "507f1f77bcf86cd799439012", "name": "John Doe", "designation": "GM", "contactNumber": "+91-9876543210" }
  ]
}
```

To **delete** a contact person:

- Incharge (current venue): `DELETE /api/profile/venue/contact-persons/{contactPersonId}`
- Admin (by venue): `DELETE /api/venues/{venueId}/profile/contact-persons/{contactPersonId}`

---

## Contact persons (separate CRUD APIs)

If you want direct CRUD (instead of using profile PUT), use these endpoints:

- **Create:** `POST /api/venues/{venueId}/contact-persons`
- **List:** `GET /api/venues/{venueId}/contact-persons`
- **Get one:** `GET /api/venues/{venueId}/contact-persons/{contactPersonId}`
- **Update:** `PATCH /api/venues/{venueId}/contact-persons/{contactPersonId}`
- **Delete:** `DELETE /api/venues/{venueId}/contact-persons/{contactPersonId}`

**Body (create):**

```json
{ "name": "John Doe", "designation": "Manager", "contactNumber": "+91-9876543210" }
```

**Body (patch):**

```json
{ "designation": "GM" }
```

---

## Uploads (S3)

Bucket: **venuemanagementdhruva** (ap-south-1). Only `image/*` content types are accepted.

**Upload flow:**
1. Call `POST /api/uploads/presign` to get a presigned PUT URL.
2. `PUT` the raw file binary directly to `uploadUrl` from the client (set the `Content-Type` header).
3. Save the returned `key` or `publicUrl` in MongoDB against your venue / space.

---

### Get presigned upload URL  
`POST /api/uploads/presign`  
Auth: Admin or Incharge.

**Request body (JSON)**
| Field       | Type    | Required | Description                                              |
|-------------|---------|----------|----------------------------------------------------------|
| fileName    | string  | ✓        | Original filename (sanitized server-side)                |
| contentType | string  | ✓        | MIME type — must be `image/*` (e.g. `image/jpeg`)       |
| entityId    | string  |          | MongoDB `_id` of the entity (venueId, spaceId, etc.)    |
| expiresIn   | number  |          | URL validity in seconds (1–3600). Default: 900 (15 min) |

**Example request**
```json
{
  "fileName": "venue-logo.jpg",
  "contentType": "image/jpeg",
  "entityId": "507f1f77bcf86cd799439011",
  "expiresIn": 900
}
```

**Example response**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/507f.../uuid-venue-logo.jpg?X-Amz-...",
    "key": "uploads/images/507f1f77bcf86cd799439011/uuid-venue-logo.jpg",
    "publicUrl": "https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/507f.../uuid-venue-logo.jpg",
    "expiresIn": 900
  }
}
```

Then from the client (Postman / frontend):
```
PUT <uploadUrl>
Content-Type: image/jpeg
Body: <raw file binary>
```

---

### Delete uploaded file  
`DELETE /api/uploads`  
Auth: Admin or Incharge.

Only keys under the `uploads/` prefix are allowed (prevents deleting arbitrary bucket objects).

**Request body (JSON)**
| Field | Type   | Required | Description                                    |
|-------|--------|----------|------------------------------------------------|
| key   | string | ✓        | S3 key returned from `POST /api/uploads/presign` |

**Example request**
```json
{
  "key": "uploads/images/507f1f77bcf86cd799439011/uuid-venue-logo.jpg"
}
```

**Example response**
```json
{
  "success": true,
  "data": { "deleted": true, "key": "uploads/images/..." }
}
```

---

## Leads

Event enquiries / leads per venue. Created by Incharge or Admin. Each lead tracks event details, contact info, and a pipeline status.

**Event types:** `wedding`, `reception`, `engagement`, `birthday`, `corporate`, `conference`, `exhibition`, `other`  
**Lead statuses:** `new` → `contacted` → `followup` → `visited` → `negotiation` → `won` / `lost`

---

### Create lead  
`POST /api/venues/{venueId}/leads`  
Auth: Admin or Incharge. `createdBy` is auto-set to the authenticated user.

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| eventType | string | ✓ | One of the event types above |
| eventTypeOther | string | | Custom name when eventType is `other` |
| specialDay.startAt | datetime | ✓ | Event start (ISO 8601) |
| specialDay.endAt | datetime | ✓ | Event end (ISO 8601) |
| specialDay.durationHours | number | ✓ | Duration in hours |
| expectedGuests | number | | Expected guest count |
| contact.name | string | ✓ | Contact person name |
| contact.phone | string | ✓ | Contact phone |
| contact.altPhone | string | | Alternate phone |
| notes | string | | Free-text notes |

**Example (wedding)**
```json
{
  "eventType": "wedding",
  "specialDay": {
    "startAt": "2026-03-20T10:30:00.000Z",
    "endAt": "2026-03-20T22:30:00.000Z",
    "durationHours": 12
  },
  "expectedGuests": 250,
  "contact": {
    "name": "Rahul Sharma",
    "phone": "+919876543210"
  }
}
```

**Example (custom event)**
```json
{
  "eventType": "other",
  "eventTypeOther": "Baby shower",
  "specialDay": {
    "startAt": "2026-03-20T10:30:00.000Z",
    "endAt": "2026-03-20T22:30:00.000Z",
    "durationHours": 12
  },
  "expectedGuests": 250,
  "contact": {
    "name": "Rahul Sharma",
    "phone": "+919876543210",
    "altPhone": "+919812345678"
  }
}
```

**Responses:** 201, 400, 401, 403.

---

### List leads  
`GET /api/venues/{venueId}/leads`  
Auth: Admin or Incharge.

**Query params:** `?status=new` (optional filter by status).

Response includes populated `createdByUser` and `venue` objects via aggregation.

**Responses:** 200 (array of leads), 401, 403.

---

### Get lead by ID  
`GET /api/venues/{venueId}/leads/{leadId}`  
Auth: Admin or Incharge. Includes populated `createdByUser` and `venue`.

**Responses:** 200, 401, 403, 404.

---

### Update lead  
`PATCH /api/venues/{venueId}/leads/{leadId}`  
Auth: Admin or Incharge.

**Request body (JSON)** — any combination of: eventType, eventTypeOther, specialDay, expectedGuests, contact, status, notes, metadata.

**Example (update status)**
```json
{
  "status": "contacted",
  "notes": "Called the client, interested in 24hr package"
}
```

**Responses:** 200, 400, 401, 403, 404.

---

### Delete lead  
`DELETE /api/venues/{venueId}/leads/{leadId}`  
Auth: Admin or Incharge.

**Responses:** 200, 401, 403, 404.

---

## Gallery (Albums + Photos)

One venue can have multiple albums. Each album contains multiple photos (stored as sub-documents).

**Flow:** Upload images via `POST /api/uploads/presign`, then pass the `publicUrl` / `key` when adding photos to an album.

---

### Create album  
`POST /api/venues/{venueId}/gallery`  
Auth: Admin or Incharge.

**Request body (JSON)**

| Field       | Type    | Required | Description                    |
|-------------|---------|----------|--------------------------------|
| name        | string  | ✓        | Album name                     |
| description | string  |          | Album description              |
| coverImage  | string  |          | S3 URL for album cover image   |
| isActive    | boolean |          | Default: true                  |
| metadata    | object  |          | Any extra data                 |

**Example**
```json
{
  "name": "Wedding Events",
  "description": "Photos from recent wedding events",
  "coverImage": "https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/.../cover.jpg"
}
```

**Responses:** 201, 400, 401, 403.

---

### List albums  
`GET /api/venues/{venueId}/gallery`  
Auth: Admin or Incharge.

Response includes `photoCount` for each album.

**Responses:** 200 (array of albums), 401, 403.

---

### Get album by ID  
`GET /api/venues/{venueId}/gallery/{albumId}`  
Auth: Admin or Incharge. Returns album with all photos.

**Responses:** 200, 401, 403, 404.

---

### Update album  
`PATCH /api/venues/{venueId}/gallery/{albumId}`  
Auth: Admin or Incharge.

**Request body (JSON)** — at least one: name, description, coverImage, isActive, metadata.

**Responses:** 200, 400, 401, 403, 404.

---

### Delete album  
`DELETE /api/venues/{venueId}/gallery/{albumId}`  
Auth: Admin or Incharge. Deletes album and all its photos.

**Responses:** 200, 401, 403, 404.

---

### Add photos to album  
`POST /api/venues/{venueId}/gallery/{albumId}/photos`  
Auth: Admin or Incharge.

**Request body (JSON)**

| Field             | Type   | Required | Description                                  |
|-------------------|--------|----------|----------------------------------------------|
| photos            | array  | ✓        | Array of photo objects                       |
| photos[].url      | string | ✓        | S3 public URL of uploaded image              |
| photos[].key      | string |          | S3 object key (for deletion via uploads API) |
| photos[].caption  | string |          | Photo caption                                |
| photos[].sortOrder| number |          | Display order (lower = first). Default: 0    |

**Example**
```json
{
  "photos": [
    {
      "url": "https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/.../photo1.jpg",
      "key": "uploads/images/.../uuid-photo1.jpg",
      "caption": "Main hall setup",
      "sortOrder": 1
    },
    {
      "url": "https://venuemanagementdhruva.s3.ap-south-1.amazonaws.com/uploads/images/.../photo2.jpg",
      "caption": "Stage view",
      "sortOrder": 2
    }
  ]
}
```

**Responses:** 200 (updated album), 400, 401, 403, 404.

---

### Update photo  
`PATCH /api/venues/{venueId}/gallery/{albumId}/photos/{photoId}`  
Auth: Admin or Incharge.

**Request body (JSON)** — at least one: url, key, caption, sortOrder.

**Responses:** 200 (updated album), 400, 401, 403, 404.

---

### Delete photo  
`DELETE /api/venues/{venueId}/gallery/{albumId}/photos/{photoId}`  
Auth: Admin or Incharge. Removes the photo from the album.

**Responses:** 200 (updated album), 401, 403, 404.

---

## Pricing

Pricing is stored **one document per venue** containing both **venue buyout** and **space buyout** pricing. Duration keys are `"12"`, `"24"`, `"36"`, `"48"` (hours). Price values are strings (empty string = not offered).

---

### Get venue pricing  
`GET /api/venues/{venueId}/pricing`  
Auth: Admin or Incharge.

Returns the full pricing document. Response includes a `spaces` array with all spaces for the venue (for UI mapping). If no pricing exists, returns a default empty structure.

**Responses:** 200 (pricing doc), 401, 403.

---

### Upsert venue pricing (full)  
`PUT /api/venues/{venueId}/pricing`  
Auth: Admin or Incharge.

Create or update pricing. Accepts venue buyout fields, space buyout fields, or both.

**Request body (JSON)**

```json
{
  "buyoutOnly": false,
  "rackRates": { "12": "50000", "24": "90000", "36": "120000", "48": "150000" },
  "inclusions": [
    { "name": "Sound system", "maxQuantity": 1 },
    { "name": "Basic lighting" }
  ],
  "addons": [
    {
      "name": "Extra projector",
      "maxQuantity": 2,
      "prices": { "12": "5000", "24": "8000", "36": "10000", "48": "12000" }
    }
  ],
  "spaceOnly": false,
  "spacePricings": {
    "69afc2df3235f0510b471102": {
      "rackRates": { "12": "30000", "24": "55000", "36": "75000", "48": "95000" },
      "inclusions": [{ "name": "WiFi" }],
      "addons": []
    }
  }
}
```

**Field summary**

| Field | Type | Description |
|-------|------|-------------|
| buyoutOnly | boolean | If true, only venue buyout pricing is offered |
| rackRates | object | `"12"`,`"24"`,`"36"`,`"48"` → price string |
| inclusions | array | Items included at no extra cost (`name`, optional `maxQuantity`) |
| addons | array | Extra chargeable items (`name`, optional `maxQuantity`, `prices` per duration) |
| spaceOnly | boolean | If true, only per-space pricing is offered |
| spacePricings | object | Map of `spaceId` → `{ rackRates, inclusions, addons }` |

**Responses:** 200 (upserted doc), 400, 401, 403, 404.

---

### Update venue buyout only  
`PATCH /api/venues/{venueId}/pricing/venue-buyout`  
Auth: Admin or Incharge.

Partial update — send only venue buyout fields (`buyoutOnly`, `rackRates`, `inclusions`, `addons`).

**Responses:** 200, 400, 401, 403.

---

### Update space buyout only  
`PATCH /api/venues/{venueId}/pricing/space-buyout`  
Auth: Admin or Incharge.

Partial update — send only space buyout fields (`spaceOnly`, `spacePricings`).

**Responses:** 200, 400, 401, 403.

---

### Delete venue pricing  
`DELETE /api/venues/{venueId}/pricing`  
Auth: Admin only.

Removes all pricing for the venue.

**Responses:** 200, 401, 403, 404.

---

## Health

### Health / smoke  
`GET /test`  
No auth. Service connectivity check.

**Responses:** 200 (OK).

---

## Response shapes

**Success (typical)**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error**
```json
{
  "success": false,
  "error": {
    "message": "string",
    "code": "string"
  }
}
```

**Auth success (login/register)**
```json
{
  "success": true,
  "data": {
    "user": { "_id", "email", "name", "role", "venueId" },
    "token": "JWT string"
  }
}
```

---

## Docs and spec URLs

- **Swagger UI (hosted):** `/api/docs`, `/docs`, `/swagger-ui`, `/venue-docs`
- **Spec YAML:** `/api/docs/swagger.yaml`
- **Spec JSON:** `/api/docs/swagger.json`

Use the same base URL as the API (local or production).
