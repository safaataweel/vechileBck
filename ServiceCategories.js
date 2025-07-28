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



// Route to get all services (subcategories) with their category names
router.get('/services', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT sc.subcategory_id, sc.subcategory_name, cat.category_name
        FROM SubCategories sc
        JOIN ServiceCategories cat ON sc.category_id = cat.category_id
      `);
      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching services:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });
  
  router.post('/add-service', async (req, res) => {
    const { subcategory_name, category_id } = req.body;

    try {
        // Insert the new service into the SubCategories table
        const result = await pool.query(
            'INSERT INTO SubCategories (subcategory_name, category_id) VALUES ($1, $2) RETURNING *',
            [subcategory_name, category_id]
        );

        // Send the newly created service as a response
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding service:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



// route to add new categiory
router.post('/add-category', async (req, res) => {
    const { category_name } = req.body;

    try {
        // Insert the new category into the ServiceCategories table
        const result = await pool.query(
            'INSERT INTO ServiceCategories (category_name) VALUES ($1) RETURNING *',
            [category_name]
        );

        // Send the newly created category as a response
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/categories/:categoryId/subcategories', async (req, res) => {
  const { categoryId } = req.params;
 console.log('Fetching subcategories for category ID:', categoryId);
  try {
    const result = await pool.query(
      'SELECT * FROM SubCategories WHERE category_id = $1',
      [categoryId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subcategories:', error);
    res.status(500).json({ error: 'Server error fetching subcategories.' });
  }
});



// Route to delete a service subcategory
router.delete('/services/:subcategoryId', async (req, res) => {
    const { subcategoryId } = req.params;
    console.log('Deleting service subcategory with ID:', subcategoryId);

    try {
        // Delete the service subcategory from the SubCategories table
        const result = await pool.query(
            'DELETE FROM SubCategories WHERE subcategory_id = $1 RETURNING *',
            [subcategoryId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Service subcategory not found' });
        }

        // Send a success response
        res.status(200).json({ message: 'Service subcategory deleted successfully' });
    } catch (error) {
        console.error('Error deleting service subcategory:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//add subcategory to category
router.post('/categories/:categoryId/subcategories', async (req, res) => {
    const { categoryId } = req.params;
    const { subcategory_name, price } = req.body;
console.log('Received data:', { categoryId, subcategory_name, price });

    try {
        // Insert the new subcategory into the SubCategories table
        const result = await pool.query(
            'INSERT INTO SubCategories (subcategory_name, category_id, price) VALUES ($1, $2, $3) RETURNING *',
            [subcategory_name, categoryId, price]
        );

        // Send the newly created subcategory as a response
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error adding subcategory:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// update subcategory
router.put('/services/:subcategoryId', async (req, res) => {
    const { subcategoryId } = req.params;
    const { subcategory_name, price } = req.body;
    console.log('Updating service subcategory with ID:', subcategoryId, 'to name:', subcategory_name, 'and price:', price);
    try {
        // Update the service subcategory in the SubCategories table
        const result = await pool.query(
            'UPDATE SubCategories SET subcategory_name = $1, price = $2 WHERE subcategory_id = $3 RETURNING *',
            [subcategory_name, price, subcategoryId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Service subcategory not found' });
        }

        // Send the updated service subcategory as a response
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error updating service subcategory:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/check-subcategories', async (req, res) => {
  const { subcategoryIds } = req.body; // متوقع تستقبل مصفوفة أرقام

  if (!Array.isArray(subcategoryIds) || subcategoryIds.length === 0) {
    return res.status(400).json({ message: 'subcategoryIds must be a non-empty array' });
  }

  try {
    const query = `
      WITH subcats AS (
        SELECT category_id
        FROM SubCategories
        WHERE subcategory_id = ANY($1)
      ),
      distinct_cats AS (
        SELECT DISTINCT category_id FROM subcats
      ),
      check_special_ids AS (
        SELECT COUNT(DISTINCT category_id) as distinct_count,
               BOOL_AND(category_id IN (1,3,4)) as all_in_special
        FROM distinct_cats
      )
      SELECT
        CASE
          WHEN distinct_count = 1 THEN 'same'
          WHEN all_in_special THEN 'same'
          ELSE 'different'
        END as result
      FROM check_special_ids;
    `;

    const { rows } = await pool.query(query, [subcategoryIds]);
    const result = rows[0]?.result || 'different';

    res.json({ result });

  } catch (error) {
    console.error('Error checking subcategories:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
