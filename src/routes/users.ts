import { Router } from 'express';
import { UserController } from '../controllers/UserController';
import { authenticate, authorize } from '../middleware/auth';
import { validate, validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const userController = new UserController();

// All routes require authentication
router.use(authenticate);

// Get all users in workspace
router.get('/', 
  authorize(['admin', 'manager']),
  validateQuery(schemas.pagination), 
  asyncHandler(userController.getUsers)
);

// Get user by ID
router.get('/:id', 
  authorize(['admin', 'manager']),
  asyncHandler(userController.getUserById)
);

// Update user
router.put('/:id', 
  authorize(['admin']),
  asyncHandler(userController.updateUser)
);

// Delete user
router.delete('/:id', 
  authorize(['admin']),
  asyncHandler(userController.deleteUser)
);

// Get user activity
router.get('/:id/activity', 
  authorize(['admin', 'manager']),
  validateQuery(schemas.pagination),
  asyncHandler(userController.getUserActivity)
);

export default router;