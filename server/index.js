require("dotenv").config();

const cors = require("cors");
const express = require("express");
const compression = require("compression");
const { ensureSchema } = require("./db");
const { deleteExpiredSessions } = require("./db");
const { attachAuth } = require("./session");
const authRoutes = require("./routes/auth");
const linkRoutes = require("./routes/links");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow relative requests (no origin = same-origin or server-to-server)
      if (!origin) {
        return callback(null, true);
      }

      const allowed = (process.env.CORS_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Default allowlist: localhost + vercel + pmkitera
      const isAllowed =
        allowed.length > 0
          ? allowed.some((pattern) => origin.includes(pattern))
          : origin.includes("localhost") ||
            origin.includes("vercel.app") ||
            origin.includes("pmkitera");

      callback(null, isAllowed);
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "2mb" }));
app.set("trust proxy", 1);

// Added for Vercel unified deployment: strip /api prefix so routes work
app.use((req, res, next) => {
  if (req.url.startsWith("/api")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

// Attach auth to all routes
app.use(attachAuth);

// Health check
app.get("/health", async (_req, res) => {
  try {
    await ensureSchema();
    res.json({
      ok: true,
      database: Boolean(process.env.DATABASE_URL),
      appBaseUrl: process.env.APP_BASE_URL || null,
      shortIoConfigured: Boolean(
        process.env.SHORT_IO_API_KEY && process.env.SHORT_IO_DOMAIN,
      ),
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// Mount route modules
app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/", linkRoutes);

// Startup
if (require.main === module || process.env.NODE_ENV !== "production") {
  const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);

    if (process.env.DATABASE_URL) {
      ensureSchema()
        .then(() => console.log("Neon schema ready"))
        .catch((error) => {
          console.error("Failed to initialize Neon schema:", error.message);
        });
    } else {
      console.log("DATABASE_URL not set, auth/internal links are disabled");
    }
  });

  server.on("error", (error) => {
    console.error("Server error:", error.message);
  });

  // Periodic cleanup: expired sessions every 30 minutes
  const SESSION_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
  const cleanupTimer = setInterval(async () => {
    try {
      const deleted = await deleteExpiredSessions();
      if (deleted > 0) {
        console.log(`Cleaned up ${deleted} expired session(s)`);
      }
    } catch (error) {
      console.error("Session cleanup failed:", error.message);
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

module.exports = app;
