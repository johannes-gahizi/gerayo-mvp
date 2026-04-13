require('dotenv').config(); 
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// --- Database Connection ---

// 1. Get the URL with a fallback to avoid "must be a string" error
const dbUrl = process.env.DATABASE_URL || ""; 

if (!dbUrl) {
    console.error("❌ DATABASE_URL is missing! Check your .env file.");
}

// 2. Check if we should use SSL (only if it's a Render URL)
const useSSL = dbUrl.includes('render.com');

const pool = new Pool({
    connectionString: dbUrl,
    ssl: useSSL ? { rejectUnauthorized: false } : false
});

// 3. Test the connection immediately to catch errors early
pool.connect((err) => {
    if (err) {
        console.error('❌ Database connection failed:', err.stack);
    } else {
        console.log('✅ Connected to Database');
    }
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
        console.log("🚀 Database tables ready.");
    } catch (err) {
        console.error("❌ Error creating tables:", err);
    }
}
createTables();

// --- PASSENGER AUTH APIs ---

app.post("/api/signup", async (req, res) => {
    const { fullname, email, password } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO users (fullname, email, password) VALUES ($1, $2, $3) RETURNING id, fullname",
            [fullname, email, password]
        );
        res.json({ success: true, token: result.rows[0].id, userName: result.rows[0].fullname });
    } catch (err) {
        res.status(400).json({ error: "Email already exists" });
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
            res.status(401).json({ error: "Invalid credentials" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// --- COMPANY AUTHENTICATION API ---

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

app.get("/api/buses", async (req, res) => {
    const { from, to, userToken } = req.query;
    
    if (!userToken) {
        return res.status(401).json({ error: "Unauthorized. Please login." });
    }
    
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

app.post('/api/book', async (req, res) => {
    const { busId, name, phone } = req.body;
    if (!busId || !name || !phone) return res.status(400).json({ error: "Missing booking info" });

    try {
        const busCheck = await pool.query('SELECT company_id FROM buses WHERE id = $1', [busId]);
        if (busCheck.rows.length === 0) return res.status(404).json({ error: "Bus not found" });
        
        const companyId = busCheck.rows[0].company_id;

        const result = await pool.query(
            'INSERT INTO bookings (bus_id, company_id, name, phone, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [busId, companyId, name, phone, 'PENDING']
        );
        
        res.json({ success: true, bookingId: result.rows[0].id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ticket/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`
            SELECT 
                bookings.id as booking_id,
                bookings.name as passenger_name,
                bookings.phone,
                bookings.status,
                buses.price, 
                buses.from_city, 
                buses.to_city, 
                buses.time,
                companies.name as company_name
            FROM bookings
            JOIN buses ON bookings.bus_id = buses.id
            JOIN companies ON bookings.company_id = companies.id
            WHERE bookings.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Ticket not found" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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