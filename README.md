# Venue Management API

Node.js backend on **AWS Lambda** (Serverless Framework v3), with **MongoDB** and **JWT** auth. **User management** (Admin + Incharge) and **venue profile** only.

## Roles

- **Admin** – Full access: users, venues, block/unblock incharge.
- **Incharge** – Email/password registration and login; manages their assigned venue and **venue profile** (logo, tagline, address, social, legal).

## Setup

```bash
cp .env.example .env
# Edit .env: MONGODB_URI, JWT_SECRET, S3_BUCKET (optional)

npm install
```

## Create first Admin

Incharge can register via `POST /api/auth/register`. Create the first admin with:

```bash
# From project root (ensure .env has MONGODB_URI)
node -r dotenv/config scripts/create-admin.js [email] [password]

# Example:
node -r dotenv/config scripts/create-admin.js admin@venue.com SecurePassword123
```

Or set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` and run `node -r dotenv/config scripts/create-admin.js`.

## Run locally

```bash
npm run offline
```

API base URL: `http://localhost:3000` (or as shown by serverless-offline).  
**API base URL (important):**  
If you deployed with **`--stage prod`**, every request must include **`/prod/`** in the path.  
Example base: `https://YOUR_API_ID.execute-api.REGION.amazonaws.com/prod`  
- Health: `GET .../prod/test`  
- Login: `POST .../prod/api/auth/login`  
- Docs: `GET .../prod/venue-docs` or `.../prod/swagger-ui` or `.../prod/api/docs`  
Without `/{stage}/`, the API returns **null** (route not found for that stage).

**API docs (Swagger UI):**  
- **Local:** [http://localhost:3000/api/docs](http://localhost:3000/api/docs) (run `npm run offline` first).  
- **Hosted (after deploy):** `https://<your-api-id>.execute-api.<region>.amazonaws.com/api/docs`  
  Same UI at: `/docs`, `/swagger-ui`, `/venue-docs`. Raw spec: `/api/docs/swagger.yaml`, `/api/docs/swagger.json`.

## Deploy

```bash
# Set env vars (e.g. in .env or CI)
# MONGODB_URI, JWT_SECRET, S3_BUCKET

npm run deploy          # stage: dev
npm run deploy:prod     # stage: prod
```

## API overview

| Lambda    | Paths |
|----------|--------|
| **authApi** | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/users` (Admin create user), `GET/PATCH/DELETE /api/users`, block/unblock |
| **venuesApi** | `POST/GET/PATCH/DELETE /api/venues` |
| **spacesApi** | `POST/GET/PATCH/DELETE /api/venues/{venueId}/spaces`, `GET/PATCH/DELETE /api/venues/{venueId}/spaces/{spaceId}` (multiple spaces per venue) |
| **profileApi** | `GET/PUT /api/profile/venue`, `GET/PUT /api/venues/{venueId}/profile` (venue profile: logo, tagline, address, social, legal) |
| **testApi** | `GET /test` |
| **swaggerApi** | `GET /api/docs` (Swagger UI), `GET /api/docs/swagger.yaml`, `GET /api/docs/swagger.json` |

All collection APIs require `Authorization: Bearer <token>` (from login or register). Incharge sees only data for their `venueId` where enforced (e.g. list venues).

## Collections (MongoDB)

- **users** – admin, incharge (email, password, name, role, venueId, isBlocked)
- **venues** – name, address, contact, isActive
- **venueprofiles** – venueId, logo, venueName, tagline, description, address, googleMapUrl, email, instagram, facebook, website, legal.businessName, legal.gst
