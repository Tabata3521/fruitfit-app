const { Client } = require('pg');

async function safeRestore() {
  const client = new Client({ connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/fruitfit' });
  try {
    await client.connect();
    
    const checkRes = await client.query(\
      SELECT key, jsonb_array_length(data) as length, jsonb_typeof(data) as type
      FROM catalog_documents
      WHERE key IN ('courses', 'training-programs')
    \);
    
    const courses = checkRes.rows.find(r => r.key === 'courses');
    const programsRow = checkRes.rows.find(r => r.key === 'training-programs');
    const programsLen = programsRow ? (programsRow.type === 'object' ? 'check nested length' : programsRow.length) : 0;
    
    console.log('--- БД СТАТУС ---');
    console.log('courses length:', courses ? courses.length : 'not found');
    console.log('training-programs type:', programsRow ? programsRow.type : 'not found');
    
    // Бэкап
    if (programsRow) {
      await client.query(\
        INSERT INTO catalog_documents (key, data, source_path, imported_at, updated_at)
        SELECT 'training-programs-backup', data, source_path, imported_at, updated_at
        FROM catalog_documents WHERE key = 'training-programs'
        ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data;
      \);
      console.log('✅ Бэкап training-programs сохранен в ключ training-programs-backup');
      
      // Удаление для триггера авто-восстановления
      await client.query(\DELETE FROM catalog_documents WHERE key = 'training-programs'\);
      console.log('✅ Сломанный training-programs удален.');
      console.log('🚀 Теперь откройте админку в браузере (F5). Она автоматически скачает 150+ программ с api.tagirfruit.ru со всеми днями тренировок!');
    } else {
      console.log('training-programs уже удален. Откройте админку для авто-восстановления.');
    }
  } catch (err) {
    console.error('Ошибка:', err.message);
  } finally {
    await client.end();
  }
}
safeRestore();