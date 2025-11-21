// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ---- ENV & LOG ----
if (!process.env.GEMINI_API_KEY) {
  console.warn("WARNING: GEMINI_API_KEY not set in .env");
}
console.log("Using API Key:", process.env.GEMINI_API_KEY ? "FOUND" : "MISSING");

const MONGO_URI = process.env.MONGO_URI ;
const JWT_SECRET = process.env.JWT_SECRET;

// ---- MongoDB setup ----
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Mongo connection error:", err));

// ---- Mongoose models ----
const { Schema, model } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const sessionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: "User", required: true },
  topic: String,
  difficulty: String,
  totalQuestions: Number,
  results: { type: Array, default: [] }, // sessionResults from frontend
  createdAt: { type: Date, default: Date.now },
});

const User = model("User", userSchema);
const Session = model("Session", sessionSchema);

// ---- Google GenAI setup ----
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/**
 * Retry wrapper for handling Google GenAI 429 / overload errors
 */
async function withRetries(fn, { retries = 4, minDelay = 500, maxDelay = 6000 } = {}) {
  let attempt = 0;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status || err?.error?.code || err?.code || null;
      if (!(status === 429 || status === "RESOURCE_EXHAUSTED" || status === "TOO_MANY_REQUESTS")) {
        throw err;
      }

      attempt++;
      const delay = Math.min(maxDelay, Math.floor(minDelay * Math.pow(2, attempt - 1)));
      const jitter = Math.floor(Math.random() * 200);
      console.warn(
        `⚠️ GenAI request failed (status=${status}). Retrying ${attempt}/${retries} in ${delay + jitter}ms`
      );
      await new Promise((r) => setTimeout(r, delay + jitter));
    }
  }

  throw new Error("Model service overloaded. Retries exhausted.");
}

/**
 * Helper to extract text from various Gemini/GenAI response shapes.
 */
function extractTextFromResponse(response) {
  try {
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.candidates[0].content.parts[0].text;
    }
    if (response?.candidates?.[0]?.content?.text) {
      return response.candidates[0].content.text;
    }
    if (response?.output?.[0]?.content?.[0]?.text) {
      return response.output[0].content[0].text;
    }
    if (typeof response === "string") return response;
    if (response?.text) return response.text;
    return null;
  } catch {
    return null;
  }
}

/**
 * Try to parse free text into JSON.
 */
function safeParseJSON(text) {
  if (!text || typeof text !== "string") return { ok: false, error: "No text to parse" };

  try {
    const parsed = JSON.parse(text);
    return { ok: true, data: parsed };
  } catch {
    const match = text.match(/{[\s\S]*}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return { ok: true, data: parsed };
      } catch {
        return { ok: false, error: "Found JSON-like block but failed to parse", raw: match[0] };
      }
    }
    return { ok: false, error: "Response is not valid JSON", raw: text };
  }
}

// ---- Auth middleware ----
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: "Missing auth token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

// ---- Auth routes ----
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "Name, email, and password are required" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ success: false, error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" });

    return res.json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ success: false, error: "Registration failed" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: "7d" });

    return res.json({
      success: true,
      user: { id: user._id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});

// ---- History routes (MongoDB) ----
app.get("/history", authMiddleware, async (req, res) => {
  try {
    const sessions = await Session.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, sessions });
  } catch (err) {
    console.error("History fetch error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch history" });
  }
});

app.post("/history", authMiddleware, async (req, res) => {
  try {
    const { topic, difficulty, totalQuestions, results } = req.body || {};

    const session = await Session.create({
      user: req.userId,
      topic,
      difficulty,
      totalQuestions,
      results: Array.isArray(results) ? results : [],
    });

    const sessions = await Session.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ success: true, session, sessions });
  } catch (err) {
    console.error("History save error:", err);
    return res.status(500).json({ success: false, error: "Failed to save session" });
  }
});

app.delete("/history", authMiddleware, async (req, res) => {
  try {
    await Session.deleteMany({ user: req.userId });
    return res.json({ success: true });
  } catch (err) {
    console.error("History delete error:", err);
    return res.status(500).json({ success: false, error: "Failed to clear history" });
  }
});

// ---- Evaluate route (Google GenAI) ----
app.post("/evaluate", async (req, res) => {
  try {
    const { topic, question, answer } = req.body;

    if (!topic || !question || typeof answer === "undefined") {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: topic, question, answer",
      });
    }

    const prompt = `
You are an expert interview evaluator.

Topic: ${topic}
Question: ${question}
Candidate Answer: ${answer}

Give JSON output with:
{
  "score": number (0-10),
  "feedback": "string",
  "mistakes": ["point1", "point2"],
  "missing_points": ["point1", "point2"],
  "perfect_answer": "string",
  "next_question": "string"
}

Only respond in valid JSON.
`;

    const response = await withRetries(() =>
      ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      })
    );

    const text = extractTextFromResponse(response);

    if (!text) {
      return res.status(502).json({
        success: false,
        error: "Could not extract text from model response",
        debug: { topKeys: Object.keys(response || {}).slice(0, 20) },
      });
    }

    const parsed = safeParseJSON(text);

    if (parsed.ok) {
      return res.json({ success: true, evaluation: parsed.data });
    }

    return res.status(200).json({
      success: false,
      error: parsed.error,
      raw: parsed.raw ?? text,
    });
  } catch (error) {
    console.error("Evaluate route error:", error);
    const code = error?.status || error?.error?.code || error?.message;

    if (code === 429 || code === "RESOURCE_EXHAUSTED" || (typeof code === "string" && code.includes("overloaded"))) {
      return res.status(503).json({
        success: false,
        error: "AI model is temporarily overloaded. Please try again in a few seconds.",
      });
    }

    return res.status(500).json({
      success: false,
      error: error?.message ?? "Server error",
    });
  }
});

// ---- Health check ----
app.get("/", (req, res) => res.send("AI Evaluator running"));

// ---- Start server ----
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

/**
 * Sample test:
 * curl -X POST http://localhost:5000/evaluate \
 *   -H "Content-Type: application/json" \
 *   -d '{"topic":"Java","question":"What is OOP?","answer":"Object."}'
 */
