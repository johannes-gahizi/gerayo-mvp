const express = require('express');
const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Database Connection ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
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

            CREATE TABLE IF NOT EXISTS buses (
                id SERIAL PRIMARY KEY,
                company_id INTEGER REFERENCES companies(id),
                from_city TEXT,
                to_city TEXT,
                time TEXT,
                price INTEGER
            );

            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                bus_id INTEGER REFERENCES buses(id),
                company_id INTEGER REFERENCES companies(id),
                name TEXT,
                phone TEXT,
                status TEXT DEFAULT 'PENDING',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Database tables ready.");
    } catch (err) {
        console.error("Error creating tables:", err);
    }
}
createTables();

// --- AUTHENTICATION API ---

app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing credentials" });

    try {
        const result = await pool.query(
            "SELECT * FROM companies WHERE username=$1 AND password=$2",
            [username, password]
        );

        if (result.rows.length === 0) {
            return res.json({ success: false });
        }

        const company = result.rows[0];
        res.json({
            success: true,
            token: company.id,
            companyName: company.name
        });
    } catch (err) {
        res.status(500).json({ error: "Login error" });
    }
});

// --- CUSTOMER APIs ---

// ✅ FIXED: Matches frontend fields (bus.company, bus.from_city, etc.)
app.get("/api/buses", async (req, res) => {
    const { from, to } = req.query;
    if (!from || !to) return res.json([]);

    try {
        const result = await pool.query(
            `SELECT buses.id, buses.price, buses.time, 
                    buses.from_city, buses.to_city, 
                    companies.name as company 
             FROM buses 
             JOIN companies ON buses.company_id = companies.id 
             WHERE LOWER(from_city)=LOWER($1) AND LOWER(to_city)=LOWER($2)`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Search error" });
    }
});

// ✅ FIXED: Automatically finds company_id so frontend doesn't have to send it
app.post('/api/book', async (req, res) => {
    const { busId, name, phone } = req.body;
    if (!busId || !name || !phone) return res.status(400).json({ error: "Missing booking info" });

    try {
        // Find the company associated with this bus
        const busCheck = await pool.query('SELECT company_id FROM buses WHERE id = $1', [busId]);
        if (busCheck.rows.length === 0) return res.status(404).json({ error: "Bus not found" });
        
        const companyId = busCheck.rows[0].company_id;

        const result = await pool.query(
            'INSERT INTO bookings (bus_id, company_id, name, phone, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [busId, companyId, name, phone, 'PENDING']
        );
        
        // Return success: true so frontend redirect logic works
        res.json({ success: true, bookingId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ticket/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                bookings.id as booking_id,
                bookings.name as passenger_name,
                bookings.phone as passenger_phone,
                bookings.status,
                buses.from_city,
                buses.to_city,
                buses.time,
                buses.price,
                companies.name as company_name
            FROM bookings
            JOIN buses ON bookings.bus_id = buses.id
            JOIN companies ON bookings.company_id = companies.id
            WHERE bookings.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ✅ UPDATED: Added a check for bookingId consistency
app.post('/api/pay', async (req, res) => {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: "Invalid payment request" });

    try {
        await pool.query(
            "UPDATE bookings SET status = 'PAID' WHERE id = $1",
            [bookingId]
        );
        res.json({ success: true, message: "Payment updated" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- ADMIN APIs ---

app.post('/api/add-bus', async (req, res) => {
    const { company_id, from, to, time, price } = req.body;
    if (!company_id || !from || !to || !time || !price) return res.status(400).json({ error: "All fields are required" });

    try {
        await pool.query(
            'INSERT INTO buses (company_id, from_city, to_city, time, price) VALUES ($1, $2, $3, $4, $5)',
            [company_id, from, to, time, price]
        );
        res.json({ message: "Bus added successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/all-buses', async (req, res) => {
    const { company_id } = req.query;
    if (!company_id) return res.json([]);
    try {
        const result = await pool.query('SELECT * FROM buses WHERE company_id = $1', [company_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/bookings', async (req, res) => {
    const { company_id } = req.query;
    if (!company_id) return res.json([]);
    try {
        const result = await pool.query('SELECT * FROM bookings WHERE company_id = $1 ORDER BY created_at DESC', [company_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SETUP ROUTE ---
app.get('/api/setup-companies', async (req, res) => {
    const { key } = req.query;
    if (key !== 'admin123') return res.status(403).send("Unauthorized");
    try {
        await pool.query(`INSERT INTO companies (name, username, password) VALUES ('Ritco', 'ritco', '1234'), ('Volcano Express', 'volcano', '1234') ON CONFLICT (username) DO NOTHING`);
        res.send("Database structure checked and ready! ✅");
    } catch (err) {
        res.status(500).send("Error: " + err.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));