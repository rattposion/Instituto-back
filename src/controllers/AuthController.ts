import { Request, Response } from 'express';
import { supabase } from '../config/database';
import { hashPassword, comparePassword } from '../utils/crypto';
import { generateToken } from '../utils/jwt';
import { createError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class AuthController {
  async register(req: Request, res: Response) {
    const { name, email, password, workspaceName } = req.body;

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      throw createError('User already exists', 409);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create workspace first
    const workspaceId = uuidv4();
    const { error: workspaceError } = await supabase
      .from('workspaces')
      .insert({
        id: workspaceId,
        name: workspaceName || `${name}'s Workspace`,
        slug: (workspaceName || `${name}-workspace`).toLowerCase().replace(/\s+/g, '-'),
        owner_id: '', // Will be updated after user creation
        settings: {},
        is_active: true
      });

    if (workspaceError) {
      logger.error('Workspace creation error:', workspaceError);
      throw createError('Failed to create workspace', 500);
    }

    // Create user
    const userId = uuidv4();
    const { error: userError } = await supabase
      .from('users')
      .insert({
        id: userId,
        name,
        email,
        password_hash: passwordHash,
        role: 'admin',
        workspace_id: workspaceId,
        is_active: true
      });

    if (userError) {
      logger.error('User creation error:', userError);
      // Cleanup workspace
      await supabase.from('workspaces').delete().eq('id', workspaceId);
      throw createError('Failed to create user', 500);
    }

    // Update workspace owner
    await supabase
      .from('workspaces')
      .update({ owner_id: userId })
      .eq('id', workspaceId);

    // Create workspace member record
    await supabase
      .from('workspace_members')
      .insert({
        id: uuidv4(),
        workspace_id: workspaceId,
        user_id: userId,
        role: 'admin',
        invited_by: userId,
        joined_at: new Date().toISOString()
      });

    // Generate token
    const token = generateToken({
      userId,
      workspaceId,
      role: 'admin'
    });

    // Log audit event
    await this.logAuditEvent(workspaceId, userId, 'user.register', 'user', userId, {
      email,
      name
    }, req);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          name,
          email,
          role: 'admin',
          workspaceId
        }
      }
    });
  }

  async login(req: Request, res: Response) {
    const { email, password } = req.body;

    // Get user with workspace info
    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id, name, email, password_hash, role, workspace_id, is_active,
        workspaces!inner(id, name, is_active)
      `)
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !user) {
      throw createError('Invalid credentials', 401);
    }

    // Verify password
    const isValidPassword = await comparePassword(password, user.password_hash);
    if (!isValidPassword) {
      throw createError('Invalid credentials', 401);
    }

    // Check workspace is active
    if (!user.workspaces.is_active) {
      throw createError('Workspace is inactive', 403);
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

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
            id: user.workspaces.id,
            name: user.workspaces.name
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
    const { data: user, error } = await supabase
      .from('users')
      .select(`
        id, name, email, role, avatar, last_login, created_at,
        workspaces!inner(id, name, slug)
      `)
      .eq('id', req.user!.id)
      .single();

    if (error || !user) {
      throw createError('User not found', 404);
    }

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
        workspace: user.workspaces
      }
    });
  }

  async updateProfile(req: AuthRequest, res: Response) {
    const { name, avatar } = req.body;

    const { error } = await supabase
      .from('users')
      .update({
        name,
        avatar,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user!.id);

    if (error) {
      logger.error('Profile update error:', error);
      throw createError('Failed to update profile', 500);
    }

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
    const { data: user, error } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user!.id)
      .single();

    if (error || !user) {
      throw createError('User not found', 404);
    }

    // Verify current password
    const isValidPassword = await comparePassword(currentPassword, user.password_hash);
    if (!isValidPassword) {
      throw createError('Current password is incorrect', 400);
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update password
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: newPasswordHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user!.id);

    if (updateError) {
      logger.error('Password update error:', updateError);
      throw createError('Failed to update password', 500);
    }

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
    const { data: user } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: 'If the email exists, a reset link has been sent'
    });

    if (user) {
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
      await supabase
        .from('audit_logs')
        .insert({
          id: uuidv4(),
          workspace_id: workspaceId,
          user_id: userId,
          action,
          resource_type: resourceType,
          resource_id: resourceId,
          details,
          ip_address: req.ip,
          user_agent: req.get('User-Agent')
        });
    } catch (error) {
      logger.error('Failed to log audit event:', error);
    }
  }
}