import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pkg;
const pool = new Pool({
    connectionString: process.env.PG_URL,
    ssl: { rejectUnauthorized: false }
});

async function init() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100),
                email VARCHAR(100) UNIQUE,
                password VARCHAR(255)
            );
            
            CREATE TABLE IF NOT EXISTS expenses (
                id SERIAL PRIMARY KEY,
                user_id INT REFERENCES users(id),
                title VARCHAR(255),
                amount NUMERIC,
                date TIMESTAMP DEFAULT NOW()
            );
        `);

        console.log('Tables created successfully');
        process.exit(0);
    } catch (err) {
        console.error('Error initializing DB:', err);
        process.exit(1);
    }
}

init();
