const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();

// PostgreSQL Pool setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

router.get('/search', async (req, res) => {
    const { searchQuery, minPrice, maxPrice, locationId, minRating, mobileAssistance } = req.query;

    // Construct the query conditions dynamically based on the received filters
    let query = `
        SELECT 
            s.service_id, 
            s.service_name, 
            s.service_description, 
            s.price, 
            w.workshop_name, 
            w.address_id, 
            w.rate, 
            w.mobile_assistance, 
            w.capacity, 
            w.current_occupancy
        FROM 
            Service s
        JOIN 
            Workshops w ON s.workshop_id = w.workshop_id
        WHERE 
            s.service_name ILIKE $1
    `;

    // Create an array for query parameters
    let queryParams = [`%${searchQuery}%`];

    // Add filters if provided
    if (minPrice && maxPrice) {
        query += ` AND s.price BETWEEN $2 AND $3`;
        queryParams.push(minPrice, maxPrice);
    }

    if (locationId) {
        query += ` AND w.address_id = $${queryParams.length + 1}`;
        queryParams.push(locationId);
    }

    if (minRating) {
        query += ` AND w.rate >= $${queryParams.length + 1}`;
        queryParams.push(minRating);
    }

    if (mobileAssistance !== undefined) {  // Check for truthy or falsy values
        query += ` AND w.mobile_assistance = $${queryParams.length + 1}`;
        queryParams.push(mobileAssistance === 'true');  // Convert to boolean
    }

    query += ` ORDER BY w.rate DESC;`;

    try {
        // Execute the query with the dynamically constructed query and parameters
        const results = await pool.query(query, queryParams);

        // Send results as JSON
        res.json(results.rows);
    } catch (error) {
        console.error("Error querying the database:", error);
        res.status(500).send("Internal server error");
    }
});

module.exports = router;
