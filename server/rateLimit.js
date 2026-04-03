function getDefaultKey(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function createRateLimiter({
  windowMs = 60 * 1000,
  max = 30,
  keyFn = getDefaultKey,
  message = "Too many requests",
  prefix = "rate",
  maxEntries = 5000,
  cleanupInterval = 200,
}) {
  const buckets = new Map();
  let requestsSinceCleanup = 0;

  function cleanup(now) {
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }

    if (buckets.size <= maxEntries) {
      return;
    }

    const overflow = buckets.size - maxEntries;
    const oldestBuckets = [...buckets.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, overflow);

    for (const [key] of oldestBuckets) {
      buckets.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    requestsSinceCleanup += 1;

    if (requestsSinceCleanup >= cleanupInterval) {
      cleanup(now);
      requestsSinceCleanup = 0;
    }

    const rawKey = String(keyFn(req) || getDefaultKey(req));
    const key = `${prefix}:${rawKey}`;
    const existingBucket = buckets.get(key);
    const bucket =
      existingBucket && existingBucket.resetAt > now
        ? existingBucket
        : {
            count: 0,
            resetAt: now + windowMs,
            lastSeenAt: now,
          };

    bucket.lastSeenAt = now;

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );

    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count >= max) {
      res.set("Retry-After", String(retryAfterSeconds));
      res.set("X-RateLimit-Remaining", "0");
      buckets.set(key, bucket);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds,
      });
    }

    bucket.count += 1;
    res.set("X-RateLimit-Remaining", String(Math.max(max - bucket.count, 0)));
    buckets.set(key, bucket);
    return next();
  };
}

module.exports = {
  createRateLimiter,
};
