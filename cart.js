
const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
const jwt = require('jsonwebtoken');

// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// JWT authentication middleware
const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded; // Store user info in request for further use
    next();
  });
};

// Route to add item to cart
router.post('/add-to-cart', authenticateJWT, async (req, res) => {
  const { subcategory_id } = req.body; // Only expecting subcategory_id now
  
  if (!subcategory_id) {
    return res.status(400).json({ message: 'Subcategory ID is required' });
  }

  const user_id = req.user.user_id; // Get the logged-in user's ID

  try {
    // Check if the user has already added this item to their cart
    const checkCartQuery = 'SELECT * FROM Carts WHERE user_id = $1 AND subcategory_id = $2';
    const checkCartResult = await pool.query(checkCartQuery, [user_id, subcategory_id]);

    if (checkCartResult.rows.length > 0) {
      // Item already exists, so we update the 'added_at' timestamp
      const updateCartQuery = `
        UPDATE Carts
        SET added_at = CURRENT_TIMESTAMP
        WHERE user_id = $1 AND subcategory_id = $2
        RETURNING *;
      `;
      const updatedCartResult = await pool.query(updateCartQuery, [user_id, subcategory_id]);
      
      return res.status(200).json({
        message: 'Item updated in cart',
        cart: updatedCartResult.rows[0],
      });
    } else {
      // Item doesn't exist, so we add it to the cart
      const addToCartQuery = `
        INSERT INTO Carts (user_id, subcategory_id)
        VALUES ($1, $2)
        RETURNING *;
      `;
      const addedCartResult = await pool.query(addToCartQuery, [user_id, subcategory_id]);
      
      return res.status(201).json({
        message: 'Item added to cart successfully',
        cart: addedCartResult.rows[0],
      });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});
 

// Route to remove item from cart
router.delete('/remove-from-cart', authenticateJWT, async (req, res) => {
  const { cart_id } = req.body; // The cart item to be removed, identified by cart_id
  console.log('Removing cart item with ID:', cart_id);

  if (!cart_id) {
    return res.status(400).json({ message: 'Cart ID is required' });
  }

  const user_id = req.user.user_id; // Extract user ID from JWT payload

  try {
    // Check if the cart item exists for this user
    const checkCartQuery = 'SELECT * FROM Carts WHERE cart_id = $1 AND user_id = $2';
    const checkCartResult = await pool.query(checkCartQuery, [cart_id, user_id]);

    if (checkCartResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cart item not found for this user' });
    }

    // If the cart item exists, remove it
    const deleteCartQuery = 'DELETE FROM Carts WHERE cart_id = $1 AND user_id = $2';
    await pool.query(deleteCartQuery, [cart_id, user_id]);

    return res.status(200).json({ message: 'Item removed from cart successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});
// Route to clear all items from the user's cart
router.delete('/clear-cart', authenticateJWT, async (req, res) => {
  const user_id = req.user.user_id;

  try {
    // Check if any items exist first (optional)
    const checkQuery = 'SELECT * FROM Carts WHERE user_id = $1';
    const checkResult = await pool.query(checkQuery, [user_id]);

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Cart is already empty' });
    }

    // Delete all cart items for the user
    const deleteQuery = 'DELETE FROM Carts WHERE user_id = $1';
    await pool.query(deleteQuery, [user_id]);

    return res.status(200).json({ message: 'Cart cleared successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Route to get all services in the cart for a user
router.get('/cart', authenticateJWT, async (req, res) => {
  const user_id = req.user.user_id; // Extract user ID from JWT token
  
  try {
    // SQL query to get services in the cart for the user
    const query = `
      SELECT 
        c.cart_id, 
        c.subcategory_id, -- ⬅️ مهم جدًا!
        s.subcategory_name AS service_name, 
        s.price,
        c.added_at
      FROM 
        Carts c
      JOIN 
        SubCategories s ON c.subcategory_id = s.subcategory_id
      WHERE 
        c.user_id = $1;
    `;
    
    const result = await pool.query(query, [user_id]);
    
    // Check if the cart is empty
    if (result.rows.length === 0) {
      return res.status(200).json({ message: 'No items found in the cart' });
    }
    
    return res.status(200).json({ cart: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
});
// Route to get count of items in the cart for a user
router.get('/count', authenticateJWT, async (req, res) => {
  const user_id = req.user.user_id;

  try {
    const countQuery = `
      SELECT COUNT(*) AS service_count
      FROM Carts
      WHERE user_id = $1;
    `;

    const result = await pool.query(countQuery, [user_id]);
    const serviceCount = parseInt(result.rows[0].service_count, 10);

    return res.status(200).json({ serviceCount });
  } catch (error) {
    console.error('Error fetching cart count:', error);
    return res.status(500).json({ message: 'Server error while getting cart count' });
  }
});


module.exports = router;
