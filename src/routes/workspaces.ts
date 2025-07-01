import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticateToken, AuthRequest, requireRole } from '../middleware/auth';
import { validate, validateQuery, validateParams } from '../middleware/validation';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import Joi from 'joi';

const router = Router();

// Validation schemas
const createWorkspaceSchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional()
});

const updateWorkspaceSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional()
});

const inviteMemberSchema = Joi.object({
  email: Joi.string().email().required(),
  role: Joi.string().valid('admin', 'manager', 'viewer').required()
});

const updateMemberSchema = Joi.object({
  role: Joi.string().valid('admin', 'manager', 'viewer').required()
});

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  search: Joi.string().max(100).optional()
});

const paramsSchema = Joi.object({
  id: Joi.string().uuid().required()
});

// Get all workspaces for user
router.get('/', authenticateToken, validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { page = 1, limit = 20, search } = req.query as any;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE wm.user_id = $1';
    const queryParams: any[] = [req.user!.id];
    let paramCount = 2;

    if (search) {
      whereClause += ` AND (w.name ILIKE $${paramCount} OR w.description ILIKE $${paramCount})`;
      queryParams.push(`%${search}%`);
      paramCount++;
    }

    // Get workspaces with member info
    const workspacesResult = await query(
      `SELECT 
        w.*,
        wm.role,
        wm.created_at as joined_at,
        (w.owner_id = $1) as is_owner,
        COUNT(DISTINCT wm2.user_id) as member_count,
        COUNT(DISTINCT p.id) as pixel_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      LEFT JOIN workspace_members wm2 ON w.id = wm2.workspace_id
      LEFT JOIN pixels p ON w.id = p.workspace_id
      ${whereClause}
      GROUP BY w.id, wm.role, wm.created_at
      ORDER BY w.created_at DESC
      LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...queryParams, limit, offset]
    );

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) as total 
       FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       ${whereClause}`,
      queryParams
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        workspaces: workspacesResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get single workspace
router.get('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if user has access to workspace
    const workspaceResult = await query(
      `SELECT 
        w.*,
        wm.role,
        (w.owner_id = $2) as is_owner,
        COUNT(DISTINCT wm2.user_id) as member_count,
        COUNT(DISTINCT p.id) as pixel_count
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      LEFT JOIN workspace_members wm2 ON w.id = wm2.workspace_id
      LEFT JOIN pixels p ON w.id = p.workspace_id
      WHERE w.id = $1 AND wm.user_id = $2
      GROUP BY w.id, wm.role`,
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found', 404);
    }

    res.json({
      success: true,
      data: workspaceResult.rows[0]
    });
  } catch (error) {
    next(error);
  }
});

// Create workspace
router.post('/', authenticateToken, validate(createWorkspaceSchema), async (req: AuthRequest, res, next) => {
  try {
    const { name, description } = req.body;

    // Generate slug from name
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    // Check if slug already exists
    const existingWorkspace = await query('SELECT id FROM workspaces WHERE slug = $1', [slug]);
    if (existingWorkspace.rows.length > 0) {
      throw createError('Workspace with this name already exists', 400);
    }

    // Start transaction
    await query('BEGIN');

    try {
      // Create workspace
      const workspaceId = uuidv4();
      await query(
        'INSERT INTO workspaces (id, name, slug, description, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [workspaceId, name, slug, description, req.user!.id]
      );

      // Add creator as admin member
      await query(
        'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
        [uuidv4(), workspaceId, req.user!.id, 'admin']
      );

      await query('COMMIT');

      // Get created workspace
      const createdWorkspace = await query(
        `SELECT 
          w.*,
          true as is_owner,
          1 as member_count,
          0 as pixel_count
        FROM workspaces w
        WHERE w.id = $1`,
        [workspaceId]
      );

      res.status(201).json({
        success: true,
        data: createdWorkspace.rows[0]
      });

      logger.info(`Workspace created: ${name} by user ${req.user!.id}`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Update workspace
router.put('/:id', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), validate(updateWorkspaceSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // Check if user is workspace owner or admin
    const workspaceResult = await query(
      `SELECT w.id FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE w.id = $1 AND wm.user_id = $2 AND (w.owner_id = $2 OR wm.role = 'admin')`,
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found or insufficient permissions', 404);
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name) {
      // Generate new slug
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      
      // Check if slug already exists (excluding current workspace)
      const existingWorkspace = await query('SELECT id FROM workspaces WHERE slug = $1 AND id != $2', [slug, id]);
      if (existingWorkspace.rows.length > 0) {
        throw createError('Workspace with this name already exists', 400);
      }

      updates.push(`name = $${paramCount++}`);
      values.push(name);
      updates.push(`slug = $${paramCount++}`);
      values.push(slug);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }

    if (updates.length === 0) {
      throw createError('No fields to update', 400);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    await query(
      `UPDATE workspaces SET ${updates.join(', ')} WHERE id = $${paramCount}`,
      values
    );

    // Get updated workspace
    const updatedWorkspace = await query(
      `SELECT 
        w.*,
        (w.owner_id = $2) as is_owner,
        COUNT(DISTINCT wm.user_id) as member_count,
        COUNT(DISTINCT p.id) as pixel_count
      FROM workspaces w
      LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
      LEFT JOIN pixels p ON w.id = p.workspace_id
      WHERE w.id = $1
      GROUP BY w.id`,
      [id, req.user!.id]
    );

    res.json({
      success: true,
      data: updatedWorkspace.rows[0]
    });

    logger.info(`Workspace updated: ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Delete workspace
router.delete('/:id', authenticateToken, validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;

    // Check if user is workspace owner
    const workspaceResult = await query(
      'SELECT id, name FROM workspaces WHERE id = $1 AND owner_id = $2',
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found or you are not the owner', 404);
    }

    // Start transaction to delete workspace and all related data
    await query('BEGIN');

    try {
      // Delete related data in correct order
      await query('DELETE FROM integration_pixels WHERE integration_id IN (SELECT id FROM integrations WHERE workspace_id = $1)', [id]);
      await query('DELETE FROM integrations WHERE workspace_id = $1', [id]);
      await query('DELETE FROM diagnostics WHERE pixel_id IN (SELECT id FROM pixels WHERE workspace_id = $1)', [id]);
      await query('DELETE FROM conversions WHERE pixel_id IN (SELECT id FROM pixels WHERE workspace_id = $1)', [id]);
      await query('DELETE FROM events WHERE pixel_id IN (SELECT id FROM pixels WHERE workspace_id = $1)', [id]);
      await query('DELETE FROM pixels WHERE workspace_id = $1', [id]);
      await query('DELETE FROM workspace_members WHERE workspace_id = $1', [id]);
      await query('DELETE FROM workspaces WHERE id = $1', [id]);

      await query('COMMIT');

      res.json({
        success: true,
        message: 'Workspace deleted successfully'
      });

      logger.info(`Workspace deleted: ${workspaceResult.rows[0].name} (${id}) by user ${req.user!.id}`);
    } catch (error) {
      await query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    next(error);
  }
});

// Get workspace members
router.get('/:id/members', authenticateToken, validateParams(paramsSchema), validateQuery(querySchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query as any;
    const offset = (page - 1) * limit;

    // Check if user has access to workspace
    const accessCheck = await query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [id, req.user!.id]
    );

    if (accessCheck.rows.length === 0) {
      throw createError('Workspace not found', 404);
    }

    // Get members
    const membersResult = await query(
      `SELECT 
        wm.id,
        wm.role,
        wm.created_at as joined_at,
        u.id as user_id,
        u.name,
        u.email,
        u.avatar,
        u.last_login,
        (w.owner_id = u.id) as is_owner
      FROM workspace_members wm
      JOIN users u ON wm.user_id = u.id
      JOIN workspaces w ON wm.workspace_id = w.id
      WHERE wm.workspace_id = $1
      ORDER BY wm.created_at ASC
      LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) as total FROM workspace_members WHERE workspace_id = $1',
      [id]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        members: membersResult.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Invite member to workspace
router.post('/:id/invite', authenticateToken, requireRole(['admin', 'manager']), validateParams(paramsSchema), validate(inviteMemberSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { email, role } = req.body;

    // Check if user has permission to invite to this workspace
    const workspaceResult = await query(
      `SELECT w.id, w.name FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE w.id = $1 AND wm.user_id = $2 AND wm.role IN ('admin', 'manager')`,
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found or insufficient permissions', 404);
    }

    // Check if user exists
    const userResult = await query('SELECT id, name FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      throw createError('User with this email does not exist', 404);
    }

    const invitedUser = userResult.rows[0];

    // Check if user is already a member
    const existingMember = await query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [id, invitedUser.id]
    );

    if (existingMember.rows.length > 0) {
      throw createError('User is already a member of this workspace', 400);
    }

    // Add user to workspace
    await query(
      'INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [uuidv4(), id, invitedUser.id, role]
    );

    res.json({
      success: true,
      message: `${invitedUser.name} has been invited to the workspace`,
      data: {
        userId: invitedUser.id,
        name: invitedUser.name,
        email: email,
        role: role
      }
    });

    logger.info(`User ${invitedUser.id} invited to workspace ${id} with role ${role} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Update member role
router.put('/:id/members/:memberId', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), validate(updateMemberSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id, memberId } = req.params;
    const { role } = req.body;

    // Check if user has permission to update members in this workspace
    const workspaceResult = await query(
      `SELECT w.id, w.owner_id FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE w.id = $1 AND wm.user_id = $2 AND wm.role = 'admin'`,
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found or insufficient permissions', 404);
    }

    const workspace = workspaceResult.rows[0];

    // Check if member exists in workspace
    const memberResult = await query(
      'SELECT id, user_id FROM workspace_members WHERE id = $1 AND workspace_id = $2',
      [memberId, id]
    );

    if (memberResult.rows.length === 0) {
      throw createError('Member not found', 404);
    }

    const member = memberResult.rows[0];

    // Prevent changing owner's role
    if (member.user_id === workspace.owner_id) {
      throw createError('Cannot change workspace owner role', 400);
    }

    // Prevent user from changing their own role
    if (member.user_id === req.user!.id) {
      throw createError('Cannot change your own role', 400);
    }

    // Update member role
    await query(
      'UPDATE workspace_members SET role = $1, updated_at = NOW() WHERE id = $2',
      [role, memberId]
    );

    res.json({
      success: true,
      message: 'Member role updated successfully'
    });

    logger.info(`Member ${memberId} role updated to ${role} in workspace ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Remove member from workspace
router.delete('/:id/members/:memberId', authenticateToken, requireRole(['admin']), validateParams(paramsSchema), async (req: AuthRequest, res, next) => {
  try {
    const { id, memberId } = req.params;

    // Check if user has permission to remove members from this workspace
    const workspaceResult = await query(
      `SELECT w.id, w.owner_id FROM workspaces w
       JOIN workspace_members wm ON w.id = wm.workspace_id
       WHERE w.id = $1 AND wm.user_id = $2 AND wm.role = 'admin'`,
      [id, req.user!.id]
    );

    if (workspaceResult.rows.length === 0) {
      throw createError('Workspace not found or insufficient permissions', 404);
    }

    const workspace = workspaceResult.rows[0];

    // Check if member exists in workspace
    const memberResult = await query(
      'SELECT id, user_id FROM workspace_members WHERE id = $1 AND workspace_id = $2',
      [memberId, id]
    );

    if (memberResult.rows.length === 0) {
      throw createError('Member not found', 404);
    }

    const member = memberResult.rows[0];

    // Prevent removing workspace owner
    if (member.user_id === workspace.owner_id) {
      throw createError('Cannot remove workspace owner', 400);
    }

    // Prevent user from removing themselves
    if (member.user_id === req.user!.id) {
      throw createError('Cannot remove yourself from workspace', 400);
    }

    // Remove member
    await query('DELETE FROM workspace_members WHERE id = $1', [memberId]);

    res.json({
      success: true,
      message: 'Member removed from workspace successfully'
    });

    logger.info(`Member ${memberId} removed from workspace ${id} by user ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

export default router;