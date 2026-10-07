const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2/promise");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "barangay_complaint",
  waitForConnections: true,
  connectionLimit: 10
});

const secret = process.env.JWT_SECRET || "development-secret";

async function seedDemoUsers() {
  const users = [
    ["admin", "admin123", "System Administrator", "admin"],
    ["staff", "staff123", "Barangay Staff", "staff"],
    ["resident", "resident123", "Demo Resident", "resident"]
  ];

  for (const [username, password, fullName, role] of users) {
    const [rows] = await pool.query("SELECT id FROM users WHERE username=?", [username]);
    if (!rows.length) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query(
        "INSERT INTO users(username,password_hash,full_name,email,role) VALUES(?,?,?,?,?)",
        [username, hash, fullName, `${username}@example.com`, role]
      );
    }
  }

  const [a] = await pool.query("SELECT id FROM announcements LIMIT 1");
  if (!a.length) {
    const [admins] = await pool.query("SELECT id FROM users WHERE username='admin'");
    await pool.query(
      "INSERT INTO announcements(title,content,published_by) VALUES(?,?,?)",
      ["Welcome to the Barangay Complaint System", "Residents may submit and track community complaints through the system.", admins[0].id]
    );
  }
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    res.status(401).json({ message: "Invalid or expired token" });
  }
}

function roles(...allowed) {
  return (req, res, next) => allowed.includes(req.user.role)
    ? next()
    : res.status(403).json({ message: "Access denied" });
}

async function log(userId, action) {
  await pool.query("INSERT INTO activity_logs(user_id,action) VALUES(?,?)", [userId, action]);
}

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, message: "API and database are connected" });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, full_name, email, phone, address } = req.body;
    if (!username || !password || !full_name) return res.status(400).json({ message: "Username, password, and full name are required" });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users(username,password_hash,full_name,email,phone,address,role) VALUES(?,?,?,?,?,?, 'resident')",
      [username, hash, full_name, email || null, phone || null, address || null]
    );
    res.status(201).json({ id: result.insertId, message: "Registration successful" });
  } catch (e) {
    res.status(400).json({ message: e.code === "ER_DUP_ENTRY" ? "Username already exists" : e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const [rows] = await pool.query("SELECT * FROM users WHERE username=? AND status='active'", [username]);
  if (!rows.length || !(await bcrypt.compare(password || "", rows[0].password_hash))) {
    return res.status(401).json({ message: "Invalid username or password" });
  }
  const user = rows[0];
  const token = jwt.sign({ id: user.id, username: user.username, full_name: user.full_name, role: user.role }, secret, { expiresIn: "8h" });
  await log(user.id, "Logged in");
  res.json({ token, user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } });
});

app.get("/api/me", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT id,username,full_name,email,phone,address,role,status,created_at FROM users WHERE id=?", [req.user.id]);
  res.json(rows[0]);
});

app.get("/api/categories", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM categories ORDER BY name");
  res.json(rows);
});

app.post("/api/categories", auth, roles("admin"), async (req, res) => {
  const { name, description } = req.body;
  await pool.query("INSERT INTO categories(name,description) VALUES(?,?)", [name, description || null]);
  await log(req.user.id, `Created category: ${name}`);
  res.status(201).json({ message: "Category created" });
});

app.get("/api/complaints", auth, async (req, res) => {
  let sql = `SELECT c.*, cat.name category, u.full_name resident,
    a.staff_id, s.full_name assigned_staff
    FROM complaints c
    JOIN categories cat ON cat.id=c.category_id
    JOIN users u ON u.id=c.resident_id
    LEFT JOIN assignments a ON a.complaint_id=c.id
    LEFT JOIN users s ON s.id=a.staff_id`;
  const params = [];
  if (req.user.role === "resident") {
    sql += " WHERE c.resident_id=?";
    params.push(req.user.id);
  } else if (req.user.role === "staff") {
    sql += " WHERE a.staff_id=?";
    params.push(req.user.id);
  }
  sql += " ORDER BY c.created_at DESC";
  const [rows] = await pool.query(sql, params);
  res.json(rows);
});

app.get("/api/complaints/:id", auth, async (req, res) => {
  const [rows] = await pool.query(`
    SELECT c.*, cat.name category, u.full_name resident,
    a.staff_id, s.full_name assigned_staff
    FROM complaints c
    JOIN categories cat ON cat.id=c.category_id
    JOIN users u ON u.id=c.resident_id
    LEFT JOIN assignments a ON a.complaint_id=c.id
    LEFT JOIN users s ON s.id=a.staff_id
    WHERE c.id=?`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: "Complaint not found" });
  const [updates] = await pool.query(`
    SELECT cu.*, u.full_name user_name
    FROM complaint_updates cu JOIN users u ON u.id=cu.user_id
    WHERE cu.complaint_id=? ORDER BY cu.created_at`, [req.params.id]);
  res.json({ complaint: rows[0], updates });
});

app.post("/api/complaints", auth, roles("resident"), async (req, res) => {
  const { category_id, subject, description, location, incident_date, incident_time, priority } = req.body;
  if (!category_id || !subject || !description || !location) return res.status(400).json({ message: "Please complete all required fields" });
  const ref = `CMP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
  const [result] = await pool.query(`
    INSERT INTO complaints(reference_no,resident_id,category_id,subject,description,location,incident_date,incident_time,priority)
    VALUES(?,?,?,?,?,?,?,?,?)`,
    [ref, req.user.id, category_id, subject, description, location, incident_date || null, incident_time || null, priority || "Medium"]
  );
  await pool.query("INSERT INTO complaint_updates(complaint_id,user_id,status,remarks) VALUES(?,?,?,?)",
    [result.insertId, req.user.id, "Submitted", "Complaint submitted by resident"]);
  await log(req.user.id, `Submitted complaint ${ref}`);
  res.status(201).json({ id: result.insertId, reference_no: ref });
});

app.patch("/api/complaints/:id/status", auth, roles("admin","staff"), async (req, res) => {
  const { status, remarks, resolution } = req.body;
  const allowed = ["Submitted","Under Review","Verified","Assigned","In Progress","On Hold","Resolved","Rejected","Closed","Cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status" });

  const resolvedAt = status === "Resolved" ? new Date() : null;
  await pool.query("UPDATE complaints SET status=?, resolution=COALESCE(?,resolution), resolved_at=? WHERE id=?",
    [status, resolution || null, resolvedAt, req.params.id]);
  await pool.query("INSERT INTO complaint_updates(complaint_id,user_id,status,remarks) VALUES(?,?,?,?)",
    [req.params.id, req.user.id, status, remarks || null]);

  const [c] = await pool.query("SELECT resident_id,reference_no FROM complaints WHERE id=?", [req.params.id]);
  if (c.length) {
    await pool.query("INSERT INTO notifications(user_id,title,message) VALUES(?,?,?)",
      [c[0].resident_id, "Complaint Updated", `${c[0].reference_no} status changed to ${status}.`]);
    await log(req.user.id, `Updated ${c[0].reference_no} to ${status}`);
  }
  res.json({ message: "Complaint updated" });
});

app.get("/api/staff", auth, roles("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT id,username,full_name,email,phone,status,created_at FROM users WHERE role='staff' ORDER BY full_name");
  res.json(rows);
});

app.post("/api/staff", auth, roles("admin"), async (req, res) => {
  const { username,password,full_name,email,phone } = req.body;
  const hash = await bcrypt.hash(password || "staff123", 10);
  await pool.query("INSERT INTO users(username,password_hash,full_name,email,phone,role) VALUES(?,?,?,?,?,'staff')",
    [username,hash,full_name,email || null,phone || null]);
  await log(req.user.id, `Created staff account: ${username}`);
  res.status(201).json({ message: "Staff account created" });
});

app.post("/api/complaints/:id/assign", auth, roles("admin","staff"), async (req,res) => {
  const { staff_id } = req.body;
  await pool.query(`
    INSERT INTO assignments(complaint_id,staff_id,assigned_by) VALUES(?,?,?)
    ON DUPLICATE KEY UPDATE staff_id=VALUES(staff_id), assigned_by=VALUES(assigned_by), assigned_at=CURRENT_TIMESTAMP`,
    [req.params.id, staff_id, req.user.id]);
  await pool.query("UPDATE complaints SET status='Assigned' WHERE id=?", [req.params.id]);
  const [c] = await pool.query("SELECT reference_no FROM complaints WHERE id=?", [req.params.id]);
  await log(req.user.id, `Assigned ${c[0]?.reference_no || req.params.id} to staff ${staff_id}`);
  res.json({ message: "Complaint assigned" });
});

app.get("/api/announcements", auth, async (req,res) => {
  const [rows] = await pool.query(`
    SELECT a.*, u.full_name published_by_name
    FROM announcements a JOIN users u ON u.id=a.published_by
    ORDER BY a.created_at DESC`);
  res.json(rows);
});

app.post("/api/announcements", auth, roles("admin","staff"), async (req,res) => {
  const { title, content } = req.body;
  await pool.query("INSERT INTO announcements(title,content,published_by) VALUES(?,?,?)",
    [title,content,req.user.id]);
  await log(req.user.id, `Published announcement: ${title}`);
  res.status(201).json({ message: "Announcement published" });
});

app.get("/api/notifications", auth, async (req,res) => {
  const [rows] = await pool.query("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC", [req.user.id]);
  res.json(rows);
});

app.patch("/api/notifications/:id/read", auth, async (req,res) => {
  await pool.query("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?", [req.params.id,req.user.id]);
  res.json({ message:"Notification marked as read" });
});

app.get("/api/dashboard", auth, async (req,res) => {
  const where = req.user.role === "resident" ? "WHERE resident_id=?" : "";
  const params = req.user.role === "resident" ? [req.user.id] : [];
  const [totals] = await pool.query(`SELECT COUNT(*) total,
    SUM(status IN ('Submitted','Under Review','Verified','Assigned','In Progress','On Hold')) pending,
    SUM(status='Resolved') resolved,
    SUM(status='Rejected') rejected FROM complaints ${where}`, params);
  const [byStatus] = await pool.query(`SELECT status,COUNT(*) count FROM complaints ${where} GROUP BY status`, params);
  const [byCategory] = await pool.query(`SELECT cat.name category,COUNT(*) count
    FROM complaints c JOIN categories cat ON cat.id=c.category_id ${req.user.role === "resident" ? "WHERE c.resident_id=?" : ""} GROUP BY cat.id ORDER BY count DESC`, params);
  res.json({ totals: totals[0], byStatus, byCategory });
});

app.get("/api/residents", auth, roles("admin","staff"), async (req,res) => {
  const [rows] = await pool.query("SELECT id,username,full_name,email,phone,address,status,created_at FROM users WHERE role='resident' ORDER BY full_name");
  res.json(rows);
});

app.get("/api/activity-logs", auth, roles("admin"), async (req,res) => {
  const [rows] = await pool.query(`
    SELECT al.*, COALESCE(u.full_name,'Deleted User') user_name
    FROM activity_logs al LEFT JOIN users u ON u.id=al.user_id
    ORDER BY al.created_at DESC LIMIT 100`);
  res.json(rows);
});

async function start() {
  try {
    await pool.query("SELECT 1");
    await seedDemoUsers();
    app.listen(process.env.PORT || 5000, () => console.log(`API running on port ${process.env.PORT || 5000}`));
  } catch (e) {
    console.error("Startup error:", e.message);
    process.exit(1);
  }
}
start();
