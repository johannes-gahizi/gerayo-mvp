require('dotenv').config();
const { Pool } = require('pg');
const crypto = require('crypto');

const dbUrl = process.env.DATABASE_URL || '';
const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl.includes('render.com') || dbUrl.includes('localhost') ? false : { rejectUnauthorized: false }
});

(async () => {
  const email = `writecheck+${Date.now()}@example.com`;
  const name = 'Write Check';
  const password = 'WriteCheck123!';
  const token = crypto.randomBytes(12).toString('hex');

  const userResult = await pool.query(
    'INSERT INTO users (fullname, email, password) VALUES ($1, $2, $3) RETURNING id',
    [name, email, password]
  );
  const userId = userResult.rows[0].id;
  console.log('signup_inserted_id', userId);

  await pool.query(
    'INSERT INTO password_reset_tokens (email, token, expires_at) VALUES ($1, $2, $3)',
    [email, token, new Date(Date.now() + 3600000)]
  );
  console.log('reset_token_inserted', token);

  const bookingResult = await pool.query(
    "INSERT INTO bookings (bus_id, company_id, name, phone, seat_number, status, payment_status) VALUES ($1, $2, $3, $4, $5, 'PENDING', 'PENDING') RETURNING id",
    [1, 1, 'Write Check', '0780000000', 1]
  );
  const bookingId = bookingResult.rows[0].id;
  console.log('booking_inserted_id', bookingId);

  await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token]);
  await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  console.log('cleanup_completed', true);
  await pool.end();
})().catch(err => {
  console.error('DB_WRITE_CHECK_FAILED', err.message);
  process.exit(1);
});
