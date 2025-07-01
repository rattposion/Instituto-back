import { Router } from 'express';
import { EventController } from '../controllers/EventController';
import { authenticate, authorize } from '../middleware/auth';
import { validate, validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const eventController = new EventController();

// All routes require authentication
router.use(authenticate);

// Get all events for workspace
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(eventController.getEvents)
);

// Create new event
router.post('/', 
  validate(schemas.createEvent), 
  asyncHandler(eventController.createEvent)
);

// Get event by ID
router.get('/:id', asyncHandler(eventController.getEventById));

// Bulk create events
router.post('/bulk', 
  authorize(['admin', 'manager']),
  asyncHandler(eventController.bulkCreateEvents)
);

// Get events analytics
router.get('/analytics/summary', asyncHandler(eventController.getEventsAnalytics));

// Reprocess failed events
router.post('/reprocess', 
  authorize(['admin', 'manager']),
  asyncHandler(eventController.reprocessFailedEvents)
);

export default router;