# DTR Automation System (Supabase + FastAPI + React)

Professional full-stack DTR automation system with:
- User frontend (clock in/out, leave, daily editable attendance)
- Admin frontend (employee CRUD, master sheet, schedule overrides, reports, backup/restore)
- FastAPI backend (Supabase integration, realtime WebSocket updates, exports, backup scheduler)

## Project Structure

- frontend_user/: React + Vite app for employee time recording
- frontend_admin/: React + Vite app for admin workflows
- backend/: FastAPI service for API, realtime, reports, and backups
- supabase_schema.sql: table definitions and constraints
- seed_data.sql: realistic SQL inserts (5-10+ rows per table)

## 1. Prerequisites

- Node.js 20+
- npm 10+
- Python 3.11+
- Supabase project (URL + service role key)

## 2. Install Dependencies

From the root folder:

1. npm install
2. npm run install:all
3. In backend, install Python packages:
   - python -m venv .venv
   - .venv\Scripts\activate (Windows PowerShell)
   - pip install -r requirements.txt

## 3. Environment Setup

Create these files from examples:

- frontend_user/.env from frontend_user/.env.example
- frontend_admin/.env from frontend_admin/.env.example
- backend/.env from backend/.env.example

Required backend values:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_BACKUP_BUCKET (recommended: dtr-backups)
- ALLOWED_ORIGINS (default already supports localhost ports 5173 and 5174)
- DAILY_BACKUP_CRON (cron expression, default 0 23 * * *)

## 4. Supabase Database Initialization

In Supabase SQL Editor, execute in order:

1. supabase_schema.sql
2. seed_data.sql

This creates and seeds:
- employees
- attendance
- schedule_settings
- notifications
- backup_logs

## 5. Run All Services Concurrently

From root:

1. npm run dev

What happens:
- frontend_user starts on http://localhost:5173
- frontend_admin starts on http://localhost:5174
- backend starts on http://localhost:8000
- Vite auto-opens browser tabs for user and admin frontends

## 6. Feature Coverage

Implemented workflows:
- Regular and JO employee tabs
- Add/edit/delete employees (admin)
- Click card to Time In / Time Out (24-hour output)
- Schedule Type A and B support
- Late threshold override by date
- Leave types (SL, VL, OB) with editable cells for partial adjustments
- Editable daily attendance table synced to Supabase
- Master sheet with date, employee, category, and search filters
- Realtime updates via WebSocket (/ws/updates)
- Manual and automatic daily backups
- Backup restore from Supabase Storage snapshots
- Monthly summary, late report, overtime report
- CSV and Excel export

## 7. API Quick Reference

- GET /employees
- POST /employees
- PUT /employees/{id}
- DELETE /employees/{id}
- GET /attendance/daily
- GET /attendance/master
- POST /attendance/clock
- PUT /attendance/{id}
- GET /settings/schedule-threshold
- PUT /settings/schedule-threshold
- GET /reports/monthly-summary
- GET /reports/late-report
- GET /reports/overtime-report
- GET /reports/export?format=csv|xlsx
- POST /backups/manual
- GET /backups
- POST /backups/restore
- WS /ws/updates

## 8. Notes for Professional Deployment

- Use HTTPS and secure secret management in production.
- Restrict CORS to real domains only.
- Add Supabase RLS/auth policies based on your organization roles.
- Add automated tests and CI before production rollout.
