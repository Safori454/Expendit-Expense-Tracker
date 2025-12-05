import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const { Pool } = pkg;

const pool = new Pool({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
    ssl: { rejectUnauthorized: false }
});

const init = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lists (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) NOT NULL,
                listname VARCHAR(50) NOT NULL,
                total NUMERIC DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(username, listname)
            );

            CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
                list_id INT REFERENCES lists(id) ON DELETE CASCADE,
                itemname VARCHAR(100),
                quantity NUMERIC,
                price NUMERIC
            );
        `);

        console.log('Tables created successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Error initializing DB:', err);
        process.exit(1);
    }
};

init();
