import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
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
    const { data: user, error } = await prisma
      .$queryRaw`
        SELECT id, workspace_id, role, is_active
        FROM users
        WHERE id = ${decoded.userId} AND is_active = true
        LIMIT 1
      `;

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

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
    const { data: member, error } = await prisma
      .$queryRaw`
        SELECT role
        FROM workspace_members
        WHERE workspace_id = ${workspaceId} AND user_id = ${req.user!.id}
        LIMIT 1
      `;

    if (error || !member) {
      return res.status(403).json({ error: 'Access denied to workspace' });
    }

    req.user!.role = member.role;
    next();
  } catch (error) {
    logger.error('Workspace validation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};