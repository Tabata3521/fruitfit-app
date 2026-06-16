const { Client } = require('pg');
const client = new Client({ connectionString: 'postgres://postgres:postgres@localhost:5432/fruitfit' });
client.connect()
  .then(() => client.query(`SELECT key, jsonb_typeof(data) as type, jsonb_array_length(data) as length FROM catalog_documents WHERE key IN ('courses', 'training-programs')`))
  .then(res => console.log(res.rows))
  .catch(err => console.error(err.message))
  .finally(() => client.end());