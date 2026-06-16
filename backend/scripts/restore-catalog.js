const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/fruitfit' });
client.connect()
  .then(() => client.query(DELETE FROM catalog_documents WHERE key IN ('training-programs', 'courses')))
  .then(res => {
    console.log('Successfully deleted broken catalog data. Rows affected:', res.rowCount);
    console.log('Now refresh the Admin Panel in your browser. It will automatically fetch the full catalog from production and save it locally!');
  })
  .catch(err => console.error('Error connecting to local DB:', err))
  .finally(() => client.end());