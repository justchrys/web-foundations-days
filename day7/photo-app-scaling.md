# SnapShare Scaling Plan

SnapShare is a photo-sharing app. Users upload photos and scroll a feed of photos from the people they follow. This plan estimates the load and describes an architecture that can handle it.

## 1. Assumptions

- 10 million registered users.
- 10% of registered users are active on a given day.
- Each active user uploads 1 photo per day and views 50 feed pages per day.
- An average photo is 2 MB. Each photo also gets one 50 KB thumbnail.
- Traffic is spread evenly over 24 hours for the average (1 day = 86,400 seconds).
- Peak traffic is 5 times the average.
- One feed page view is one request to the server. The thumbnails on the page are served separately by the CDN.
- Photos are kept forever (no deletions), and 1 year = 365 days.
- Storage uses decimal units (1 TB = 1,000,000 MB). Copies kept for safety by the storage provider are not counted.

**Daily active users (DAU):** 10,000,000 × 10% = **1,000,000 users per day**.

## 2. Estimates

### Uploads per second
- Uploads per day: 1,000,000 users × 1 photo = 1,000,000 photos.
- Average: 1,000,000 ÷ 86,400 ≈ **12 uploads per second**.
- Peak (5×): 12 × 5 ≈ **58 uploads per second** (about 116 MB/s of incoming photo data, or roughly 0.9 Gbit/s).

### Feed views per second
- Feed views per day: 1,000,000 users × 50 = 50,000,000 views.
- Average: 50,000,000 ÷ 86,400 ≈ **579 feed views per second**.
- Peak (5×): 579 × 5 ≈ **2,900 feed views per second**.

### Photo storage per year
- Storage per photo: 2 MB original + 0.05 MB thumbnail = 2.05 MB.
- Per day: 1,000,000 × 2.05 MB = 2,050,000 MB ≈ **2.05 TB per day**.
- Per year: 2.05 TB × 365 ≈ **748 TB per year** (about 0.75 PB).
  - Originals: 730 TB per year.
  - Thumbnails: about 18 TB per year.
- The database only holds metadata (owner, caption, file location, timestamps). If each photo needs about 1 KB, that is only about 365 GB per year, tiny compared with the photos.

### Summary table

| Measure | Average | Peak (5×) |
|---|---|---|
| Uploads per second | ~12 | ~58 |
| Feed views per second | ~579 | ~2,900 |
| Photo storage | ~2.05 TB per day | ~748 TB per year |

## 3. Read-heavy or write-heavy?

SnapShare is **read-heavy**. There are about 579 feed views per second but only about 12 uploads per second, so reads outnumber writes by roughly **50 to 1**.

What this means for the design:
- Optimise for reads first: serve images from a CDN, keep popular data in a cache, and send read queries to a read replica so the main database is not overloaded.
- Writes (uploads) are fewer, but each one is heavy because of the 2 MB file. They should be handled carefully, with slow work such as thumbnail creation moved to the background.
- Because data is read many times after being written once, it is worth doing extra work at write time (such as making thumbnails) to make reading cheap.

## 4. Why photos should not be stored in the database

- **Size:** At about 748 TB per year, photos would make the database enormous, and database storage is far more expensive than file storage.
- **Speed:** Large files slow queries, backups and replication, and tie up database connections that should be answering fast metadata queries.
- **Serving:** A database cannot hand files to a CDN easily, so every image would pass through the app servers and the database.
- **Scaling:** Databases are hard to scale for big files, while file storage is built for it.

Photos go in **object storage** (such as Amazon S3 or Google Cloud Storage). It is cheap, almost unlimited, highly durable, and works directly with a CDN. The database stores only each photo's metadata and its storage key or URL.

## 5. Architecture diagram

```
          Users (mobile app / browser)
            |                     |
   photos & thumbnails       API requests
            |                     |
            v                     v
       +---------+        +---------------+
       |   CDN   |        | Load Balancer |
       +----+----+        +-------+-------+
            |                     |
      cache miss                  v
            |           +------------------+
            |           | App servers (xN) |
            |           +--+---+---+----+--+
            |              |   |   |    |
            |      +-------+   |   |    +--------+
            |      |       +---+   |             |
            |      v       v       v             v
            |  +-------+ +----------+      +-----------+
            |  | Cache | | Database |      |   Queue   |
            |  |(Redis)| | (primary)|      +-----+-----+
            |  +-------+ +----+-----+            |
            |                 |                  v
            |                 v            +-----------+
            |          +-------------+     |  Worker   |
            |          | Read replica|     | (thumbs)  |
            |          +-------------+     +-----+-----+
            |                                    |
            v                                    |
     +----------------+<--------------------------+
     | Object Storage |
     | photos + thumbs|
     +----------------+
```

How to read it:
- Image downloads go Users → CDN → (on a cache miss) Object Storage.
- API calls go Users → Load Balancer → App servers.
- App servers read the Cache first, then the Read replica; writes go to the Database (primary), which copies changes to the replica.
- App servers also upload original photos to Object Storage and add thumbnail jobs to the Queue.
- The Worker takes jobs from the Queue, reads the original from Object Storage and writes the thumbnail back.

## 6. What each component does

- **CDN:** Serves photos and thumbnails from servers close to the user, so images load quickly and most image traffic never reaches our own servers.
- **Load balancer:** Spreads incoming requests across the app servers and avoids unhealthy ones, so no single server is a bottleneck or a single point of failure.
- **App servers:** Run the application logic (login, upload, feed) and stay stateless, so we can add more of them as traffic grows.
- **Cache:** Keeps frequently read data such as feeds and photo metadata in memory, so repeated requests do not hit the database.
- **Database (primary):** Stores users, follow relationships and photo metadata, and handles all writes so the data stays consistent.
- **Read replica:** Holds a copy of the database that answers read queries, which takes load off the primary and handles the heavy read traffic.
- **Object storage:** Stores the large photo files cheaply and durably, so they stay out of the database.
- **Queue:** Holds thumbnail jobs so an upload can finish right away and no job is lost during a traffic spike.
- **Worker:** Processes queued jobs in the background by creating thumbnails, so slow image processing never delays a user.

## 7. Upload flow, step by step

1. The user picks a photo in the app and taps upload. The app sends it over HTTPS with the user's login token.
2. The request reaches the **load balancer**, which forwards it to one of the **app servers**.
3. The app server checks the user is logged in and that the file is a valid image within the size limit.
4. The app server saves the original photo to **object storage** and gets back a storage key.
5. The app server inserts a row for the photo in the **database (primary)**: owner, storage key, timestamp and a status of "processing".
6. The app server puts a thumbnail job (photo id and storage key) on the **queue**.
7. The app server replies "upload successful" to the user straight away, without waiting for the thumbnail.
8. A **worker** takes the job from the queue, downloads the original, creates a 50 KB thumbnail and saves it to object storage.
9. The worker updates the photo's row in the database with the thumbnail key and sets its status to "ready". If the worker fails, the job is retried.
10. Followers' feeds now include the photo. Their cached feeds are refreshed or expire, and the **CDN** serves the thumbnail when they scroll.

## 8. Trade-offs

- **Caching and CDN: speed vs fresh data.** Caching makes reads much faster and cheaper, but cached feeds can be a little out of date, so a new photo may take a few seconds to appear. Cache invalidation is also easy to get wrong, and a cache and CDN add running costs.
- **Read replica: scale vs consistency.** The replica takes most of the read load, but it copies data from the primary with a small delay. A user could upload a photo and briefly not see it in their own feed. One fix is to read the author's own recent uploads from the primary, which adds complexity.
- **Queue and worker: fast uploads vs extra complexity.** Users get a quick response and spikes are absorbed, but a photo shows without a thumbnail until the worker finishes. We must also run and monitor the queue and workers, and handle failures and retries.
- **Feed building: read speed vs write cost.** Pre-building each follower's feed when a photo is posted makes reading very fast, but one upload by a user with many followers causes a lot of writes. Building the feed when it is requested is cheaper to store but slower to read.
