import "dotenv/config";
import express from "express";
import cors from "cors";
import { getDb } from "./db/database";
import { migrate } from "./db/migrate";
import authRouter from "./routes/auth";
import subjectsRouter from "./routes/subjects";
import questionsRouter from "./routes/questions";
import examsRouter from "./routes/exams";
import usersRouter from "./routes/users";
import { requireAuth } from "./middleware/auth";

const app = express();
const PORT = process.env.PORT || 4000;

// API responses must not be cached/ETag-revalidated: a 304 with an empty body
// breaks fetch/axios clients (and Vite's dev proxy can surface it).
app.set("etag", false);
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  next();
});

app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRouter);
app.use("/api/subjects", subjectsRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/exams", examsRouter);
app.use("/api/users", usersRouter);

// me endpoint
app.get("/api/me", requireAuth, (req, res) => res.json({ user: req.user }));

const start = async () => {
  await getDb();
  await migrate();
  app.listen(PORT, () => {
    console.log(`MCQ backend running on http://localhost:${PORT}`);
  });
};

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

process.on("SIGINT", () => {
  const { closeDb } = require("./db/database");
  closeDb();
  process.exit(0);
});