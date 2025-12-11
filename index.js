import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import ejs from 'ejs';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import axios from 'axios';
import { fileURLToPath } from 'url';


dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { Pool } = pkg;
const app = express();
const port = 3000;
const FROM_EMAIL = `"${process.env.SMTP_FROM_NAME}" <${process.env.SMTP_FROM_EMAIL}>`;


// PostgreSQL connection
const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
  ssl: {
    rejectUnauthorized: false 
  }
});

// Test DB connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('DB connection error:', err);
  } else {
    console.log('DB connected:', res.rows[0]);
  }
});

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true
}));

// Make username available in all views
app.use((req, res, next) => {
    res.locals.username = req.session.username || null;
    next();
});


const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASS  
  }
});



transporter.verify((err, success) => {
  if (err) console.error('Email transporter error:', err);
  else console.log('Email transporter ready');
});


async function generateListPDF(listName, items, message) {
  return new Promise((resolve, reject) => {
    try {
      let buffers = [];
      const doc = new PDFDocument({ margin: 50, size: "A4" });

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => resolve(Buffer.concat(buffers)));

      // ==== LOGO ====
      const logoPath = path.join(__dirname, "/public/images/expendit.png");

      doc.image(logoPath, {
        fit: [120, 120],
        align: "center",
      });
      doc.moveDown(1.5);

      // ===== HEADER =====
      doc.fontSize(20).text(listName, { align: "center" });
      doc.moveDown();
      doc.fontSize(12).text(`Message: ${message}`);
      doc.moveDown(1);

      // Column layout
      const itemX = 50;
      const qtyX = 260;
      const priceX = 340;
      const totalX = 420;
      const rowHeight = 20;

      function drawTableHeader() {
        const startY = doc.y;

        doc.font("Helvetica-Bold").fontSize(12);

        doc.text("Item", itemX, startY);
        doc.text("Quantity", qtyX, startY);
        doc.text("Price", priceX, startY);
        doc.text("Total", totalX, startY);

        doc.moveTo(itemX, startY + 15)
           .lineTo(500, startY + 15)
           .stroke();

        doc.moveDown();
      }

      drawTableHeader();

      let grandTotal = 0;

      for (const item of items) {
        if (doc.y + rowHeight > doc.page.height - 60) {
          doc.addPage();
          drawTableHeader();
        }

        const y = doc.y;
        const name = item.itemname || "-";
        const quantity = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        const total = quantity * price;

        grandTotal += total;

        doc.font("Helvetica").fontSize(11);

        doc.text(name, itemX, y, {
          width: qtyX - itemX - 10,
          ellipsis: true
        });
        doc.text(String(quantity), qtyX, y);
        doc.text(price.toFixed(2), priceX, y);
        doc.text(total.toFixed(2), totalX, y);

        doc.moveDown();
      }

      if (doc.y + 40 > doc.page.height) doc.addPage();

      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(13)
        .text(`Grand Total: ${grandTotal.toFixed(2)}`, totalX, doc.y);

      doc.moveDown(2);
      doc.fontSize(10).fillColor("#999")
        .text("Powered by Expendit", { align: "center" });

      doc.end();

    } catch (err) {
      reject(err);
    }
  });
}


// --- Routes ---
// Sign In or Sign Up
app.get('/', (req, res) => {
    res.render('index.ejs', { error: null });
});

// Sign Up
app.get('/login/signup', (req, res) => {
    res.render('signup.ejs', { error: null, success: null });
});

// Register User
app.post('/login/register', async (req, res) => {
    const { username, password, confirm_password } = req.body;

    if (password !== confirm_password) {
        return res.render('signup.ejs', {
            error: 'Passwords do not match',
            success: null
        });
    }

    try {
        // Check existing username
        const existing = await pool.query(
            'SELECT username FROM users WHERE username=$1',
            [username]
        );

        if (existing.rows.length > 0) {
            return res.render('signup.ejs', {
                error: 'Username already exists',
                success: null
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save user
        await pool.query(
            'INSERT INTO users (username, password) VALUES ($1, $2)',
            [username, hashedPassword]
        );

        // Log user in immediately
        req.session.username = username;

        return res.redirect('/home');

    } catch (err) {
        console.error(err);
        return res.render('signup.ejs', {
            error: 'Error creating account',
            success: null
        });
    }
});

// Login
app.post('/login/home', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(
            'SELECT * FROM users WHERE username=$1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.render('index.ejs', { error: 'User not found. Sign Up User!' });
        }

        const user = result.rows[0];

        // Compare hashed password
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('index.ejs', { error: 'Invalid password. Try Again' });
        }

        // Save user in session
        req.session.username = username;
        res.redirect('/home');

    } catch (err) {
        console.error(err);
        res.render('index.ejs', { error: 'Login failed' });
    }
});

// Home
app.get('/home', (req, res) => {
    if (!req.session.username) {
        return res.redirect('/');
    }
    res.render('home.ejs', {
        username: req.session.username
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// --- Lists ---
// Create list and Show create list page
app.post('/newlist', (req, res) => {
    if (!req.session.username) return res.redirect('/');
    res.render('createlist.ejs', { listname: null, editMode: false });
});

// Modify List name
app.post('/editsheet',  async (req, res) => {
    const { listname } = req.body;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    const result=await pool.query(
        'SELECT * FROM lists WHERE username=$1 AND listname=$2',
        [username, listname]
    );

    res.render('createlist.ejs', { listname, editMode: true });
    
});

// Save Modified list name
app.post('/updatesheet', async (req, res) => {
    const { oldname, listname } = req.body;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Insert list for this user, ensure listname unique per user
        await pool.query(
            `UPDATE lists SET listname=$1 where username=$2 AND listname=$3`,
            [listname, username, oldname]
        );
        res.render('createlist.ejs', { listname, editMode: false });
    } catch (err) {
        if (err.code === '23505') { // unique violation
            return res.send("You already have a list with this name!");
        }
        console.error(err);
        res.send("Error creating list: " + err.message);
    }
});

// Create new list
app.post('/newsheet', async (req, res) => {
    const { listname } = req.body;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Insert list for this user and ensuring listname is unique per user
        await pool.query(
            `INSERT INTO lists (listname, username) VALUES ($1, $2)`,
            [listname, username]
        );
        res.render('createlist.ejs', { listname, editMode: false });
    } catch (err) {
        if (err.code === '23505') { // unique violation
            return res.send("You already have a list with this name!");
        }
        console.error(err);
        res.send("Error creating list: " + err.message);
    }
});


// Created list page where users will add items
app.get('/list', async (req, res) => {
    const { listname } = req.query;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Get the list
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        // Get items
        const itemsResult = await pool.query(
            'SELECT * FROM items WHERE list_id=$1',
            [list.id]
        );

        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.quantity) * Number(item.price)
        }));

        // Total sum of list
        const totalSum = items.reduce((acc, item) => acc + item.total, 0);

        // Render list
       res.render('newlist.ejs', { listname, items, total: totalSum });
    } catch (err) {
        console.error(err);
        res.send("Error fetching list: " + err.message);
    }
});

// Created list page where users will add items to list
app.post('/list', async (req, res) => {
    const { listname } = req.body;
    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listname, req.session.username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const itemsResult = await pool.query(
            'SELECT * FROM items WHERE list_id=$1',
            [listResult.rows[0].id]
        );

        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.quantity) * Number(item.price)
        }));

        const totalSum = items.reduce((acc, item) => acc + item.total, 0);

        res.render('newlist.ejs', { listname, items, total: totalSum });

    } catch (err) {
        console.error(err);
        res.send("Error fetching list: " + err.message);
    }
});

// Add item
app.post('/additems', async (req, res) => {
    const { itemname, quantity, price, listname } = req.body;
    const username = req.session.username;
    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2', 
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        await pool.query(
            'INSERT INTO items (list_id, itemname, quantity, price) VALUES ($1,$2,$3,$4)',
            [list.id, itemname, Number(quantity), Number(price)]
        );

        // Update list total
        await pool.query(
            `UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1`,
            [list.id]
        );

        const itemsResult = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);
        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.quantity) * Number(item.price)
        }));

        const updatedList = await pool.query('SELECT * FROM lists WHERE id=$1', [list.id]);
        const totalSum = Number(updatedList.rows[0].total);

        res.render('newlist.ejs', { listname, items, total: totalSum });
    } catch (err) {
        console.error(err);
        res.send("Error adding item: " + err.message);
    }
});

// GET edit item page
app.get('/edititem/:id', async (req, res) => {
    const itemId = req.params.id;
    const { listname } = req.query;
    const username = req.session.username;

    try {
        // Find the list to ensure user owns it
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        // Find the item
        const itemResult = await pool.query(
            'SELECT * FROM items WHERE id=$1 AND list_id=$2',
            [Number(itemId), list.id]
        );
        if (!itemResult.rows.length) return res.send("Item not found");

        const item = itemResult.rows[0];

        // Render edit page
        res.render('edititem.ejs', {
            listname,
            item: {
                id: item.id,
                itemname: item.itemname,
                quantity: Number(item.quantity),
                price: Number(item.price)
            }
        });
    } catch (err) {
        console.error(err);
        res.send("Error fetching item: " + err.message);
    }
});

// Edit item
app.post('/edititem/update', async (req, res) => {
    const { id, listname, itemname, quantity, price } = req.body;
    const username = req.session.username;
    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2', 
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        await pool.query(
            'UPDATE items SET itemname=$1, quantity=$2, price=$3 WHERE id=$4 AND list_id=$5',
            [itemname, Number(quantity), Number(price), Number(id), list.id]
        );

        await pool.query(
            `UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1`,
            [list.id]
        );

        const itemsResult = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);
        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.quantity) * Number(item.price)
        }));

        const updatedList = await pool.query('SELECT * FROM lists WHERE id=$1', [list.id]);
        const totalSum = Number(updatedList.rows[0].total);

        res.render('newlist.ejs', { listname, items, total: totalSum });
    } catch (err) {
        console.error(err);
        res.send("Error updating item: " + err.message);
    }
});

// Delete item
app.post('/deleteitem', async (req, res) => {
    const { id, listname } = req.body;
    const username = req.session.username;
    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2', 
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        await pool.query('DELETE FROM items WHERE id=$1 AND list_id=$2', [Number(id), list.id]);

        // Update list total
        await pool.query(
            `UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1`,
            [list.id]
        );

        const itemsResult = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);
        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.quantity) * Number(item.price)
        }));

        const updatedList = await pool.query('SELECT * FROM lists WHERE id=$1', [list.id]);
        const totalSum = Number(updatedList.rows[0].total);

        res.render('newlist.ejs', { listname, items, total: totalSum });
    } catch (err) {
        console.error(err);
        res.send("Error deleting item: " + err.message);
    }
});

// Save list and show confirmation
app.post('/savelist', async (req, res) => {
    const { listname } = req.body;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Get the list for the current user
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        // Update total in case items changed
        await pool.query(
            `UPDATE lists 
             SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) 
             WHERE id=$1`,
            [list.id]
        );

        // Render confirmation page
        res.render('savelist.ejs', { listname });

    } catch (err) {
        console.error(err);
        res.send("Error saving list: " + err.message);
    }
});

// View a saved list
app.get('/viewsaved', async (req, res) => {
    const { listname } = req.query;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");
        const list = listResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT * FROM items WHERE list_id=$1',
            [list.id]
        );

        const items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price)
        }));

        // Render the saved list view
        res.render('viewsaved.ejs', { listname, items });

    } catch (err) {
        console.error(err);
        res.send("Error viewing saved list: " + err.message);
    }
});

// HISTORY ROUTES

//View all history
app.get('/history', async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        const listsResult = await pool.query(
            'SELECT * FROM lists WHERE username=$1 ORDER BY created_at DESC',
            [username]
        );

        const listsWithItems = await Promise.all(
            listsResult.rows.map(async (list) => {
                const itemsResult = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);
                return { ...list, items: itemsResult.rows };
            })
        );

        res.render('history.ejs', { lists: listsWithItems });

    } catch (err) {
        console.error(err);
        res.send("Error fetching history: " + err.message);
    }
});

// View single history list (GET)
app.get('/history/data', async (req, res) => {
    const username = req.session.username;
    const { listname } = req.query;
    if (!username) return res.redirect('/');
    if (!listname) return res.send("No list specified");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT id, itemname, quantity, price, (quantity*price) AS total FROM items WHERE list_id=$1',
            [list.id]
        );

        list.items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.total)
        }));

        const totalSum = list.items.reduce((acc, item) => acc + item.total, 0);

        res.render('historyContent.ejs', { list, totalSum });

    } catch (err) {
        console.error(err);
        res.send("Error loading history content: " + err.message);
    }
});

// View single history list 
app.post('/history/data', async (req, res) => {
    const username = req.session.username;
    const { listing } = req.body; // match the input name from the form
    if (!username) return res.redirect('/');
    if (!listing) return res.send("No list specified");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname=$1 AND username=$2',
            [listing, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        const itemsResult = await pool.query(
            'SELECT id, itemname, quantity, price, (quantity*price) AS total FROM items WHERE list_id=$1',
            [list.id]
        );

        list.items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.total)
        }));

        const totalSum = list.items.reduce((acc, item) => acc + item.total, 0);

        res.render('historyContent', { list, totalSum });

    } catch (err) {
        console.error(err);
        res.send("Error loading history content: " + err.message);
    }
});

// Add item to history list
app.post('/history/additem', async (req, res) => {
    const username = req.session.username;
    const { listname, itemname, quantity, price } = req.body;
    if (!username) return res.redirect('/');
    if (!listname || !itemname || !quantity || !price) return res.send("Missing fields");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        await pool.query(
            'INSERT INTO items (list_id, itemname, quantity, price) VALUES ($1,$2,$3,$4)',
            [list.id, itemname, Number(quantity), Number(price)]
        );

        const itemsResult = await pool.query(
            'SELECT id, itemname, quantity, price, (quantity*price) AS total FROM items WHERE list_id=$1',
            [list.id]
        );

        list.items = itemsResult.rows.map(item => ({
            ...item,
            quantity: Number(item.quantity),
            price: Number(item.price),
            total: Number(item.total)
        }));

        const totalSum = list.items.reduce((acc, item) => acc + item.total, 0);

        res.render('historyContent.ejs', { list, totalSum });

    } catch (err) {
        console.error(err);
        res.send("Error adding item: " + err.message);
    }
});

// Delete item from history list
app.post('/history/deletelist', async (req, res) => {
    const username = req.session.username;
    const { id, listname } = req.body;
    if (!username) return res.redirect('/');
    if (!listname) return res.send("Missing list or item ID");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        await pool.query(
    'DELETE FROM items WHERE list_id=$1',
    [list.id]
);
await pool.query(
    'DELETE FROM lists WHERE id=$1 AND username=$2',
    [list.id, username]
);

        res.redirect(`/history`);
    } catch (err) {
        console.error(err);
        res.send("Error deleting item: " + err.message);
    }
});

// Clear all history and lists
app.post('/history/clear', async (req, res) => {
    const username = req.session.username;
    const { id, listname } = req.body;
    if (!username) return res.redirect('/');


    try {
        await pool.query('DELETE FROM items WHERE list_id IN (SELECT id FROM lists WHERE username=$1)', [username]);
await pool.query('DELETE FROM lists WHERE username=$1', [username]);

        res.redirect(`/history`);
    } catch (err) {
        console.error(err);
        res.send("Error deleting item: " + err.message);
    }
});

// Edit/update item in history
app.post('/history/edititem/update', async (req, res) => {
    const username = req.session.username;
    const { id, listname, itemname, quantity, price } = req.body;
    if (!username) return res.redirect('/');
    if (!id || !listname || !itemname || !quantity || !price) return res.send("Missing fields");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        await pool.query(
            'UPDATE items SET itemname=$1, quantity=$2, price=$3 WHERE id=$4 AND list_id=$5',
            [itemname, Number(quantity), Number(price), Number(id), list.id]
        );

        await pool.query(
            'UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1',
            [list.id]
        );

        res.redirect('/history/data?listname=' + encodeURIComponent(listname));

    } catch (err) {
        console.error(err);
        res.send("Error updating item: " + err.message);
    }
});

//  Update all items at once
app.post('/history/updateallitems', async (req, res) => {
    try {
        const username = req.session.username;
        if (!username) return res.redirect('/');
        
        let { listname, items } = req.body;
        console.log(listname,items)
        if (!listname || !items) return res.send('List not found');

        // Convert items object to array if needed
        if (!Array.isArray(items)) items = Object.values(items);

        const listResult = await pool.query('SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2', [listname, username]);
        if (!listResult.rows.length) return res.send('List not found');
        const list = listResult.rows[0];

        for (const item of items) {
            await pool.query(
                'UPDATE items SET itemname=$1, quantity=$2, price=$3 WHERE id=$4 AND list_id=$5',
                [item.itemname, Number(item.quantity), Number(item.price), Number(item.id), list.id]
            );
        }

        await pool.query('UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1', [list.id]);
        res.redirect(`/history/data?listname=${encodeURIComponent(listname)}`);
    } catch (err) {
        console.error(err);
        res.send('Server error: ' + err.message);
    }
});

// Delete a single item
app.post("/history/deleteitem", async (req, res) => {
    try {
        const { id, listname } = req.body;

        if (!id) return res.status(400).send("Item ID required");

        await pool.query("DELETE FROM items WHERE id = $1", [id]);

        // Optionally, recalculate list total
        const totalRes = await pool.query(
            "SELECT SUM(quantity * price) AS total FROM items WHERE list_id = (SELECT id FROM lists WHERE listname = $1)",
            [listname]
        );
        const newTotal = totalRes.rows[0].total || 0;

        await pool.query(
            "UPDATE lists SET total = $1 WHERE listname = $2",
            [newTotal, listname]
        );

        res.sendStatus(200); // success
    } catch (err) {
        console.error(err);
        res.sendStatus(500);
    }
});

// Delete all items in a list
app.post('/history/removeallitems', async (req, res) => {
    const { listname } = req.body;
    const username = req.session.username;

    if (!username) return res.redirect('/');

    try {
        //  Get the list_id
        const listRes = await pool.query(
            "SELECT id FROM lists WHERE username=$1 AND listname=$2",
            [username, listname]
        );

        if (listRes.rowCount === 0) {
            return res.send("List not found");
        }

        const list_id = listRes.rows[0].id;

        //  Delete all items for this list
        await pool.query("DELETE FROM items WHERE list_id=$1", [list_id]);

        res.redirect(`/history/data?listname=${encodeURIComponent(listname)}`);
    } catch (err) {
        console.error(err);
        res.send('Error deleting items: ' + err.message);
    }
});

// Ensuring past datetimes are not set as reminders
function isPastDateTime(date, time) {
    const chosen = new Date(`${date} ${time}`);
    const now = new Date();
    return chosen <= now;
}

// Set Scheduler to call reminders
cron.schedule('* * * * *', async () => {
    console.log('Checking reminders...');
    await axios.get('http://localhost:3000/cron/check-reminders');
});

// Getting Reminders
app.get("/cron/check-reminders", async (req, res) => {
  console.log("CRON route hit");

  try {
    const remindersRes = await pool.query(`
      SELECT r.id, r.list_id, r.username, r.remind_at, r.sent, r.message, r.email,
             l.listname
      FROM reminders r
      JOIN lists l ON r.list_id = l.id
      WHERE r.sent = false AND r.remind_at <= NOW()
    `);

    const reminders = remindersRes.rows;

    for (const row of reminders) {

      const itemsRes = await pool.query(
        "SELECT itemname, quantity, price FROM items WHERE list_id = $1",
        [row.list_id]
      );
      const items = itemsRes.rows;

      // Generate PDF -> returns BUFFER not file
      const pdfBuffer = await generateListPDF(row.listname, items, row.message);

      try {
        await transporter.sendMail({
          from: FROM_EMAIL,
          to: row.email,
          subject: `Reminder: ${row.listname}`,
          text: row.message,
          attachments: [
            {
              filename: `${row.listname}.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf"
            }
          ]
        });

        console.log("Email sent to", row.email);

        await pool.query(
          "UPDATE reminders SET sent = true WHERE id = $1",
          [row.id]
        );
      } catch (err) {
        console.error("Failed to send email to", row.email, err);
      }
    }

    res.send("Cron check completed");
  } catch (err) {
    console.error(err);
    res.status(500).send(err.message);
  }
});

// Reminders page showing all reminders
app.get('/reminders', async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Get all reminders for the user with list name
        const result = await pool.query(`
            SELECT r.id, r.remind_at, r.sent, r.message, l.listname
            FROM reminders r
            JOIN lists l ON r.list_id = l.id
            WHERE r.username = $1
            ORDER BY r.remind_at ASC
        `, [username]);

        // Map for EJS
        const reminders = result.rows.map(r => {
            const dt = new Date(r.remind_at);
            return {
                id: r.id,
                message: r.message && r.message.trim() !== ""
                    ? r.message
                    : `Reminder for list: ${r.listname}`, // default message if empty
                status: r.sent ? "sent" : "pending",
                reminder_date: dt,
                reminder_time: dt.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            };
        });

        res.render('reminders', { reminders });

    } catch (err) {
        console.error(err);
        res.send("Error loading reminders: " + err.message);
    }
});

// Setting Reminder
app.get('/reminders/new', async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Get all user's lists
        const listsRes = await pool.query(
            "SELECT id, listname FROM lists WHERE username=$1",
            [username]
        );

        res.render('newReminder', { lists: listsRes.rows });
    } catch (err) {
        console.error(err);
        res.send("Error loading lists: " + err.message);
    }
});

// Set reminder routes
app.post('/setreminder', async (req, res) => {
    const { listname } = req.body;
    res.redirect(`/list/set-reminder?listname=${encodeURIComponent(listname)}`);
});
app.get('/list/set-reminder', async (req, res) => {
    const username = req.session.username;
    const { listname } = req.query;

    if (!username) return res.redirect('/');

    res.render('setReminder', { listname });
});
app.post('/list/set-reminder', async (req, res) => {
    const username = req.session.username;
    const { listname, date, time, message, email } = req.body;
    console.log(listname, message, date, time, email);

    if (!username) return res.redirect('/');
    if (!email) return res.send("❗ Please provide an email address for the reminder.");

    // Prevent past date/time
    if (isPastDateTime(date, time)) {
        return res.send("❗ Invalid reminder: You cannot set a reminder in the past.");
    }

    try {
        const listRes = await pool.query(
            "SELECT id FROM lists WHERE username=$1 AND listname=$2",
            [username, listname]
        );

        if (listRes.rowCount === 0) return res.send("List not found");

        const list_id = listRes.rows[0].id;
        const finalMessage = message?.trim() || `Reminder for list: ${listname}`;
        const remind_at = `${date} ${time}`;

        await pool.query(
            "INSERT INTO reminders (list_id, username, remind_at, message, email) VALUES ($1, $2, $3, $4, $5)",
            [list_id, username, remind_at, finalMessage, email]
        );

        res.redirect('/reminders');
    } catch (err) {
        console.error(err);
        res.send("Error setting reminder: " + err.message);
    }
});

// Creating New Reminders
app.post('/reminders/new', async (req, res) => {
    const username = req.session.username;
    const { list_id, date, time, message, email } = req.body;  

    if (!username) return res.redirect('/');

    if (isPastDateTime(date, time)) {
        return res.send("❗ Invalid reminder: You cannot set a reminder in the past.");
    }

    try {
        const listRes = await pool.query(
            "SELECT listname FROM lists WHERE id=$1 AND username=$2",
            [list_id, username]
        );

        if (listRes.rowCount === 0) {
            return res.send("List not found");
        }

        const listname = listRes.rows[0].listname;
        const finalMessage = message && message.trim() !== ""
            ? message.trim()
            : `Reminder for list: ${listname}`;

        const remind_at = `${date} ${time}`;

        await pool.query(
            `INSERT INTO reminders (list_id, username, remind_at, message, email)
             VALUES ($1, $2, $3, $4, $5)`,
            [list_id, username, remind_at, finalMessage, email]   
        );

        res.redirect('/reminders');
    } catch (err) {
        console.error(err);
        res.send("Error creating reminder: " + err.message);
    }
});

// Deleting reminders
app.post('/reminders/delete', async (req, res) => {
    const username = req.session.username;
    const { id } = req.body;

    if (!username) return res.redirect('/');

    try {
        await pool.query(
            "DELETE FROM reminders WHERE id = $1 AND username = $2",
            [id, username]
        );

        res.redirect('/reminders');
    } catch (err) {
        console.error(err);
        res.send("Error deleting reminder: " + err.message);
    }
});

// Editing Reminders
app.get('/reminders/edit/:id', async (req, res) => {
    const { id } = req.params;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        const reminderResult = await pool.query(
            'SELECT * FROM reminders WHERE id = $1 AND username = $2',
            [id, username]
        );

        if (!reminderResult.rows.length) return res.send('Reminder not found or access denied.');

        const reminder = reminderResult.rows[0];
        res.render('editReminder', { reminder });
    } catch (err) {
        console.error('Database error:', err);
        res.send('Error fetching reminder.');
    }
});

// Edit reminders
app.post('/reminders/edit/:id', async (req, res) => {
    const { id } = req.params;
    const { message, date, time } = req.body;
    const username = req.session.username;

    if (!username) return res.redirect('/');

    // ❌ Prevent past date/time
    if (isPastDateTime(date, time)) {
        return res.send("❗ Invalid reminder: You cannot update a reminder to a past date/time.");
    }

    try {
        const remind_at = `${date} ${time}`;

        await pool.query(
            "UPDATE reminders SET message = $1, remind_at = $2, sent = false WHERE id = $3 AND username = $4",
            [message, remind_at, id, username]
        );

        res.redirect('/reminders');
    } catch (err) {
        console.error(err);
        res.send('Error updating reminder.');
    }
});

// Mark as done when reminders get sent
app.post("/reminders/markdone/:id", async (req, res) => {
    try {
        await pool.query(
            "UPDATE reminders SET status = 'sent' WHERE id = $1",
            [req.params.id]
        );
        res.redirect("/reminders");
    } catch (err) {
        console.log(err);
        res.send("Error marking reminder as done.");
    }
});
app.post("/reminders/delete/:id", async (req, res) => {
    try {
        await pool.query("DELETE FROM reminders WHERE id = $1", [req.params.id]);
        res.redirect("/reminders");
    } catch (err) {
        console.log(err);
        res.send("Error deleting reminder.");
    }
});


// Excel Export 
// Show Excel conversion page
app.post("/cvtExcel", async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        const listsResult = await pool.query('SELECT * FROM lists WHERE username=$1', [username]);
        res.render("cvt.ejs", { lists: listsResult.rows });
    } catch (err) {
        console.error(err);
        res.send("Error loading lists: " + err.message);
    }
});

// Download list as excel file
app.post("/cvtExcel/download", async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    let { listname } = req.body;

    try {
        let listsResult;

        if (!listname || listname.trim() === "") {
            // Export all lists for the user
            listsResult = await pool.query(
                'SELECT * FROM lists WHERE username=$1 ORDER BY created_at',
                [username]
            );
        } else {
            // Export only the selected list
            listsResult = await pool.query(
                'SELECT * FROM lists WHERE username=$1 AND TRIM(listname) ILIKE TRIM($2)',
                [username, listname]
            );
        }

        if (listsResult.rows.length === 0) {
            return res.send("No list found with that name.");
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Exported Lists");

        sheet.columns = [
            { header: "List Name", key: "listname", width: 25 },
            { header: "Created At", key: "created_at", width: 25 },
            { header: "Item Name", key: "itemname", width: 25 },
            { header: "Quantity", key: "quantity", width: 15 },
            { header: "Price", key: "price", width: 15 },
            { header: "Total", key: "total", width: 15 }
        ];

        for (const list of listsResult.rows) {
            const items = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);

            if (items.rows.length === 0) {
                // Add empty row if no items
                sheet.addRow({
                    listname: list.listname,
                    created_at: list.created_at.toLocaleString(),
                    itemname: "-",
                    quantity: 0,
                    price: 0,
                    total: 0
                });
            } else {
                items.rows.forEach(item => {
                    sheet.addRow({
                        listname: list.listname,
                        created_at: list.created_at.toLocaleString(),
                        itemname: item.itemname,
                        quantity: item.quantity || 0,
                        price: item.price || 0,
                        total: (Number(item.quantity) || 0) * (Number(item.price) || 0)
                    });
                });
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Disposition", `attachment; filename=ExpenseLists.xlsx`);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(buffer);

    } catch (err) {
        console.error(err);
        res.send("Error generating Excel: " + err.message);
    }
});

// Email Excel
// Show Send Email page
app.get('/cvtExcel/email', async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        const listsResult = await pool.query(
            'SELECT * FROM lists WHERE username=$1',
            [username]
        );
        res.render('sendEmail.ejs', { lists: listsResult.rows });
    } catch (err) {
        console.error(err);
        res.send("Error loading lists for email: " + err.message);
    }
});

app.post("/sendExcelEmail", async (req, res) => {
    const username = req.session.username;
    try {
        const { listname, userEmail, recipientEmail, subject, content } = req.body;
        let query = 'SELECT * FROM lists WHERE username=$1';
        let params = [username];
        if (listname) { query += ' AND listname ILIKE $2'; params.push(listname); }
        const listsResult = await pool.query(query, params);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Exported Lists");
        sheet.columns = [
            { header: "List Name", key: "listname", width: 20 },
            { header: "Created At", key: "created_at", width: 25 },
            { header: "Item Name", key: "itemname", width: 20 },
            { header: "Quantity", key: "quantity", width: 10 },
            { header: "Price", key: "price", width: 10 },
            { header: "Total", key: "total", width: 10 }
        ];

        for (const list of listsResult.rows) {
            const items = await pool.query('SELECT * FROM items WHERE list_id=$1', [list.id]);
            items.rows.forEach(item => {
                sheet.addRow({
    listname: list.listname,
    created_at: list.created_at.toLocaleString(),
    itemname: item.itemname,
    quantity: item.quantity,
    price: item.price,
    total: Number(item.quantity) * Number(item.price)
});

            });
        }

        const buffer = await workbook.xlsx.writeBuffer();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: userEmail, pass: "your_app_password" }
        });

        await transporter.sendMail({
            from: userEmail,
            to: recipientEmail,
            subject: subject || "Exported List",
            text: content || "Attached is your Excel export.",
            attachments: [{ filename: "ExpenseLists.xlsx", content: buffer }]
        });

        res.send(`Email sent to ${recipientEmail}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error sending email: " + err.message);
    }
});

// Start server
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));
