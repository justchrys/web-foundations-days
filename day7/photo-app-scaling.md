# SnapShare Scaling Plan

## 1. Assumptions
- 10M registered users; 10% active daily. Each active user uploads 1 photo and views 50 feed pages per day.
- Photo = 2 MB original + 50 KB thumbnail. One feed page = one API request (thumbnails come from the CDN).
- Average traffic is spread over 86,400 s/day; peak = 5x average. 365 days/year, no deletions, decimal units.

**Daily active users:** 10,000,000 x 10% = **1,000,000**.

## 2. Estimates
| Measure | Calculation | Average | Peak (5x) |
|---|---|---|---|
| Uploads/second | 1,000,000 / 86,400 | ~12 | ~58 |
| Feed views/second | 50,000,000 / 86,400 | ~579 | ~2,900 |
| Storage per year | 1M x 2.05 MB x 365 | ~748 TB | |

- Storage: originals ~730 TB + thumbnails ~18 TB per year. Database metadata (about 1 KB per photo, my assumption) is only ~365 GB per year.
- Peak upload bandwidth: 58 x 2 MB = ~116 MB/s (~0.9 Gbit/s). With pre-signed URLs (section 7) this goes straight to object storage, not through our servers.

## 3. Read-heavy or write-heavy?
**Read-heavy**: ~579 reads/s vs ~12 writes/s, about **50 to 1**. So: serve images from a CDN, cache hot data, send reads to a replica, and keep slow write work (thumbnails) in the background.

## 4. Why photos are not stored in the database
At ~748 TB per year, photos would bloat the database, make backups and replication slow, use up connections, and cost far more than file storage. Photos go in **object storage** (e.g. S3); the database keeps only metadata and the file's storage key.

## 5. Architecture diagram
```
            Users (mobile app / browser)
        |               |                  |
   API calls        image GETs     PUT photo (pre-signed URL)
        v               v                  v
 +---------------+   +-----+       +----------------+
 | Load Balancer |   | CDN |------>| Object Storage |  photos + thumbnails
 +-------+-------+   +-----+ miss  +--+----------+--+
         v                            ^          | "photo uploaded" event
 +---------------+                    |          v
 |  App servers  |                    |     +---------+      +--------+
 |     (xN)      |                    |     |  Queue  |----->| Worker |
 +---+-------+---+                    |     +---------+      +---+----+
     |       |                        +--------------------------+
     v       v                          writes thumbnail,
 +-------+ +-----------+  replicates    updates photo status in DB
 | Cache | | Database  |-------------> +--------------+
 |(Redis)| | (primary) |               | Read replica |
 +-------+ +-----------+               +--------------+
```
App servers read the cache first, then the replica; writes go to the primary. They also create pre-signed upload URLs (they do not carry the photo data). The worker updates the primary database.

## 6. What each component does
- **CDN:** serves photos and thumbnails from servers near the user, so images load fast and most image traffic never reaches us.
- **Load balancer:** spreads API requests across app servers and skips unhealthy ones, so no single server is a bottleneck.
- **App servers:** run the logic (login, feed, upload requests) and are stateless, so we can add more as traffic grows.
- **Cache:** keeps hot data such as feeds and photo metadata in memory, so repeated reads skip the database.
- **Database (primary):** stores users, follows and photo metadata, and takes all writes so data stays consistent.
- **Read replica:** a copy that answers read queries, taking heavy read load off the primary.
- **Object storage:** stores the large photo files cheaply and durably, outside the database.
- **Queue:** holds thumbnail jobs so no job is lost in a spike and uploads never wait for image processing.
- **Worker:** takes queued jobs and creates thumbnails in the background, retrying on failure.

## 7. Upload flow (direct upload with pre-signed URL)
1. The app calls the API (via the load balancer) to start an upload, sending the file type and size. An app server checks the user's login and the limits.
2. The app server saves a photo row in the primary database with status **"pending"**, and creates a short-lived **pre-signed URL** limited to one storage key.
3. The app server returns the photo id and the URL. It never touches the photo itself.
4. The client uploads the 2 MB file **directly to object storage** with the pre-signed URL.
5. When the upload finishes, object storage sends a **"photo uploaded" event** to the **queue**.
6. A **worker** takes the job, checks the file is a real image, creates a 50 KB thumbnail, saves it, and sets the row to **"ready"** with the thumbnail key.
7. If the worker fails, the job is retried; after several failures it goes to a dead-letter queue and the row is marked **"failed"**. A scheduled cleanup removes "pending" rows whose upload never arrived.
8. Followers' feeds now include the photo: cached feeds refresh or expire, and the CDN serves the thumbnail.

## 8. Trade-offs
- **Cache and CDN: speed vs freshness.** Reads become fast and cheap, but a new photo may take a few seconds to show, cache invalidation is easy to get wrong, and both add cost.
- **Read replica: scale vs consistency.** The replica lags slightly behind the primary, so a user might not instantly see their own new photo. Reading the author's own uploads from the primary fixes this at the cost of extra logic.
- **Queue and worker: fast uploads vs complexity.** Uploads finish quickly and spikes are absorbed, but thumbnails arrive a moment later, and we must run and monitor the queue, retries and dead-letter handling.
- **Pre-signed URLs: less server load vs more moving parts.** App servers avoid ~116 MB/s of upload traffic at peak, but the flow has more steps, needs strict URL expiry, size and type limits, and leaves "pending" uploads that must be confirmed or cleaned up.
