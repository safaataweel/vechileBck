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


// const express = require('express');
// const router = express.Router();
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// require('dotenv').config();

// const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyBg2MfMBxR1xSk254t_gxVLXT0lxAgfIxA";

// const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// // دالة بتحكي مع موديل جيمناي
// async function getGeminiReply(userInput) {
//   const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
//   const prompt = `Please reply shortly, in a simple way, and in Gen Z style to this: "${userInput}"`;

//   const result = await model.generateContent({
//     prompt: {
//       text: prompt
//     }
//   });
//   const response = await result.response;
//   return response.text();
// }

// // POST /chat
// router.post('/chat', async (req, res) => {
//   try {
//     const userInput = req.body.message;
//     if (!userInput) {
//       return res.status(400).json({ response: "No message provided." });
//     }
//     console.log("User Input:", userInput);
//     const reply = await getGeminiReply(userInput);
//     console.log("Gemini Reply:", reply);
//     return res.json({ response: reply });
//   } catch (error) {
//     console.error("Gemini error:", error);
//     return res.status(500).json({ response: "Something went wrong with Gemini 😢" });
//   }
// });

// module.exports = router;

