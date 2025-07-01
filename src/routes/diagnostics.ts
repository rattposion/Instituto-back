import { Router } from 'express';
import { DiagnosticController } from '../controllers/DiagnosticController';
import { authenticate, authorize } from '../middleware/auth';
import { validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const diagnosticController = new DiagnosticController();

// All routes require authentication
router.use(authenticate);

// Get all diagnostics for workspace
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(diagnosticController.getDiagnostics)
);

// Get diagnostic by ID
router.get('/:id', asyncHandler(diagnosticController.getDiagnosticById));

// Run diagnostics for pixel
router.post('/run/:pixelId', 
  authorize(['admin', 'manager']),
  asyncHandler(diagnosticController.runDiagnostics)
);

// Resolve diagnostic
router.put('/:id/resolve', 
  authorize(['admin', 'manager']),
  asyncHandler(diagnosticController.resolveDiagnostic)
);

// Get diagnostics summary
router.get('/summary/stats', asyncHandler(diagnosticController.getDiagnosticsSummary));

// Export diagnostics report
router.get('/export/report', 
  authorize(['admin', 'manager']),
  asyncHandler(diagnosticController.exportDiagnosticsReport)
);

export default router;