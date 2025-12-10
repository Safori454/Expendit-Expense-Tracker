# Expendit - Expense Tracker Web Application

Expendit is a web-based expense tracker that allows users to create, manage, and track expense lists, set reminders, and generate reports in PDF or Excel formats. 
Built with Node.js, Express, PostgreSQL, and EJS, it provides a simple, intuitive interface for personal financial management.

---

## Features

### User Management
- Sign Up / Login: with secure password hashing using bcrypt.
- Session management: for persistent login using `express-session`.
- Logout: functionality to end sessions.

### Lists and Items
- Create multiple **expense lists**.
- Add, edit, or delete **items** in each list.
- Update all items in a list at once.
- Automatically calculate **total cost** of each list.
- Save lists and view **history** of all past lists.

### Reminders
- Set reminders for lists with a message and optional email notification.
- Prevent past date/time for reminders.
- Cron job checks reminders every minute and sends email notifications with PDF attachment.
- View, edit, or delete reminders.
- Mark reminders as done after sending.

### Reporting
- Generate 'PDF reports' for lists with item details and grand total.
- Export lists to 'Excel' files.
- Download reports for personal records.

### History
- View all past lists with item details.
- Delete a single list, clear all items in a list, or remove all history at once.
- Edit items directly from history.

---

## Technology Stack

- Backend: Node.js, Express.js
- Database: PostgreSQL
- Templating: EJS
- Authentication & Security: bcryptjs, express-session
- Email Notifications: Nodemailer
- File Generation: PDFKit (PDF), ExcelJS (Excel)
- Scheduling: node-cron
- HTTP Requests: axios
- Environment Variables:** dotenv

---
## Future Enhancement
- Add React to Frontend
- Add openAI api to interact with app
  
## WebPage Link
https://expendit-expense-tracker.vercel.app

Author

Godfred Safo Ofori
Email: gsofori@st.ug.edu.gh
