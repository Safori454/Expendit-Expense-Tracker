import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT
});

async function init() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS lists (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) NOT NULL REFERENCES users(username),
        listname VARCHAR(100) NOT NULL,
        total NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(username, listname)
      );

      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        list_id INT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        itemname VARCHAR(255),
        quantity NUMERIC(12,2),
        price NUMERIC(12,2)
      );
    `);

    console.log('Database initialized successfully!');
  } catch (err) {
    console.error('Error initializing DB:', err);
  } finally {
    await pool.end();
  }
}

init();
