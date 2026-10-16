const express = require('express');
const controller = require('./controller');
const { deliveryEventsSchema } = require('./validator');
const { validate } = require('../../shared/validation/validate');
const { asyncHandler } = require('../../shared/errors/errorHandler');
const { webhookRateLimiter } = require('../../shared/middleware/rateLimit');
const { UnauthorizedError, NotFoundError } = require('../../shared/errors/AppError');
const { verifyPropertyWebhook } = require('./signature');
const propertyRepository = require('../property/repository');

// Public: authorised by the HMAC in the URL, not by a user session.
const router = express.Router();

async function verifySignature(req, res, next) {
  try {
    if (!verifyPropertyWebhook(req.params.propertyId, req.query.sig)) {
      throw new UnauthorizedError('Invalid webhook signature');
    }
    const property = await propertyRepository.findById(req.params.propertyId);
    if (!property) throw new NotFoundError('Property');
    next();
  } catch (err) {
    next(err);
  }
}

router.use(webhookRateLimiter());
router.post('/:propertyId', verifySignature, validate(deliveryEventsSchema), asyncHandler(controller.receive));

module.exports = router;
