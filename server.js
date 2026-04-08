const path = require("path");
const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ ONE buses array (combined)
let buses = [
  {
    id: 1,
    company: "Volcano Express",
    from: "Kigali",
    to: "Huye",
    time: "08:00",
    price: 3000
  },
  {
    id: 2,
    company: "Ritco",
    from: "Kigali",
    to: "Musanze",
    time: "09:30",
    price: 2500
  },
  {
    id: 3,
    company: "Jaguar Executive",
    from: "Kigali",
    to: "Rubavu",
    time: "11:00",
    price: 4000
  }
];

// Store bookings
let bookings = [];

// ✅ Search buses
app.get("/api/buses", (req, res) => {
  const { from, to } = req.query;

  const results = buses.filter(
    b => b.from === from && b.to === to
  );

  res.json(results);
});

// ✅ Book ticket
app.post("/api/book", (req, res) => {
  const { name, phone, busId } = req.body;

  const booking = {
    id: Math.floor(Math.random() * 100000),
    name,
    phone,
    busId
  };

  bookings.push(booking);

  res.json(booking);
});

// ✅ Admin: Add bus
app.post("/api/add-bus", (req, res) => {
  const bus = {
    id: Date.now(),
    ...req.body
  };

  buses.push(bus);

  res.json(bus);
});

// ✅ Admin: Get all buses
app.get("/api/all-buses", (req, res) => {
  res.json(buses);
});

// ✅ Admin: View bookings
app.get("/api/bookings", (req, res) => {
  res.json(bookings);
});

// ✅ Start server (ALWAYS LAST)
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});