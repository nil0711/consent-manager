import express from "express";
import session from "express-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import expressLayouts from "express-ejs-layouts";
import rateLimit from "express-rate-limit";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";

import authRouter from "./routes/auth.js";
import participantRouter from "./routes/participant.js";
import researcherRouter from "./routes/researcher.js";
import studyRouter from "./routes/study.js";
import { startRetentionJob } from "./jobs/retention.js";

export function createApp() {
  const app = express();

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // Trust proxy if behind one (important for secure cookies in prod)
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }

  // Views + static
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "../views"));
  app.use(expressLayouts);
  app.set("layout", "layout");
  app.use("/public", express.static(path.join(__dirname, "../public")));

  // Body parsing
  app.use(express.urlencoded({ extended: true }));

  // --- Session store in Postgres ---
  const PgSession = connectPgSimple(session);
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL
  });

  app.use(
    session({
      name: "consent.sid",
      secret: process.env.SESSION_SECRET || "devsecret",
      store: new PgSession({
        pool,
        tableName: "user_sessions",
        createTableIfMissing: true
      }),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.COOKIE_SECURE === "1", // set to 1 in prod with HTTPS
        maxAge: 1000 * 60 * 60 * 8 // 8h
      }
    })
  );

  // ---- Rate limiting ----
  const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000); // 10 min
  const MAX_GLOBAL = Number(process.env.RATE_LIMIT_MAX || 600); // per IP per window
  const MAX_AUTH = Number(process.env.RATE_LIMIT_AUTH_MAX || 20); // tighter for auth POSTs

  const globalLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_GLOBAL,
    standardHeaders: "draft-7",
    legacyHeaders: false
  });

  const authPostLimiter = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_AUTH,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: "Too many attempts. Try again later."
  });

  // Apply a light global limiter
  app.use(globalLimiter);

  // Apply strict limiter only to POST /login and POST /signup (not GET forms)
  const postOnly = (limiter) => (req, res, next) => (req.method === "POST" ? limiter(req, res, next) : next());
  app.use("/login", postOnly(authPostLimiter));
  app.use("/signup", postOnly(authPostLimiter));

  // Routers
  app.use(authRouter);
  app.use(participantRouter);
  app.use(researcherRouter);
  app.use(studyRouter);

  // 404
  app.use((req, res) => {
    res.status(404).render("404", { title: "Not found", user: req.session?.user || null });
  });

  // Error handler
  app.use((err, req, res, _next) => {
    console.error("[500]", err);
    const msg =
      (err && err.expose && err.message) ||
      (process.env.NODE_ENV === "development" ? String(err?.stack || err) : "Unexpected error");
    res.status(err.statusCode || 500).render("500", {
      title: "Error",
      user: req.session?.user || null,
      message: msg
    });
  });

  // 🔔 Start scheduled retention sweeper
  startRetentionJob();

  return app;
}
