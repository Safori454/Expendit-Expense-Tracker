import express from 'express';
import bodyParser from 'body-parser';
import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import nodemailer from 'nodemailer';
import session from 'express-session';

const app = express();
const port = 3000;

// File paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempJSON = path.join(__dirname, 'items.json'); // Temporary items for current list
const dataJSON = path.join(__dirname, 'data.json');   // Saved lists

// Middleware
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');

app.use(session({
    secret: 'yourSecretKeyHere',
    resave: false,
    saveUninitialized: true
}));

// So username can appear anywhere when called
app.use((req, res, next) => {
    res.locals.username = req.session.username || null;
    next();
});


// Function to load data from JSON file
function loadData() {
    try {
        if (!fs.existsSync(dataJSON)) fs.writeFileSync(dataJSON, '[]'); // create empty file if not exist
        return JSON.parse(fs.readFileSync(dataJSON, 'utf8'));
    } catch (err) {
        console.error('Error loading JSON:', err);
        return [];
    }
}

// Load JSON file
function loadJSON(filePath) {
    try {
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]');
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error('Error loading JSON:', err);
        return [];
    }
}

// Save JSON file
function saveJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// --- Routes ---

// Home page
app.get('/', (req, res) => res.render('index.ejs'));

// Sign up / login
app.get('/login/signup', (req, res) => res.render('signup.ejs'));
app.post('/login/user', (req, res) => res.render('signup.ejs', { Password: req.body.Password }));

app.post('/login/register', (req, res) => {
    req.session.username = req.body.username;
    res.redirect('/home');
});

app.post('/login/home', (req, res) => {
    req.session.username = req.body.username;
    res.redirect('/home');
});

app.get('/home', (req, res) => {
    if (!req.session.username) return res.redirect('/');
    res.render('home.ejs');
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send('Error logging out');
        res.redirect('/');
    });
});

// Create / Edit List Name
app.post('/newlist', (req, res) => res.render('createlist.ejs'));
app.post('/newsheet', (req, res) => res.render('createlist.ejs', { listname: req.body.listname }));
app.post('/editsheet', (req, res) => res.render('createlist.ejs', { listname: req.body.listname, click: 1 }));

// Render List
app.post('/list', (req, res) => {
    const { listname } = req.body;
    const items = loadJSON(tempJSON).filter(i => i.listname === listname);
    res.render('newlist.ejs', { listname, items });
});

// Add item
app.post('/additems', (req, res) => {
    const { itemname, quantity, price, listname } = req.body;
    const items = loadJSON(tempJSON);
    const newItem = {
        id: Date.now(),
        listname,
        itemname,
        quantity: Number(quantity),
        price: Number(price),
        total: Number(quantity) * Number(price)
    };
    items.push(newItem);
    saveJSON(tempJSON, items);
    const listItems = items.filter(i => i.listname === listname);
    res.render('newlist.ejs', { listname, items: listItems });
});


// --- Edit item (GET) ---
app.get("/edititem/:id", (req, res) => {
    const { id } = req.params;
    const { listname } = req.query;

    const items = loadJSON(tempJSON);
    const numericId = Number(id);
    const itemToEdit = items.find(i => i.id === numericId && i.listname === listname);

    if (!itemToEdit) return res.send(`Item not found in list '${listname}' with id ${id}`);

    res.render("edititem.ejs", { itemToEdit, listname });
});

app.post('/edititem/update', (req, res) => {
    const { id, listname, itemname, quantity, price } = req.body;
    const items = loadJSON(tempJSON);

    const numericId = Number(id);
    const itemIndex = items.findIndex(i => i.id === numericId && i.listname === listname);
    if (itemIndex < 0) return res.send(`Item not found in list '${listname}' with id ${id}`);

    items[itemIndex] = {
        ...items[itemIndex],
        itemname,
        quantity: Number(quantity),
        price: Number(price),
        total: Number(quantity) * Number(price)
    };

    saveJSON(tempJSON, items);
    res.render('newlist.ejs', { listname, items: items.filter(i => i.listname === listname) });
});

app.post('/edititem/delete', (req, res) => {
    const { id, listname } = req.body;
    const items = loadJSON(tempJSON);

    const numericId = Number(id);
    const itemIndex = items.findIndex(i => i.id === numericId && i.listname === listname);
    if (itemIndex < 0) return res.send(`Item not found in list '${listname}' with id ${id}`);

    items.splice(itemIndex, 1);
    saveJSON(tempJSON, items);

    res.render('newlist.ejs', { 
        listname, 
        items: items.filter(i => i.listname === listname) 
    });
});


// Delete item
app.post('/deleteitem', (req, res) => {
    const { id, listname } = req.body;
    const items = loadJSON(tempJSON);
    const numericId = Number(id);
    const itemIndex = items.findIndex(i => i.id === numericId && i.listname === listname);
    if (itemIndex < 0) return res.send(`Item not found in list '${listname}' with id ${id}`);
    items.splice(itemIndex, 1);
    saveJSON(tempJSON, items);
    res.render('newlist.ejs', { listname, items: items.filter(i => i.listname === listname) });
});

// View saved list
app.get('/viewsaved', (req, res) => {
    const { listname } = req.query;
    const savedData = loadJSON(dataJSON);
    const selectedList = savedData.find(l => l.listname === listname);
    if (!selectedList) return res.send(`No saved list found with name "${listname}"`);
    res.render('viewsaved.ejs', { listname: selectedList.listname, items: selectedList.items,  });
});

app.post('/savelist', (req, res) => {
    const { listname } = req.body;
    const tempItemsData = loadJSON(tempJSON);
    const cleanedItems = tempItemsData.filter(i => i.listname === listname && i.itemname && i.quantity && i.price);

    const savedData = loadJSON(dataJSON);
    const existingIndex = savedData.findIndex(l => l.listname === listname);

    if (existingIndex >= 0) {
        savedData[existingIndex].items = cleanedItems;
        savedData[existingIndex].date = new Date();
    } else {
        savedData.push({ listname, date: new Date(), items: cleanedItems });
    }

    saveJSON(dataJSON, savedData);

    // Only remove items of this list from tempJSON
    const remainingTemp = tempItemsData.filter(i => i.listname !== listname);
    saveJSON(tempJSON, remainingTemp);

    res.render('savelist.ejs', { listname });
});


// --- History routes ---

// View all saved lists (history)
app.get('/history', (req, res) => {
    const lists = loadJSON(dataJSON);
    res.render('history.ejs', { lists });
});

app.post('/history', (req, res) => {
    const lists = loadJSON(dataJSON);
    res.render('history.ejs', { lists });
});

// View a single list in history
app.post("/history/data", (req, res) => {
    const { listing } = req.body;
    const selectedList = loadJSON(dataJSON).find(l => l.listname === listing);
    if (!selectedList) return res.send("List not found");

    if (!selectedList.items || selectedList.items.length === 0) {
        return res.render("historyEmpty.ejs", { listname: selectedList.listname });
    }

    res.render("historyContent.ejs", { list: selectedList, listname: selectedList.listname });
});

// GET edit a single item from history
app.get('/history/edititem/:id', (req, res) => {
    const { id } = req.params;
    const { listname } = req.query;

    const data = loadJSON(dataJSON);
    const list = data.find(l => l.listname === listname);
    if (!list) return res.send(`List '${listname}' not found`);

    const numericId = Number(id);
    const itemToEdit = list.items.find(i => i.id === numericId);
    if (!itemToEdit) return res.send(`Item not found in list '${listname}'`);

    res.render('editHistoryItem.ejs', { itemToEdit, listname });
});

// POST update history item
app.post('/history/edititem/update', (req, res) => {
    const { listname, id, itemname, quantity, price } = req.body;

    const data = loadJSON(dataJSON);
    const list = data.find(l => l.listname === listname);
    if (!list) return res.send(`List '${listname}' not found`);

    const numericId = Number(id);
    const itemIndex = list.items.findIndex(i => i.id === numericId);
    if (itemIndex < 0) return res.send(`Item not found in list '${listname}'`);

    list.items[itemIndex] = {
        ...list.items[itemIndex],
        itemname,
        quantity: Number(quantity),
        price: Number(price),
        total: Number(quantity) * Number(price)
    };

    saveJSON(dataJSON, data);

    // Return to historyContent for this list
    res.render('historyContent.ejs', { list, listname: list.listname });
});

// POST delete history item
app.post('/history/deleteitem', (req, res) => {
    const { listname, id } = req.body;

    const data = loadJSON(dataJSON);
    const list = data.find(l => l.listname === listname);
    if (!list) return res.send(`List '${listname}' not found`);

    const numericId = Number(id);
    const itemIndex = list.items.findIndex(i => i.id === numericId);
    if (itemIndex < 0) return res.send(`Item not found in list '${listname}'`);

    list.items.splice(itemIndex, 1);
    saveJSON(dataJSON, data);

    res.render('historyContent.ejs', { list, listname: list.listname });
});
// Delete list
app.post('/deletelist', (req, res) => {
    const { listname } = req.body;
    let savedLists = loadJSON(dataJSON);
    savedLists = savedLists.filter(list => list.listname !== listname);
    saveJSON(dataJSON, savedLists);
    res.redirect('/history');
});

// Clear all history
app.post('/history/clear', (req, res) => {
    saveJSON(dataJSON, []);
    res.redirect('/history');
});


// --- Excel & Email routes remain unchanged ---
// Use loadJSON(dataJSON) instead of API calls

// Excel & Email Routes (unchanged)
app.post("/cvtExcel", (req, res) => res.render("cvt.ejs", { lists: loadData() }));
app.post("/cvtExcel/download", async (req, res) => {
    try {
        const lists = loadData();
        const requestedList = req.body.listname;
        let exportLists = requestedList ? lists.filter(l => l.listname.toLowerCase() === requestedList.toLowerCase()) : lists;
        if (requestedList && exportLists.length === 0) return res.send(`No list found with name "${requestedList}"`);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Exported Lists");

        sheet.columns = [
            { header: "List Name", key: "listname", width: 20 },
            { header: "Date", key: "date", width: 20 },
            { header: "Item Name", key: "itemname", width: 20 },
            { header: "Quantity", key: "quantity", width: 10 },
            { header: "Price", key: "price", width: 10 },
            { header: "Total", key: "total", width: 10 }
        ];

        exportLists.forEach(list => {
            list.items.forEach(item => {
                sheet.addRow({ listname: list.listname, date: new Date(list.date).toLocaleString(), ...item });
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename=ExpenseLists.xlsx`);
        res.send(buffer);
    } catch (err) { res.status(500).send("Error generating Excel file: " + err.message); }
});

app.post("/cvtExcel/email", (req, res) => res.render("sendEmail.ejs", { lists: loadData() }));
app.post("/sendExcelEmail", async (req, res) => {
    try {
        const lists = loadData();
        const { listname, userEmail, recipientEmail, subject, content } = req.body;
        let exportLists = listname ? lists.filter(l => l.listname.toLowerCase() === listname.toLowerCase()) : lists;
        if (listname && exportLists.length === 0) return res.send(`No list found with name "${listname}"`);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Exported Lists");
        sheet.columns = [
            { header: "List Name", key: "listname", width: 20 },
            { header: "Date", key: "date", width: 30 },
            { header: "Item Name", key: "itemname", width: 20 },
            { header: "Quantity", key: "quantity", width: 10 },
            { header: "Price", key: "price", width: 10 },
            { header: "Total", key: "total", width: 10 }
        ];
        exportLists.forEach(list => list.items.forEach(item => sheet.addRow({ listname: list.listname, date: new Date(list.date).toLocaleString(), ...item })));
        const buffer = await workbook.xlsx.writeBuffer();

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: { user: userEmail, pass: "enyswleyapxkcdlx" } // App Password
        });

        await transporter.sendMail({ from: userEmail, to: recipientEmail, subject: subject || "Exported List", text: content || "Attached is your Excel export.", attachments: [{ filename: "ExpenseLists.xlsx", content: buffer }] });
        return res.send(`Email successfully sent to ${recipientEmail}`);
    } catch (err) { return res.status(500).send("Error sending email: " + err.message); }
});

// Start server
app.listen(port, () => console.log(`Server running at http://localhost:${port}`));










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
