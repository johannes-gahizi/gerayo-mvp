const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ Connect to PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ✅ Refactored Tables
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT,
        username TEXT UNIQUE,
        password TEXT
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS buses (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        company TEXT,
        from_city TEXT,
        to_city TEXT,
        time TEXT,
        price INTEGER
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        name TEXT,
        phone TEXT,
        bus_id INTEGER
      );
    `);

    console.log("Tables ready ✅");
  } catch (err) {
    console.error("Error creating tables:", err);
  }
}
createTables();

// --- AUTHENTICATION APIS ---

// ✅ New Company Registration
app.post("/api/register", async (req, res) => {
  const { name, username, password } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO companies (name, username, password) VALUES ($1,$2,$3) RETURNING id, name, username",
      [name, username, password]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Registration failed" });
  }
});

// ✅ UPDATED Login with Error Message
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT id, name FROM companies WHERE username=$1 AND password=$2",
      [username, password]
    );

    if (result.rows.length === 0) {
      // ✅ FIX: Added clear error message for the frontend
      return res.json({ 
        success: false, 
        message: "Invalid username or password" 
      });
    }

    const company = result.rows[0];
    res.json({
      success: true,
      token: company.id,
      companyName: company.name
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Login error" });
  }
});

// --- BUS & BOOKING APIS ---

app.get("/api/buses", async (req, res) => {
  const { from, to } = req.query;
  try {
    const result = await pool.query(
      "SELECT * FROM buses WHERE LOWER(from_city)=LOWER($1) AND LOWER(to_city)=LOWER($2)",
      [from, to]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Search error");
  }
});

app.post("/api/add-bus", async (req, res) => {
  const { company_id, company, from, to, time, price } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO buses (company_id, company, from_city, to_city, time, price) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [company_id, company, from, to, time, price]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error adding bus");
  }
});

app.get("/api/all-buses", async (req, res) => {
  const { company_id } = req.query;
  try {
    const result = await pool.query(
      "SELECT * FROM buses WHERE company_id=$1",
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching buses");
  }
});

app.post("/api/book", async (req, res) => {
  const { company_id, name, phone, busId } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO bookings (company_id, name, phone, bus_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [company_id, name, phone, busId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Booking error");
  }
});

app.get("/api/bookings", async (req, res) => {
  const { company_id } = req.query;
  try {
    const result = await pool.query(
      "SELECT * FROM bookings WHERE company_id=$1",
      [company_id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching bookings");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});