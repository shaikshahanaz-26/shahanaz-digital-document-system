require("dotenv").config();
const express = require("express");
const session = require("express-session");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "shahanaz_document_db",
  waitForConnections: true,
  connectionLimit: 10
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "shahanaz-demo-secret",
  resave: false,
  saveUninitialized: false
}));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"))
});
const upload = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 } });

function auth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please login first." });
  next();
}

app.get("/api/me", (req, res) => res.json({ user: req.session.user || null }));

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "All fields are required." });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'user')",
      [name.trim(), email.trim().toLowerCase(), hash]
    );
    req.session.user = { user_id: result.insertId, name: name.trim(), email: email.trim().toLowerCase(), role: "user" };
    res.json({ message: "Registration successful.", redirect: "dashboard.html" });
  } catch (e) {
    res.status(400).json({ error: e.code === "ER_DUP_ENTRY" ? "Email already registered." : "Could not register user." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE email=?", [String(req.body.email || "").toLowerCase()]);
    if (!rows.length || !(await bcrypt.compare(req.body.password || "", rows[0].password)))
      return res.status(401).json({ error: "Invalid email or password." });
    const u = rows[0];
    req.session.user = { user_id: u.user_id, name: u.name, email: u.email, role: u.role };
    res.json({ message: "Login successful.", redirect: "dashboard.html" });
  } catch {
    res.status(500).json({ error: "Database connection failed. Check your .env file." });
  }
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ message: "Logged out." })));

app.get("/api/dashboard", auth, async (req, res) => {
  const uid = req.session.user.user_id;
  const [[{ total }]] = await pool.execute("SELECT COUNT(*) total FROM documents WHERE user_id=?", [uid]);
  const [[{ categories }]] = await pool.execute("SELECT COUNT(*) categories FROM categories");
  const [recent] = await pool.execute(
    `SELECT d.*, c.category_name FROM documents d LEFT JOIN categories c ON d.category_id=c.category_id
     WHERE d.user_id=? ORDER BY d.upload_date DESC LIMIT 5`, [uid]);
  res.json({ total, categories, recent, user: req.session.user });
});

app.get("/api/categories", auth, async (_, res) => {
  const [rows] = await pool.execute("SELECT * FROM categories ORDER BY category_name");
  res.json(rows);
});

app.post("/api/categories", auth, async (req, res) => {
  try {
    const [r] = await pool.execute("INSERT INTO categories(category_name,description) VALUES(?,?)",
      [req.body.category_name, req.body.description || ""]);
    res.json({ message: "Category added.", category_id: r.insertId });
  } catch { res.status(400).json({ error: "Category already exists or invalid." }); }
});

app.get("/api/documents", auth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT d.*, c.category_name FROM documents d LEFT JOIN categories c ON d.category_id=c.category_id
     WHERE d.user_id=? ORDER BY d.upload_date DESC`, [req.session.user.user_id]);
  res.json(rows);
});

app.post("/api/documents", auth, upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a file to upload." });
  try {
    const [r] = await pool.execute(
      "INSERT INTO documents(user_id,category_id,title,file_name,file_path) VALUES(?,?,?,?,?)",
      [req.session.user.user_id, req.body.category_id || null, req.body.title || req.file.originalname,
       req.file.originalname, req.file.filename]);
    res.json({ message: "Document uploaded successfully.", document_id: r.insertId });
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "Upload failed. Check your category and database." });
  }
});

app.get("/api/documents/:id/download", auth, async (req, res) => {
  const [rows] = await pool.execute("SELECT * FROM documents WHERE document_id=? AND user_id=?",
    [req.params.id, req.session.user.user_id]);
  if (!rows.length) return res.status(404).send("Document not found or access denied.");
  const filePath = path.join(uploadDir, rows[0].file_path);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found on server.");
  res.download(filePath, rows[0].file_name);
});

app.delete("/api/documents/:id", auth, async (req, res) => {
  const [rows] = await pool.execute("SELECT * FROM documents WHERE document_id=? AND user_id=?",
    [req.params.id, req.session.user.user_id]);
  if (!rows.length) return res.status(404).json({ error: "Document not found." });
  await pool.execute("DELETE FROM documents WHERE document_id=?", [req.params.id]);
  fs.unlink(path.join(uploadDir, rows[0].file_path), () => {});
  res.json({ message: "Document deleted." });
});

app.get("/api/access", auth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT a.*, d.title, u.name, u.email FROM document_access a
     JOIN documents d ON a.document_id=d.document_id JOIN users u ON a.user_id=u.user_id
     WHERE d.user_id=? ORDER BY a.granted_date DESC`, [req.session.user.user_id]);
  res.json(rows);
});

app.post("/api/access", auth, async (req, res) => {
  const { document_id, email, permission } = req.body;
  const [docs] = await pool.execute("SELECT document_id FROM documents WHERE document_id=? AND user_id=?",
    [document_id, req.session.user.user_id]);
  const [users] = await pool.execute("SELECT user_id FROM users WHERE email=?", [email]);
  if (!docs.length || !users.length) return res.status(400).json({ error: "Document or user email not found." });
  try {
    await pool.execute("INSERT INTO document_access(document_id,user_id,permission) VALUES(?,?,?)",
      [document_id, users[0].user_id, permission || "view"]);
    res.json({ message: "Access granted." });
  } catch { res.status(400).json({ error: "Access could not be granted." }); }
});

app.get("/api/shared/:id/download", auth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT d.* FROM documents d JOIN document_access a ON a.document_id=d.document_id
     WHERE d.document_id=? AND a.user_id=? AND a.permission IN ('view','download','edit')`,
    [req.params.id, req.session.user.user_id]);
  if (!rows.length) return res.status(403).send("Access denied.");
  const p = path.join(uploadDir, rows[0].file_path);
  if (!fs.existsSync(p)) return res.status(404).send("File not found.");
  res.download(p, rows[0].file_name);
});

app.get("/api/shared", auth, async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT d.*, c.category_name, u.name AS owner FROM documents d
     JOIN document_access a ON a.document_id=d.document_id
     JOIN users u ON u.user_id=d.user_id LEFT JOIN categories c ON c.category_id=d.category_id
     WHERE a.user_id=? ORDER BY a.granted_date DESC`, [req.session.user.user_id]);
  res.json(rows);
});

app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`Shahanaz DMS running at http://localhost:${PORT}`));