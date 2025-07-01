import { Router } from 'express';
import { WorkspaceController } from '../controllers/WorkspaceController';
import { authenticate, authorize } from '../middleware/auth';
import { validate, validateQuery, schemas } from '../middleware/validation';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const workspaceController = new WorkspaceController();

// All routes require authentication
router.use(authenticate);

// Get user's workspaces
router.get('/', 
  validateQuery(schemas.pagination), 
  asyncHandler(workspaceController.getWorkspaces)
);

// Create new workspace
router.post('/', 
  validate(schemas.createWorkspace), 
  asyncHandler(workspaceController.createWorkspace)
);

// Get workspace by ID
router.get('/:id', asyncHandler(workspaceController.getWorkspaceById));

// Update workspace
router.put('/:id', 
  authorize(['admin']),
  asyncHandler(workspaceController.updateWorkspace)
);

// Delete workspace
router.delete('/:id', 
  authorize(['admin']),
  asyncHandler(workspaceController.deleteWorkspace)
);

// Get workspace members
router.get('/:id/members', 
  authorize(['admin', 'manager']),
  validateQuery(schemas.pagination),
  asyncHandler(workspaceController.getWorkspaceMembers)
);

// Invite member to workspace
router.post('/:id/invite', 
  authorize(['admin', 'manager']),
  validate(schemas.inviteMember),
  asyncHandler(workspaceController.inviteMember)
);

// Remove member from workspace
router.delete('/:id/members/:userId', 
  authorize(['admin']),
  asyncHandler(workspaceController.removeMember)
);

// Update member role
router.put('/:id/members/:userId', 
  authorize(['admin']),
  asyncHandler(workspaceController.updateMemberRole)
);

// Get workspace analytics
router.get('/:id/analytics', asyncHandler(workspaceController.getWorkspaceAnalytics));

export default router;