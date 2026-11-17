# Student Attendance Monitoring Web Application

A responsive browser-based attendance monitoring application built with HTML, CSS, and JavaScript.

## How to Run
1. Keep `index.html`, `style.css`, and `script.js` in the same folder.
2. Open `index.html` in a modern web browser.
3. No server or installation is required.

## Features
- Student list with search, **Add**, **Edit** (name), and **Remove** (single or bulk)
- Present / Late / Absent status per student, per date
- **Mark All Present**: marks every still-unmarked student as Present, so you only change the exceptions
- Attendance date selector (today or any past date; future dates are blocked)
- Summary cards, class attendance rate, and a donut chart that includes an Unmarked segment
- Attendance History with per-date details and an **Edit** shortcut
- **Export CSV / Import CSV** for backups and moving data between browsers
- Custom confirmation dialogs, keyboard support (Esc closes dialogs, focus stays inside them), and screen-reader announcements for messages
- Responsive layout for desktop and mobile

## How attendance is calculated
- **Present and Late both count as attended.** Late is also shown separately.
- Rates only include students who have been **marked**. Unmarked students are not counted as absent.
- A student with no records yet shows **—** instead of 0%.
- The sidebar rate is always for *today's* class, even if you are viewing another date.

## History
- A date is saved only once at least one student is marked, so browsing dates never creates blank history rows.
- Resetting a date clears its saved record. Clearing history deletes everything (export a CSV first for a backup).
- Removing a student keeps their previous history for reporting, and they no longer appear in future records.
- A new student cannot reuse the ID of a former student with a different name, so histories never get mixed up.

## CSV format
Columns: `Date, Student ID, Student Name, Status, Active` (dates as `YYYY-MM-DD`; Status is Present, Late, or Absent; Active is Yes/No). Importing merges into existing data: records for the same date and student are overwritten, and rows whose ID conflicts with an existing student of a different name are skipped.

## Notes
Data is saved in the browser's localStorage. Clearing site data removes it, so export a CSV occasionally. If the browser blocks or fills up storage, the app shows a warning.
