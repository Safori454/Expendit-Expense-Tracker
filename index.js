import express from 'express';
import bodyParser from 'body-parser';
import session from 'express-session';
import ejs from 'ejs';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;
const app = express();
const port = 3000;

// PostgreSQL connection
const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
    ssl: { rejectUnauthorized: false } // required for Render
});

export default pool; // optional if you want to import pool elsewhere


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

// --- Routes ---

// Home
app.get('/', (req, res) => {
    res.render('index.ejs', { error: null });
});


// Signup
// GET signup page
app.get('/login/signup', (req, res) => {
    res.render('signup.ejs', { error: null, success: null });
});


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






app.post('/login/register', async (req, res) => {
    const { username, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password) VALUES ($1,$2)', [username, hashedPassword]);
        req.session.username = username;
        res.redirect('/home');
    } catch (err) {
        console.error(err);
        res.send("Error registering user: " + err.message);
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
            return res.render('index.ejs', { error: 'User not found' });
        }

        const user = result.rows[0];

        // Compare hashed password
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('index.ejs', { error: 'Invalid password' });
        }

        // Save user in session
        req.session.username = username;
        res.redirect('/home');

    } catch (err) {
        console.error(err);
        res.render('index.ejs', { error: 'Login failed' });
    }
});


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

// Create list
// Show create list page
app.post('/newlist', (req, res) => {
    if (!req.session.username) return res.redirect('/');
    res.render('createlist.ejs', { listname: null, editMode: false });
});

// Create new list
app.post('/newsheet', async (req, res) => {
    const { listname } = req.body;
    const username = req.session.username;
    if (!username) return res.redirect('/');

    try {
        // Insert list for this user, ensure listname unique per user
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

// View list
// GET route to view a list
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



// ==============================
// HISTORY ROUTES
// ==============================

// 1️⃣ View all history
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

// 2️⃣ View single history list (GET)
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


// 3️⃣ Add item to history list
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

// 4️⃣ Delete item from history list
app.post('/history/deleteitem', async (req, res) => {
    const username = req.session.username;
    const { id, listname } = req.body;
    if (!username) return res.redirect('/');
    if (!listname || !id) return res.send("Missing list or item ID");

    try {
        const listResult = await pool.query(
            'SELECT * FROM lists WHERE listname ILIKE $1 AND username=$2',
            [listname, username]
        );
        if (!listResult.rows.length) return res.send("List not found");

        const list = listResult.rows[0];

        await pool.query(
            'DELETE FROM items WHERE id=$1 AND list_id=$2',
            [Number(id), list.id]
        );

        // Update list total
        await pool.query(
            'UPDATE lists SET total = (SELECT COALESCE(SUM(quantity*price),0) FROM items WHERE list_id=$1) WHERE id=$1',
            [list.id]
        );

        res.redirect('/history/data?listname=' + encodeURIComponent(listname));

    } catch (err) {
        console.error(err);
        res.send("Error deleting item: " + err.message);
    }
});

// 5️⃣ Edit/update item in history
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

// 6️⃣ Update all items at once
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

// --- Excel Export ---
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

app.post("/cvtExcel/download", async (req, res) => {
    const username = req.session.username;
    if (!username) return res.redirect('/');

    const { listname } = req.body;

    try {
        const listsResult = await pool.query(
            'SELECT * FROM lists WHERE username=$1 AND listname ILIKE $2',
            [username, listname]
        );

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
                    ...item
                });
            });
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


// --- Email Excel ---
// Show Send Email page
// Render sendEmail.ejs
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
                    ...item
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
