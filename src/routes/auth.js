import { Router } from "express";
import bcrypt from "bcrypt";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { dash } from "../lib/mw.js";

const router = Router();

router.get("/", (req, res) => {
  if (req.session.user) return res.redirect(dash(req.session.user.role));
  return res.redirect("/login");
});

router.get("/signup", (req, res) => {
  res.render("signup", { title: "Sign up", error: null });
});

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["participant", "researcher"])
});

router.post("/signup", async (req, res) => {
  const parsed = SignupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("signup", { title: "Sign up", error: "Invalid input." });
  }
  const { email, password, role } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.render("signup", { title: "Sign up", error: "Email already registered." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { email, passwordHash, role } });
  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect(dash(user.role));
});

router.get("/login", (req, res) => {
  if (req.session.user) return res.redirect(dash(req.session.user.role));
  res.render("login", { title: "Log in", error: null });
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

router.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.render("login", { title: "Log in", error: "Invalid input." });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.render("login", { title: "Log in", error: "Invalid email or password." });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.render("login", { title: "Log in", error: "Invalid email or password." });

  req.session.user = { id: user.id, email: user.email, role: user.role };
  res.redirect(dash(user.role));
});

router.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

// DEV-ONLY role switch (optional)
router.post("/dev/promote", async (req, res) => {
  if (process.env.ALLOW_ROLE_SWITCH !== "1") return res.status(404).send("Not found");
  if (!req.session.user) return res.redirect("/login");
  const role = req.body?.role;
  if (!["participant", "researcher"].includes(role)) return res.status(400).send("Invalid role");
  await prisma.user.update({ where: { id: req.session.user.id }, data: { role } });
  req.session.user.role = role;
  return res.redirect(dash(role));
});

export default router;
