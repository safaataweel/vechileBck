const { Client } = require('pg');
const fs = require('fs');

// PostgreSQL connection configuration
const client = new Client({
    user: 'postgres',
    host: 'localhost',
    database: 'vehilcemaintenance',
    password: '1234',
    port: 5432,
});

// Function to read and extract the `categories` data from the file
function extractCategoriesFromFile(filePath) {
    try {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log('File content:', fileContent); // Log the file content

        // Use a regex to extract the `categories` dictionary
        const categoriesMatch = fileContent.match(/categories\s*=\s*({[\s\S]*?})\s*\n/);
        if (!categoriesMatch) {
            throw new Error('Could not find the `categories` dictionary in the file.');
        }

        // Convert the extracted string to valid JSON
        const categoriesString = categoriesMatch[1]
            .replace(/'/g, '"') // Replace single quotes with double quotes
            .replace(/True/g, 'true') // Replace Python `True` with JavaScript `true`
            .replace(/False/g, 'false') // Replace Python `False` with JavaScript `false`
            .replace(/(\w+):/g, '"$1":') // Wrap keys in double quotes
            .replace(/,(\s*})/g, '$1'); // Remove trailing commas

        // Parse the JSON string
        const categories = JSON.parse(categoriesString);
        console.log('Extracted categories:', categories); // Log the extracted data
        return categories;
    } catch (error) {
        console.error('Error reading or parsing file:', error);
        return null;
    }
}

// Function to insert categories and subcategories into the database
async function insertData() {
    const filePath = 'C:/Users/Lenovo/Downloads/apiService.txt'; // Replace with the path to your file
    const categories = extractCategoriesFromFile(filePath);
    if (!categories) return;

    try {
        // Connect to the database
        await client.connect();
        console.log('Connected to PostgreSQL database');

        // Insert categories and subcategories
        for (const [categoryName, categoryData] of Object.entries(categories)) {
            // Insert category
            const categoryRes = await client.query(
                'INSERT INTO ServiceCategories (category_name) VALUES ($1) RETURNING category_id',
                [categoryName]
            );
            const categoryId = categoryRes.rows[0].category_id;

            // Insert subcategories
            for (const subcategoryName of categoryData.subcategories) {
                await client.query(
                    'INSERT INTO SubCategories (subcategory_name, category_id) VALUES ($1, $2)',
                    [subcategoryName, categoryId]
                );
            }
        }
        console.log('Data inserted successfully');
    } catch (error) {
        console.error('Error inserting data:', error);
    } finally {
        // Close the database connection
        await client.end();
        console.log('Database connection closed');
    }
}

// Run the script
insertData();