const express = require('express');
const app = express();
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL client
const bcrypt = require('bcrypt'); // For password hashing
const jwt = require('jsonwebtoken');
require('dotenv').config(); // For .env configuration
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const multer = require("multer");



const adminRoutes = require('./admin');
const vehicleRoutes = require('./vehicle'); // Assuming you have a vehicle.js file for vehicle routes
const customerRoutes = require('./customer'); // Assuming you have a customer.js file for customer routes
const mechanicRoutes = require('./mechanic'); // Assuming you have a mechanic.js file for mechanic routes
// const serviceRoutes = require('./service'); // Assuming you have a service.js file for service routes
// const reviewRoutes = require('./review'); // Assuming you have a review.js file for review routes
const profileRoutes = require('./profile'); // Assuming you have a profile.js file for profile routes
const searchRoutes = require('./Search'); // Assuming you have a Search.js file for search routes
const ServiceCategoriesRoutes = require('./ServiceCategories'); // Assuming you have a ServiceCategories.js file for service categories routes
const historyRoutes = require('./history'); // Assuming you have a history.js file for history routes
const chngePasswordRoutes = require('./ChangePassword'); // Assuming you have a changePassword.js file for change password routes
const BookingRoutes = require('./booking'); // Assuming you have a Booking.js file for booking routes
const resetPasswordRoutes = require('./resetpsword'); // Assuming you have a resetpsword.js file for reset password routes

// Middleware
app.use(express.json()); 
app.use(cors());
app.use(bodyParser.json());
app.use('/admin', adminRoutes);
app.use('/customer', customerRoutes);
app.use('/mechanic', mechanicRoutes);
app.use('/profile', profileRoutes); // Uncomment if you have vehicle routes
app.use('/vehicle', vehicleRoutes); // Uncomment if you have vehicle routes
app.use('/search', searchRoutes); // Uncomment if you have search routes
app.use('/ServiceCategories', require('./ServiceCategories')); // Assuming you have a ServiceCategories.js file for service categories routes
app.use('/changePassword', chngePasswordRoutes); // Assuming you have a changePassword.js file for change password routes
app.use('/history', historyRoutes); // Assuming you have a history.js file for history routes
app.use('/booking', BookingRoutes); // Assuming you have a booking.js file for booking routes
app.use('/resetpsword', resetPasswordRoutes); // Assuming you have a resetpsword.js file for reset password routes

// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});


// Set up multer storage engine to store files in a general 'uploads' directory
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);  // Save files in the 'uploads' directory
    },
    filename: (req, file, cb) => {
      const fileName = `${Date.now()}-${file.originalname}`;  // Generate a unique filename
      cb(null, fileName);
    },
  });
  
  // Initialize multer with a file size limit (optional) but no file type restriction
  const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },  // Optional: Limit the file size to 10MB
  });
  

// Admin approves the workshop
app.patch('/approve-workshop/:workshop_id', async (req, res) => {
  const { workshop_id } = req.params;
  const { approval_status } = req.body;

  try {
    if (approval_status !== 'Approved') {
      return res.status(400).json({ message: 'Invalid approval status' });
    }

    const result = await pool.query(
      `UPDATE Workshops SET approval_status = $1 WHERE workshop_id = $2 RETURNING *`,
      [approval_status, workshop_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found' });
    }

    const updatedWorkshop = result.rows[0];
    res.status(200).json({
      message: 'Workshop approved successfully',
      workshop: updatedWorkshop,
    });
  } catch (error) {
    console.error('Error during approval:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});
// Admin rejects the workshop
app.patch('/reject-workshop/:workshop_id', async (req, res) => {
  const { workshop_id } = req.params;
  const { approval_status } = req.body;

  try {
    if (approval_status !== 'Rejected') {
      return res.status(400).json({ message: 'Invalid rejection status' });
    }

    const result = await pool.query(
      `UPDATE Workshops SET approval_status = $1 WHERE workshop_id = $2 RETURNING *`,
      [approval_status, workshop_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Workshop not found' });
    }

    const updatedWorkshop = result.rows[0];
    res.status(200).json({
      message: 'Workshop rejected successfully',
      workshop: updatedWorkshop,
    });
  } catch (error) {
    console.error('Error during rejection:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/refresh-token', (req, res) => {
  const { refresh_token } = req.body;

  if (!refresh_token) {
      return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
      const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);

      // Generate a new access token
      const newAccessToken = jwt.sign(
          { user_id: decoded.user_id, role: decoded.role },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
      );

      return res.status(200).json({ access_token: newAccessToken });
  } catch (err) {
      console.error('Error during token verification:', err.message);
      return res.status(403).json({ message: 'Invalid or expired refresh token' });
  }
});

// Login route to authenticate users and return their role
app.post('/login', async (req, res) => {
    const { email_address, password } = req.body;

    try {
        // Check if the email exists
        const userResult = await pool.query(
            'SELECT * FROM Users WHERE email_address = $1',
            [email_address]
        );

        if (userResult.rows.length === 0) {
            return res.status(400).json({ message: 'User not found' });
        }

        const user = userResult.rows[0];

        // Compare the password with the hashed password in the database
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid password' });
        }

         // Generate JWT access token (expires in 1 hour)
  const accessToken = jwt.sign(
    { user_id: user.user_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Generate JWT refresh token (expires in 7 days)
  const refreshToken = jwt.sign(
    { user_id:  user.user_id, role: user.role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

        // Return user role and the token
        res.status(200).json({
            message: 'Login successful',
            user_id: user.user_id,
            role: user.role,
            access_token: accessToken, // Short-lived token
            refresh_token: refreshToken, // Long-lived token
        });
    } catch (error) {
        console.error('Error during login:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
});



// API Configuration
// const API_URL = "https://api.api-ninjas.com/v1/cars";
// const API_KEY = "FvCSvdaPtxwpW0JHYPoREA==pq9v7ZKZcF9ZaY6f";




// Function to check if a car exists in the database
const carExists = async (make, model, year, transmission, fuel_type) => {
  const query = `
    SELECT 1 FROM ReferenceVehicle 
    WHERE make = $1 AND model = $2 AND year = $3 
    AND transmission = $4 AND fuel_type = $5
  `;
  const values = [make, model, year, transmission, fuel_type];
  const result = await pool.query(query, values);
  return result.rowCount > 0;
};

// Function to insert a car into the database
const insertCar = async (car) => {
  const query = `
    INSERT INTO ReferenceVehicle (make, model, year, transmission, engine_size, fuel_type) 
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  const values = [
    car.make,
    car.model,
    car.year,
    car.transmission || null,
    car.engine_size, // Keep 0 if missing
    car.fuel_type || null,
  ];
  await pool.query(query, values);
};

// Fetch car data and store in the database
const fetchAndStoreCars = async () => {
  try {
    // Define parameters for fetching cars
    const params = {
      year: 2010, // Example year
      fuel_type: "electricity", // Example fuel type
      limit: 50, // Fetch up to 50 cars at a time
    };

    const response = await axios.get(API_URL, {
      headers: { "X-Api-Key": API_KEY },
      params,
    });

    const cars = response.data;

    // Process each car
    for (const car of cars) {
      const engine_size = car.engine_size || 0; // Use 0 if engine_size is missing

      // Check if the car already exists
      const exists = await carExists(
        car.make,
        car.model,
        car.year,
        car.transmission,
        car.fuel_type
      );

      if (!exists) {
        await insertCar({
          make: car.make,
          model: car.model,
          year: car.year,
          engine_size,
          transmission: car.transmission,
          fuel_type: car.fuel_type,
        });
        console.log(`Inserted: ${car.make} ${car.model} ${car.year}`);
      } else {
        console.log(`Duplicate skipped: ${car.make} ${car.model} ${car.year}`);
      }
    }
  } catch (error) {
    console.error("Error fetching or storing cars:", error.message);
  }
};

// Run the script
fetchAndStoreCars();

// API to get all car makes
app.get('/api/makes', async (req, res) => {
    try {
        const query = 'SELECT DISTINCT make FROM referencevehicle ORDER BY make';
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching makes:', error);
        res.status(500).json({ error: 'An error occurred while fetching car makes' });
    }
});

// API to get all models for a specific make
app.get('/api/models', async (req, res) => {
    const { make } = req.query;
    if (!make) {
        return res.status(400).json({ error: 'Make parameter is required' });
    }

    try {
        const query = 'SELECT DISTINCT model FROM ReferenceVehicle WHERE make = $1 ORDER BY model';
        const result = await pool.query(query, [make]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching models:', error);
        res.status(500).json({ error: 'An error occurred while fetching models' });
    }
});

// API to get all years for a specific make and model
app.get('/api/years', async (req, res) => {
    const { make, model } = req.query;
    if (!make || !model) {
        return res.status(400).json({ error: 'Make and model parameters are required' });
    }

    try {
        const query = 'SELECT DISTINCT year FROM ReferenceVehicle WHERE make = $1 AND model = $2 ORDER BY year';
        const result = await pool.query(query, [make, model]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching years:', error);
        res.status(500).json({ error: 'An error occurred while fetching years' });
    }
});

// API to get all transmissions for a specific make, model, and year
app.get('/api/transmissions', async (req, res) => {
    const { make, model, year } = req.query;
    if (!make || !model || !year) {
        return res.status(400).json({ error: 'Make, model, and year parameters are required' });
    }

    try {
        const query = `
            SELECT DISTINCT 
                CASE 
                    WHEN transmission = 'a' THEN 'automatic' 
                    WHEN transmission = 'm' THEN 'gear' 
                    ELSE transmission 
                END AS transmission 
            FROM referencevehicle 
            WHERE make = $1 AND model = $2 AND year = $3 
            ORDER BY transmission
        `;
        const result = await pool.query(query, [make, model, year]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching transmissions:', error);
        res.status(500).json({ error: 'An error occurred while fetching transmissions' });
    }
});

// API to get all fuel types for a specific make, model, and year
app.get('/api/fuel-types', async (req, res) => {
    const { make, model, year } = req.query;
    if (!make || !model || !year) {
        return res.status(400).json({ error: 'Make, model, and year parameters are required' });
    }

    try {
        const query = 'SELECT DISTINCT fuel_type FROM ReferenceVehicle WHERE make = $1 AND model = $2 AND year = $3 ORDER BY fuel_type';
        const result = await pool.query(query, [make, model, year]);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching fuel types:', error);
        res.status(500).json({ error: 'An error occurred while fetching fuel types' });
    }
});
// const normalizeString = (str) => {
//     return str.trim().toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase());
//   };
// //

  

const authenticateJWT = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  console.log('Token received:', token);

  if (!token) {
    console.log('Authorization header missing or token not found');
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      console.log('JWT verification failed:', err.message);
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
};

  
  app.get('/api/vehicles/count', authenticateJWT, async (req, res) => {
    try {
      const userId = req.user_id; // Extract user_id from decoded JWT
      const result = await pool.query('SELECT COUNT(*) AS count FROM vehicle WHERE user_id = $1', [userId]);
  
      const vehicleCount = result.rows[0]?.count ? parseInt(result.rows[0].count, 10) : 0;
  
      res.json({ count: vehicleCount });
    } catch (error) {
      console.error('Error fetching vehicle count:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });


app.post('/api/vehicles', authenticateJWT, async (req, res) => {
  const { make, model, year, transmission, fuel_type, isDefault } = req.body;
  const user_id = req.user?.user_id; // Ensure user ID is extracted from JWT
  console.log('Request body:', req.body); // Log the request body
  console.log('User ID from token:', user_id); // Log the user I
   // Log the Authorization header to see the token sent with the request
  const authHeader = req.headers.authorization;
  console.log('Authorization header:', authHeader);

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token.' });
  }
  // Input Validation
  if (!make || !model || !year || !transmission || !fuel_type) {
    return res.status(400).json({ error: 'Missing required fields: make, model, year, transmission, or fuel_type.' });
  }

  if (!user_id) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token.' });
  }

  try {
    // Check if ReferenceVehicle entry exists
    const referenceVehicleQuery = await pool.query(`
      SELECT reference_id
      FROM referencevehicle
      WHERE make = $1 AND model = $2 AND year = $3 AND transmission = $4 AND fuel_type = $5
    `, [make, model, year, transmission, fuel_type]);

    let reference_id;

    if (referenceVehicleQuery.rows.length > 0) {
      reference_id = referenceVehicleQuery.rows[0].reference_id;
    } else {
      // Create a new ReferenceVehicle entry
      const newRefQuery = await pool.query(`
        INSERT INTO referencevehicle (make, model, year, transmission, fuel_type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING reference_id
      `, [make, model, year, transmission, fuel_type]);
      reference_id = newRefQuery.rows[0].reference_id;
    }

    // Handle isDefault logic
    if (isDefault) {
      await pool.query(`
        UPDATE vehicle
        SET isDefault = FALSE
        WHERE user_id = $1
      `, [user_id]);
    }

    // Insert into Vehicle table
    const newVehicleQuery = await pool.query(`
      INSERT INTO vehicle (user_id, reference_id, isDefault, registration_date)
      VALUES ($1, $2, $3, CURRENT_DATE)
      RETURNING *
    `, [user_id, reference_id, isDefault || false]);

    res.status(201).json(newVehicleQuery.rows[0]);
  } catch (error) {
    console.error('Error adding vehicle:', error);

    if (error.message.includes('violates')) {
      res.status(400).json({ error: 'Database constraint violation. Check your input data.' });
    } else {
      res.status(500).json({ error: 'An error occurred while processing your request.' });
    }
  }
});

app.get('/myprofile', authenticateJWT, async (req, res) => {
  const user_id = req.user.user_id;  // Decode user_id from the token

  try {
      // Fetch user profile details
      const userResult = await pool.query(
          'SELECT first_name, last_name, email_address, profile_picture, role, phone_number FROM Users WHERE user_id = $1',
          [user_id]
      );

      if (userResult.rows.length === 0) {
          return res.status(404).json({ message: 'User not found' });
      }

      const user = userResult.rows[0];

      // Fetch address associated with the user
      const addressResult = await pool.query(
          'SELECT street, city FROM address WHERE user_id = $1',
          [user_id]
      );

      const address = addressResult.rows[0]; // Address data for the user

      // Fetch associated customer details (if the user is a customer)
      let customerDetails = null;
      if (user.role === 'Customer') {
          const customerResult = await pool.query(
              'SELECT loyalty_points, cancel_count FROM Customers WHERE user_id = $1',
              [user_id]
          );
          customerDetails = customerResult.rows[0];
      }

      let workshopDetails = null;

      if (user.role === 'Mechanic') {
          const workshopResult = await pool.query(
              'SELECT workshop_name, approval_status, working_day_hours FROM Workshops WHERE user_id = $1',
              [user_id]
          );
      
          if (workshopResult.rows.length > 0) {
              workshopDetails = workshopResult.rows[0]; // Include working_day_hours here
          } else {
              workshopDetails = { message: "Mechanic is not assigned to any workshop" };
          }
      }
      
      // Response
      res.status(200).json({
          user,
          address, // Include address in the response
          customerDetails,
          workshopDetails,
      });
  } catch (error) {
      console.error('Error fetching profile:', error.message);
      res.status(500).json({ message: 'Server error' });
  }
});



app.get('/myhome', authenticateJWT, async (req, res) => {
  const user_id = req.user.user_id; // Decoded from JWT

  try {
    // Fetch only the required user details
    const userResult = await pool.query(
      'SELECT first_name, last_name, profile_picture FROM Users WHERE user_id = $1',
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // ✅ Return only first_name, last_name, and profile_picture
    res.status(200).json({
      first_name: user.first_name,
      last_name: user.last_name,
      profile_picture: user.profile_picture
    });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Start the server and listen on a specified port
const port = process.env.PORT || 5000; // Use environment variable or default to 5000
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is running on port ${port}`);
});
