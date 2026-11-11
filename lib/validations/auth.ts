/**
 * Authentication validation schemas
 * Centralized Zod schemas for authentication-related forms and API requests
 */

import { z } from "zod";

/**
 * User registration schema
 * Used for both client-side form validation and server-side API validation
 */
export const registerSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or less"),
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password must be 100 characters or less"),
});

/**
 * User registration form data type
 */
export type RegisterFormData = z.infer<typeof registerSchema>;

/**
 * User login schema
 * Used for both client-side form validation and server-side API validation
 */
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

/** API body alias for POST /api/auth/login */
export const loginBodySchema = z.object({
  email: z.string().trim().min(3).max(254).refine(value => z.string().email().safeParse(value).success || /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,49}$/.test(value), 'Invalid email or username'),
  // Preserve historical registration's 100-character login compatibility.
  // New employee credentials enforce bcrypt's UTF-8 byte limit at creation.
  password: z.string().min(1).max(100),
});

/**
 * User login form data type
 */
export type LoginFormData = z.infer<typeof loginSchema>;

/** API body alias for POST /api/auth/register */
export const registerBodySchema = registerSchema;

