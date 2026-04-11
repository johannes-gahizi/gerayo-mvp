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

// ✅ Create tables
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS buses (
        id SERIAL PRIMARY KEY,
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
        name TEXT,
        phone TEXT,
        bus_id INTEGER
      );
    `);

    console.log("Tables ready ✅");
  } catch (err) {
    console.error(err);
  }
}
createTables();

// --- AUTHENTICATION API ---

// ✅ Admin Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  // Simple hardcoded admin
  if (username === "admin" && password === "1234") {
    res.json({
      success: true,
      token: "secure123" // simple token
    });
  } else {
    res.json({ success: false });
  }
});

// --- BUS & BOOKING APIS ---

// ✅ Search buses
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

// ✅ Add bus
app.post("/api/add-bus", async (req, res) => {
  const { company, from, to, time, price } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO buses (company, from_city, to_city, time, price) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [company, from, to, time, price]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Error adding bus");
  }
});

// ✅ Get all buses
app.get("/api/all-buses", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM buses");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching buses");
  }
});

// ✅ Book ticket
app.post("/api/book", async (req, res) => {
  const { name, phone, busId } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO bookings (name, phone, bus_id) VALUES ($1,$2,$3) RETURNING *",
      [name, phone, busId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Booking error");
  }
});

// ✅ Get bookings
app.get("/api/bookings", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM bookings");
    res.json(result.rows);
  } catch (err) {
    res.status(500).send("Error fetching bookings");
  }
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});