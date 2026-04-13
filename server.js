require('dotenv').config(); 
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Database Connection ---

const dbUrl = process.env.DATABASE_URL || ""; 

if (!dbUrl) {
    console.error("❌ DATABASE_URL is missing! Check your .env file.");
}

// Robust SSL Check for Render/Heroku
const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('render.com') || dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

// Test connection
pool.connect((err) => {
    if (err) console.error('❌ Database connection failed:', err.stack);
    else console.log('✅ Connected to PostgreSQL');
});

// --- Database Initialization ---
async function createTables() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS companies (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                fullname TEXT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS buses (
                id SERIAL PRIMARY KEY,
                company_id INTEGER REFERENCES companies(id),
                from_city TEXT NOT NULL,
                to_city TEXT NOT NULL,
                time TEXT NOT NULL,
                price INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                bus_id INTEGER REFERENCES buses(id),
                company_id INTEGER REFERENCES companies(id),
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                status TEXT DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("🚀 Database Schema Verified.");
    } catch (err) {
        console.error("❌ Error creating tables:", err);
    }
}
createTables();

// --- PASSENGER AUTH APIs ---

app.post("/api/signup", async (req, res) => {
    const { fullname, email, password } = req.body;
    if (!fullname || !email || !password) return res.status(400).json({ error: "All fields required" });

    try {
        const result = await pool.query(
            "INSERT INTO users (fullname, email, password) VALUES ($1, $2, $3) RETURNING id, fullname",
            [fullname, email, password]
        );
        res.json({ success: true, token: result.rows[0].id, userName: result.rows[0].fullname });
    } catch (err) {
        res.status(400).json({ error: "Email already registered" });
    }
});

app.post("/api/user-login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            "SELECT id, fullname FROM users WHERE email=$1 AND password=$2",
            [email, password]
        );
        if (result.rows.length > 0) {
            res.json({ success: true, token: result.rows[0].id, userName: result.rows[0].fullname });
        } else {
            res.status(401).json({ success: false, error: "Invalid email or password" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server authentication error" });
    }
});

// --- CUSTOMER SEARCH & BOOKING ---

app.get("/api/buses", async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.json([]);

    try {
        const result = await pool.query(
            `SELECT b.id, b.price, b.time, b.from_city, b.to_city, c.name as company 
             FROM buses b
             JOIN companies c ON b.company_id = c.id 
             WHERE LOWER(b.from_city) = LOWER($1) AND LOWER(b.to_city) = LOWER($2)`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch buses" });
    }
});

app.post('/api/book', async (req, res) => {
    const { busId, name, phone } = req.body;
    if (!busId || !name || !phone) return res.status(400).json({ error: "Missing information" });

    try {
        const bus = await pool.query('SELECT company_id FROM buses WHERE id = $1', [busId]);
        if (bus.rows.length === 0) return res.status(404).json({ error: "Bus not found" });

        const result = await pool.query(
            'INSERT INTO bookings (bus_id, company_id, name, phone) VALUES ($1, $2, $3, $4) RETURNING id',
            [busId, bus.rows[0].company_id, name, phone]
        );
        res.json({ success: true, bookingId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: "Booking failed" });
    }
});

app.get('/api/ticket/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT bk.id as booking_id, bk.name as passenger_name, bk.status,
                   bs.from_city, bs.to_city, bs.time, c.name as company_name
            FROM bookings bk
            JOIN buses bs ON bk.bus_id = bs.id
            JOIN companies c ON bk.company_id = c.id
            WHERE bk.id = $1`, [req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/pay', async (req, res) => {
    const { bookingId } = req.body;
    try {
        const result = await pool.query(
            "UPDATE bookings SET status = 'PAID' WHERE id = $1 RETURNING id",
            [bookingId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: "Booking not found" });
        res.json({ success: true, message: "Payment verified" });
    } catch (err) {
        res.status(500).json({ error: "Payment update failed" });
    }
});

// --- COMPANY DASHBOARD APIs ---

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query("SELECT id, name FROM companies WHERE username=$1 AND password=$2", [username, password]);
        if (result.rows.length > 0) {
            res.json({ success: true, token: result.rows[0].id, companyName: result.rows[0].name });
        } else {
            res.json({ success: false, error: "Invalid Admin Credentials" });
        }
    } catch (err) {
        res.status(500).json({ error: "Login system error" });
    }
});

app.get('/api/bookings', async (req, res) => {
    const { company_id } = req.query;
    try {
        const result = await pool.query(
            'SELECT b.*, bs.time, bs.from_city, bs.to_city FROM bookings b JOIN buses bs ON b.bus_id = bs.id WHERE b.company_id = $1 ORDER BY b.created_at DESC', 
            [company_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch bookings" });
    }
});

// --- SYSTEM INITIALIZATION ---

app.get('/api/setup-companies', async (req, res) => {
    const { key } = req.query;
    if (key !== 'admin123') return res.status(403).send("Unauthorized");
    try {
        await pool.query(`
            INSERT INTO companies (name, username, password) 
            VALUES ('Ritco', 'ritco', '1234'), ('Volcano Express', 'volcano', '1234') 
            ON CONFLICT (username) DO NOTHING`);
        res.send("System ready! Companies initialized. ✅");
    } catch (err) {
        res.status(500).send("Error: " + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Gerayo Server live on port ${PORT}`));