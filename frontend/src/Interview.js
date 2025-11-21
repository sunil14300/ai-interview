// src/InterviewEnhanced.js
import React, { useEffect, useRef, useState } from "react";
import "./Interview.css";

const BACKEND_URL = "http://localhost:5000";

export default function InterviewEnhanced() {
  const topicQuestions = {
    Java: "What is OOP?",
    Python: "What are Python decorators?",
    SQL: "What is normalization in databases? Give examples.",
    "Data Structures": "Explain the difference between Array and Linked List.",
    "System Design": "How would you design a URL shortener?"
  };

  // ---------- state ----------
  const [topic, setTopic] = useState("Java");
  const [difficulty, setDifficulty] = useState("Medium");
  const [question, setQuestion] = useState(topicQuestions["Java"]);
  const [transcript, setTranscript] = useState("");
  const [evaluation, setEvaluation] = useState(null);

  const [totalQuestions, setTotalQuestions] = useState(5);
  const [sessionResults, setSessionResults] = useState([]);
  const [remainingQuestions, setRemainingQuestions] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [interviewActive, setInterviewActive] = useState(false);

  const [timePerQuestion, setTimePerQuestion] = useState(60);
  const [timeLeft, setTimeLeft] = useState(timePerQuestion);
  const timerRef = useRef(null);

  // auth + history
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // login/register modal
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // speech recognition
  const recognitionRef = useRef(null);
  const [isListening, setIsListening] = useState(false);

  // stable submit ref
  const submitRef = useRef();
  const lastSubmittedIndex = useRef(-1);
  const [submitting, setSubmitting] = useState(false);

  // review modal per question
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  // perfect answer expand per question
  const [expandedPerfect, setExpandedPerfect] = useState({});

  // theme
  const [darkMode, setDarkMode] = useState(false);

  // toasts
  const [toasts, setToasts] = useState([]);

  // ---------- toast helper ----------
  const showToast = (message, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  // ---------- init auth + theme + local history ----------
  useEffect(() => {
    try {
      const storedUser = localStorage.getItem("ai_user");
      const storedToken = localStorage.getItem("ai_token");
      if (storedUser && storedToken) {
        setUser(JSON.parse(storedUser));
        setToken(storedToken);
      }
    } catch {}

    const savedTheme = localStorage.getItem("ai_theme");
    if (savedTheme === "dark") setDarkMode(true);

    if (!token) {
      try {
        const localHist = JSON.parse(localStorage.getItem("ai_interview_history") || "[]");
        setHistory(localHist);
      } catch {
        setHistory([]);
      }
    }
  }, []); // eslint-disable-line

  // when token changes, load history from backend
  useEffect(() => {
    if (token) {
      (async () => {
        try {
          const res = await fetch(`${BACKEND_URL}/history`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (res.ok && data.success) {
            setHistory(data.sessions || []);
          } else {
            showToast(data.error || "Failed to load history", "error");
          }
        } catch (err) {
          showToast(err.message, "error");
        }
      })();
    }
  }, [token]); // eslint-disable-line

  // keep topic/question sync when not active
  useEffect(() => {
    if (!interviewActive) setQuestion(topicQuestions[topic]);
  }, [topic, interviewActive]); // eslint-disable-line

  useEffect(() => {
    if (!interviewActive) setTimeLeft(timePerQuestion);
  }, [timePerQuestion, interviewActive]);

  useEffect(() => {
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (!interviewActive) {
      clearInterval(timerRef.current);
      return;
    }
    setTimeLeft(timePerQuestion);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (lastSubmittedIndex.current !== currentIndex) {
            submitRef.current?.(true);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [interviewActive, currentIndex, timePerQuestion]); // eslint-disable-line

  const speak = (text) => {
    try {
      const utter = new SpeechSynthesisUtterance(text);
      window.speechSynthesis.speak(utter);
    } catch {}
  };

  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Browser does not support speech recognition");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.onresult = (event) => {
        const text = event.results[0][0].transcript;
        setTranscript(text);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
      recognition.start();
      setIsListening(true);
    } catch (err) {
      console.error(err);
    }
  };

  const stopListening = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setIsListening(false);
  };

  const normalizeEval = (ev) => {
    if (!ev) return null;
    return {
      ...ev,
      mistakes: Array.isArray(ev.mistakes) ? ev.mistakes : (ev.mistakes ? [ev.mistakes] : []),
      missing_points: Array.isArray(ev.missing_points) ? ev.missing_points : (ev.missing_points ? [ev.missing_points] : []),
    };
  };

  const topWeaknesses = (ev) => {
    const norm = normalizeEval(ev);
    if (!norm || !norm.missing_points) return [];
    return norm.missing_points.slice(0, 3);
  };

  const startInterview = () => {
    if (!Number.isInteger(totalQuestions) || totalQuestions <= 0) {
      alert("Enter a valid number of questions (> 0).");
      return;
    }
    setSessionResults([]);
    setRemainingQuestions(totalQuestions);
    setCurrentIndex(0);
    setInterviewActive(true);
    setEvaluation(null);
    setTranscript("");
    setQuestion(topicQuestions[topic]);
    lastSubmittedIndex.current = -1;
    setTimeLeft(timePerQuestion);
    speak(topicQuestions[topic]);
    showToast("Interview started", "info");
  };

  const advanceQuestion = (nextQuestionFromModel) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= totalQuestions) {
      finishSession();
      return;
    }
    setCurrentIndex(nextIndex);
    setRemainingQuestions(totalQuestions - nextIndex);
    setQuestion(nextQuestionFromModel || topicQuestions[topic]);
    setTranscript("");
    setEvaluation(null);
    lastSubmittedIndex.current = -1;
    setTimeLeft(timePerQuestion);
    speak(nextQuestionFromModel || topicQuestions[topic]);
  };

  const saveSessionToBackend = async (sessionSummary) => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_URL}/history`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic: sessionSummary.topic,
          difficulty: sessionSummary.difficulty,
          totalQuestions: sessionSummary.totalQuestions,
          results: sessionSummary.results,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setHistory(data.sessions || []);
        showToast("Session saved to your account", "success");
      } else {
        showToast(data.error || "Failed to save session", "error");
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const finishSession = () => {
    const endTime = new Date().toISOString();
    const sessionSummary = {
      id: `sess_${Date.now()}`,
      topic,
      difficulty,
      totalQuestions,
      results: sessionResults,
      endedAt: endTime,
    };

    if (token) {
      saveSessionToBackend(sessionSummary);
    } else {
      const newHistory = [sessionSummary, ...history].slice(0, 50);
      setHistory(newHistory);
      localStorage.setItem("ai_interview_history", JSON.stringify(newHistory));
    }

    setInterviewActive(false);
    setRemainingQuestions(0);
    setEvaluation(null);
    showToast("Interview completed", "success");
  };

  const handleSubmitAnswer = async (auto = false) => {
    if (submitting) return;
    if (lastSubmittedIndex.current === currentIndex && !auto) return;
    if (auto && lastSubmittedIndex.current === currentIndex) return;
    if (!interviewActive && !auto) return;

    setSubmitting(true);
    lastSubmittedIndex.current = currentIndex;
    clearInterval(timerRef.current);

    const payload = {
      topic,
      difficulty,
      question,
      answer: transcript || "(no answer given)",
    };

    try {
      const res = await fetch(`${BACKEND_URL}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        showToast(data.error || "Evaluation failed", "error");
      }

      const evalObj = data.success ? data.evaluation : { raw: data, feedback: data.error || "Evaluation error" };

      const newResult = {
        question,
        answer: payload.answer,
        evaluation: evalObj,
        timeTaken: timePerQuestion - timeLeft,
        autoSubmitted: auto,
      };

      setSessionResults((s) => [...s, newResult]);
      setEvaluation(evalObj);
      setReviewModalOpen(true);
      window.__nextQ = evalObj?.next_question || evalObj?.nextQuestion || null;

      showToast("Answer evaluated", "success");
    } catch (err) {
      console.error(err);
      const newResult = {
        question,
        answer: payload.answer,
        evaluation: { error: err.message },
        timeTaken: timePerQuestion - timeLeft,
        autoSubmitted: auto,
      };
      setSessionResults((s) => [...s, newResult]);
      setEvaluation({ error: err.message, feedback: "Network or server error." });
      setReviewModalOpen(true);
      window.__nextQ = null;
      showToast("Evaluation error", "error");
    } finally {
      setSubmitting(false);
    }
  };

  submitRef.current = handleSubmitAnswer;

  const buildPrintableHTML = (results, meta) => {
    const escapeHtml = (s) => {
      if (!s && s !== 0) return "";
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    };

    const head = `
      <head>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>Session Summary - ${meta.topic}</title>
        <style>
          body { font-family: Arial, sans-serif; padding:20px; color:#111; }
          h1{ color:#3f3cbb; }
          .card{ border:1px solid #ddd; padding:12px; border-radius:8px; margin-bottom:12px;}
          pre{ white-space:pre-wrap; word-break:break-word; background:#f7fafc; padding:8px; border-radius:6px;}
        </style>
      </head>
    `;
    const body = `
      <body>
        <h1>Session Summary — ${meta.topic}</h1>
        <p>Difficulty: ${meta.difficulty} • Questions: ${meta.totalQuestions}</p>
        ${results
          .map(
            (r, i) => `
          <div class="card">
            <h3>${i + 1}. ${escapeHtml(r.question)}</h3>
            <strong>Your answer:</strong>
            <p>${escapeHtml(r.answer)}</p>
            <strong>Evaluation:</strong>
            <pre>${escapeHtml(JSON.stringify(r.evaluation, null, 2))}</pre>
          </div>
        `
          )
          .join("")}
      </body>
    `;
    return `<!doctype html><html>${head}${body}</html>`;
  };

  const downloadResults = () => {
    const html = buildPrintableHTML(sessionResults, { topic, difficulty, totalQuestions });
    const w = window.open("");
    w.document.write(html);
    w.document.close();
    setTimeout(() => {
      try {
        w.print();
      } catch {}
    }, 400);
  };

  const clearHistory = async () => {
    if (!window.confirm("Clear saved history?")) return;
    if (token) {
      try {
        const res = await fetch(`${BACKEND_URL}/history`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setHistory([]);
          showToast("History cleared from account", "success");
        } else {
          showToast(data.error || "Failed to clear history", "error");
        }
      } catch (err) {
        showToast(err.message, "error");
      }
    } else {
      localStorage.removeItem("ai_interview_history");
      setHistory([]);
      showToast("Local history cleared", "success");
    }
  };

  const getScoreClass = (score) => {
    if (typeof score !== "number") return "score-na";
    if (score >= 8) return "high";
    if (score >= 4) return "mid";
    return "low";
  };

  const calculateSessionScore = (results) => {
    let numericScores = results
      .map((r) => (r.evaluation && typeof r.evaluation.score === "number" ? r.evaluation.score : null))
      .filter(Boolean);
    if (numericScores.length === 0) return 0;
    const avg = numericScores.reduce((a, b) => a + b, 0) / numericScores.length;
    return Math.round(avg);
  };

  const renderEvaluationPanel = (rawEval, small = false, indexKey = "") => {
    const ev = normalizeEval(rawEval);
    if (!ev) return <div className="smallMuted">No evaluation yet.</div>;

    const top3 = topWeaknesses(ev);

    return (
      <div className={`evalCard evaluation-card ${small ? "small-compact" : ""}`} data-key={indexKey}>
        <div className="eval-header">
          <div className="score-wrap">
            <div className={`score-badge ${getScoreClass(ev.score)}`}>
              {typeof ev.score === "number" ? ev.score : "N/A"}
            </div>
            <div className="score-meta">
              <div className="score-label">Score</div>
              <div className="score-sub">Based on a 0–10 scale</div>
            </div>
          </div>

          <div className="next-q-cta">
            {ev.next_question || ev.nextQuestion ? (
              <button
                className="btn primary"
                onClick={() => {
                  const nq = ev.next_question || ev.nextQuestion;
                  setQuestion(nq);
                  speak(nq);
                }}
              >
                Ask Follow-up
              </button>
            ) : null}
          </div>
        </div>

        <div className="eval-body">
          <section className="eval-section">
            <h4>Feedback</h4>
            <p className="feedback">{ev.feedback || "No feedback provided."}</p>
          </section>

          <section className="eval-section two-cols">
            <div>
              <h5>Top weaknesses</h5>
              {top3.length ? (
                <ul className="points-list">
                  {top3.map((m, i) => (
                    <li key={i}>
                      <strong>{i + 1}.</strong> {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="smallMuted">No missing points listed.</p>
              )}
            </div>

            <div>
              <h5>Other Mistakes</h5>
              {ev.mistakes && ev.mistakes.length ? (
                <ul className="points-list mistakes">
                  {ev.mistakes.map((m, i) => (
                    <li key={i}>
                      <strong>{i + 1}.</strong> {m}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="smallMuted">No specific mistakes listed.</p>
              )}
            </div>
          </section>

          <section className="eval-section">
            <div className="perfect-header">
              <h5>Perfect Answer (example)</h5>
              <div className="perfect-actions">
                <button
                  className="btn ghost"
                  onClick={() => {
                    setExpandedPerfect((prev) => ({
                      ...prev,
                      [indexKey || "cur"]: !prev[indexKey || "cur"],
                    }));
                  }}
                >
                  {expandedPerfect[indexKey || "cur"] ? "Collapse" : "Expand"}
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    const text = ev.perfect_answer || "";
                    navigator.clipboard?.writeText(text);
                    showToast("Perfect answer copied", "success");
                  }}
                >
                  Copy Example
                </button>
              </div>
            </div>

            <pre
              className="perfect-answer"
              style={{
                maxHeight: expandedPerfect[indexKey || "cur"] ? 420 : 140,
                overflow: "auto",
                transition: "max-height 300ms ease",
              }}
            >
              {ev.perfect_answer || "No example provided."}
            </pre>
          </section>
        </div>
      </div>
    );
  };

  const evalToShow = normalizeEval(evaluation);
  const progressPercent = totalQuestions > 0 ? Math.round((currentIndex / totalQuestions) * 100) : 0;
  const displayIndex = interviewActive ? Math.min(currentIndex + 1, totalQuestions) : 0;

  const onReviewNext = () => {
    setReviewModalOpen(false);
    const nextQ = window.__nextQ || null;
    window.__nextQ = null;
    setTimeout(() => {
      advanceQuestion(nextQ);
    }, 200);
  };

  const onReviewSkip = () => {
    setReviewModalOpen(false);
    window.__nextQ = null;
    setTimeout(() => {
      advanceQuestion();
    }, 200);
  };

  const handleRegister = async () => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: authName, email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Registration failed", "error");
      } else {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem("ai_user", JSON.stringify(data.user));
        localStorage.setItem("ai_token", data.token);
        showToast("Registered & logged in", "success");
        setAuthModalOpen(false);
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogin = async () => {
    setAuthLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        showToast(data.error || "Login failed", "error");
      } else {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem("ai_user", JSON.stringify(data.user));
        localStorage.setItem("ai_token", data.token);
        showToast("Logged in", "success");
        setAuthModalOpen(false);
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem("ai_user");
    localStorage.removeItem("ai_token");
    showToast("Logged out", "info");
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem("ai_theme", next ? "dark" : "light");
      return next;
    });
  };

  return (
    <div className={darkMode ? "theme-dark" : "theme-light"}>
      <div className="container">
        <div className="card" style={{ maxWidth: 1000 }}>
          <div className="header header-row">
            <div>
              <h1 className="h1">AI Interview Practice</h1>
              <p className="hint">Practice technical interview questions with AI feedback</p>
            </div>
            <div className="header-actions">
              <button className="btn ghost" onClick={toggleDarkMode}>
                {darkMode ? "☀ Light" : "🌙 Dark"}
              </button>
              {user ? (
                <div className="user-info">
                  <span className="user-name">Hi, {user.name}</span>
                  <button className="btn ghost" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              ) : (
                <button className="btn ghost" onClick={() => setAuthModalOpen(true)}>
                  Login / Register
                </button>
              )}
            </div>
          </div>

          {/* controls */}
          <div className="grid">
            <div>
              <label className="label">Select Topic</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="select"
                disabled={interviewActive}
              >
                <option value="Java">Java</option>
                <option value="Python">Python</option>
                <option value="SQL">SQL</option>
                <option value="Data Structures">Data Structures</option>
                <option value="System Design">System Design</option>
              </select>
            </div>

            <div>
              <label className="label">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="select"
                disabled={interviewActive}
              >
                <option>Easy</option>
                <option>Medium</option>
                <option>Hard</option>
              </select>
            </div>

            <div>
              <label className="label">Number of Questions</label>
              <input
                className="input"
                type="number"
                min="1"
                value={totalQuestions}
                onChange={(e) => setTotalQuestions(Number(e.target.value))}
                disabled={interviewActive}
              />
            </div>

            <div>
              <label className="label">Time per question (sec)</label>
              <input
                className="input"
                type="number"
                min="10"
                value={timePerQuestion}
                onChange={(e) => setTimePerQuestion(Number(e.target.value))}
                disabled={interviewActive}
              />
            </div>
          </div>

          {/* progress */}
          <div style={{ margin: "14px 0", transition: "all 200ms ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontWeight: 700 }}>
                {interviewActive ? `Question ${displayIndex} of ${totalQuestions}` : "Ready to start"}
              </div>
              <div style={{ fontWeight: 600, color: "#6b7280" }}>
                {currentIndex}/{totalQuestions}
              </div>
            </div>
            <div style={{ background: "#eef2ff", height: 12, borderRadius: 8 }}>
              <div
                style={{
                  width: `${progressPercent}%`,
                  background: "#4f46e5",
                  height: "100%",
                  borderRadius: 8,
                  transition: "width 500ms cubic-bezier(.2,.9,.2,1)",
                }}
              />
            </div>
          </div>

          <div className="questionBox noselect" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 16 }}>Q: </strong>
              <span style={{ marginLeft: 8 }}>{question}</span>
            </div>
            <div style={{ marginLeft: 16, textAlign: "right", minWidth: 140 }}>
              <div style={{ fontWeight: 700, color: "#374151" }}>Time left</div>
              <div style={{ fontSize: 20, color: "#111827" }}>{timeLeft}s</div>
            </div>
          </div>

          <div className="btnRow" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={startInterview} disabled={interviewActive}>
              Start Interview
            </button>
            <button className="btn green" onClick={startListening} disabled={isListening}>
              Start Answer (Mic)
            </button>
            <button className="btn yellow" onClick={stopListening} disabled={!isListening}>
              Stop
            </button>
            <button className="btn blue" onClick={() => handleSubmitAnswer(false)} disabled={!interviewActive || submitting}>
              {submitting ? "Evaluating..." : "Submit Answer"}
            </button>
            <button
              className="btn"
              onClick={() => setHistoryOpen(true)}
              style={{ background: "#eef2ff", color: "#4f46e5" }}
            >
              History
            </button>
          </div>

          {/* waveform animation while recording */}
          {isListening && (
            <div className="waveform">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          )}

          <div className="transcript" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Your answer:</div>
            <div style={{ color: "#111827" }}>
              {transcript || <span style={{ color: "#9ca3af" }}>(speak to record)</span>}
            </div>
          </div>

          {/* live evaluation */}
          <div style={{ marginTop: 16 }}>{renderEvaluationPanel(evaluation)}</div>

          {/* session summary */}
          {!interviewActive && sessionResults.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 8 }}>Session Summary</h3>

              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <div
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: "#fff",
                    border: "1px solid rgba(15,23,42,0.04)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    Overall Score: {calculateSessionScore(sessionResults)}
                  </div>
                  <div className="smallMuted">Average of all evaluated questions.</div>
                </div>

                <button className="btn blue" onClick={downloadResults}>
                  Download Summary (PDF)
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setSessionResults([]);
                    setTranscript("");
                    setEvaluation(null);
                    setCurrentIndex(0);
                    setQuestion(topicQuestions[topic]);
                  }}
                >
                  Retake
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                {sessionResults.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      marginBottom: 12,
                      padding: 12,
                      borderRadius: 10,
                      background: "#fff",
                      border: "1px solid rgba(15,23,42,0.04)",
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{i + 1}. {r.question}</div>
                    <div style={{ marginTop: 6 }}>
                      <strong>Your answer:</strong> {r.answer}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      {renderEvaluationPanel(r.evaluation, true, `past_${i}`)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* history modal */}
          {historyOpen && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <h3>Saved History</h3>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={() => setHistoryOpen(false)}>
                      Close
                    </button>
                    <button
                      className="btn"
                      onClick={clearHistory}
                      style={{ background: "#fee2e2", color: "#b91c1c" }}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="modal-body">
                  {history.length === 0 && <p className="smallMuted">No saved sessions yet.</p>}
                  {history.map((s) => {
                    const dateLabel = s.endedAt || s.createdAt;
                    const id = s.id || s._id || "";
                    return (
                      <div key={id} className="history-row">
                        <div>
                          <div className="history-title">
                            {s.topic} — {s.difficulty}
                          </div>
                          <div className="smallMuted">
                            {s.totalQuestions} questions •{" "}
                            {dateLabel ? new Date(dateLabel).toLocaleString() : ""}
                          </div>
                        </div>
                        <div style={{ minWidth: 220, textAlign: "right" }}>
                          <button
                            className="btn"
                            onClick={() => {
                              const w = window.open("");
                              w.document.write("<pre>" + JSON.stringify(s, null, 2) + "</pre>");
                            }}
                          >
                            Preview JSON
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* per-question review modal */}
          {reviewModalOpen && (
            <div className="modal-backdrop">
              <div className="modal">
                <div className="modal-header">
                  <h3>Review — Question {currentIndex + 1}</h3>
                  <button className="btn" onClick={() => setReviewModalOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="modal-body">
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontWeight: 700 }}>{question}</div>
                    <div style={{ marginTop: 8 }}>
                      <strong>Your answer:</strong> {transcript || "(no answer)"}
                    </div>
                  </div>
                  <div>{renderEvaluationPanel(evaluation)}</div>
                </div>
                <div className="modal-footer">
                  <button className="btn" onClick={onReviewSkip}>
                    Skip
                  </button>
                  <button className="btn primary" onClick={onReviewNext}>
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Toast container */}
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`}>
              {t.message}
            </div>
          ))}
        </div>

        {/* Auth modal */}
        {authModalOpen && (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 420 }}>
              <div className="modal-header">
                <h3>{authMode === "login" ? "Login" : "Register"}</h3>
                <button className="btn" onClick={() => setAuthModalOpen(false)}>
                  Close
                </button>
              </div>
              <div className="modal-body">
                {authMode === "register" && (
                  <div style={{ marginBottom: 10 }}>
                    <label className="label">Name</label>
                    <input
                      className="input"
                      value={authName}
                      onChange={(e) => setAuthName(e.target.value)}
                    />
                  </div>
                )}
                <div style={{ marginBottom: 10 }}>
                  <label className="label">Email</label>
                  <input
                    className="input"
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Password</label>
                  <input
                    className="input"
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                  />
                </div>
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn primary"
                    onClick={authMode === "login" ? handleLogin : handleRegister}
                    disabled={authLoading}
                  >
                    {authLoading
                      ? "Please wait..."
                      : authMode === "login"
                      ? "Login"
                      : "Register"}
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn ghost"
                    onClick={() =>
                      setAuthMode((m) => (m === "login" ? "register" : "login"))
                    }
                  >
                    {authMode === "login"
                      ? "Need an account? Register"
                      : "Already registered? Login"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
