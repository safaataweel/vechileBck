CREATE DATABASE VehilceMaintenance;


CREATE TABLE Users (
    user_id SERIAL PRIMARY KEY,  -- SERIAL automatically handles auto-increment
    profile_picture VARCHAR(255),
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email_address VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Customer', 'Admin', 'Mechanic')),  -- ENUM equivalent
    phone_number VARCHAR(15) UNIQUE
);

CREATE TABLE Customers (
    customer_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    loyalty_points INT DEFAULT 0,
    cancel_count INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

CREATE TABLE Admins (
    admin_id SERIAL PRIMARY KEY,
    user_id INT UNIQUE NOT NULL,
    permission_level INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

CREATE TABLE Workshops (
    workshop_id SERIAL PRIMARY KEY,
    workshop_name VARCHAR(100) NOT NULL,
    image VARCHAR(255),
    rate DOUBLE PRECISION NOT NULL,  
    capacity INT NOT NULL,
    working_day_hours VARCHAR(50),
    emergency_service BOOLEAN DEFAULT FALSE,
    mobile_assistance BOOLEAN DEFAULT FALSE,
    current_occupancy INT DEFAULT 0,
    address_id INT NOT NULL,
    approval_status VARCHAR(20) DEFAULT 'Pending',
    FOREIGN KEY (address_id) REFERENCES Address(address_id)
);



CREATE TABLE Address (
    address_id SERIAL PRIMARY KEY,
    street VARCHAR(255) NOT NULL,
    city VARCHAR(50) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    user_id INT UNIQUE,  -- Ensures only one address per user
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE  -- Cascade delete if user is deleted
);

CREATE TABLE Booking (
    booking_id  SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    service_id INT NOT NULL,
    status_id INT NOT NULL,
    booking_date DATE NOT NULL,
    scheduled_date DATE NOT NULL,
    completion_date DATE,
    booking_status VARCHAR(50) CHECK (booking_status IN ('pending', 'accepted', 'rejected'))
    schedule_id INT,
    payment_id INT,
    address_id INT,  -- Reference to a saved address (could be null if using a temporary address)
    temporary_street VARCHAR(255),  -- New street address for temporary use
    temporary_city VARCHAR(50),     -- New city for temporary use
    temporary_latitude DOUBLE PRECISION,     -- Latitude for temporary use
    temporary_longitude DOUBLE PRECISION,    -- Longitude for temporary use
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (address_id) REFERENCES Address(address_id),  -- The selected saved address (if any)
    FOREIGN KEY (service_id) REFERENCES Service(service_id),  -- Assuming Services table exists
    FOREIGN KEY (status_id) REFERENCES ServiceStatus(status_id)  -- Assuming Status table exists
);
CREATE TABLE ServiceStatus (
    status_id SERIAL PRIMARY KEY,
    status_name VARCHAR(50) NOT NULL,  -- e.g., "Not Started", "In Progress", "Completed"
    booking_id INT NOT NULL,
    updated_at DATE NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
);

CREATE TABLE Schedule (
    schedule_id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    time_slot TIME NOT NULL,
    status VARCHAR(50) NOT NULL,  -- e.g., "available", "unavilable", "booked"
    max_capacity INT NOT NULL,
    mobile_assistance_only BOOLEAN DEFAULT FALSE
);



CREATE TABLE Service (
    service_id SERIAL PRIMARY KEY,
    service_name VARCHAR(100) NOT NULL,
    service_description TEXT,
    category_id INT NOT NULL,
    price INT NOT NULL,
    workshop_id INT,  -- Linking service to a specific workshop
    FOREIGN KEY (category_id) REFERENCES ServiceCategories(category_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id)  -- Each service belongs to a workshop
);
CREATE TABLE ServiceCategories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL
);
CREATE TABLE SubCategories (
    subcategory_id SERIAL PRIMARY KEY,
    subcategory_name VARCHAR(100) NOT NULL,
    category_id INT REFERENCES ServiceCategories(category_id)
);

CREATE TABLE Payment (
    payment_id SERIAL PRIMARY KEY,
    booking_id INT NOT NULL,
    income_value INT NOT NULL,
    percent_to_admin DOUBLE PRECISION NOT NULL,
    percent_to_workshop DOUBLE PRECISION NOT NULL,
    date DATE NOT NULL,
    type VARCHAR(50) NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
);
CREATE TABLE Review (
    review_id SERIAL PRIMARY KEY,
    target VARCHAR(50) NOT NULL,  -- Target can be 'Workshop' or 'app'
    target_id INT NOT NULL,
    rating DOUBLE PRECISION NOT NULL,
    comment TEXT,
    review_date DATE NOT NULL
);

CREATE TABLE OfferType (
    offer_type_id SERIAL PRIMARY KEY,
    description TEXT,
    service_category_id INT,  -- Linking OfferType to ServiceCategory
    duration INT,
    discount_percentage DOUBLE PRECISION,
    FOREIGN KEY (service_category_id) REFERENCES ServiceCategories(category_id) 
);
CREATE TABLE Offer (
    offer_id SERIAL PRIMARY KEY,
    offer_type_id INT NOT NULL,
    target_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_price DOUBLE PRECISION NOT NULL,
    FOREIGN KEY (offer_type_id) REFERENCES OfferType(offer_type_id)
);

CREATE TABLE Vehicle (
    vehicle_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    reference_id INT NOT NULL,
    isDefault BOOLEAN DEFAULT FALSE,
    registration_date DATE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (reference_id) REFERENCES ReferenceVehicle(reference_id)
); 
CREATE TABLE Garage (
    garage_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id),
    FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id),
    CONSTRAINT UNIQUE (user_id, vehicle_id)  -- Ensuring uniqueness of each vehicle for a user
);
CREATE TABLE MaintenanceLog (
    log_id SERIAL PRIMARY KEY,
    vehicle_id INT NOT NULL,
    date DATE NOT NULL,
    notes TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES Vehicle(vehicle_id)
);
CREATE TABLE Notification (
    notification_id SERIAL PRIMARY KEY,
    sender_user_id INT NOT NULL,
    receiver_user_id INT NOT NULL,
    message TEXT NOT NULL,
    date DATE NOT NULL,
    notification_type VARCHAR(50),  -- Added type for categorizing notifications
    FOREIGN KEY (sender_user_id) REFERENCES Users(user_id),
    FOREIGN KEY (receiver_user_id) REFERENCES Users(user_id)
);


-- CREATE TABLE EmergencyService (
--     emergency_service_id INT PRIMARY KEY AUTO_INCREMENT,
--     service_id INT NOT NULL,  -- Foreign key to the Service table
--     priority_level INT NOT NULL,  -- Priority level of the emergency service
--     availability VARCHAR(50),  -- Availability information like "24/7", "Weekdays Only"
--     additional_cost DOUBLE NOT NULL,  -- Extra cost for emergency service
--     FOREIGN KEY (service_id) REFERENCES Service(service_id)
-- );



CREATE TABLE ReferenceVehicle ( --redy for the customer to select from
    reference_id SERIAL PRIMARY KEY,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    transmission VARCHAR(50),
    engine_size DOUBLE PRECISION NOT NULL,
    fuel_type VARCHAR(50)
    ALTER TABLE Review ADD COLUMN user_id INT REFERENCES Users(user_id);

);
CREATE TABLE Certifications (
    certification_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    issuing_authority VARCHAR(100),
    valid_until DATE
);

CREATE TABLE WorkshopCertifications (
    workshop_id INT,
    certification_id INT,
    PRIMARY KEY (workshop_id, certification_id),
    FOREIGN KEY (workshop_id) REFERENCES Workshops(workshop_id),
    FOREIGN KEY (certification_id) REFERENCES Certifications(certification_id)
);



INSERT INTO servicecategories (category_name) VALUES ('Car Care');
INSERT INTO servicecategories (category_name) VALUES ('Car Maintenance');
INSERT INTO servicecategories (category_name) VALUES ('Car Accessories');
INSERT INTO servicecategories (category_name) VALUES ('Tires & Wheels');
INSERT INTO servicecategories (category_name) VALUES ('Tools & Equipment');
INSERT INTO servicecategories (category_name) VALUES ('Performance Parts');
INSERT INTO servicecategories (category_name) VALUES ('Exterior Accessories');
INSERT INTO servicecategories (category_name) VALUES ('Lighting');
INSERT INTO servicecategories (category_name) VALUES ('Engine Parts');
INSERT INTO servicecategories (category_name) VALUES ('Interior Accessories');
INSERT INTO servicecategories (category_name) VALUES ('Body Parts');
INSERT INTO servicecategories (category_name) VALUES ('Replacement Parts');

-- Inserting subcategories for "Car Care"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Waxes & Polishes', 1);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Interior Cleaners', 1);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Exterior Cleaners', 1);

-- Inserting subcategories for "Car Maintenance"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Oil & Fluids', 2);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Filters', 2);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Battery', 2);

-- Inserting subcategories for "Car Accessories"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Electronics', 3);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Seat Covers', 3);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Car Organizers', 3);

-- Inserting subcategories for "Tires & Wheels"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('All-Season Tires', 4);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Winter Tires', 4);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Rims', 4);

-- Inserting subcategories for "Tools & Equipment"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Hand Tools', 5);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Power Tools', 5);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Diagnostic Equipment', 5);

-- Inserting subcategories for "Performance Parts"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Exhaust Systems', 6);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Suspension', 6);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Brakes', 6);

-- Inserting subcategories for "Exterior Accessories"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Car Covers', 7);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Roof Racks', 7);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Wind Deflectors', 7);

-- Inserting subcategories for "Lighting"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Headlights', 8);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Taillights', 8);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('LED Bulbs', 8);

-- Inserting subcategories for "Engine Parts"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Air Intakes', 9);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Engine Mounts', 9);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Cylinder Heads', 9);

-- Inserting subcategories for "Interior Accessories"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Floor Mats', 10);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Steering Wheel Covers', 10);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Dashboard Covers', 10);

-- Inserting subcategories for "Body Parts"
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Bumpers', 11);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Fenders', 11);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Hoods', 11);


-- Inserting subcategories for "Replacement Parts"  
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Mirrors', 12);
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Windows', 12);   
INSERT INTO subcategories (subcategory_name, category_id) VALUES ('Windshield Wipers', 12);

-- Inserting services for "Car Care"
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Car Wash', 'Exterior and interior cleaning', 1, 5);

-- Inserting services for "Car Maintenance"
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Oil Change', 'Engine oil replacement', 2, 2);   
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Battery Replacement', 'Car battery replacement', 2, 3); 

-- Inserting services for "Car Accessories"
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Car Charger', 'Mobile phone charger for car', 3, 3);
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Car Organizer', 'Organizer for car accessories', 3, 4);  

-- Inserting services for "Tires & Wheels"
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Tire Rotation', 'Rotating tires for even wear', 4, 5);
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Wheel Alignment', 'Aligning wheels for proper handling', 4, 2);

-- Inserting services for "Tools & Equipment"
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Socket Set', 'Set of sockets for car repairs', 5, 5);
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Diagnostic Tool', 'Tool for diagnosing car issues', 5, 5);

-- Inserting services for "Performance Parts"   
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Performance Exhaust', 'Upgraded exhaust system', 6, 3);
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Performance Brakes', 'Upgraded brake system', 6, 4);

INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Suspension Upgrade', 'Upgraded suspension system', 6, 5);
INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Cold Air Intake', 'Upgraded air intake system', 6, 5);

INSERT INTO service (service_name, service_description, category_id, price) VALUES ('Brake Pads Replacement', 'Replacing brake pads', 6, 5);
