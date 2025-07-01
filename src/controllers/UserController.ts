import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

export class UserController {
  async getUsers(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search, role, sortBy = 'created_at', sortOrder = 'desc' } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        is_active: true,
        last_login: true,
        created_at: true
      },
      where: {
        workspace_id: req.user!.workspaceId,
        AND: [
          {
            id: {
              gte: offset,
              lte: offset + Number(limit) - 1
            }
          },
          {
            role: role ? { equals: role } : undefined
          },
          {
            OR: [
              {
                name: {
                  contains: search,
                  mode: 'insensitive'
                }
              },
              {
                email: {
                  contains: search,
                  mode: 'insensitive'
                }
              }
            ]
          }
        ]
      },
      orderBy: {
        [sortBy as string]: sortOrder === 'asc' ? 'asc' : 'desc'
      },
      take: Number(limit),
      count: true
    });

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

    const { data: user, error } = await prisma.user.findUnique({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        is_active: true,
        last_login: true,
        created_at: true
      },
      where: {
        id: id,
        workspace_id: req.user!.workspaceId
      }
    });

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
    const { data: existingUser, error: fetchError } = await prisma.user.findUnique({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        is_active: true,
        last_login: true,
        created_at: true
      },
      where: {
        id: id,
        workspace_id: req.user!.workspaceId
      }
    });

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

    const { data: user, error } = await prisma.user.update({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        is_active: true,
        last_login: true,
        created_at: true
      },
      where: {
        id: id
      },
      data: updateData
    });

    if (error) {
      logger.error('Error updating user:', error);
      throw createError('Failed to update user', 500);
    }

    // Update workspace member role if changed
    if (role !== undefined) {
      await prisma.workspaceMember.updateMany({
        where: {
          user_id: id,
          workspace_id: req.user!.workspaceId
        },
        data: {
          role: role
        }
      });
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
    const { data: existingUser, error: fetchError } = await prisma.user.findUnique({
      select: {
        name: true
      },
      where: {
        id: id,
        workspace_id: req.user!.workspaceId
      }
    });

    if (fetchError || !existingUser) {
      throw createError('User not found', 404);
    }

    // Remove from workspace members
    await prisma.workspaceMember.deleteMany({
      where: {
        user_id: id,
        workspace_id: req.user!.workspaceId
      }
    });

    // Deactivate user instead of deleting
    const { error } = await prisma.user.update({
      where: {
        id: id
      },
      data: {
        is_active: false,
        updated_at: new Date().toISOString()
      }
    });

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
    const user = await prisma.user.findUnique({
      select: {
        id: true
      },
      where: {
        id: id,
        workspace_id: req.user!.workspaceId
      }
    });

    if (!user) {
      throw createError('User not found', 404);
    }

    const activities = await prisma.auditLog.findMany({
      where: {
        user_id: id,
        workspace_id: req.user!.workspaceId
      },
      orderBy: {
        created_at: 'desc'
      },
      skip: offset,
      take: Number(limit)
    });
    const count = await prisma.auditLog.count({
      where: {
        user_id: id,
        workspace_id: req.user!.workspaceId
      }
    });

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