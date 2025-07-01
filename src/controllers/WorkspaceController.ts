import { Response } from 'express';
import { supabase } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WorkspaceController {
  async getWorkspaces(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    let query = supabase
      .from('workspace_members')
      .select(`
        workspaces!inner(id, name, slug, description, is_active, created_at),
        role
      `, { count: 'exact' })
      .eq('user_id', req.user!.id)
      .range(offset, offset + Number(limit) - 1)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('workspaces.name', `%${search}%`);
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
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        id: workspaceId,
        name,
        slug,
        description,
        owner_id: req.user!.id,
        settings: {},
        is_active: true
      })
      .select()
      .single();

    if (workspaceError) {
      logger.error('Error creating workspace:', workspaceError);
      throw createError('Failed to create workspace', 500);
    }

    // Add user as admin member
    const { error: memberError } = await supabase
      .from('workspace_members')
      .insert({
        id: uuidv4(),
        workspace_id: workspaceId,
        user_id: req.user!.id,
        role: 'admin',
        invited_by: req.user!.id,
        joined_at: new Date().toISOString()
      });

    if (memberError) {
      logger.error('Error adding workspace member:', memberError);
      // Cleanup workspace
      await supabase.from('workspaces').delete().eq('id', workspaceId);
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
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (memberError || !member) {
      throw createError('Workspace not found', 404);
    }

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .single();

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
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .eq('role', 'admin')
      .single();

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

    const { data: workspace, error } = await supabase
      .from('workspaces')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

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
    const { data: workspace, error: workspaceError } = await supabase
      .from('workspaces')
      .select('owner_id, name')
      .eq('id', id)
      .eq('owner_id', req.user!.id)
      .single();

    if (workspaceError || !workspace) {
      throw createError('Workspace not found or access denied', 404);
    }

    // Delete workspace (cascade will handle related data)
    const { error } = await supabase
      .from('workspaces')
      .delete()
      .eq('id', id);

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
    const { data: userMember, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (memberError || !userMember) {
      throw createError('Workspace not found', 404);
    }

    let query = supabase
      .from('workspace_members')
      .select(`
        id, role, joined_at, created_at,
        users!inner(id, name, email, avatar, last_login)
      `, { count: 'exact' })
      .eq('workspace_id', id)
      .range(offset, offset + Number(limit) - 1)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.or(`users.name.ilike.%${search}%,users.email.ilike.%${search}%`);
    }

    if (role) {
      query = query.eq('role', role);
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
    const { data: userMember, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .single();

    if (memberError || !userMember || !['admin', 'manager'].includes(userMember.role)) {
      throw createError('Access denied', 403);
    }

    // Check if user exists
    const { data: invitedUser, error: userError } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', email)
      .single();

    if (userError || !invitedUser) {
      throw createError('User not found', 404);
    }

    // Check if user is already a member
    const { data: existingMember } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', id)
      .eq('user_id', invitedUser.id)
      .single();

    if (existingMember) {
      throw createError('User is already a member of this workspace', 409);
    }

    // Add member to workspace
    const { data: member, error } = await supabase
      .from('workspace_members')
      .insert({
        id: uuidv4(),
        workspace_id: id,
        user_id: invitedUser.id,
        role,
        invited_by: req.user!.id,
        joined_at: new Date().toISOString()
      })
      .select(`
        id, role, joined_at, created_at,
        users!inner(id, name, email, avatar)
      `)
      .single();

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
    const { data: userMember, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .eq('role', 'admin')
      .single();

    if (memberError || !userMember) {
      throw createError('Access denied', 403);
    }

    // Prevent removing workspace owner
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (workspace?.owner_id === userId) {
      throw createError('Cannot remove workspace owner', 400);
    }

    // Remove member
    const { error } = await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', id)
      .eq('user_id', userId);

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
    const { data: userMember, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .eq('role', 'admin')
      .single();

    if (memberError || !userMember) {
      throw createError('Access denied', 403);
    }

    // Prevent changing workspace owner role
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('owner_id')
      .eq('id', id)
      .single();

    if (workspace?.owner_id === userId && role !== 'admin') {
      throw createError('Cannot change workspace owner role', 400);
    }

    // Update member role
    const { data: member, error } = await supabase
      .from('workspace_members')
      .update({ role })
      .eq('workspace_id', id)
      .eq('user_id', userId)
      .select(`
        id, role, joined_at, created_at,
        users!inner(id, name, email, avatar)
      `)
      .single();

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
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', id)
      .eq('user_id', req.user!.id)
      .single();

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
      supabase
        .from('pixels')
        .select('id, status')
        .eq('workspace_id', id),
      
      // Events in timeframe
      supabase
        .from('events')
        .select(`
          event_name, timestamp, parameters,
          pixels!inner(workspace_id)
        `)
        .eq('pixels.workspace_id', id)
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString()),
      
      // Conversions
      supabase
        .from('conversions')
        .select(`
          total_conversions, total_value,
          pixels!inner(workspace_id)
        `)
        .eq('pixels.workspace_id', id)
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