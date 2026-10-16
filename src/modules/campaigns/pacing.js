const logger = require('../../config/logger');

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Per-hotel send throttle shared by every worker process: a fixed one-second window counter in
 * Redis. Returns once this caller may send one more message. If Redis is unavailable it falls
 * back to even local pacing, so a Redis blip slows sending down instead of stopping it.
 */
async function waitForSlot(redis, propertyId, perSecond, { now = Date.now, sleep = defaultSleep } = {}) {
  try {
    for (;;) {
      const second = Math.floor(now() / 1000);
      const key = `campaign:rate:${propertyId}:${second}`;
      const used = await redis.incr(key);
      if (used === 1) await redis.expire(key, 3);
      if (used <= perSecond) return;
      await sleep(1000 - (now() % 1000) + 5); // wait for the next window
    }
  } catch (err) {
    logger.warn({ err }, 'campaigns:rate_limiter_unavailable_using_local_pacing');
    await sleep(Math.ceil(1000 / perSecond));
  }
}

module.exports = { waitForSlot };
