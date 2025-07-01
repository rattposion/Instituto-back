import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { validate } from '../middleware/validation';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';
import { prisma } from '../config/database';
import Joi from 'joi';

const router = Router();

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  name: Joi.string().min(2).max(100).required(),
  workspaceName: Joi.string().min(2).max(100).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const updateProfileSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  avatar: Joi.string().uri().optional()
});

const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required()
});

// Generate JWT token
const generateToken = (userId: string): string => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET!,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Register
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, name, workspaceName } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      throw createError('User already exists with this email', 400);
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Use transaction to create user and workspace
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: hashedPassword,
          name,
        },
      });

      // Create workspace if provided, otherwise use default
      let workspace;
      if (workspaceName) {
        const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        workspace = await tx.workspace.create({
          data: {
            name: workspaceName,
            slug,
            ownerId: user.id,
          },
        });
      } else {
        // Get or create default workspace
        workspace = await tx.workspace.upsert({
          where: { slug: 'default' },
          update: {},
          create: {
            name: 'Default Workspace',
            slug: 'default',
            ownerId: user.id,
          },
        });
      }

      // Add user to workspace as admin
      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: 'ADMIN',
        },
      });

      return { user, workspace };
    });

    // Generate token
    const token = generateToken(result.user.id);

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          avatar: result.user.avatar,
          role: 'ADMIN',
          workspaceId: result.workspace.id,
          workspaceName: result.workspace.name
        }
      }
    });

    logger.info(`User registered: ${email}`);
  } catch (error) {
    next(error);
  }
});

// Login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Get user with workspace info
    const user = await prisma.user.findUnique({
      where: { email, isActive: true },
      include: {
        workspaceMembers: {
          include: {
            workspace: true
          },
          take: 1
        }
      }
    });

    if (!user || user.workspaceMembers.length === 0) {
      throw createError('Invalid credentials', 401);
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw createError('Invalid credentials', 401);
    }

    // Generate token
    const token = generateToken(user.id);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const workspaceMember = user.workspaceMembers[0];

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          role: workspaceMember.role,
          workspaceId: workspaceMember.workspace.id,
          workspaceName: workspaceMember.workspace.name
        }
      }
    });

    logger.info(`User logged in: ${email}`);
  } catch (error) {
    next(error);
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: {
        workspaceMembers: {
          include: {
            workspace: true
          },
          take: 1
        }
      }
    });

    if (!user) {
      throw createError('User not found', 404);
    }

    const workspaceMember = user.workspaceMembers[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        role: workspaceMember.role,
        createdAt: user.createdAt,
        workspace: {
          id: workspaceMember.workspace.id,
          name: workspaceMember.workspace.name
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// Update profile
router.put('/me', authenticateToken, validate(updateProfileSchema), async (req: AuthRequest, res, next) => {
  try {
    const { name, avatar } = req.body;
    
    const updateData: any = {};
    if (name) updateData.name = name;
    if (avatar) updateData.avatar = avatar;

    if (Object.keys(updateData).length === 0) {
      throw createError('No fields to update', 400);
    }

    await prisma.user.update({
      where: { id: req.user!.id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

    logger.info(`Profile updated for user: ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Change password
router.put('/change-password', authenticateToken, validate(changePasswordSchema), async (req: AuthRequest, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Get current password hash
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { passwordHash: true }
    });

    if (!user) {
      throw createError('User not found', 404);
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isCurrentPasswordValid) {
      throw createError('Current password is incorrect', 400);
    }

    // Hash new password
    const saltRounds = 12;
    const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash: hashedNewPassword }
    });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

    logger.info(`Password changed for user: ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

// Logout (client-side token removal, but we can log it)
router.post('/logout', authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    res.json({
      success: true,
      message: 'Logged out successfully'
    });

    logger.info(`User logged out: ${req.user!.id}`);
  } catch (error) {
    next(error);
  }
});

export default router;