import { NextRequest, NextResponse } from 'next/server';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  limit?: number; // max requests allowed within window
  windowMs?: number; // duration of window in milliseconds
  keyPrefix?: string; // namespace for the rate limit
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitRecord>();
  private defaultLimit: number;
  private defaultWindowMs: number;

  constructor(defaultLimit = 60, defaultWindowMs = 60_000) {
    this.defaultLimit = defaultLimit;
    this.defaultWindowMs = defaultWindowMs;

    // Periodically clean up expired entries every 5 minutes
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
      if (timer.unref) {
        timer.unref();
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now > record.resetAt) {
        this.store.delete(key);
      }
    }
  }

  reset(): void {
    this.store.clear();
  }

  getClientIp(request: Request | NextRequest): string {
    const headers = request.headers;
    const forwarded = headers.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    const realIp = headers.get('x-real-ip') || headers.get('cf-connecting-ip');
    if (realIp) {
      return realIp.trim();
    }
    return '127.0.0.1';
  }

  check(
    request: Request | NextRequest,
    options: RateLimitOptions = {}
  ): RateLimitResult {
    const limit = options.limit ?? this.defaultLimit;
    const windowMs = options.windowMs ?? this.defaultWindowMs;
    const prefix = options.keyPrefix ?? 'global';
    const ip = this.getClientIp(request);
    const key = `${prefix}:${ip}`;

    const now = Date.now();
    let record = this.store.get(key);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs,
      };
      this.store.set(key, record);
      return {
        success: true,
        limit,
        remaining: limit - 1,
        resetAt: record.resetAt,
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    record.count += 1;
    const remaining = Math.max(0, limit - record.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));

    if (record.count > limit) {
      return {
        success: false,
        limit,
        remaining: 0,
        resetAt: record.resetAt,
        retryAfterSeconds,
      };
    }

    return {
      success: true,
      limit,
      remaining,
      resetAt: record.resetAt,
      retryAfterSeconds,
    };
  }

  createResponse(result: RateLimitResult): NextResponse {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': String(result.remaining),
          'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
          'Retry-After': String(result.retryAfterSeconds),
        },
      }
    );
  }
}

export const rateLimiter = new RateLimiter();
export default rateLimiter;
