/**
 * Rate Limiting Utilities
 * Redis-based rate limiting with sliding window algorithm
 */

import { getRedis } from "./redis";
import { prisma } from '@/prisma/client';
import { checkMongoRateLimit } from './mongo-rate-limit';

/**
 * Rate limit configuration
 */
interface RateLimitConfig {
  /**
   * Maximum number of requests allowed
   */
  limit: number;
  /**
   * Time window in seconds
   */
  window: number;
  /**
   * Identifier for the rate limit (e.g., user ID, IP address)
   */
  identifier: string;
}

/**
 * Rate limit result
 */
export interface RateLimitResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean;
  /**
   * Current request count in the window
   */
  current: number;
  /**
   * Maximum allowed requests
   */
  limit: number;
  /**
   * Time remaining until the window resets (in seconds)
   */
  reset: number;
}

/**
 * Check rate limit using sliding window algorithm
 *
 * @param config - Rate limit configuration
 * @returns Promise<RateLimitResult> - Rate limit result
 */
export async function checkRateLimit(
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (process.env.BENAA_RATE_LIMIT_BACKEND === 'mongodb') return checkMongoRateLimit(prisma,config);
  const redis = getRedis();
  if (!redis) {
    return { allowed: true, current: 0, limit: config.limit, reset: config.window };
  }
  // Admission, count and expiry are one Redis operation across all processes.
  const script = `
    local key, now, window, limit, member = KEYS[1], tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now-window)
    local count = redis.call('ZCARD', key)
    if count >= limit then return {0, count, math.ceil(window/1000)} end
    redis.call('ZADD', key, now, member)
    redis.call('PEXPIRE', key, window)
    return {1, count+1, math.ceil(window/1000)}
  `;
  try {
    const value = await redis.eval(script, [`rate-limit:${config.identifier}`],
      [Date.now(), config.window * 1000, config.limit, crypto.randomUUID()]);
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite) ||
        ![0, 1].includes(value[0]) || value[1] < 0 || value[2] < 0) {
      throw new Error('Invalid limiter response');
    }
    return { allowed: value[0] === 1, current: value[1], limit: config.limit, reset: value[2] };
  } catch {
    if (process.env.NODE_ENV === 'production') throw new Error('RATE_LIMIT_UNAVAILABLE');
    return { allowed: true, current: 0, limit: config.limit, reset: config.window };
  }
}
