import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { logger } from '../utils/logger';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.body);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Validation error:', errorMessage);
      return res.status(400).json({ error: errorMessage });
    }
    
    next();
  };
};

export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error } = schema.validate(req.query);
    
    if (error) {
      const errorMessage = error.details.map(detail => detail.message).join(', ');
      logger.warn('Query validation error:', errorMessage);
      return res.status(400).json({ error: errorMessage });
    }
    
    next();
  };
};

// Common validation schemas
export const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
    workspaceName: Joi.string().min(2).max(100).optional()
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  createPixel: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    pixelId: Joi.string().required(),
    metaAccount: Joi.string().required()
  }),

  createEvent: Joi.object({
    pixelId: Joi.string().uuid().required(),
    eventName: Joi.string().required(),
    eventType: Joi.string().valid('standard', 'custom').default('standard'),
    parameters: Joi.object().default({}),
    source: Joi.string().valid('web', 'server', 'mobile').default('web'),
    userAgent: Joi.string().optional(),
    ipAddress: Joi.string().ip().optional()
  }),

  createConversion: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    pixelId: Joi.string().uuid().required(),
    eventName: Joi.string().required(),
    rules: Joi.array().items(Joi.object({
      type: Joi.string().valid('url', 'event', 'parameter').required(),
      operator: Joi.string().valid('equals', 'contains', 'starts_with', 'ends_with', 'greater_than', 'less_than').required(),
      field: Joi.string().required(),
      value: Joi.alternatives().try(Joi.string(), Joi.number()).required()
    })).min(1).required()
  }),

  createWorkspace: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    description: Joi.string().max(500).optional()
  }),

  inviteMember: Joi.object({
    email: Joi.string().email().required(),
    role: Joi.string().valid('admin', 'manager', 'viewer').required()
  }),

  updateProfile: Joi.object({
    name: Joi.string().min(2).max(100).optional(),
    avatar: Joi.string().uri().optional()
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).required()
  }),

  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string().optional(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    search: Joi.string().optional()
  })
};