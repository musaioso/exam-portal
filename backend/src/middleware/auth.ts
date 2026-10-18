import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "mcq-secret-change-me";

if (!process.env.JWT_SECRET) {
  console.warn(
    "[auth] JWT_SECRET is not set — signing tokens with the well-known default that ships in this repository. " +
      "Set JWT_SECRET in the deployment environment to stop anyone from forging logins."
  );
}

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "teacher" | "student";
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthUser | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthUser;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : (req as any).cookies?.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });
  req.user = user;
  next();
}

/**
 * Attaches `req.user` when a valid token is supplied, but never rejects the
 * request. Used by endpoints whose payload differs by role (a student only ever
 * sees published exams; staff see drafts too) — without this an anonymous call
 * would fall through as "no role" and receive the staff view.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : (req as any).cookies?.token;
  if (token) {
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireRole(...roles: AuthUser["role"][]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}