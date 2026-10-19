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
  connectionLimit: 10,
});

const secret = process.env.JWT_SECRET || "development-secret";

// ========================================
// DEMO ACCOUNTS
// ========================================

async function seedDemoUsers() {
  const users = [
    ["admin", "admin123", "System Administrator", "admin"],
    ["staff", "staff123", "Barangay Staff", "staff"],
    ["resident", "resident123", "Demo Resident", "resident"],
  ];

  for (const [username, password, fullName, role] of users) {
    const [rows] = await pool.query("SELECT id FROM users WHERE username=?", [
      username,
    ]);

    if (!rows.length) {
      const hash = await bcrypt.hash(password, 10);

      await pool.query(
        `INSERT INTO users
        (username, password_hash, full_name, email, role)
        VALUES (?, ?, ?, ?, ?)`,
        [username, hash, fullName, `${username}@example.com`, role],
      );
    }
  }

  const [announcements] = await pool.query(
    "SELECT id FROM announcements LIMIT 1",
  );

  if (!announcements.length) {
    const [admins] = await pool.query(
      "SELECT id FROM users WHERE username='admin'",
    );

    if (admins.length) {
      await pool.query(
        `INSERT INTO announcements
        (title, content, published_by)
        VALUES (?, ?, ?)`,
        [
          "Welcome to the Barangay Complaint System",
          "Residents may submit and track community complaints through the system.",
          admins[0].id,
        ],
      );
    }
  }
}

// ========================================
// AUTHENTICATION AND ROLE MIDDLEWARE
// ========================================

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    req.user = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
}

function roles(...allowed) {
  return (req, res, next) => {
    if (allowed.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      message: "Access denied",
    });
  };
}

async function log(userId, action) {
  await pool.query("INSERT INTO activity_logs(user_id, action) VALUES(?, ?)", [
    userId,
    action,
  ]);
}

// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      message: "API and database are connected",
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      message: error.message,
    });
  }
});

// ========================================
// REGISTER
// ========================================

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, full_name, email, phone, address } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({
        message: "Username, password, and full name are required",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users
      (username, password_hash, full_name, email, phone, address, role)
      VALUES (?, ?, ?, ?, ?, ?, 'resident')`,
      [
        username,
        hash,
        full_name,
        email || null,
        phone || null,
        address || null,
      ],
    );

    res.status(201).json({
      id: result.insertId,
      message: "Registration successful",
    });
  } catch (error) {
    res.status(400).json({
      message:
        error.code === "ER_DUP_ENTRY"
          ? "Username already exists"
          : error.message,
    });
  }
});

// ========================================
// LOGIN
// ========================================

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE username=? AND status='active'",
      [username],
    );

    if (
      !rows.length ||
      !(await bcrypt.compare(password || "", rows[0].password_hash))
    ) {
      return res.status(401).json({
        message: "Invalid username or password",
      });
    }

    const user = rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
      secret,
      { expiresIn: "8h" },
    );

    await log(user.id, "Logged in");

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Unable to log in",
    });
  }
});

// ========================================
// CURRENT USER
// ========================================

app.get("/api/me", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, full_name, email, phone, address,
    role, status, created_at
    FROM users WHERE id=?`,
    [req.user.id],
  );

  if (!rows.length || rows[0].status !== "active") {
    return res.status(401).json({
      message: "Account is inactive",
    });
  }

  res.json(rows[0]);
});

// ========================================
// CATEGORIES
// ========================================

app.get("/api/categories", auth, async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM categories ORDER BY name");

  res.json(rows);
});

app.post("/api/categories", auth, roles("admin"), async (req, res) => {
  const { name, description } = req.body;

  await pool.query("INSERT INTO categories(name, description) VALUES(?, ?)", [
    name,
    description || null,
  ]);

  await log(req.user.id, `Created category: ${name}`);

  res.status(201).json({
    message: "Category created",
  });
});

// ========================================
// COMPLAINT LIST
// ========================================

app.get("/api/complaints", auth, async (req, res) => {
  let sql = `
    SELECT c.*, cat.name category, u.full_name resident,
    a.staff_id, s.full_name assigned_staff
    FROM complaints c
    JOIN categories cat ON cat.id=c.category_id
    JOIN users u ON u.id=c.resident_id
    LEFT JOIN assignments a ON a.complaint_id=c.id
    LEFT JOIN users s ON s.id=a.staff_id
  `;

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

// ========================================
// COMPLAINT DETAILS
// ========================================

app.get("/api/complaints/:id", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, cat.name category, u.full_name resident,
    a.staff_id, s.full_name assigned_staff
    FROM complaints c
    JOIN categories cat ON cat.id=c.category_id
    JOIN users u ON u.id=c.resident_id
    LEFT JOIN assignments a ON a.complaint_id=c.id
    LEFT JOIN users s ON s.id=a.staff_id
    WHERE c.id=?`,
    [req.params.id],
  );

  if (!rows.length) {
    return res.status(404).json({
      message: "Complaint not found",
    });
  }

  const [updates] = await pool.query(
    `SELECT cu.*, u.full_name user_name
    FROM complaint_updates cu
    JOIN users u ON u.id=cu.user_id
    WHERE cu.complaint_id=?
    ORDER BY cu.created_at`,
    [req.params.id],
  );

  res.json({
    complaint: rows[0],
    updates,
  });
});

// ========================================
// SUBMIT COMPLAINT
// ========================================

app.post("/api/complaints", auth, roles("resident"), async (req, res) => {
  const {
    category_id,
    subject,
    description,
    location,
    incident_date,
    incident_time,
    priority,
  } = req.body;

  if (!category_id || !subject || !description || !location) {
    return res.status(400).json({
      message: "Please complete all required fields",
    });
  }

  const ref = `CMP-${new Date().getFullYear()}-${Date.now()
    .toString()
    .slice(-6)}`;

  const [result] = await pool.query(
    `INSERT INTO complaints
      (reference_no, resident_id, category_id, subject, description,
      location, incident_date, incident_time, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ref,
      req.user.id,
      category_id,
      subject,
      description,
      location,
      incident_date || null,
      incident_time || null,
      priority || "Medium",
    ],
  );

  await pool.query(
    `INSERT INTO complaint_updates
      (complaint_id, user_id, status, remarks)
      VALUES (?, ?, ?, ?)`,
    [
      result.insertId,
      req.user.id,
      "Submitted",
      "Complaint submitted by resident",
    ],
  );

  
await log(req.user.id, `Submitted complaint ${ref}`);

// Notify all active administrators and staff
const [recipients] = await pool.query(
  `SELECT id
   FROM users
   WHERE role IN ('admin', 'staff')
   AND status = 'active'`,
);

if (recipients.length > 0) {
  const notificationValues = recipients.map((recipient) => [
    recipient.id,
    "New Complaint Submitted",
    `A resident submitted a new complaint: ${ref} - ${subject}.`,
  ]);

  await pool.query(
    `INSERT INTO notifications (user_id, title, message)
     VALUES ?`,
    [notificationValues],
  );
}

res.status(201).json({
  id: result.insertId,
  reference_no: ref,
});

});

// ========================================
// UPDATE COMPLAINT STATUS AND NOTIFY RESIDENT
// ========================================

app.patch(
  "/api/complaints/:id/status",
  auth,
  roles("admin", "staff"),
  async (req, res) => {
    const { status, remarks, resolution } = req.body;

    const allowed = [
      "Submitted",
      "Under Review",
      "Verified",
      "Assigned",
      "In Progress",
      "On Hold",
      "Resolved",
      "Rejected",
      "Closed",
      "Cancelled",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: "Invalid status",
      });
    }

    const [complaints] = await pool.query(
      "SELECT resident_id, reference_no FROM complaints WHERE id=?",
      [req.params.id],
    );

    if (!complaints.length) {
      return res.status(404).json({
        message: "Complaint not found",
      });
    }

    const resolvedAt = status === "Resolved" ? new Date() : null;

    await pool.query(
      `UPDATE complaints
      SET status=?, resolution=COALESCE(?, resolution), resolved_at=?
      WHERE id=?`,
      [status, resolution || null, resolvedAt, req.params.id],
    );

    await pool.query(
      `INSERT INTO complaint_updates
      (complaint_id, user_id, status, remarks)
      VALUES (?, ?, ?, ?)`,
      [req.params.id, req.user.id, status, remarks || null],
    );

    await pool.query(
      "INSERT INTO notifications(user_id, title, message) VALUES(?, ?, ?)",
      [
        complaints[0].resident_id,
        "Complaint Updated",
        `${complaints[0].reference_no} status changed to ${status}.`,
      ],
    );

    await log(
      req.user.id,
      `Updated ${complaints[0].reference_no} to ${status}`,
    );

    res.json({
      message: "Complaint updated",
    });
  },
);

// ========================================
// STAFF LIST
// ADMIN ONLY
// ========================================

app.get("/api/staff", auth, roles("admin"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, full_name, email, phone, status, created_at
    FROM users
    WHERE role='staff' AND status='active'
    ORDER BY full_name`,
  );

  res.json(rows);
});

// ========================================
// CREATE STAFF
// ADMIN ONLY
// ========================================

app.post("/api/staff", auth, roles("admin"), async (req, res) => {
  try {
    const { username, password, full_name, email, phone } = req.body;

    if (!username || !password || !full_name) {
      return res.status(400).json({
        message: "Username, password, and full name are required",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users
      (username, password_hash, full_name, email, phone, role)
      VALUES (?, ?, ?, ?, ?, 'staff')`,
      [username, hash, full_name, email || null, phone || null],
    );

    await log(req.user.id, `Created staff account: ${username}`);

    res.status(201).json({
      message: "Staff account created",
    });
  } catch (error) {
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : 500).json({
      message:
        error.code === "ER_DUP_ENTRY"
          ? "Username already exists"
          : "Unable to create staff account",
    });
  }
});

// ========================================
// DELETE STAFF
// ADMIN ONLY
// SOFT DELETE: SET STATUS TO INACTIVE
// ========================================

app.delete("/api/staff/:id", auth, roles("admin"), async (req, res) => {
  try {
    const staffId = Number(req.params.id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({
        message: "Invalid staff account ID.",
      });
    }

    const [result] = await pool.query(
      `UPDATE users
      SET status='inactive'
      WHERE id=? AND role='staff' AND status='active'`,
      [staffId],
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Active staff account not found.",
      });
    }

    await log(req.user.id, `Deactivated staff account ID ${staffId}`);

    res.json({
      message: "Staff account deactivated successfully.",
    });
  } catch (error) {
    console.error("Deactivate staff error:", error);

    res.status(500).json({
      message: "Unable to deactivate staff account.",
    });
  }
});

// ========================================
// ASSIGN COMPLAINT
// ========================================


app.post(
  "/api/complaints/:id/assign",
  auth,
  roles("admin", "staff"),
  async (req, res) => {
    try {
      const complaintId = Number(req.params.id);
      const staffId = Number(req.body.staff_id);

      if (
        !Number.isInteger(complaintId) ||
        complaintId <= 0 ||
        !Number.isInteger(staffId) ||
        staffId <= 0
      ) {
        return res.status(400).json({
          message: "Please select a valid complaint and staff member.",
        });
      }

      // Check whether the complaint exists
      const [complaints] = await pool.query(
        `SELECT id, reference_no, subject
         FROM complaints
         WHERE id = ?`,
        [complaintId],
      );

      if (!complaints.length) {
        return res.status(404).json({
          message: "Complaint not found.",
        });
      }

      // Check whether the selected staff member is active
      const [staffRows] = await pool.query(
        `SELECT id, full_name
         FROM users
         WHERE id = ?
           AND role = 'staff'
           AND status = 'active'`,
        [staffId],
      );

      if (!staffRows.length) {
        return res.status(400).json({
          message: "Active staff account not found.",
        });
      }

      const complaint = complaints[0];
      const staff = staffRows[0];

      // Assign the complaint to the selected staff member
      await pool.query(
        `INSERT INTO assignments
          (complaint_id, staff_id, assigned_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
          staff_id = VALUES(staff_id),
          assigned_by = VALUES(assigned_by),
          assigned_at = CURRENT_TIMESTAMP`,
        [complaintId, staffId, req.user.id],
      );

      // Update complaint status
      await pool.query(
        `UPDATE complaints
         SET status = 'Assigned'
         WHERE id = ?`,
        [complaintId],
      );

      // Record the status update
      await pool.query(
        `INSERT INTO complaint_updates
          (complaint_id, user_id, status, remarks)
         VALUES (?, ?, ?, ?)`,
        [
          complaintId,
          req.user.id,
          "Assigned",
          `Complaint assigned to ${staff.full_name}`,
        ],
      );

      // Notify the staff member who received the assignment
      await pool.query(
        `INSERT INTO notifications
          (user_id, title, message)
         VALUES (?, ?, ?)`,
        [
          staffId,
          "New Complaint Assigned",
          `You have been assigned complaint ${complaint.reference_no}: ${complaint.subject}.`,
        ],
      );

      // Log the assignment
      await log(
        req.user.id,
        `Assigned ${complaint.reference_no} to staff ${staff.full_name}`,
      );

      // Notify the resident that the complaint was assigned
      const [residentRows] = await pool.query(
        `SELECT resident_id
         FROM complaints
         WHERE id = ?`,
        [complaintId],
      );

      await pool.query(
        `INSERT INTO notifications
          (user_id, title, message)
         VALUES (?, ?, ?)`,
        [
          residentRows[0].resident_id,
          "Complaint Assigned",
          `Your complaint ${complaint.reference_no} has been assigned to ${staff.full_name}.`,
        ],
      );

      return res.json({
        message: "Complaint assigned and notifications sent successfully.",
      });
    } catch (error) {
      console.error("Assign complaint error:", error);

      return res.status(500).json({
        message: "Unable to assign complaint.",
      });
    }
  },
);


// ========================================
// ANNOUNCEMENTS
// ========================================

app.get("/api/announcements", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT a.*, u.full_name published_by_name
    FROM announcements a
    JOIN users u ON u.id=a.published_by
    ORDER BY a.created_at DESC`,
  );

  res.json(rows);
});

app.post(
  "/api/announcements",
  auth,
  roles("admin", "staff"),
  async (req, res) => {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        message: "Title and content are required",
      });
    }

    await pool.query(
      `INSERT INTO announcements(title, content, published_by)
      VALUES (?, ?, ?)`,
      [title, content, req.user.id],
    );

    await log(req.user.id, `Published announcement: ${title}`);

    res.status(201).json({
      message: "Announcement published",
    });
  },
);

// ========================================
// NOTIFICATIONS
// ========================================

app.get("/api/notifications", auth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM notifications
    WHERE user_id=?
    ORDER BY created_at DESC`,
    [req.user.id],
  );

  res.json(rows);
});

app.patch("/api/notifications/:id/read", auth, async (req, res) => {
  await pool.query(
    `UPDATE notifications
    SET is_read=1
    WHERE id=? AND user_id=?`,
    [req.params.id, req.user.id],
  );

  res.json({
    message: "Notification marked as read",
  });
});

// ========================================
// DASHBOARD
// ========================================

app.get("/api/dashboard", auth, async (req, res) => {
  const where = req.user.role === "resident" ? "WHERE resident_id=?" : "";

  const params = req.user.role === "resident" ? [req.user.id] : [];

  const [totals] = await pool.query(
    `SELECT COUNT(*) total,
    SUM(status IN ('Submitted','Under Review','Verified',
    'Assigned','In Progress','On Hold')) pending,
    SUM(status='Resolved') resolved,
    SUM(status='Rejected') rejected
    FROM complaints ${where}`,
    params,
  );

  const [byStatus] = await pool.query(
    `SELECT status, COUNT(*) count
    FROM complaints ${where}
    GROUP BY status`,
    params,
  );

  const [byCategory] = await pool.query(
    `SELECT cat.name category, COUNT(*) count
    FROM complaints c
    JOIN categories cat ON cat.id=c.category_id
    ${req.user.role === "resident" ? "WHERE c.resident_id=?" : ""}
    GROUP BY cat.id
    ORDER BY count DESC`,
    params,
  );

  res.json({
    totals: totals[0],
    byStatus,
    byCategory,
  });
});

// ========================================
// RESIDENT LIST
// ADMIN AND STAFF
// ========================================

app.get("/api/residents", auth, roles("admin", "staff"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, username, full_name, email, phone, address,
      status, created_at
      FROM users
      WHERE role='resident' AND status='active'
      ORDER BY full_name`,
  );

  res.json(rows);
});

// ========================================
// CREATE RESIDENT
// ADMIN ONLY
// ========================================

app.post("/api/residents", auth, roles("admin"), async (req, res) => {
  try {
    const { username, password, full_name, email, phone, address } = req.body;

    if (!username?.trim() || !password || !full_name?.trim()) {
      return res.status(400).json({
        message: "Full name, username, and password are required.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters long.",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users
      (username, password_hash, full_name, email, phone, address, role)
      VALUES (?, ?, ?, ?, ?, ?, 'resident')`,
      [
        username.trim(),
        hash,
        full_name.trim(),
        email?.trim() || null,
        phone?.trim() || null,
        address?.trim() || null,
      ],
    );

    await log(req.user.id, `Created resident account: ${username.trim()}`);

    res.status(201).json({
      id: result.insertId,
      message: "Resident account created successfully.",
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "That username already exists. Please choose another.",
      });
    }

    console.error("Create resident error:", error);

    res.status(500).json({
      message: "Unable to create resident account.",
    });
  }
});

// ========================================
// DELETE RESIDENT
// ADMIN ONLY
// SOFT DELETE: SET STATUS TO INACTIVE
// ========================================

app.delete("/api/residents/:id", auth, roles("admin"), async (req, res) => {
  try {
    const residentId = Number(req.params.id);

    if (!Number.isInteger(residentId) || residentId <= 0) {
      return res.status(400).json({
        message: "Invalid resident account ID.",
      });
    }

    const [result] = await pool.query(
      `UPDATE users
      SET status='inactive'
      WHERE id=? AND role='resident' AND status='active'`,
      [residentId],
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Active resident account not found.",
      });
    }

    await log(req.user.id, `Deactivated resident account ID ${residentId}`);

    res.json({
      message: "Resident account deactivated successfully.",
    });
  } catch (error) {
    console.error("Deactivate resident error:", error);

    res.status(500).json({
      message: "Unable to deactivate resident account.",
    });
  }
});

// ========================================
// ACTIVITY LOGS
// ADMIN ONLY
// ========================================

app.get("/api/activity-logs", auth, roles("admin"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT al.*, COALESCE(u.full_name, 'Deleted User') user_name
      FROM activity_logs al
      LEFT JOIN users u ON u.id=al.user_id
      ORDER BY al.created_at DESC
      LIMIT 100`,
  );

  res.json(rows);
});

// ========================================
// START SERVER
// ========================================

async function start() {
  try {
    await pool.query("SELECT 1");
    await seedDemoUsers();

    const port = process.env.PORT || 5000;

    app.listen(port, () => {
      console.log(`API running on port ${port}`);
    });
  } catch (error) {
    console.error("Startup error:", error.message);
    process.exit(1);
  }
}

start();
