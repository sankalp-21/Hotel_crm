const { ValidationError } = require('../errors/AppError');

/**
 * Validates req[part] (body/query/params) against a zod schema.
 * Replaces req[part] with the parsed (and type-coerced) result so
 * downstream code can trust the shape.
 *
 * Usage:
 *   router.post('/guests', validate(createGuestSchema), controller.create)
 *   router.get('/guests', validate(searchGuestSchema, 'query'), controller.search)
 */
function validate(schema, part = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(new ValidationError('Invalid request data', result.error.flatten()));
    }
    req[part] = result.data;
    next();
  };
}

module.exports = { validate };
