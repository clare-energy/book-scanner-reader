import express from "express";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail, findUserById } from "./db.js";

const SALT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  next();
}

function validateCredentials(email, password) {
  if (typeof email !== "string" || !EMAIL_RE.test(email)) {
    return "Enter a valid email address.";
  }
  if (typeof password !== "string" || password.length < 8) {
    return "Password must be at least 8 characters.";
  }
  return null;
}

export const authRouter = express.Router();

authRouter.post("/signup", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;

  const validationError = validateCredentials(email, password);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, passwordHash);
    req.session.userId = user.id;
    res.status(201).json(user);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    console.error("Signup failed:", err);
    res.status(500).json({ error: "Signup failed, please retry." });
  }
});

authRouter.post("/login", async (req, res) => {
  const email = req.body.email?.trim().toLowerCase();
  const { password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const user = await findUserByEmail(email);
    const valid = user && (await bcrypt.compare(password, user.password_hash));
    if (!valid) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    req.session.userId = user.id;
    res.json({ id: user.id, email: user.email });
  } catch (err) {
    console.error("Login failed:", err);
    res.status(500).json({ error: "Login failed, please retry." });
  }
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.status(204).end();
  });
});

authRouter.get("/me", async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const user = await findUserById(req.session.userId);
  if (!user) {
    return res.status(401).json({ error: "Not signed in" });
  }
  res.json(user);
});
