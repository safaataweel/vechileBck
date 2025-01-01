const express = require('express');
const app = express();
const cors = require('cors');
const { Pool } = require('pg'); // PostgreSQL client
const bcrypt = require('bcrypt'); // For password hashing
const jwt = require('jsonwebtoken');
require('dotenv').config(); // For .env configuration
const bodyParser = require('body-parser');
const axios = require('axios');
// Middleware
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
// PostgreSQL Pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

app.post('/signup', async (req, res) => {
    const { first_name, last_name, email_address, password, role, phone_number, workshop_details } = req.body;

    try {
        // Check if email already exists
        const emailCheck = await pool.query('SELECT * FROM Users WHERE email_address = $1', [email_address]);
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ message: 'Email already in use' });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert the user into the Users table
        const result = await pool.query(
            `INSERT INTO Users (first_name, last_name, email_address, password, role, phone_number)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [first_name, last_name, email_address, hashedPassword, role, phone_number]
        );

        const newUser = result.rows[0];

        // Optional: Generate a JWT token for authentication
        const token = jwt.sign({ user_id: newUser.user_id, role: newUser.role }, process.env.JWT_SECRET, {
            expiresIn: '1h',
        });

        // Handle different roles
        if (role === 'Mechanic') {
            const { workshop_name, image, rate, capacity, address } = workshop_details;

             const addressResult = await pool.query(
                `INSERT INTO Address (street, city, latitude, longitude) 
                 VALUES ($1, $2, $3, $4) RETURNING address_id`,
                [address.street, address.city, address.latitude, address.longitude]
            );
            const address_id = addressResult.rows[0].address_id;

            // Step 2: Insert the workshop details and mark as pending for admin approval
            const workshopResult = await pool.query(
                `INSERT INTO Workshops (workshop_name, image, rate, capacity, address_id, approval_status)
                 VALUES ($1, $2, $3, $4, $5, 'Pending') RETURNING *`,
                [workshop_name, image, rate, capacity, address_id]
            );

            const newWorkshop = workshopResult.rows[0];

            // Step 3: Associate the workshop with the user
            await pool.query(
                `UPDATE Users SET role = 'Mechanic' WHERE user_id = $1`,
                [newUser.user_id]
            );

            // Send response
            res.status(201).json({ message: 'Workshop request submitted successfully, awaiting approval', user: newUser, workshop: newWorkshop, token });

        } else if (role === 'Customer') {
            // If the role is Customer, insert into Customers table with default values
            const customerResult = await pool.query(
                `INSERT INTO Customers (user_id, loyalty_points, cancel_count)
                 VALUES ($1, 0, 0) RETURNING *`,
                [newUser.user_id]
            );

            const newCustomer = customerResult.rows[0];

            // Send response
            res.status(201).json({ message: 'Customer registered successfully', user: newUser, customer: newCustomer, token });

        } else if (role === 'Admin') {
            // If the role is Admin, insert into Admins table
            const adminResult = await pool.query(
                `INSERT INTO Admins (user_id, permission_level)
                 VALUES ($1, 1) RETURNING *`,
                [newUser.user_id]
            );

            const newAdmin = adminResult.rows[0];

            // Send response
            res.status(201).json({ message: 'Admin registered successfully', user: newUser, admin: newAdmin, token });

        } else {
            return res.status(400).json({ message: 'Invalid role' });
        }

    } catch (error) {
        console.error('Error during sign-up:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Admin approves the workshop
app.patch('/approve-workshop/:workshop_id', async (req, res) => {
    const { workshop_id } = req.params;
    const { approval_status } = req.body;

    try {
        // Ensure the approval status is 'Approved'
        if (approval_status !== 'Approved') {
            return res.status(400).json({ message: 'Invalid approval status' });
        }

        // Update the workshop approval status
        const result = await pool.query(
            `UPDATE Workshops SET approval_status = $1 WHERE workshop_id = $2 RETURNING *`,
            [approval_status, workshop_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Workshop not found' });
        }

        const updatedWorkshop = result.rows[0];

        // Send response
        res.status(200).json({
            message: 'Workshop approved successfully',
            workshop: updatedWorkshop,
        });

    } catch (error) {
        console.error('Error during approval:', error.message);
        res.status(500).json({ message: 'Server error' });
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

        // Generate a JWT token
        const token = jwt.sign({ user_id: user.user_id, role: user.role }, process.env.JWT_SECRET, {
            expiresIn: '1h',
        });

        // Return user role and the token
        res.status(200).json({
            message: 'Login successful',
            user_id: user.user_id,
            role: user.role,
            token: token,
        });
    } catch (error) {
        console.error('Error during login:', error.message);
        res.status(500).json({ message: 'Server error' });
    }
});

// Function to fetch car data from the API
async function fetchCarData(make, model, year, fuel_type, transmission) {
    const response = await axios.get('https://api.api-ninjas.com/v1/cars', {
        params: {
            make,
            model,
            year,
            fuel_type,
            transmission,
        },
        headers: {
            'X-Api-Key': 'FvCSvdaPtxwpW0JHYPoREA==pq9v7ZKZcF9ZaY6f', 
        },
    });
    console.log('API response:', response.data);

    return response.data;
}

// Function to insert car data into the database
async function insertCarData(car) {
    const { make, model, year, transmission, cylinders, fuel_type } = car;
    const query = `
        INSERT INTO referencevehicle (make, model, year, transmission, engine_size, fuel_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (make, model, year) DO NOTHING;
    `;
    await pool.query(query, [make, model, year, transmission, cylinders, fuel_type]);
}

// POST endpoint to fetch and store car data
app.post('/cars', async (req, res) => {
    const { make, model, year, fuel_type, transmission } = req.body;
    console.log('Inserting car:', { make, model, year, transmission, cylinders, fuel_type });

    try {
        const cars = await fetchCarData(make, model, year, fuel_type, transmission);
        for (const car of cars) {
            await insertCarData(car);
        }
        res.status(200).json({ message: 'Car data stored successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while fetching or storing car data' });
    }
});

// GET endpoint to fetch car data
app.get('/cars', async (req, res) => {
    const { make, model, year, fuel_type, transmission } = req.query;

    try {
        const cars = await fetchCarData(make, model, year, fuel_type, transmission);
        res.status(200).json(cars);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'An error occurred while fetching car data' });
    }
});

const makesAndModels = [
    { make: "Volkswagen", models: ["Polo", "Passat", "Golf", "R-line", "GTI", "TCI", "Jetta"] },
    { make: "Hyundai", models: ["Tucson", "Accent", "Santa Fe"] },
    { make: "Skoda", models: ["Octavia", "Superb", "Fabia"] },
    { make: "Kia", models: ["Sportage", "Sorento", "Morning"] },
    { make: "Seat", models: ["Leon", "Ibiza", "Ateca", "Arona", "FR", "Cupra"] },
    { make: "Mercedes-Benz", models: ["Class E", "Class C"] },
    { make: "BMW", models: ["Series 5", "Series 3", "X5"] },
    { make: "Peugeot", models: ["Partner", "Rifter", "301"] },
    { make: "Opel", models: ["Corsa", "Astra"] },
    { make: "Ford", models: ["Focus", "Fiesta"] },
    { make: "Citroen", models: ["Berlingo", "C4", "C1"] },
    { make: "Fiat", models: ["Doblo", "Panda", "Punto"] },
    { make: "Toyota", models: ["Corolla", "Land Cruiser", "RAV4", "Avensis", "CHR", "Auris"] },
];



// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
