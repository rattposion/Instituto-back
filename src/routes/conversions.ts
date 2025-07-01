import { Router } from 'express';
import { ConversionController } from '../controllers/ConversionController';
import { authenticate, authorize } from '../middleware/auth';
import { validate, validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const conversionController = new ConversionController();

// All routes require authentication
router.use(authenticate);

// Get all conversions for workspace
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(conversionController.getConversions)
);

// Create new conversion
router.post('/', 
  authorize(['admin', 'manager']),
  validate(schemas.createConversion), 
  asyncHandler(conversionController.createConversion)
);

// Get conversion by ID
router.get('/:id', asyncHandler(conversionController.getConversionById));

// Update conversion
router.put('/:id', 
  authorize(['admin', 'manager']),
  asyncHandler(conversionController.updateConversion)
);

// Delete conversion
router.delete('/:id', 
  authorize(['admin']),
  asyncHandler(conversionController.deleteConversion)
);

// Get conversion analytics
router.get('/:id/analytics', asyncHandler(conversionController.getConversionAnalytics));

// Get conversion funnel
router.get('/:id/funnel', asyncHandler(conversionController.getConversionFunnel));

export default router;