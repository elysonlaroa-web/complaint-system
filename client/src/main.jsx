import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
  Navigate,
  Outlet,
  useNavigate,
  useParams,
} from "react-router-dom";
import axios from "axios";
import "./styles.css";

const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

// =========================
// SESSION
// =========================
function getToken() {
  return sessionStorage.getItem("token");
}

function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem("user") || "null");
  } catch {
    return null;
  }
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("user");

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

// =========================
// REUSABLE CONFIRMATION MODAL
// =========================
function AccountDeactivationModal({
  account,
  accountType,
  loading,
  onCancel,
  onConfirm,
}) {
  if (!account) return null;

  const typeLabel = accountType === "staff" ? "Staff" : "Resident";

  return (
    <div
      className="delete-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div
        className="delete-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-delete-modal-title"
      >
        <div className="delete-modal-icon">!</div>

        <h2 id="account-delete-modal-title">
          Confirm {typeLabel} Deactivation
        </h2>

        <p>
          Are you sure you want to deactivate the account of
          <strong> {account.full_name}</strong>?
        </p>

        <p className="delete-modal-note">
          This account will no longer be active. The account holder will lose
          access to the BarangayCare system. Existing records will remain in the
          system.
        </p>

        <div className="delete-modal-actions">
          <button
            type="button"
            className="cancel-delete-btn"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>

          <button
            type="button"
            className="confirm-delete-btn"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Deactivating..." : "Confirm Deactivation"}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================
// NOTIFICATION BELL
// =========================
function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  const unreadCount = notifications.filter((item) => !item.is_read).length;

  async function loadNotifications() {
    try {
      const response = await api.get("/notifications");
      setNotifications(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      if (error.response?.status !== 401) {
        console.error("Unable to load notifications:", error);
      }
    }
  }

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsideClick);

    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
    };
  }, []);

  async function markAsRead(id) {
    try {
      await api.patch(`/notifications/${id}/read`);

      setNotifications((items) =>
        items.map((item) => (item.id === id ? { ...item, is_read: 1 } : item)),
      );
    } catch (error) {
      console.error("Unable to mark notification as read:", error);
    }
  }

  return (
    <div className="notification-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="notification-bell"
        aria-label="Open notifications"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
          <path d="M10 21h4" />
        </svg>

        {unreadCount > 0 && <span className="notification-dot" />}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            <strong>Notifications</strong>
            {unreadCount > 0 && (
              <span className="notification-count">{unreadCount} new</span>
            )}
          </div>

          <div className="notification-dropdown-list">
            {!notifications.length ? (
              <div className="notification-empty">No notifications yet.</div>
            ) : (
              notifications.slice(0, 8).map((item) => (
                <div
                  className={`notification-item ${
                    item.is_read ? "read" : "unread"
                  }`}
                  key={item.id}
                >
                  <div className="notification-item-heading">
                    <strong>{item.title || "Notification"}</strong>
                    {!item.is_read && <span className="item-unread-dot" />}
                  </div>

                  <p>{item.message}</p>

                  <div className="notification-item-footer">
                    <small>
                      {item.created_at
                        ? new Date(item.created_at).toLocaleString()
                        : ""}
                    </small>

                    {!item.is_read && (
                      <button
                        type="button"
                        className="mark-read"
                        onClick={() => markAsRead(item.id)}
                      >
                        Mark as read
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            className="view-all-notifications"
            onClick={() => {
              setOpen(false);
              navigate("/notifications");
            }}
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}

// =========================
// LAYOUT
// =========================
function Layout() {
  const [user, setUser] = useState(getUser());
  const navigate = useNavigate();

  function logout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    setUser(null);
    navigate("/login", { replace: true });
  }

  return (
    <div className="app">
      <aside>
        <div className="brand">
          Barangay<span>Care</span>
        </div>

        <div className="role">{user?.role?.toUpperCase()}</div>

        <nav>
          <Link to="/">Dashboard</Link>

          {user?.role === "resident" && (
            <Link to="/submit">Submit Complaint</Link>
          )}

          <Link to="/complaints">Complaints</Link>

          {(user?.role === "admin" || user?.role === "staff") && (
            <Link to="/residents">Residents</Link>
          )}

          {user?.role === "admin" && <Link to="/staff">Staff</Link>}

          {(user?.role === "admin" || user?.role === "staff") && (
            <Link to="/announcements">Announcements</Link>
          )}

          {user?.role === "admin" && <Link to="/logs">Activity Logs</Link>}
        </nav>

        <button className="logout" onClick={logout}>
          Logout
        </button>
      </aside>

      <main>
        <header>
          <div className="topbar-user">
            <div className="user-info">
              <b>{user?.full_name || user?.username || "User"}</b>
              <small>Community Complaint Portal</small>
            </div>

            <NotificationBell />
          </div>
        </header>

        <section className="content">
          <Outlet />
        </section>
      </main>
    </div>
  );
}

// =========================
// PROTECTED ROUTES
// =========================
function Protected({ children }) {
  const token = getToken();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

// =========================
// LOGIN
// =========================
function Login() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", form);

      if (!data.token || !data.user) {
        throw new Error("Invalid login response from server.");
      }

      sessionStorage.setItem("token", data.token);
      sessionStorage.setItem("user", JSON.stringify(data.user));

      navigate("/", { replace: true });
    } catch (error) {
      setError(
        error.response?.data?.message ||
          error.message ||
          "Login failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-overlay"></div>

      <div className="auth-content">
        <div className="auth-title">
          <h1>
            BARANGAY<span>CARE</span>
          </h1>
          <h2>Complaint Management &amp; Monitoring System</h2>
        </div>

        <form className="authbox" onSubmit={submit}>
          <div className="auth-header">USER LOGIN</div>

          <div className="auth-form">
            <label>
              <span>Username</span>
              <input
                type="text"
                value={form.username}
                onChange={(e) =>
                  setForm({
                    ...form,
                    username: e.target.value,
                  })
                }
                required
              />
            </label>

            <label>
              <span>Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) =>
                  setForm({
                    ...form,
                    password: e.target.value,
                  })
                }
                required
              />
            </label>

            {error && <div className="error">{error}</div>}

            <button type="submit" disabled={loading}>
              {loading ? "Signing In..." : "LOGIN"}
            </button>

            <div className="forgot">Forgot Password?</div>
          </div>
        </form>
      </div>
    </div>
  );
}

// =========================
// DASHBOARD
// =========================
function Dashboard() {
  const [data, setData] = useState({
    totals: {},
    byStatus: [],
    byCategory: [],
  });

  const [error, setError] = useState("");
  const user = getUser();

  useEffect(() => {
    api
      .get("/dashboard")
      .then((response) => {
        setData(response.data);
      })
      .catch((error) => {
        if (error.response?.status !== 401) {
          setError("Unable to load dashboard data.");
        }
      });
  }, []);

  const totals = data.totals || {};

  return (
    <>
      <div className="title">
        <div>
          <h1>Dashboard</h1>
          <p>Overview of community complaints and activities.</p>
        </div>

        {user?.role === "resident" && (
          <Link className="btn" to="/submit">
            + New Complaint
          </Link>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stats">
        <Stat n={totals.total || 0} label="Total Complaints" />
        <Stat n={totals.pending || 0} label="Pending" />
        <Stat n={totals.resolved || 0} label="Resolved" />
        <Stat n={totals.rejected || 0} label="Rejected" />
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Complaint Status</h2>

          {data.byStatus.length > 0 ? (
            data.byStatus.map((item) => (
              <div className="barrow" key={item.status}>
                <span>{item.status}</span>
                <b>{item.count}</b>
              </div>
            ))
          ) : (
            <p className="empty">No status data available.</p>
          )}
        </div>

        <div className="card">
          <h2>Top Categories</h2>

          {data.byCategory.length > 0 ? (
            data.byCategory.map((item) => (
              <div className="barrow" key={item.category}>
                <span>{item.category}</span>
                <b>{item.count}</b>
              </div>
            ))
          ) : (
            <p className="empty">No category data available.</p>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ n, label }) {
  return (
    <div className="card stat">
      <strong>{n}</strong>
      <span>{label}</span>
    </div>
  );
}

// =========================
// COMPLAINTS
// =========================
function Complaints() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/complaints")
      .then((response) => {
        setRows(response.data);
      })
      .catch((error) => {
        if (error.response?.status !== 401) {
          setError("Unable to load complaints.");
        }
      });
  }, []);

  const filtered = rows.filter((item) =>
    `${item.reference_no} ${item.subject} ${item.category} ${item.status}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  return (
    <>
      <div className="title">
        <div>
          <h1>Complaints</h1>
          <p>Review and monitor complaint records.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <input
          className="search"
          placeholder="Search reference, subject, category or status..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Subject</th>
              <th>Resident</th>
              <th>Category</th>
              <th>Priority</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {filtered.map((item) => (
              <tr key={item.id}>
                <td>{item.reference_no}</td>
                <td>{item.subject}</td>
                <td>{item.resident}</td>
                <td>{item.category}</td>
                <td>
                  <span
                    className={`pill ${item.priority?.toLowerCase() || ""}`}
                  >
                    {item.priority}
                  </span>
                </td>
                <td>
                  <span className="pill">{item.status}</span>
                </td>
                <td>
                  <Link to={`/complaints/${item.id}`}>View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!filtered.length && <p className="empty">No complaints found.</p>}
      </div>
    </>
  );
}

// =========================
// COMPLAINT DETAIL
// =========================
function ComplaintDetail({ id }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("");
  const [remarks, setRemarks] = useState("");
  const [staff, setStaff] = useState([]);
  const [staffId, setStaffId] = useState("");
  const [error, setError] = useState("");

  const user = getUser();

  async function load() {
    try {
      const response = await api.get(`/complaints/${id}`);
      setData(response.data);
      setStatus(response.data.complaint.status);
    } catch (error) {
      if (error.response?.status !== 401) {
        setError("Unable to load complaint details.");
      }
    }
  }

  useEffect(() => {
    load();

    if (user?.role === "admin") {
      api
        .get("/staff")
        .then((response) => setStaff(response.data))
        .catch((error) => {
          if (error.response?.status !== 401) {
            setError("Unable to load staff.");
          }
        });
    }
  }, [id]);

  async function update() {
    try {
      await api.patch(`/complaints/${id}/status`, {
        status,
        remarks,
      });

      setRemarks("");
      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message || "Unable to update complaint.",
        );
      }
    }
  }

  async function assign() {
    if (!staffId) return;

    try {
      await api.post(`/complaints/${id}/assign`, {
        staff_id: staffId,
      });

      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message || "Unable to assign complaint.",
        );
      }
    }
  }

  if (error) {
    return (
      <>
        <Link to="/complaints">← Back</Link>
        <div className="error">{error}</div>
      </>
    );
  }

  if (!data) {
    return <div className="card">Loading...</div>;
  }

  const complaint = data.complaint;

  return (
    <>
      <Link to="/complaints">← Back</Link>

      <div className="title">
        <div>
          <h1>{complaint.reference_no}</h1>
          <p>{complaint.subject}</p>
        </div>

        <span className={`pill ${complaint.priority?.toLowerCase() || ""}`}>
          {complaint.priority}
        </span>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Complaint Details</h2>

          <Info k="Resident" v={complaint.resident} />
          <Info k="Category" v={complaint.category} />
          <Info k="Location" v={complaint.location} />
          <Info
            k="Incident Date"
            v={complaint.incident_date || "Not provided"}
          />
          <Info k="Description" v={complaint.description} />

          <h3>Status Timeline</h3>

          {data.updates?.map((item) => (
            <div className="timeline" key={item.id}>
              <b>{item.status}</b>
              <span>{item.remarks || "Status updated"}</span>
              <small>{new Date(item.created_at).toLocaleString()}</small>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Management</h2>

          <p>
            Current status: <span className="pill">{complaint.status}</span>
          </p>

          {(user?.role === "admin" || user?.role === "staff") && (
            <>
              <label>
                Status
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
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
                  ].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Remarks
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </label>

              <button onClick={update}>Update Complaint</button>
            </>
          )}

          {user?.role === "admin" && (
            <>
              <hr />

              <label>
                Assign Staff
                <select
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                >
                  <option value="">Select staff</option>

                  {staff.map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.full_name}
                    </option>
                  ))}
                </select>
              </label>

              <button className="secondary" onClick={assign}>
                Assign Complaint
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Info({ k, v }) {
  return (
    <div className="info">
      <small>{k}</small>
      <div>{v}</div>
    </div>
  );
}

// =========================
// SUBMIT COMPLAINT
// =========================
function Submit() {
  const [categories, setCategories] = useState([]);

  const [form, setForm] = useState({
    category_id: "",
    subject: "",
    description: "",
    location: "",
    incident_date: "",
    incident_time: "",
    priority: "Medium",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/categories")
      .then((response) => setCategories(response.data))
      .catch((error) => {
        if (error.response?.status !== 401) {
          setError("Unable to load categories.");
        }
      });
  }, []);

  async function submit(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    try {
      const response = await api.post("/complaints", form);

      setMessage(
        `Complaint submitted successfully. Reference Number: ${response.data.reference_no}`,
      );

      setForm({
        ...form,
        subject: "",
        description: "",
        location: "",
      });
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(error.response?.data?.message || "Submission failed.");
      }
    }
  }

  return (
    <>
      <div className="title">
        <div>
          <h1>Submit Complaint</h1>
          <p>Provide complete information about your concern.</p>
        </div>
      </div>

      <form className="card form" onSubmit={submit}>
        {message && <div className="success">{message}</div>}
        {error && <div className="error">{error}</div>}

        <label>
          Category
          <select
            required
            value={form.category_id}
            onChange={(e) =>
              setForm({
                ...form,
                category_id: e.target.value,
              })
            }
          >
            <option value="">Select category</option>

            {categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Subject
          <input
            required
            value={form.subject}
            onChange={(e) =>
              setForm({
                ...form,
                subject: e.target.value,
              })
            }
          />
        </label>

        <label>
          Description
          <textarea
            required
            rows="5"
            value={form.description}
            onChange={(e) =>
              setForm({
                ...form,
                description: e.target.value,
              })
            }
          />
        </label>

        <div className="grid2">
          <label>
            Location
            <input
              required
              value={form.location}
              onChange={(e) =>
                setForm({
                  ...form,
                  location: e.target.value,
                })
              }
            />
          </label>

          <label>
            Priority
            <select
              value={form.priority}
              onChange={(e) =>
                setForm({
                  ...form,
                  priority: e.target.value,
                })
              }
            >
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
          </label>
        </div>

        <div className="grid2">
          <label>
            Incident Date
            <input
              type="date"
              value={form.incident_date}
              onChange={(e) =>
                setForm({
                  ...form,
                  incident_date: e.target.value,
                })
              }
            />
          </label>

          <label>
            Incident Time
            <input
              type="time"
              value={form.incident_time}
              onChange={(e) =>
                setForm({
                  ...form,
                  incident_time: e.target.value,
                })
              }
            />
          </label>
        </div>

        <button type="submit">Submit Complaint</button>
      </form>
    </>
  );
}

// =========================
// RESIDENTS
// =========================


function Residents() {
  const user = getUser();
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedResident, setSelectedResident] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    full_name: "",
    username: "",
    email: "",
    password: "",
    phone: "",
    address: "",
  });

  async function loadResidents() {
    setLoading(true);

    try {
      const response = await api.get("/residents");
      setItems(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load residents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadResidents();
  }, []);

  function updateForm(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function addResident(e) {
    e.preventDefault();

    if (!isAdmin) {
      setError("Only administrators can create resident accounts.");
      return;
    }

    setSaving(true);
    setMessage("");
    setError("");

    try {
      await api.post("/residents", form);

      setMessage("Resident account created successfully.");

      setForm({
        full_name: "",
        username: "",
        email: "",
        password: "",
        phone: "",
        address: "",
      });

      setShowAddForm(false);
      await loadResidents();
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to create resident account.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function deactivateResident() {
    if (!isAdmin || !selectedResident || saving) return;

    setSaving(true);
    setError("");
    setMessage("");

    try {
      await api.delete(`/residents/${selectedResident.id}`);

      setMessage(
        `Resident account for ${selectedResident.full_name} was deactivated.`,
      );

      setSelectedResident(null);
      await loadResidents();
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to deactivate resident account.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <h1>Residents</h1>
          <p>Manage registered community residents.</p>
        </div>

        {isAdmin && (
          <button
            type="button"
            className="add-resident-btn"
            onClick={() => {
              setMessage("");
              setError("");
              setShowAddForm((value) => !value);
            }}
          >
            {showAddForm ? "Cancel" : "+ Add Resident"}
          </button>
        )}
      </div>

      {message && <div className="success-message">{message}</div>}
      {error && <div className="error-message">{error}</div>}

      {isAdmin && showAddForm && (
        <div className="card resident-form-card">
          <h2>Create Resident Account</h2>

          <form onSubmit={addResident} className="resident-form">
            <label>
              Full Name
              <input
                name="full_name"
                value={form.full_name}
                onChange={updateForm}
                required
                placeholder="Enter full name"
              />
            </label>

            <label>
              Username
              <input
                name="username"
                value={form.username}
                onChange={updateForm}
                required
                placeholder="Choose a username"
              />
            </label>

            <label>
              Email
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={updateForm}
                required
                placeholder="Enter email address"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                name="password"
                value={form.password}
                onChange={updateForm}
                required
                minLength={8}
                placeholder="At least 8 characters"
              />
            </label>

            <label>
              Phone
              <input
                name="phone"
                value={form.phone}
                onChange={updateForm}
                placeholder="Enter phone number"
              />
            </label>

            <label>
              Address
              <input
                name="address"
                value={form.address}
                onChange={updateForm}
                placeholder="Enter residential address"
              />
            </label>

            <div className="resident-form-actions">
              <button
                type="button"
                className="cancel-delete-btn"
                onClick={() => setShowAddForm(false)}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="add-resident-btn"
                disabled={saving}
              >
                {saving ? "Creating..." : "Create Account"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card table-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Status</th>
                {isAdmin && <th>Actions</th>}
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6}>Loading residents...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6}>No residents found.</td>
                </tr>
              ) : (
                items.map((resident) => (
                  <tr key={resident.id}>
                    <td>{resident.full_name || "-"}</td>
                    <td>{resident.username || "-"}</td>
                    <td>{resident.email || "-"}</td>
                    <td>{resident.phone || "-"}</td>
                    <td>{resident.address || "-"}</td>
                    <td>{resident.status || "active"}</td>

                    {isAdmin && (
                      <td>
                        {(resident.status || "active") === "active" && (
                          <button
                            type="button"
                            className="confirm-delete-btn"
                            onClick={() => {
                              setSelectedResident(resident);
                              setError("");
                              setMessage("");
                            }}
                          >
                            Deactivate
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin && selectedResident && (
        <AccountDeactivationModal
          account={selectedResident}
          accountType="resident"
          loading={saving}
          onCancel={() => {
            if (!saving) setSelectedResident(null);
          }}
          onConfirm={deactivateResident}
        />
      )}
    </div>
  );
}



// =========================
// STAFF
// =========================
function Staff() {
  const [rows, setRows] = useState([]);

  const [form, setForm] = useState({
    username: "",
    password: "staff123",
    full_name: "",
    email: "",
    phone: "",
  });

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [deletingStaff, setDeletingStaff] = useState(false);

  async function load() {
    try {
      const response = await api.get("/staff");
      setRows(response.data);
    } catch (error) {
      if (error.response?.status !== 401) {
        setError("Unable to load staff accounts.");
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e) {
    e.preventDefault();
    setMessage("");
    setError("");

    try {
      await api.post("/staff", form);

      setMessage("Staff account created.");

      setForm({
        username: "",
        password: "staff123",
        full_name: "",
        email: "",
        phone: "",
      });

      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message || "Unable to create staff account.",
        );
      }
    }
  }

  function handleDeleteStaff(staff) {
    setSelectedStaff(staff);
    setShowDeleteModal(true);
    setError("");
    setMessage("");
  }

  async function confirmDeleteStaff() {
    if (!selectedStaff || deletingStaff) return;

    setDeletingStaff(true);
    setError("");
    setMessage("");

    try {
      await api.delete(`/staff/${selectedStaff.id}`);

      setMessage(
        `Staff account for ${selectedStaff.full_name} was deactivated.`,
      );

      setShowDeleteModal(false);
      setSelectedStaff(null);

      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message ||
            "Unable to deactivate staff account.",
        );
      }
    } finally {
      setDeletingStaff(false);
    }
  }

  return (
    <>
      <div className="title">
        <div>
          <h1>Staff Management</h1>
          <p>Create and manage barangay staff accounts.</p>
        </div>
      </div>

      {message && <div className="success">{message}</div>}
      {error && <div className="error">{error}</div>}

      <div className="grid2">
        <form className="card form" onSubmit={add}>
          <h2>Add Staff</h2>

          <label>
            Full Name
            <input
              required
              value={form.full_name}
              onChange={(e) =>
                setForm({
                  ...form,
                  full_name: e.target.value,
                })
              }
            />
          </label>

          <label>
            Username
            <input
              required
              value={form.username}
              onChange={(e) =>
                setForm({
                  ...form,
                  username: e.target.value,
                })
              }
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={form.password}
              onChange={(e) =>
                setForm({
                  ...form,
                  password: e.target.value,
                })
              }
            />
          </label>

          <label>
            Email
            <input
              type="email"
              value={form.email}
              onChange={(e) =>
                setForm({
                  ...form,
                  email: e.target.value,
                })
              }
            />
          </label>

          <label>
            Phone
            <input
              value={form.phone}
              onChange={(e) =>
                setForm({
                  ...form,
                  phone: e.target.value,
                })
              }
            />
          </label>

          <button type="submit">Create Staff</button>
        </form>

        <div className="card">
          <h2>Staff Accounts</h2>

          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((item) => (
                <tr key={item.id}>
                  <td>{item.full_name}</td>
                  <td>{item.username}</td>
                  <td>{item.email || "-"}</td>
                  <td>
                    {item.status === "active" ? (
                      <button
                            type="button"
                            className="confirm-delete-btn"
                            onClick={() => {
                              handleDeleteStaff(item)
                            }}
                          >
                            Deactivate
                          </button>
                    ) : (
                      <span className="pill">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!rows.length && <p className="empty">No staff accounts found.</p>}
        </div>
      </div>

      {showDeleteModal && selectedStaff && (
        <AccountDeactivationModal
          account={selectedStaff}
          accountType="staff"
          loading={deletingStaff}
          onCancel={() => {
            setShowDeleteModal(false);
            setSelectedStaff(null);
          }}
          onConfirm={confirmDeleteStaff}
        />
      )}
    </>
  );
}

// =========================
// ANNOUNCEMENTS
// =========================
function Announcements() {
  const [rows, setRows] = useState([]);

  const [form, setForm] = useState({
    title: "",
    content: "",
  });

  const [user] = useState(getUser());
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await api.get("/announcements");
      setRows(response.data);
    } catch (error) {
      if (error.response?.status !== 401) {
        setError("Unable to load announcements.");
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function add(e) {
    e.preventDefault();

    try {
      await api.post("/announcements", form);

      setForm({
        title: "",
        content: "",
      });

      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message || "Unable to publish announcement.",
        );
      }
    }
  }

  return (
    <>
      <div className="title">
        <div>
          <h1>Announcements</h1>
          <p>Community notices and updates.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {(user?.role === "admin" || user?.role === "staff") && (
        <form className="card form" onSubmit={add}>
          <h2>Publish Announcement</h2>

          <label>
            Title
            <input
              required
              value={form.title}
              onChange={(e) =>
                setForm({
                  ...form,
                  title: e.target.value,
                })
              }
            />
          </label>

          <label>
            Content
            <textarea
              required
              value={form.content}
              onChange={(e) =>
                setForm({
                  ...form,
                  content: e.target.value,
                })
              }
            />
          </label>

          <button type="submit">Publish</button>
        </form>
      )}

      <div className="list">
        {rows.map((item) => (
          <div className="card" key={item.id}>
            <h2>{item.title}</h2>
            <p>{item.content}</p>

            <small>
              Posted by {item.published_by_name} ·{" "}
              {new Date(item.created_at).toLocaleString()}
            </small>
          </div>
        ))}
      </div>
    </>
  );
}

// =========================
// NOTIFICATIONS
// =========================
function Notifications() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await api.get("/notifications");
      setRows(response.data);
    } catch (error) {
      if (error.response?.status !== 401) {
        setError("Unable to load notifications.");
      }
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function read(id) {
    try {
      await api.patch(`/notifications/${id}/read`);
      await load();
    } catch (error) {
      if (error.response?.status !== 401) {
        setError(
          error.response?.data?.message || "Unable to update notification.",
        );
      }
    }
  }

  return (
    <>
      <div className="title">
        <div>
          <h1>Notifications</h1>
          <p>Complaint and system updates.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="list">
        {rows.map((item) => (
          <div
            className={`card notification ${item.is_read ? "read" : ""}`}
            key={item.id}
          >
            <h3>{item.title}</h3>
            <p>{item.message}</p>
            <small>{new Date(item.created_at).toLocaleString()}</small>

            {!item.is_read && (
              <button className="smallbtn" onClick={() => read(item.id)}>
                Mark as read
              </button>
            )}
          </div>
        ))}

        {!rows.length && <div className="card empty">No notifications.</div>}
      </div>
    </>
  );
}

// =========================
// ACTIVITY LOGS
// =========================
function Logs() {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get("/activity-logs")
      .then((response) => {
        setRows(response.data);
      })
      .catch((error) => {
        if (error.response?.status !== 401) {
          setError("Unable to load activity logs.");
        }
      });
  }, []);

  return (
    <>
      <div className="title">
        <div>
          <h1>Activity Logs</h1>
          <p>Recent system and administrative activities.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Action</th>
              <th>Date/Time</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((item) => (
              <tr key={item.id}>
                <td>{item.user_name}</td>
                <td>{item.action}</td>
                <td>{new Date(item.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {!rows.length && <p className="empty">No activity logs found.</p>}
      </div>
    </>
  );
}

// =========================
// DETAIL ROUTE
// =========================
function DetailRoute() {
  const { id } = useParams();
  return <ComplaintDetail id={id} />;
}

// =========================
// APP ROUTES
// =========================
function App() {
  const token = getToken();

  return (
    <Routes>
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login />}
      />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/complaints" element={<Complaints />} />
        <Route path="/complaints/:id" element={<DetailRoute />} />
        <Route path="/residents" element={<Residents />} />
        <Route path="/staff" element={<Staff />} />
        <Route path="/announcements" element={<Announcements />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/logs" element={<Logs />} />
      </Route>

      <Route
        path="*"
        element={<Navigate to={token ? "/" : "/login"} replace />}
      />
    </Routes>
  );
}

// =========================
// START REACT
// =========================
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
