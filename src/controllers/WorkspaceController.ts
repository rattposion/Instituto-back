import { Response } from 'express';
import { Database } from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class WorkspaceController {
  async getWorkspaces(req: AuthRequest, res: Response) {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    let whereClauses: string[] = ['wm.user_id = $1'];
    let params: any[] = [req.user!.id];
    let paramIndex = 2;
    if (search) {
      whereClauses.push('w.name ILIKE $' + paramIndex);
      params.push(`%${search}%`);
      paramIndex++;
    }
    const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const sql = `SELECT w.id, w.name, w.slug, w.description, w.is_active, w.created_at, wm.role, count(*) OVER() AS total_count FROM workspace_members wm INNER JOIN workspaces w ON wm.workspace_id = w.id ${where} ORDER BY w.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);
    const result = await Database.query(sql, params);
    const workspaceMembers = result.rows;
    const total = workspaceMembers.length > 0 ? Number(workspaceMembers[0].total_count) : 0;
    const workspaces = workspaceMembers.map((member: any) => ({
      id: member.id,
      name: member.name,
      slug: member.slug,
      description: member.description,
      is_active: member.is_active,
      created_at: member.created_at,
      role: member.role
    }));
    res.json({
      success: true,
      data: workspaces,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  }

  async createWorkspace(req: AuthRequest, res: Response) {
    const { name, description } = req.body;
    const workspaceId = uuidv4();
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const created_at = new Date().toISOString();
    const sql = `INSERT INTO workspaces (id, name, slug, description, owner_id, settings, is_active, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *`;
    const values = [workspaceId, name, slug, description, req.user!.id, JSON.stringify({}), true, created_at];
    const result = await Database.query(sql, values);
    const workspace = result.rows[0];
    // Adiciona usuário como admin
    const memberSql = `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at, created_at) VALUES ($1,$2,$3,'admin',$4,$5,$5)`;
    await Database.query(memberSql, [uuidv4(), workspaceId, req.user!.id, req.user!.id, created_at]);
    res.status(201).json({
      success: true,
      data: workspace
    });
  }

  async getWorkspaceById(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const memberSql = 'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1';
    const memberResult = await Database.query(memberSql, [id, req.user!.id]);
    const member = memberResult.rows[0];
    if (!member) {
      throw createError('Workspace not found', 404);
    }
    const wsSql = 'SELECT * FROM workspaces WHERE id = $1 LIMIT 1';
    const wsResult = await Database.query(wsSql, [id]);
    const workspace = wsResult.rows[0];
    if (!workspace) {
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
    // Verifica se é admin
    const memberSql = 'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = $3 LIMIT 1';
    const memberResult = await Database.query(memberSql, [id, req.user!.id, 'admin']);
    const member = memberResult.rows[0];
    if (!member) {
      throw createError('Access denied', 403);
    }
    const updateFields: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;
    if (name !== undefined) { updateFields.push(`name = $${paramIndex}`); params.push(name); paramIndex++; updateFields.push(`slug = $${paramIndex}`); params.push(name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')); paramIndex++; }
    if (description !== undefined) { updateFields.push(`description = $${paramIndex}`); params.push(description); paramIndex++; }
    if (settings !== undefined) { updateFields.push(`settings = $${paramIndex}`); params.push(settings); paramIndex++; }
    updateFields.push(`updated_at = $${paramIndex}`); params.push(new Date().toISOString()); paramIndex++;
    params.push(id);
    const sql = `UPDATE workspaces SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await Database.query(sql, params);
    const workspace = result.rows[0];
    res.json({
      success: true,
      data: workspace
    });
  }

  async deleteWorkspace(req: AuthRequest, res: Response) {
    const { id } = req.params;
    // Verifica se é owner
    const wsResult = await Database.query('SELECT owner_id, name FROM workspaces WHERE id = $1 AND owner_id = $2 LIMIT 1', [id, req.user!.id]);
    const workspace = wsResult.rows[0];
    if (!workspace) {
      throw createError('Workspace not found or access denied', 404);
    }
    await Database.query('DELETE FROM workspaces WHERE id = $1', [id]);
    res.json({
      success: true,
      message: 'Workspace deleted successfully'
    });
  }

  async getWorkspaceMembers(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { page = 1, limit = 20, search, role } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    // Verifica acesso
    const memberResult = await Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1', [id, req.user!.id]);
    const userMember = memberResult.rows[0];
    if (!userMember) {
      throw createError('Workspace not found', 404);
    }
    let whereClauses: string[] = ['wm.workspace_id = $1'];
    let params: any[] = [id];
    let paramIndex = 2;
    if (search) {
      whereClauses.push('(u.name ILIKE $' + paramIndex + ' OR u.email ILIKE $' + (paramIndex + 1) + ')');
      params.push(`%${search}%`, `%${search}%`);
      paramIndex += 2;
    }
    if (role) {
      whereClauses.push('wm.role = $' + paramIndex);
      params.push(role);
      paramIndex++;
    }
    const where = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
    const sql = `SELECT wm.id, wm.role, wm.joined_at, wm.created_at, u.id as user_id, u.name, u.email, u.avatar, u.last_login, count(*) OVER() AS total_count FROM workspace_members wm INNER JOIN users u ON wm.user_id = u.id ${where} ORDER BY wm.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(Number(limit), offset);
    const result = await Database.query(sql, params);
    const members = result.rows;
    const total = members.length > 0 ? Number(members[0].total_count) : 0;
    res.json({
      success: true,
      data: members,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  }

  async inviteMember(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { email, role } = req.body;
    // Verifica permissão
    const memberResult = await Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1', [id, req.user!.id]);
    const userMember = memberResult.rows[0];
    if (!userMember || !['admin', 'manager'].includes(userMember.role)) {
      throw createError('Access denied', 403);
    }
    // Busca usuário
    const userResult = await Database.query('SELECT id, name FROM users WHERE email = $1 LIMIT 1', [email]);
    const invitedUser = userResult.rows[0];
    if (!invitedUser) {
      throw createError('User not found', 404);
    }
    // Verifica se já é membro
    const existingResult = await Database.query('SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1', [id, invitedUser.id]);
    if (existingResult.rows.length > 0) {
      throw createError('User is already a member of this workspace', 409);
    }
    // Adiciona membro
    const now = new Date().toISOString();
    const memberSql = 'INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id, role, joined_at, created_at';
    const memberResult2 = await Database.query(memberSql, [uuidv4(), id, invitedUser.id, role, req.user!.id, now]);
    const member = memberResult2.rows[0];
    // TODO: Enviar email de convite
    res.status(201).json({
      success: true,
      data: member
    });
  }

  async removeMember(req: AuthRequest, res: Response) {
    const { id, userId } = req.params;
    // Verifica admin
    const memberResult = await Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = $3 LIMIT 1', [id, req.user!.id, 'admin']);
    const userMember = memberResult.rows[0];
    if (!userMember) {
      throw createError('Access denied', 403);
    }
    // Não pode remover owner
    const wsResult = await Database.query('SELECT owner_id FROM workspaces WHERE id = $1 LIMIT 1', [id]);
    const workspace = wsResult.rows[0];
    if (workspace?.owner_id === userId) {
      throw createError('Cannot remove workspace owner', 400);
    }
    await Database.query('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [id, userId]);
    res.json({
      success: true,
      message: 'Member removed successfully'
    });
  }

  async updateMemberRole(req: AuthRequest, res: Response) {
    const { id, userId } = req.params;
    const { role } = req.body;
    // Verifica admin
    const memberResult = await Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = $3 LIMIT 1', [id, req.user!.id, 'admin']);
    const userMember = memberResult.rows[0];
    if (!userMember) {
      throw createError('Access denied', 403);
    }
    // Não pode mudar owner
    const wsResult = await Database.query('SELECT owner_id FROM workspaces WHERE id = $1 LIMIT 1', [id]);
    const workspace = wsResult.rows[0];
    if (workspace?.owner_id === userId && role !== 'admin') {
      throw createError('Cannot change workspace owner role', 400);
    }
    const memberSql = 'UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3 RETURNING id, role, joined_at, created_at';
    const memberResult2 = await Database.query(memberSql, [role, id, userId]);
    const member = memberResult2.rows[0];
    res.json({
      success: true,
      data: member
    });
  }

  async getWorkspaceAnalytics(req: AuthRequest, res: Response) {
    const { id } = req.params;
    const { timeframe = '7d' } = req.query;
    // Verifica acesso
    const memberResult = await Database.query('SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1', [id, req.user!.id]);
    const member = memberResult.rows[0];
    if (!member) {
      throw createError('Workspace not found', 404);
    }
    // Datas
    const endDate = new Date();
    const startDate = new Date();
    switch (timeframe) {
      case '24h': startDate.setDate(startDate.getDate() - 1); break;
      case '7d': startDate.setDate(startDate.getDate() - 7); break;
      case '30d': startDate.setDate(startDate.getDate() - 30); break;
      default: startDate.setDate(startDate.getDate() - 7);
    }
    // Stats
    const [pixelsResult, eventsResult, conversionsResult] = await Promise.all([
      Database.query('SELECT id, status FROM pixels WHERE workspace_id = $1', [id]),
      Database.query('SELECT event_name, timestamp, parameters FROM events WHERE pixel_id IN (SELECT id FROM pixels WHERE workspace_id = $1) AND timestamp >= $2 AND timestamp <= $3', [id, startDate.toISOString(), endDate.toISOString()]),
      Database.query('SELECT total_conversions, total_value FROM conversions WHERE pixel_id IN (SELECT id FROM pixels WHERE workspace_id = $1)', [id])
    ]);
    const pixels = pixelsResult.rows || [];
    const events = eventsResult.rows || [];
    const conversions = conversionsResult.rows || [];
    const analytics = {
      pixels: {
        total: pixels.length,
        active: pixels.filter((p: any) => p.status === 'active').length,
        inactive: pixels.filter((p: any) => p.status === 'inactive').length,
        error: pixels.filter((p: any) => p.status === 'error').length
      },
      events: {
        total: events.length,
        byDay: this.groupEventsByDay(events),
        byType: this.groupEventsByType(events)
      },
      conversions: {
        total: conversions.reduce((sum: number, c: any) => sum + c.total_conversions, 0),
        totalValue: conversions.reduce((sum: number, c: any) => sum + parseFloat(c.total_value || 0), 0)
      }
    };
    res.json({
      success: true,
      data: analytics
    });
  }

  private groupEventsByDay(events: any[]) {
    const grouped: { [key: string]: number } = {};
    events.forEach((event: any) => {
      const day = new Date(event.timestamp).toISOString().split('T')[0];
      grouped[day] = (grouped[day] || 0) + 1;
    });
    return grouped;
  }

  private groupEventsByType(events: any[]) {
    const grouped: { [key: string]: number } = {};
    events.forEach((event: any) => {
      grouped[event.event_name] = (grouped[event.event_name] || 0) + 1;
    });
    return grouped;
  }
}