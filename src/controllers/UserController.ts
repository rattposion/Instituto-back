import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export class UserController {
  async getUsers(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, role, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let baseQuery = 'SELECT id, name, email, role, avatar, is_active, last_login, created_at FROM users WHERE workspace_id = $1';
    let params: any[] = [req.user!.workspaceId];
    let countQuery = 'SELECT COUNT(*) FROM users WHERE workspace_id = $1';
    let countParams: any[] = [req.user!.workspaceId];
    if (search) {
      baseQuery += ' AND (name ILIKE $2 OR email ILIKE $2)';
      countQuery += ' AND (name ILIKE $2 OR email ILIKE $2)';
      params.push(`%${search}%`);
      countParams.push(`%${search}%`);
    }
    if (role) {
      baseQuery += ` AND role = $${params.length + 1}`;
      countQuery += ` AND role = $${countParams.length + 1}`;
      params.push(role);
      countParams.push(role);
    }
    baseQuery += ` ORDER BY ${sortBy} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);
    const usersResult = await Database.query(baseQuery, params);
    const countResult = await Database.query(countQuery, countParams);
    const users = usersResult.rows;
    const count = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit))
      }
    });
  }

  async getUserById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const result = await Database.query(
      'SELECT id, name, email, role, avatar, is_active, last_login, created_at FROM users WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    const user = result.rows[0];
    if (!user) {
      throw createError('User not found', 404);
    }
    res.json({
      success: true,
      data: user
    });
  }

  async updateUser(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, role, isActive } = req.body;
    // Check if user exists and belongs to workspace
    const existingResult = await Database.query(
      'SELECT * FROM users WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (existingResult.rows.length === 0) {
      throw createError('User not found', 404);
    }
    // Prevent self-demotion from admin
    if (id === req.user!.id && role && role !== 'admin') {
      throw createError('Cannot change your own admin role', 400);
    }
    const updateResult = await Database.query(
      'UPDATE users SET name = $1, role = $2, is_active = $3, updated_at = $4 WHERE id = $5 RETURNING id, name, email, role, avatar, is_active, last_login, created_at',
      [name, role, isActive, new Date().toISOString(), id]
    );
    const user = updateResult.rows[0];
    // Update workspace member role if changed
    if (role !== undefined) {
      await Database.query(
        'UPDATE workspace_members SET role = $1 WHERE user_id = $2 AND workspace_id = $3',
        [role, id, req.user!.workspaceId]
      );
    }
    res.json({
      success: true,
      data: user
    });
  }

  async deleteUser(req: AuthRequest, res: Response) {
    const { id } = req.params;
    // Prevent self-deletion
    if (id === req.user!.id) {
      throw createError('Cannot delete your own account', 400);
    }
    // Check if user exists and belongs to workspace
    const existingResult = await Database.query(
      'SELECT name FROM users WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (existingResult.rows.length === 0) {
      throw createError('User not found', 404);
    }
    // Remove from workspace members
    await Database.query(
      'DELETE FROM workspace_members WHERE user_id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );
    // Deactivate user instead of deleting
    await Database.query(
      'UPDATE users SET is_active = false, updated_at = $1 WHERE id = $2',
      [new Date().toISOString(), id]
    );
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  }

  async getUserActivity(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    // Check if user exists and belongs to workspace
    const userResult = await Database.query(
      'SELECT id FROM users WHERE id = $1 AND workspace_id = $2 LIMIT 1',
      [id, req.user!.workspaceId]
    );
    if (userResult.rows.length === 0) {
      throw createError('User not found', 404);
    }
    const activitiesResult = await Database.query(
      'SELECT * FROM audit_logs WHERE user_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4',
      [id, req.user!.workspaceId, limit, offset]
    );
    const countResult = await Database.query(
      'SELECT COUNT(*) FROM audit_logs WHERE user_id = $1 AND workspace_id = $2',
      [id, req.user!.workspaceId]
    );
    const activities = activitiesResult.rows;
    const count = parseInt(countResult.rows[0].count, 10);
    res.json({
      success: true,
      data: activities,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / Number(limit))
      }
    });
  }
}