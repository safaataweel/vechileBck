const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // PostgreSQL client
require('dotenv').config();
const chatbotData = require('./questionsAnswers');

function getChatbotResponse(input) {
  const normalizedInput = input.toLowerCase();
  const result = chatbotData.find(item =>
    item.keywords?.some(keyword => normalizedInput.includes(keyword.toLowerCase()))
  );
  return result ? result.answer : "Sorry, I didn’t get that. Can you rephrase?";
}

router.post('/chat', (req, res) => {
  const userInput = req.body.message;
  const response = getChatbotResponse(userInput);
  return res.json({ response });
});


module.exports = router;


