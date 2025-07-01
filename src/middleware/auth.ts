import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Database } from '../config/database';
import { JWTPayload } from '../types';
import { logger } from '../utils/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    workspaceId: string;
    role: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload;
    
    // Verify user exists and is active
    const userResult = await Database.query(
      'SELECT id, workspace_id, role, is_active FROM users WHERE id = $1 AND is_active = true',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = userResult.rows[0];

    req.user = {
      id: user.id,
      workspaceId: user.workspace_id,
      role: user.role
    };

    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

export const validateWorkspace = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.params.workspaceId || req.body.workspaceId;
    
    if (!workspaceId) {
      return res.status(400).json({ error: 'Workspace ID required' });
    }

    // Check if user has access to workspace
    const memberResult = await Database.query(
      'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.user!.id]
    );

    if (memberResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied to workspace' });
    }

    req.user!.role = memberResult.rows[0].role;
    next();
  } catch (error) {
    logger.error('Workspace validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};