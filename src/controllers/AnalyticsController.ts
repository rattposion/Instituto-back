import { Request, Response } from 'express';
import { Database } from '../config/database';
import { hashPassword, comparePassword } from '../utils/crypto';
import { generateToken } from '../utils/jwt';
import { createError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class AuthController {
  async register(req: Request, res: Response) {
    console.log('Início do método register', req.body);
    logger.info('Iniciando registro de usuário', { body: { ...req.body, password: '***' } });
    try {
      const { name, email, password, workspaceName } = req.body;

      // Check if user already exists
      const existingUserResult = await Database.query(
        'SELECT id FROM users WHERE email = $1',
        [email]
      );
      logger.info('Verificação de usuário existente', { email, existe: existingUserResult.rows.length > 0 });

      if (existingUserResult.rows.length > 0) {
        throw createError('User already exists', 409);
      }

      // Hash password
      const passwordHash = await hashPassword(password);
      logger.info('Senha hasheada com sucesso');

      // Create workspace and user in transaction
      const result = await Database.transaction(async (client) => {
        // Create workspace first
        const workspaceId = uuidv4();
        await client.query(
          `INSERT INTO workspaces (id, name, slug, settings, is_active) 
           VALUES ($1, $2, $3, $4, $5)`,
          [
            workspaceId,
            workspaceName || `${name}'s Workspace`,
            (workspaceName || `${name}-workspace`).toLowerCase().replace(/\s+/g, '-'),
            JSON.stringify({}),
            true
          ]
        );
        logger.info('Workspace criado', { workspaceId });

        // Create user
        const userId = uuidv4();
        await client.query(
          `INSERT INTO users (id, name, email, password_hash, role, workspace_id, is_active) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [userId, name, email, passwordHash, 'admin', workspaceId, true]
        );
        logger.info('Usuário criado', { userId });

        // Update workspace owner
        await client.query(
          'UPDATE workspaces SET owner_id = $1 WHERE id = $2',
          [userId, workspaceId]
        );
        logger.info('Owner do workspace atualizado', { workspaceId, userId });

        // Create workspace member record
        await client.query(
          `INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by, joined_at) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), workspaceId, userId, 'admin', userId, new Date()]
        );
        logger.info('Membro do workspace criado', { workspaceId, userId });

        return { userId, workspaceId };
      });

      // Generate token
      const token = generateToken({
        userId: result.userId,
        workspaceId: result.workspaceId,
        role: 'admin'
      });
      logger.info('Token JWT gerado');

      // Log audit event
      await this.logAuditEvent(result.workspaceId, result.userId, 'user.register', 'user', result.userId, {
        email,
        name
      }, req);
      logger.info('Evento de auditoria registrado');

      res.status(201).json({
        success: true,
        data: {
          token,
          user: {
            id: result.userId,
            name,
            email,
            role: 'admin',
            workspaceId: result.workspaceId
          }
        }
      });
    } catch (error) {
      logger.error('Erro no registro de usuário', { error });
      throw error;
    }
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    // Get user with workspace info
    const userResult = await Database.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.workspace_id, u.is_active,
              w.id as workspace_id, w.name as workspace_name, w.is_active as workspace_active
       FROM users u
       INNER JOIN workspaces w ON u.workspace_id = w.id
       WHERE u.email = $1 AND u.is_active = true`,
      [email]
    );

    if (userResult.rows.length === 0) {
      throw createError('Invalid credentials', 401);
    }

    const user = userResult.rows[0];

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      throw createError('Invalid credentials', 401);
    }

    // Check workspace is active
    if (!user.workspace_active) {
      throw createError('Workspace is inactive', 403);
    }

    // Update last login
    await Database.query(
      'UPDATE users SET last_login = $1 WHERE id = $2',
      [new Date(), user.id]
    );

    // Generate token
    const token = generateToken({
      userId: user.id,
      workspaceId: user.workspace_id,
      role: user.role
    });

    // Log audit event
    await this.logAuditEvent(user.workspace_id, user.id, 'user.login', 'user', user.id, {
      email
    }, req);

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          workspaceId: user.workspace_id,
          workspace: {
            id: user.workspace_id,
            name: user.workspace_name
          }
        }
      }
    });
  }

  async logout(req: AuthRequest, res: Response) {
    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'user.logout',
      'user',
      req.user!.id,
      {},
      req
    );

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  }

  async getProfile(req: AuthRequest, res: Response) {
    const userResult = await Database.query(
      `SELECT u.id, u.name, u.email, u.role, u.avatar, u.last_login, u.created_at,
              w.id as workspace_id, w.name as workspace_name, w.slug as workspace_slug
       FROM users u
       INNER JOIN workspaces w ON u.workspace_id = w.id
       WHERE u.id = $1`,
      [req.user!.id]
    );

    if (userResult.rows.length === 0) {
      throw createError('User not found', 404);
    }

    const user = userResult.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        lastLogin: user.last_login,
        createdAt: user.created_at,
        workspace: {
          id: user.workspace_id,
          name: user.workspace_name,
          slug: user.workspace_slug
        }
      }
    });
  }

  async updateProfile(req: AuthRequest, res: Response) {
    const { name, avatar } = req.body;

    await Database.query(
      'UPDATE users SET name = $1, avatar = $2, updated_at = $3 WHERE id = $4',
      [name, avatar, new Date(), req.user!.id]
    );

    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'user.update_profile',
      'user',
      req.user!.id,
      { name, avatar },
      req
    );

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });
  }

  async changePassword(req: AuthRequest, res: Response) {
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const userResult = await Database.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.user!.id]
    );

    if (userResult.rows.length === 0) {
      throw createError('User not found', 404);
    }

    const user = userResult.rows[0];

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      throw createError('Current password is incorrect', 400);
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    await Database.query(
      'UPDATE users SET password_hash = $1, updated_at = $2 WHERE id = $3',
      [newPasswordHash, new Date(), req.user!.id]
    );

    // Log audit event
    await this.logAuditEvent(
      req.user!.workspaceId,
      req.user!.id,
      'user.change_password',
      'user',
      req.user!.id,
      {},
      req
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  }

  async forgotPassword(req: Request, res: Response) {
    const { email } = req.body;

    // Check if user exists
    const userResult = await Database.query(
      'SELECT id, name FROM users WHERE email = $1 AND is_active = true',
      [email]
    );

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If the email exists, a reset link has been sent'
    });

    if (userResult.rows.length > 0) {
      // TODO: Implement email sending logic
      logger.info(`Password reset requested for user: ${email}`);
    }
  }

  async resetPassword(req: Request, res: Response) {
    // TODO: Implement password reset logic
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  }

  async verifyEmail(req: Request, res: Response) {
    // TODO: Implement email verification logic
    res.json({
      success: true,
      message: 'Email verified successfully'
    });
  }

  async refreshToken(req: AuthRequest, res: Response) {
    // Generate new token
    const token = generateToken({
      userId: req.user!.id,
      workspaceId: req.user!.workspaceId,
      role: req.user!.role
    });

    res.json({
      success: true,
      data: { token }
    });
  }

  private async logAuditEvent(
    workspaceId: string,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    details: any,
    req: Request
  ) {
    try {
      await Database.query(
        `INSERT INTO audit_logs (id, workspace_id, user_id, action, resource_type, resource_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          workspaceId,
          userId,
          action,
          resourceType,
          resourceId,
          JSON.stringify(details),
          req.ip,
          req.get('User-Agent')
        ]
      );
    } catch (error) {
      logger.error('Failed to log audit event:', error);
    }
  }
}
