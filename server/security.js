const { rateLimit } = require('express-rate-limit');

function limiter(windowMs, limit, message) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: message }
  });
}

const apiLimiter = limiter(15 * 60 * 1000, 600, 'Too many requests. Please try again later.');
const loginLimiter = limiter(15 * 60 * 1000, 10, 'Too many sign-in attempts. Please wait and try again.');
const confirmationLimiter = limiter(60 * 60 * 1000, 5, 'Too many confirmation requests. Please try again later.');
const passwordResetLimiter = limiter(60 * 60 * 1000, 5, 'Too many password reset requests. Please try again later.');
const publicTrackingLimiter = limiter(15 * 60 * 1000, 120, 'Too many tracking requests. Please try again later.');
const qrLimiter = limiter(15 * 60 * 1000, 30, 'Too many QR requests. Please try again later.');
const hardwareLimiter = limiter(60 * 1000, 300, 'Too many device readings. Please slow down.');

module.exports = {
  apiLimiter,
  loginLimiter,
  confirmationLimiter,
  passwordResetLimiter,
  publicTrackingLimiter,
  qrLimiter,
  hardwareLimiter
};
