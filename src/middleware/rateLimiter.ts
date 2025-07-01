import { RateLimiterMemory } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

const rateLimiter = new RateLimiterMemory({
  keyGenerator: (req: Request) => req.ip,
  points: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  duration: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000') / 1000, // Convert to seconds
});

export const rateLimiterMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes: any) {
    const remainingPoints = rejRes?.remainingPoints || 0;
    const msBeforeNext = rejRes?.msBeforeNext || 0;
    
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    
    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 1,
      'X-RateLimit-Limit': process.env.RATE_LIMIT_MAX_REQUESTS || '100',
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext).toISOString()
    });
    
    res.status(429).json({
      error: 'Too many requests',
      retryAfter: Math.round(msBeforeNext / 1000) || 1
    });
  }
};

export { rateLimiterMiddleware as rateLimiter };