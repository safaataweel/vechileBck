const crypto = require('crypto');

const secretKey = crypto.randomBytes(64).toString('base64');
console.log(secretKey); // This will print your secret key. 
// This will print your secret key.
