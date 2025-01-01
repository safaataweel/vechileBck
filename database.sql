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
    rate DOUBLE PRECISION NOT NULL,  -- Corrected data type
    capacity INT NOT NULL,
    working_day_hours VARCHAR(50),
    emergency_service BOOLEAN DEFAULT FALSE,
    mobile_assistance BOOLEAN DEFAULT FALSE,
    current_occupancy INT DEFAULT 0,
    address_id INT NOT NULL,
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
    booking_status VARCHAR(50) NOT NULL,
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

CREATE TABLE ReferenceVehicle (
    reference_id SERIAL PRIMARY KEY,
    make VARCHAR(50) NOT NULL,
    model VARCHAR(50) NOT NULL,
    year INT NOT NULL,
    transmission VARCHAR(50),
    engine_size DOUBLE PRECISION NOT NULL,
    fuel_type VARCHAR(50)
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
CREATE TABLE OfferType (
    offer_type_id SERIAL PRIMARY KEY,
    description TEXT,
    service_category_id INT,  -- Linking OfferType to ServiceCategory
    duration INT,
    discount_percentage DOUBLE PRECISION,
    FOREIGN KEY (service_category_id) REFERENCES ServiceCategories(category_id)  -- Enabling offers to apply to categories
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
CREATE TABLE ServiceCategories (
    category_id SERIAL PRIMARY KEY,
    category_name VARCHAR(50) NOT NULL
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
-- CREATE TABLE EmergencyService (
--     emergency_service_id INT PRIMARY KEY AUTO_INCREMENT,
--     service_id INT NOT NULL,  -- Foreign key to the Service table
--     priority_level INT NOT NULL,  -- Priority level of the emergency service
--     availability VARCHAR(50),  -- Availability information like "24/7", "Weekdays Only"
--     additional_cost DOUBLE NOT NULL,  -- Extra cost for emergency service
--     FOREIGN KEY (service_id) REFERENCES Service(service_id)
-- );
