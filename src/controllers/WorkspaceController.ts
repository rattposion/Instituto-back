import { Response } from 'express';
import { prisma } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WorkspaceController {
  async getWorkspaces(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = prisma.workspaceMember.findMany({
      select: {
        workspaces: {
          select: {
            id: true,
            name: true,
            slug: true,
            description: true,
            is_active: true,
            created_at: true
          }
        },
        role: true
      },
      where: {
        userId: req.user!.id
      },
      skip: offset,
      take: Number(limit),
      orderBy: {
        created_at: 'desc'
      }
    });

    if (search) {
      query = prisma.workspaceMember.findMany({
        select: {
          workspaces: {
            select: {
              name: true
            },
            where: {
              name: {
                contains: search,
                mode: 'insensitive'
              }
            }
          },
          role: true
        },
        where: {
          userId: req.user!.id
        },
        skip: offset,
        take: Number(limit),
        orderBy: {
          created_at: 'desc'
        }
      });
    }

    const { data: workspaceMembers, error, count } = await query;

    if (error) {
      logger.error('Error fetching workspaces:', error);
      throw createError('Failed to fetch workspaces', 500);
    }

    const workspaces = workspaceMembers?.map(member => ({
      ...member.workspaces,
      role: member.role
    })) || [];

    res.json({
      success: true,
      data: workspaces,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async createWorkspace(req: AuthRequest, res: Response) {
    const { name, description } = req.body;

    const workspaceId = uuidv4();
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Create workspace
    const { data: workspace, error: workspaceError } = await prisma.workspace.create({
      data: {
        id: workspaceId,
        name,
        slug,
        description,
        owner_id: req.user!.id,
        settings: {},
        is_active: true
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        owner_id: true,
        settings: true,
        is_active: true,
        created_at: true
      }
    });

    if (workspaceError) {
      logger.error('Error creating workspace:', workspaceError);
      throw createError('Failed to create workspace', 500);
    }

    // Add user as admin member
    const { error: memberError } = await prisma.workspaceMember.create({
      data: {
        id: uuidv4(),
        workspace_id: workspaceId,
        user_id: req.user!.id,
        role: 'admin',
        invited_by: req.user!.id,
        joined_at: new Date().toISOString()
      }
    });

    if (memberError) {
      logger.error('Error adding workspace member:', memberError);
      // Cleanup workspace
      await prisma.workspace.delete({
        where: {
          id: workspaceId
        }
      });
      throw createError('Failed to create workspace', 500);
    }

    res.status(201).json({
      success: true,
      data: workspace
    });
  }

  async getWorkspaceById(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if user has access to workspace
    const { data: member, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id
      }
    });

    if (memberError || !member) {
      throw createError('Workspace not found', 404);
    }

    const { data: workspace, error } = await prisma.workspace.findUnique({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        is_active: true,
        created_at: true,
        settings: true
      },
      where: {
        id: id
      }
    });

    if (error || !workspace) {
      throw createError('Workspace not found', 404);
    }

    res.json({
      success: true,
      data: {
        ...workspace,
        role: member.role
      }
    });
  }

  async updateWorkspace(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { name, description, settings } = req.body;

    // Check if user is admin of workspace
    const { data: member, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id,
        role: 'admin'
      }
    });

    if (memberError || !member) {
      throw createError('Access denied', 403);
    }

    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) {
      updateData.name = name;
      updateData.slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    }
    if (description !== undefined) updateData.description = description;
    if (settings !== undefined) updateData.settings = settings;

    const { data: workspace, error } = await prisma.workspace.update({
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        is_active: true,
        created_at: true,
        settings: true
      },
      where: {
        id: id
      },
      data: updateData
    });

    if (error) {
      logger.error('Error updating workspace:', error);
      throw createError('Failed to update workspace', 500);
    }

    res.json({
      success: true,
      data: workspace
    });
  }

  async deleteWorkspace(req: AuthRequest, res: Response) {
    const { id } = req.params;

    // Check if user is owner of workspace
    const { data: workspace, error: workspaceError } = await prisma.workspace.findFirst({
      select: {
        owner_id: true,
        name: true
      },
      where: {
        id: id,
        owner_id: req.user!.id
      }
    });

    if (workspaceError || !workspace) {
      throw createError('Workspace not found or access denied', 404);
    }

    // Delete workspace (cascade will handle related data)
    const { error } = await prisma.workspace.delete({
      where: {
        id: id
      }
    });

    if (error) {
      logger.error('Error deleting workspace:', error);
      throw createError('Failed to delete workspace', 500);
    }

    res.json({
      success: true,
      message: 'Workspace deleted successfully'
    });
  }

  async getWorkspaceMembers(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    // Check if user has access to workspace
    const { data: userMember, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id
      }
    });

    if (memberError || !userMember) {
      throw createError('Workspace not found', 404);
    }

    let query = prisma.workspaceMember.findMany({
      select: {
        id: true,
        role: true,
        joined_at: true,
        created_at: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
            last_login: true
          }
        }
      },
      where: {
        workspace_id: id
      },
      skip: offset,
      take: Number(limit),
      orderBy: {
        created_at: 'desc'
      }
    });

    if (search) {
      query = prisma.workspaceMember.findMany({
        select: {
          id: true,
          role: true,
          joined_at: true,
          created_at: true,
          users: {
            select: {
              name: true,
              email: true
            },
            where: {
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
          }
        },
        where: {
          workspace_id: id
        },
        skip: offset,
        take: Number(limit),
        orderBy: {
          created_at: 'desc'
        }
      });
    }

    if (role) {
      query = prisma.workspaceMember.findMany({
        select: {
          id: true,
          role: true,
          joined_at: true,
          created_at: true,
          users: {
            select: {
              name: true,
              email: true
            },
            where: {
              role: role
            }
          }
        },
        where: {
          workspace_id: id
        },
        skip: offset,
        take: Number(limit),
        orderBy: {
          created_at: 'desc'
        }
      });
    }

    const { data: members, error, count } = await query;

    if (error) {
      logger.error('Error fetching workspace members:', error);
      throw createError('Failed to fetch members', 500);
    }

    res.json({
      success: true,
      data: members,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count || 0,
        totalPages: Math.ceil((count || 0) / Number(limit))
      }
    });
  }

  async inviteMember(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { email, role } = req.body;

    // Check if user can invite to workspace
    const { data: userMember, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id
      }
    });

    if (memberError || !userMember || !['admin', 'manager'].includes(userMember.role)) {
      throw createError('Access denied', 403);
    }

    // Check if user exists
    const { data: invitedUser, error: userError } = await prisma.user.findUnique({
      select: {
        id: true,
        name: true
      },
      where: {
        email: email
      }
    });

    if (userError || !invitedUser) {
      throw createError('User not found', 404);
    }

    // Check if user is already a member
    const { data: existingMember } = await prisma.workspaceMember.findFirst({
      select: {
        id: true
      },
      where: {
        workspace_id: id,
        user_id: invitedUser.id
      }
    });

    if (existingMember) {
      throw createError('User is already a member of this workspace', 409);
    }

    // Add member to workspace
    const { data: member, error } = await prisma.workspaceMember.create({
      select: {
        id: true,
        role: true,
        joined_at: true,
        created_at: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true
          }
        }
      },
      data: {
        id: uuidv4(),
        workspace_id: id,
        user_id: invitedUser.id,
        role,
        invited_by: req.user!.id,
        joined_at: new Date().toISOString()
      }
    });

    if (error) {
      logger.error('Error inviting member:', error);
      throw createError('Failed to invite member', 500);
    }

    // TODO: Send invitation email

    res.status(201).json({
      success: true,
      data: member
    });
  }

  async removeMember(req: AuthRequest, res: Response) {
    const { id, userId } = req.params;

    // Check if user is admin of workspace
    const { data: userMember, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id,
        role: 'admin'
      }
    });

    if (memberError || !userMember) {
      throw createError('Access denied', 403);
    }

    // Prevent removing workspace owner
    const { data: workspace } = await prisma.workspace.findFirst({
      select: {
        owner_id: true
      },
      where: {
        id: id
      }
    });

    if (workspace?.owner_id === userId) {
      throw createError('Cannot remove workspace owner', 400);
    }

    // Remove member
    const { error } = await prisma.workspaceMember.delete({
      where: {
        workspace_id_user_id: {
          workspace_id: id,
          user_id: userId
        }
      }
    });

    if (error) {
      logger.error('Error removing member:', error);
      throw createError('Failed to remove member', 500);
    }

    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  }

  async updateMemberRole(req: AuthRequest, res: Response) {
    const { id, userId } = req.params;
    const { role } = req.body;

    // Check if user is admin of workspace
    const { data: userMember, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id,
        role: 'admin'
      }
    });

    if (memberError || !userMember) {
      throw createError('Access denied', 403);
    }

    // Prevent changing workspace owner role
    const { data: workspace } = await prisma.workspace.findFirst({
      select: {
        owner_id: true
      },
      where: {
        id: id
      }
    });

    if (workspace?.owner_id === userId && role !== 'admin') {
      throw createError('Cannot change workspace owner role', 400);
    }

    // Update member role
    const { data: member, error } = await prisma.workspaceMember.update({
      select: {
        id: true,
        role: true,
        joined_at: true,
        created_at: true,
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true
          }
        }
      },
      where: {
        workspace_id_user_id: {
          workspace_id: id,
          user_id: userId
        }
      },
      data: {
        role: role
      }
    });

    if (error) {
      logger.error('Error updating member role:', error);
      throw createError('Failed to update member role', 500);
    }

    res.json({
      success: true,
      data: member
    });
  }

  async getWorkspaceAnalytics(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;

    // Check if user has access to workspace
    const { data: member, error: memberError } = await prisma.workspaceMember.findFirst({
      select: {
        role: true
      },
      where: {
        workspace_id: id,
        user_id: req.user!.id
      }
    });

    if (memberError || !member) {
      throw createError('Workspace not found', 404);
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeframe) {
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default:
        startDate.setDate(startDate.getDate() - 7);
    }

    // Get workspace statistics
    const [pixelsResult, eventsResult, conversionsResult] = await Promise.all([
      // Pixels count
      prisma.pixel.findMany({
        select: {
          id: true,
          status: true
        },
        where: {
          workspace_id: id
        }
      }),
      
      // Events in timeframe
      prisma.event.findMany({
        select: {
          event_name: true,
          timestamp: true,
          parameters: true,
          pixels: {
            select: {
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            some: {
              workspace_id: id
            }
          },
          timestamp: {
            gte: startDate.toISOString(),
            lte: endDate.toISOString()
          }
        }
      }),
      
      // Conversions
      prisma.conversion.findMany({
        select: {
          total_conversions: true,
          total_value: true,
          pixels: {
            select: {
              workspace_id: true
            }
          }
        },
        where: {
          pixels: {
            some: {
              workspace_id: id
            }
          }
        }
      })
    ]);

    const pixels = pixelsResult.data || [];
    const events = eventsResult.data || [];
    const conversions = conversionsResult.data || [];

    const analytics = {
      pixels: {
        total: pixels.length,
        active: pixels.filter(p => p.status === 'active').length,
        inactive: pixels.filter(p => p.status === 'inactive').length,
        error: pixels.filter(p => p.status === 'error').length
      },
      events: {
        total: events.length,
        byDay: this.groupEventsByDay(events),
        byType: this.groupEventsByType(events)
      },
      conversions: {
        total: conversions.reduce((sum, c) => sum + c.total_conversions, 0),
        totalValue: conversions.reduce((sum, c) => sum + parseFloat(c.total_value || 0), 0)
      }
    };

    res.json({
      success: true,
      data: analytics
    });
  }

  private groupEventsByDay(events: any[]) {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return grouped;
  }

  private groupEventsByType(events: any[]) {
    const grouped: { [key: string]: number } = {};
    events.forEach(event => {
      grouped[event.event_name] = (grouped[event.event_name] || 0) + 1;
    });
    return grouped;
  }
}