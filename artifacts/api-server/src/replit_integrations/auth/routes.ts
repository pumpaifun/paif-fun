import type { Express } from "express";
import { z } from "zod";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";

const updateProfileSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/, "Only letters, numbers, and underscores").optional(),
  firstName: z.string().min(1).max(50).optional(),
});

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update user profile (username, display name)
  app.patch("/api/auth/profile", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.id;
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid input" });
      }

      const { username, firstName } = parsed.data;

      if (username) {
        const existing = await authStorage.getUserByUsername(username);
        if (existing && existing.id !== userId) {
          return res.status(409).json({ message: "Username is already taken" });
        }
      }

      const updated = await authStorage.updateUser(userId, { username, firstName });
      res.json(updated);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Check if username is available
  app.get("/api/auth/check-username/:username", isAuthenticated, async (req: any, res) => {
    try {
      const { username } = req.params;
      const userId = req.user.id;
      const existing = await authStorage.getUserByUsername(username);
      const available = !existing || existing.id === userId;
      res.json({ available });
    } catch (error) {
      res.status(500).json({ message: "Failed to check username" });
    }
  });
}
