const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();

// PostgreSQL Pool setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Route to get all service categories
router.get('/categories', async (req, res) => {
    try {
        // Query to get all categories
        const results = await pool.query(`
            SELECT category_id, category_name
            FROM ServiceCategories
            ORDER BY category_name ASC; 
        `);

        // Send results as JSON
        res.json(results.rows);
    } catch (error) {
        console.error("Error querying the database:", error);
        res.status(500).send("Internal server error");
    }
});

module.exports = router;
