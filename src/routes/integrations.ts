import { Router } from 'express';
import { IntegrationController } from '../controllers/IntegrationController';
import { authenticate, authorize } from '../middleware/auth';
import { validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const integrationController = new IntegrationController();

// All routes require authentication
router.use(authenticate);

// Get all integrations for workspace
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(integrationController.getIntegrations)
);

// Create new integration
router.post('/', 
  authorize(['admin', 'manager']),
  asyncHandler(integrationController.createIntegration)
);

// Get integration by ID
router.get('/:id', asyncHandler(integrationController.getIntegrationById));

// Update integration
router.put('/:id', 
  authorize(['admin', 'manager']),
  asyncHandler(integrationController.updateIntegration)
);

// Delete integration
router.delete('/:id', 
  authorize(['admin']),
  asyncHandler(integrationController.deleteIntegration)
);

// Test integration connection
router.post('/:id/test', 
  authorize(['admin', 'manager']),
  asyncHandler(integrationController.testIntegration)
);

// Sync integration
router.post('/:id/sync', 
  authorize(['admin', 'manager']),
  asyncHandler(integrationController.syncIntegration)
);

export default router;