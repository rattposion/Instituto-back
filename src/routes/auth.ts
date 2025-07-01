import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';
import { validate, schemas } from '../middleware/validation';
import { authenticate } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();
const authController = new AuthController();

// Public routes
router.post('/register', validate(schemas.register), asyncHandler(authController.register));
router.post('/login', validate(schemas.login), asyncHandler(authController.login));
router.post('/forgot-password', asyncHandler(authController.forgotPassword));
router.post('/reset-password', asyncHandler(authController.resetPassword));
router.post('/verify-email', asyncHandler(authController.verifyEmail));

// Protected routes
router.post('/logout', authenticate, asyncHandler(authController.logout));
router.post('/refresh', authenticate, asyncHandler(authController.refreshToken));
router.get('/me', authenticate, asyncHandler(authController.getProfile));
router.put('/me', authenticate, validate(schemas.updateProfile), asyncHandler(authController.updateProfile));
router.put('/change-password', authenticate, validate(schemas.changePassword), asyncHandler(authController.changePassword));

export default router;