const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../server-utils');

test('hashPassword and verifyPassword work for a new password', async () => {
  const hashed = hashPassword('SuperSecure123!');
  assert.ok(hashed.startsWith('pbkdf2$'));
  assert.equal(verifyPassword('SuperSecure123!', hashed), true);
  assert.equal(verifyPassword('WrongPassword', hashed), false);
});
