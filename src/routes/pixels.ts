import { Router } from 'express';
import { PixelController } from '../controllers/PixelController';
import { authenticate, authorize } from '../middleware/auth';
import { validate, validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const pixelController = new PixelController();

// All routes require authentication
router.use(authenticate);

// Get all pixels for workspace
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(pixelController.getPixels)
);

// Get pixel by ID
router.get('/:id', asyncHandler(pixelController.getPixelById));

// Create new pixel
router.post('/', 
  authorize(['admin', 'manager']),
  validate(schemas.createPixel), 
  asyncHandler(pixelController.createPixel)
);

// Update pixel
router.put('/:id', 
  authorize(['admin', 'manager']),
  asyncHandler(pixelController.updatePixel)
);

// Delete pixel
router.delete('/:id', 
  authorize(['admin']),
  asyncHandler(pixelController.deletePixel)
);

// Get pixel analytics
router.get('/:id/analytics', asyncHandler(pixelController.getPixelAnalytics));

// Get pixel events
router.get('/:id/events', 
  validateQuery(schemas.pagination),
  asyncHandler(pixelController.getPixelEvents)
);

// Test pixel connection
router.post('/:id/test', 
  authorize(['admin', 'manager']),
  asyncHandler(pixelController.testPixelConnection)
);

export default router;