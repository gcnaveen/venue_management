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
| dimensions  | string  |          | e.g. 40ft x 60ft       |
| isActive    | boolean |          | Default true       |
| metadata    | object  |          |                    |

**Example**
```json
{
  "name": "Main Hall",
  "description": "Large event space",
  "capacity": 200,
  "dimensions": "40ft x 60ft",
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

**Request body (JSON)** — at least one: name, description, capacity, type, isActive, metadata.

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
