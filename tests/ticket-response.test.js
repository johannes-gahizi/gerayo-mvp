const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTicketResponse } = require('../server-utils');

test('buildTicketResponse exposes the fields used by the ticket page', async () => {
  const response = await buildTicketResponse(
    {
      id: 42,
      name: 'Aline',
      status: 'PAID',
      payment_status: 'PAID',
      payment_reference: 'TX-1',
      seat_number: 7
    },
    {
      price: 2500,
      time: '08:00',
      from_city: 'Kigali',
      to_city: 'Musanze'
    },
    {
      name: 'Ritco'
    }
  );

  assert.equal(response.booking_id, 42);
  assert.equal(response.passenger_name, 'Aline');
  assert.equal(response.company_name, 'Ritco');
  assert.equal(response.price, 2500);
  assert.equal(response.time, '08:00');
  assert.equal(response.from_city, 'Kigali');
  assert.equal(response.to_city, 'Musanze');
});
