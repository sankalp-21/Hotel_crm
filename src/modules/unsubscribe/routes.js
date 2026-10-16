const express = require('express');
const controller = require('./controller');
const { asyncHandler } = require('../../shared/errors/errorHandler');
const { publicRateLimiter } = require('../../shared/middleware/rateLimit');

// Public: no authenticate / property context. Authorisation is the signed token itself.
const router = express.Router();

router.use(publicRateLimiter());
router.get('/', asyncHandler(controller.show));
router.post('/', asyncHandler(controller.perform));

module.exports = router;
