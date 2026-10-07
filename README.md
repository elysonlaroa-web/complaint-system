# Barangay Complaint Management and Monitoring System

Full-stack starter system using React.js, Node.js, Express.js, and MySQL.

## Requirements
- Node.js 18+
- MySQL 8+
- npm

## Setup

### 1. Database
Create a MySQL database and import:
`database/barangay_complaint.sql`

The default database name is `barangay_complaint`.

### 2. Backend
```bash
cd server
npm install
```

Copy `.env.example` to `.env` and update the MySQL credentials.

Then:
```bash
npm run dev
```

Backend runs on `http://localhost:5000`.

### 3. Frontend
Open another terminal:
```bash
cd client
npm install
npm run dev
```

Frontend runs on the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Demo accounts
- Admin: `admin` / `admin123`
- Staff: `staff` / `staff123`
- Resident: `resident` / `resident123`

These demo accounts are seeded by the backend on first start.

## Included
- JWT login
- Resident, Staff, and Admin roles
- Complaint submission
- Complaint tracking
- Complaint assignment
- Complaint status updates
- Categories and priorities
- Announcements
- Notifications
- Dashboard statistics
- Search/filtering
- Activity logs
- MySQL schema and seed data

This is a capstone-ready foundation. Before production deployment, change demo credentials, configure secure JWT secrets, add HTTPS, and review validation/security settings.
