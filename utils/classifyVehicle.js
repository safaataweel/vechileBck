// utils/classifyVehicle.js

function classifyVehicle(make, model, year) {
    const luxuryBrands = ['Mercedes', 'BMW', 'Audi', 'Lexus', 'Porsche'];
    const economyBrands = ['Kia', 'Hyundai', 'Chevrolet', 'Fiat'];
  
    if (luxuryBrands.includes(make)) return 'Luxury';
    if (economyBrands.includes(make)) return 'Economy';
    if (year >= 2020 && (make === 'Toyota' || make === 'Honda')) return 'Standard';
  
    return 'Standard'; // default if not matched
  }
  
  module.exports = classifyVehicle;
  