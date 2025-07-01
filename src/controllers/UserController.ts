import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export class UserController {
  async getUsers(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, role, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = Database.query
      .select('id, name, email, role, avatar, is_active, last_login, created_at', { count: 'exact' })
      .eq('workspace_id', req.user!.workspaceId)
      .range(offset, offset + Number(limit) - 1)
      .order(sortBy as string, { ascending: sortOrder === 'asc' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    if (role) {
      query = query.eq('role', role);
    }

    const { data: users, error, count } = await query;

    if (error) {
      logger.error('Error fetching users:', error);
      throw createError('Failed to fetch users', 500);
    }

    res.json({
      success: true,
      data: users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async getUserById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    const { data: user, error } = await Database.query
      .select('id, name, email, role, avatar, is_active, last_login, created_at')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (error || !user) {
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
    const { data: existingUser, error: fetchError } = await Database.query
      .select('*')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingUser) {
      throw createError('User not found', 404);
    }

    // Prevent self-demotion from admin
    if (id === req.user!.id && role && role !== 'admin') {
      throw createError('Cannot change your own admin role', 400);
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (isActive !== undefined) updateData.is_active = isActive;

    const { data: user, error } = await Database.query
      .update(updateData)
      .eq('id', id)
      .select('id, name, email, role, avatar, is_active, last_login, created_at')
      .single();

    if (error) {
      logger.error('Error updating user:', error);
      throw createError('Failed to update user', 500);
    }

    // Update workspace member role if changed
    if (role !== undefined) {
      await Database.query
        .update({ role })
        .eq('user_id', id)
        .eq('workspace_id', req.user!.workspaceId);
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
    const { data: existingUser, error: fetchError } = await Database.query
      .select('name')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (fetchError || !existingUser) {
      throw createError('User not found', 404);
    }

    // Remove from workspace members
    await Database.query
      .delete()
      .eq('user_id', id)
      .eq('workspace_id', req.user!.workspaceId);

    // Deactivate user instead of deleting
    const { error } = await Database.query
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) {
      logger.error('Error deleting user:', error);
      throw createError('Failed to delete user', 500);
    }

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
    const { data: user, error: userError } = await Database.query
      .select('id')
      .eq('id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .single();

    if (userError || !user) {
      throw createError('User not found', 404);
    }

    const { data: activities, error, count } = await Database.query
      .select('*', { count: 'exact' })
      .eq('user_id', id)
      .eq('workspace_id', req.user!.workspaceId)
      .range(offset, offset + Number(limit) - 1)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching user activity:', error);
      throw createError('Failed to fetch user activity', 500);
    }

    res.json({
      success: true,
      data: activities,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }
}