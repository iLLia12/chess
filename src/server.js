'use strict';

require('dotenv').config();

const db = require('./db');
const app = require('./app');
const { ensureAdmin } = require('./users');

const port = Number(process.env.PORT || 3000);

db.migrate()
  .then(() => ensureAdmin())
  .then(() => {
    app.listen(port, () => console.log(`chess online listening on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('Could not start:', err.message);
    if (err.code === 'ECONNREFUSED') console.error('Start the database with:  npm run db');
    process.exit(1);
  });
