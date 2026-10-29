'use strict';

require('dotenv').config();

const db = require('./db');
const app = require('./app');

const port = Number(process.env.PORT || 3000);

db.migrate()
  .then(() => {
    app.listen(port, () => console.log(`chess online listening on http://localhost:${port}`));
  })
  .catch((err) => {
    console.error('Database is not reachable:', err.message);
    console.error('Start it with:  npm run db');
    process.exit(1);
  });
