# TicketHub Design

TicketHub sells tickets for concerts and events. The hardest problem is the **big sale**: when a popular concert goes on sale, thousands of people compete for the same seats at the same moment.

## 1. Requirements

**Functional**
- Users can register, log in and browse or search events.
- Users can view an event's seat map and see which seats are free.
- Users can hold up to 4 seats for 10 minutes, then pay for them.
- Users can view their tickets, and unpaid holds expire automatically.

**Non-functional**
- **Speed:** browsing pages load in under 300 ms, even during a big sale.
- **Correctness:** a seat is never sold twice, and nobody is charged for a seat they do not get.
- **Fairness:** first come, first served; a limit of 4 tickets per user and protection against bots.
- **Availability and scale:** the site stays up during a 100x traffic spike; paid orders are never lost.
- **Security:** HTTPS, hashed passwords, and card details handled only by the payment provider.

## 2. Estimates

Assumptions: 1 day = 86,400 s; normal peak = 5x average; during a sale each user makes about 10 requests (page views, seat-map refreshes, hold attempts) and the first minute is 3x the 10-minute average.

| | Normal day | Big sale (first 10 minutes) |
|---|---|---|
| Users | 50,000 visitors | 200,000 users in 600 s = ~333 new users/s |
| Requests | 50,000 x 10 = 500,000/day = ~6/s (peak ~29/s) | 2,000,000 in 600 s = ~3,300/s (first-minute surge ~10,000/s) |
| Buying | 5,000 tickets/day = ~0.06/s (peak ~0.3/s) | ~333 hold attempts/s (surge ~1,000/s); up to 20,000 seats sold = ~33/s |
| Competition | none | 200,000 users for 20,000 seats = 10 users per seat |

**Comparison:** the sale has about **500x** the request rate of a normal day and thousands of times more buying attempts, all aimed at the same 20,000 seats. On a normal day the system is read-heavy (about 100 page views per ticket sold). In a sale, writes and contention become the problem, so the design must protect the database. Storage is small (5,000 tickets/day is under 2 million per year, a few GB).

## 3. API

| Method | Path | Description | Success |
|---|---|---|---|
| `GET` | `/events` | Browse or search events (`q`, `city`, `date`, `page`) | `200` |
| `GET` | `/events/{id}` | Event details | `200` |
| `GET` | `/events/{id}/seats` | Seat map with each seat's status | `200` |
| `POST` | `/events/{id}/queue` | Join the waiting room | `202` |
| `POST` | `/events/{id}/holds` | Hold 1 to 4 seats for 10 minutes | `201` |
| `DELETE` | `/events/{id}/holds` | Release my held seats | `204` |
| `POST` | `/orders` | Pay for my held seats (`Idempotency-Key` header) | `201` |
| `GET` | `/me/tickets` | View my tickets | `200` |

Hold request `POST /events/7/holds` with `{ "seat_ids": [1201, 1202] }` returns `201` with `{ "seat_ids": [1201, 1202], "expires_at": "2026-11-02T18:10:00Z" }`. If a seat was just taken it returns `409` with `{ "error": { "code": "SEAT_UNAVAILABLE", "seat_ids": [1202] } }`. Paying: `POST /orders` with `{ "event_id": 7, "seat_ids": [1201, 1202], "payment_token": "tok_abc" }`.

Errors: `400` invalid request (for example more than 4 seats), `401` not logged in, `402` payment failed, `403` not yet admitted from the waiting room, `404` event or seat not found, `409` seat taken or hold expired, `429` too many requests.

## 4. Data model

- **users** (`id` PK, `email` unique, `name`, `password_hash`, `created_at`)
- **events** (`id` PK, `title`, `venue`, `starts_at`, `sale_starts_at`)
- **orders** (`id` PK, `user_id` FK, `event_id` FK, `total_cents`, `payment_ref` unique, `created_at`)
- **seats** (`id` PK, `event_id` FK, `section`, `row_label`, `seat_number`, `price_cents`, `status`, `held_by` FK to users, `hold_expires_at`, `order_id` FK to orders)

**Relationships:** one user has many orders (one-to-many); one event has many seats and many orders (one-to-many); one order covers several seats, but a seat belongs to at most one order (one-to-many, through `seats.order_id`). Users and events are linked many-to-many through orders.

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE events (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, venue TEXT NOT NULL,
  starts_at DATETIME NOT NULL, sale_starts_at DATETIME NOT NULL);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id),
  event_id INTEGER NOT NULL REFERENCES events (id),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  payment_ref TEXT NOT NULL UNIQUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE TABLE seats (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events (id),
  section TEXT NOT NULL, row_label TEXT NOT NULL, seat_number INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'held', 'sold')),
  held_by INTEGER REFERENCES users (id),
  hold_expires_at DATETIME,
  order_id INTEGER REFERENCES orders (id),
  UNIQUE (event_id, section, row_label, seat_number),
  CHECK ((status = 'available' AND held_by IS NULL AND order_id IS NULL)
      OR (status = 'held' AND held_by IS NOT NULL AND hold_expires_at IS NOT NULL AND order_id IS NULL)
      OR (status = 'sold' AND order_id IS NOT NULL)));

CREATE INDEX idx_seats_event_status ON seats (event_id, status);
CREATE INDEX idx_orders_user ON orders (user_id);
```

Indexes: `seats (event_id, status)` makes the seat map and "how many seats are left" fast; `orders (user_id)` makes "my tickets" fast.

## 5. How the design prevents two people buying the same seat

The database is the single source of truth, and the rule is enforced there, not in the app or the cache.

**Step 1: hold the seats (one atomic transaction).**
```sql
BEGIN;
UPDATE seats
SET status = 'held', held_by = :user, hold_expires_at = :now_plus_10_min
WHERE id IN (:seat1, :seat2) AND event_id = :event
  AND (status = 'available' OR (status = 'held' AND hold_expires_at < :now));
-- if rows changed < seats requested: ROLLBACK and return 409
COMMIT;
```
**Step 2: pay.** The app asks the payment provider to authorize the card, then runs:
```sql
BEGIN;
INSERT INTO orders (user_id, event_id, total_cents, payment_ref) VALUES (...);
UPDATE seats
SET status = 'sold', order_id = :order_id, held_by = NULL, hold_expires_at = NULL
WHERE id IN (:seat1, :seat2) AND status = 'held' AND held_by = :user AND hold_expires_at > :now;
-- if rows changed < seats requested: ROLLBACK and cancel the payment authorization
COMMIT;
```
If the transaction succeeds, the payment is captured; if not, the authorization is cancelled, so nobody pays for a seat they do not get.

**Why two people cannot get the same seat:**
- **One atomic conditional UPDATE, not "check, then update".** The database locks the seat row while updating it, so two simultaneous requests run one after the other. The second sees the seat is already held and changes 0 rows, so it receives `409`. A separate "read the status, then write" would let both read "available".
- **Transactions give all-or-nothing.** If any one of the seats cannot be held, the whole hold is rolled back, so nobody ends up with half an order.
- **Constraints back it up.** The `CHECK` makes it impossible to store a seat that is "sold" without an order, or "available" with an owner. `UNIQUE` on the seat position stops duplicate seat rows. A seat has one `order_id`, so it cannot belong to two orders.
- **Holds expire.** A hold older than 10 minutes can be taken by someone else, so abandoned seats return to sale.
- **Retries are safe.** `payment_ref` is unique and the `Idempotency-Key` is checked, so a repeated request cannot create a second order or charge twice.
- **The cache is only a hint.** A cached seat map may show a taken seat as free, but the hold request still goes to the database, which is the final decision.

## 6. Architecture

```
        Client (browser / app)
        |            |             |
   lookup     static files &    buying
        v     event pages          v
   +-------+   +-------+   +----------------+
   |  DNS  |   |  CDN  |   |  Waiting room  |
   +-------+   +-------+   | (virtual queue)|
                           +--------+-------+
                                    | admitted users only
                                    v
                            +---------------+
                            | Load Balancer |
                            +---+-------+---+
                                |       |
                        +-------+--+ +--+-------+
                        | App      | | App      |  autoscaled,
                        | server 1 | | server N |  stateless
                        +----+-----+ +-----+----+
                             |             |
       +-----------+---------+-------+-----+-------------+
       v           v                 v                   v
 +-----------+ +-------------+ +-----------+     +-----------------+
 |   Cache   | |  Database   | |   Queue   |     | Payment provider|
 |  (Redis)  | |  (primary)  | +-----+-----+     |   (external)    |
 +-----------+ +------+------+       v           +-----------------+
                      | replicates +---------+
                      v            | Workers |
               +--------------+    +---------+
               | Read replica |
               +--------------+
```

- **DNS:** turns the website name into the address of our servers so users can find us.
- **CDN:** serves static files and cached event pages from servers near the user, so most browsing traffic never reaches our servers.
- **Waiting room:** lets users into the buying pages at a rate the database can handle, so a flood of 200,000 users cannot knock the system over, and it keeps the order fair.
- **Load balancer:** spreads requests over the app servers and skips failed ones, so no single server is a bottleneck.
- **App servers:** run the API logic and keep no state, so we can add many more before a big sale.
- **Cache (Redis):** holds event details, a seat map refreshed every 1 to 2 seconds, and a "sold out" flag, so most reads never touch the database.
- **Primary database:** stores users, events, seats and orders and makes the final, consistent decision on every seat.
- **Read replica:** answers read queries such as "my tickets" and gives a copy ready if the primary fails.
- **Queue and workers:** handle slow jobs after a purchase (sending tickets and emails, retrying payment confirmations), so buyers never wait for them.
- **Payment provider:** takes card payments securely, so we never store card details.

**How it survives the big sale**
- The waiting room admits users at a steady rate (for example a few hundred per second) instead of all at once, and the CDN and cache absorb the browsing.
- App servers are scaled up before the sale starts, and per-user rate limits and bot checks cut off abusive traffic.
- Seat changes are short, single-row transactions, with at most 4 seats per user, so the primary database handles about 1,000 write attempts per second.
- When the last seat is sold, a "sold out" flag in the cache lets the remaining users get an instant answer without touching the database.
- The database is not the only copy of anything important: replicas and backups protect orders, and a failed primary is replaced by a replica.

## 7. Trade-offs

- **Waiting room: fairness and stability vs waiting time.** It protects the system and gives everyone a fair place in line, but users have to wait and it adds a component that must itself be reliable.
- **Cached seat map: speed vs accuracy.** Caching for 1 to 2 seconds takes most of the load off the database, but a user may click a seat that was just taken and get a `409`, so the app must show a friendly "seat just taken, choose another" message.
- **Hold time: fairness to buyers vs unsold seats.** A 10-minute hold gives people time to pay, but seats stay unavailable if they never pay. A shorter hold frees seats faster but rushes buyers.
- **One SQL primary: correctness vs write scaling.** All seat writes go to one primary, which keeps seat booking simple and safe. If the load grew much further, we could split events across several databases, which is more complex.
