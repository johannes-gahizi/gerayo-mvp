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
// Place this near the top
function sendSMS(phone, message) {
    console.log(`📩 SMS to ${phone}: ${message}`);
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
async function initializeDatabase() {
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
                price INTEGER NOT NULL,
                total_seats INTEGER DEFAULT 30
            );

            CREATE TABLE IF NOT EXISTS bookings (
                id SERIAL PRIMARY KEY,
                bus_id INTEGER REFERENCES buses(id),
                company_id INTEGER REFERENCES companies(id),
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                status TEXT DEFAULT 'PENDING',
                payment_status TEXT DEFAULT 'PENDING',
                payment_reference TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                seat_number INTEGER
            );
        `);

        await pool.query(`ALTER TABLE buses ADD COLUMN IF NOT EXISTS total_seats INTEGER DEFAULT 30;`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PENDING';`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_reference TEXT;`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);
        await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS seat_number INTEGER;`);

        await pool.query(`
            INSERT INTO companies (name, username, password)
            VALUES ('Ritco', 'ritco', '1234'), ('Volcano Express', 'volcano', '1234')
            ON CONFLICT (username) DO NOTHING
        `);

        const defaultBuses = [
            ['Ritco', 'Kigali', 'Musanze', '08:00', 2500],
            ['Ritco', 'Kigali', 'Rubavu', '11:00', 4000],
            ['Volcano Express', 'Kigali', 'Huye', '09:30', 3000],
            ['Volcano Express', 'Musanze', 'Kigali', '15:00', 2800]
        ];

        for (const [companyName, fromCity, toCity, time, price] of defaultBuses) {
            await pool.query(`
                INSERT INTO buses (company_id, from_city, to_city, time, price, total_seats)
                SELECT c.id, $1, $2, $3, $4, 30
                FROM companies c
                WHERE c.name = $5
                  AND NOT EXISTS (
                      SELECT 1 FROM buses b
                      WHERE b.company_id = c.id
                        AND LOWER(b.from_city) = LOWER($1)
                        AND LOWER(b.to_city) = LOWER($2)
                        AND b.time = $3
                  )
            `, [fromCity, toCity, time, price, companyName]);
        }

        console.log("🚀 Database Schema Verified.");
    } catch (err) {
        console.error("❌ Error creating tables:", err);
    }
}
initializeDatabase();

setInterval(async () => {
    try {
        await pool.query(`
            UPDATE bookings 
            SET payment_status='EXPIRED'
            WHERE payment_status='PROCESSING'
            AND created_at < NOW() - INTERVAL '10 minutes'
        `);
    } catch (err) {
        console.error('❌ Failed to expire old payments:', err);
    }
}, 60000); // every 1 minute

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
            `SELECT b.id, b.price, b.time, b.from_city, b.to_city, COALESCE(b.total_seats, 30) as total_seats,
                    c.name as company,
                    (COALESCE(b.total_seats, 30) - (SELECT COUNT(*) FROM bookings bk WHERE bk.bus_id = b.id AND bk.status = 'PAID')) as seats_left
             FROM buses b
             JOIN companies c ON b.company_id = c.id
             WHERE LOWER(b.from_city) = LOWER($1) AND LOWER(b.to_city) = LOWER($2)`,
            [from, to]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Failed to fetch buses:", err);
        res.status(500).json({ error: "Failed to fetch buses" });
    }
});

app.post('/api/book', async (req, res) => {
    const { busId, name, phone, company_id } = req.body;

    try {
        const bus = await pool.query(
            'SELECT id, company_id, COALESCE(total_seats, 30) as total_seats FROM buses WHERE id=$1',
            [busId]
        );

        if (bus.rows.length === 0) {
            return res.status(404).json({ error: "Bus not found" });
        }

        const capacity = parseInt(bus.rows[0].total_seats, 10) || 30;
        const count = await pool.query(
            "SELECT COUNT(*) FROM bookings WHERE bus_id=$1 AND status='PAID'",
            [busId]
        );

        const booked = parseInt(count.rows[0].count, 10);

        if (booked >= capacity) {
            return res.status(400).json({ error: "Bus is full" });
        }

        const seatNumber = booked + 1;
        const bookingCompanyId = company_id || bus.rows[0].company_id;

        const result = await pool.query(
            `INSERT INTO bookings (bus_id, company_id, name, phone, seat_number, status, payment_status)
             VALUES ($1, $2, $3, $4, $5, 'PENDING', 'PENDING')
             RETURNING id`,
            [busId, bookingCompanyId, name, phone, seatNumber]
        );

        res.json({ success: true, bookingId: result.rows[0].id });

    } catch (err) {
        console.error("Booking failed:", err);
        res.status(500).json({ error: "Booking failed" });
    }
});
// This runs once every 60 seconds independently
setInterval(async () => {
    try {
        await pool.query(`
            UPDATE bookings
            SET payment_status='EXPIRED'
            WHERE payment_status='PROCESSING'
            AND created_at < NOW() - INTERVAL '5 minutes'
        `);
    } catch (err) {
        console.error("Cleanup error:", err);
    }
}, 60000);

const QRCode = require('qrcode');

app.get('/api/ticket/:id', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, bs.price, bs.time, bs.from_city, bs.to_city, c.name as company_name
            FROM bookings b
            LEFT JOIN buses bs ON b.bus_id = bs.id
            LEFT JOIN companies c ON b.company_id = c.id
            WHERE b.id = $1
        `, [req.params.id]);

        const booking = result.rows[0];
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        const qr = await QRCode.toDataURL(`TICKET-${booking.id}`);
        res.json({ ...booking, qr });
    } catch (err) {
        console.error('Ticket lookup failed:', err);
        res.status(500).json({ error: 'Ticket lookup failed' });
    }
});

app.post('/api/pay-request', async (req, res) => {
    const { bookingId, phone } = req.body;

    try {
        const ref = "TX-" + Date.now();

        await pool.query(
            "UPDATE bookings SET payment_status='PROCESSING', payment_reference=$1 WHERE id=$2",
            [ref, bookingId]
        );

        // 🔥 REALISTIC OUTCOMES
        setTimeout(async () => {
            const rand = Math.random();

            let status = "PAID";

            if (rand < 0.2) status = "FAILED";      // 20% fail
            else if (rand < 0.4) status = "EXPIRED"; // 20% timeout

            await pool.query(
                "UPDATE bookings SET payment_status=$1, status=$2 WHERE id=$3",
                [status, status === "PAID" ? "PAID" : "PENDING", bookingId]
            );

            // --- ADDED MESSAGE START ---
            if (status === "PAID") {
                sendSMS(phone, "✅ Payment received. Your ticket is confirmed!");
            }
            // --- ADDED MESSAGE END ---

            console.log(`💳 Payment ${status} for booking ${bookingId}`);
        }, 5000);

        res.json({ success: true, ref });

    } catch (err) {
        res.status(500).json({ error: "Payment request failed" });
    }
});

app.post('/api/payment-callback', async (req, res) => {
    const { bookingId, status } = req.body;

    try {
        await pool.query(
            "UPDATE bookings SET payment_status=$1, status=$2 WHERE id=$3",
            [status, status === "PAID" ? "PAID" : "PENDING", bookingId]
        );

        res.send("Callback processed");
    } catch (err) {
        res.status(500).send("Callback error");
    }
});

app.post('/api/pay', async (req, res) => {
    const { bookingId, paymentReference } = req.body;
    try {
        const result = await pool.query(
            "UPDATE bookings SET status = 'PAID', payment_status = 'PAID', payment_reference = COALESCE($2, payment_reference) WHERE id = $1 RETURNING *",
            [bookingId, paymentReference]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: "Booking not found" });

        // --- Added SMS Logic ---
        const booking = result.rows[0];
        const msg = `Confirmed! Booking #${booking.id} for ${booking.name}. Seat: ${booking.seat_number}. Ref: ${paymentReference}`;
        sendSMS(booking.phone, msg);
        // -----------------------

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
// ✅ GET buses for admin (company only)
app.get('/api/all-buses', async (req, res) => {
    const { company_id } = req.query;

    if (!company_id) return res.json([]);

    try {
        const result = await pool.query(
            'SELECT * FROM buses WHERE company_id = $1 ORDER BY id DESC',
            [company_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch buses" });
    }
});

// ✅ ADD new bus
app.post('/api/add-bus', async (req, res) => {
    const { company_id, from, to, time, price } = req.body;

    if (!company_id || !from || !to || !time || !price) {
        return res.status(400).json({ error: "All fields required" });
    }

    try {
        await pool.query(
            'INSERT INTO buses (company_id, from_city, to_city, time, price) VALUES ($1, $2, $3, $4, $5)',
            [company_id, from, to, time, price]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to add bus" });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Gerayo Server live on port ${PORT}`));