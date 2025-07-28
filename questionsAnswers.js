const express = require('express');
const router = express.Router();
const chatbotData = [

  // 1. Bot Greets (type: "greeting")
  {
    type: "greeting",
    keywords: ["advice"],
    answer: "Advice? Sure thing! 🛠️ What car conundrum are you facing?"
  },
  {
    type: "greeting",
    keywords: ["assistance"],
    answer: "Assistance? I'm all ears! 👂 What do you need help with?"
  },
  {
    type: "greeting",
    keywords: ["good afternoon"],
    answer: "Good afternoon! ☀️ How's your day going? Need any car advice?"
  },
  {
    type: "greeting",
    keywords: ["good evening"],
    answer: "Good evening! 🌆 Ready to tackle any car troubles before the night rolls in?"
  },
  {
    type: "greeting",
    keywords: ["good morning"],
    answer: "Good morning! 🌞 Hope your car is feeling as fresh as you are. Need any help?"
  },
  {
    type: "greeting",
    keywords: ["hello"],
    answer: "Hey there! 🚗💨 How can I assist you and your ride today?"
  },
  {
    type: "greeting",
    keywords: ["help"],
    answer: "Need help? 🚗💡 I'm here for you! What’s on your mind?"
  },
  {
    type: "greeting",
    keywords: ["hi"],
    answer: "Hi hi! 👋 Ready to fix up that car? Let's roll!"
  },
  {
    type: "greeting",
    keywords: ["question"],
    answer: "Got a question? 🤔 I'm here to help! What’s up?"
  },
  {
    type: "greeting",
    keywords: ["query"],
    answer: "Query? Let’s tackle it together! 💪 What do you need to know?"
  },
  {
    type: "greeting",
    keywords: ["support"],
    answer: "Support? You got it! 🤝 What can I do for you today?"
  },

  // 2. User Describes Problem (type: "problem")
  {
    type: "problem",
    keywords: ["battery issue"],
    answer: "Battery issue? 🔋⚡ Might need a jumpstart or a new battery. Let's get it checked!"
  },
  {
    type: "problem",
    keywords: ["problem"],
    answer: "Can you tell me more about the issue? 🔍 I’m here to help!"
  },
  {
    type: "problem",
    keywords: ["issue"],
    answer: "Got an issue? I’m on it. Tell me more 🛠️"
  },
  {
    type: "problem",
    keywords: ["battery light 🔋"],
    answer: "Battery light on? 🔋 Maybe the battery’s low or your alternator needs some love."
  },
  {
    type: "problem",
    keywords: ["brake problem"],
    answer: "Brake problem? 🚗🛑 Better check those brakes ASAP! Safety first!"
  },
  {
    type: "problem",
    keywords: ["brake warning light"],
    answer: "Brake warning? 🛑 Not something to ignore. Check brake fluid or visit a workshop fast!"
  },
  {
    type: "problem",
    keywords: ["car pulling one side"],
    answer: "Your car pulling to one side? 🛞 Might need a tire alignment or check your brakes!"
  },
  {
    type: "problem",
    keywords: ["check engine light"],
    answer: "Check engine light? 🚨 Time to get that checked out. It could be anything from a loose gas cap to a serious issue."
  },
  {
    type: "problem",
    keywords: ["engine light"],
    answer: "Engine light on? 🚨 Time for a diagnostic check! It could be a simple fix or something serious."
  },
  {
    type: "problem",
    keywords: ["engine light 🚨"],
    answer: "Hmm, engine light on? 🚨 That's serious. Please get a diagnostic check ASAP!"
  },
  {
    type: "problem",
    keywords: ["oil change"],
    answer: "Oil change time? 🛢️ Usually every 5,000-7,500 miles. Check your manual for specifics!"
  },
  {
    type: "problem",
    keywords: ["overheating"],
    answer: "Yikes, overheating! 🥵 Pull over safely, turn off the engine, and check coolant levels."
  },
  {
    type: "problem",
    keywords: ["smoke"],
    answer: "Seeing smoke? 🚬😳 STOP the car immediately and call for help! Could be overheating or oil leak."
  },
  {
    type: "problem",
    keywords: ["tire pressure ⚠️"],
    answer: "Tire pressure warning? 🚘🛞 Probably time to pump some air. Check your tires soon!"
  },
  {
    type: "problem",
    keywords: ["vibration"],
    answer: "Feeling vibrations? 🌀 Might be wheel alignment, tires, or suspension issues."
  },
  {
    type: "problem",
    keywords: ["weird noise"],
    answer: "Hearing strange sounds? 👂 It could be anything from brakes to engine. Best to get it checked."
  },

  // 3. Bot Offers Next Steps (type: "next_steps")
  {
    type: "next_steps",
    keywords: ["battery issue"],
    answer: "You might just need a jumpstart! 🔋⚡ Want instructions or a workshop recommendation?"
  },
  {
    type: "next_steps",
    keywords: ["brake problem"],
    answer: "Safety first! 👮‍♂️ I recommend heading to a brake specialist. Want me to suggest one?"
  },
  {
    type: "next_steps",
    keywords: ["engine light"],
    answer: "Would you like to:\n1. Try a DIY reset\n2. Find a workshop nearby?\nReply with 1 or 2! 🚗"
  },

  // 4. Maintenance Questions / FAQs (type: "faq")
  {
    type: "faq",
    question: "How do I know if my battery is dying?",
    answer: "If your car struggles to start or the lights dim, it might be battery time! 🔋⚡"
  },
  {
    type: "faq",
    question: "How do I know if my brakes need replacing?",
    answer: "Squeaking or grinding noises? 🚨 That's a sign! Also, if your brake pedal feels soft or spongy."
  },
  {
    type: "faq",
    question: "How do I know if my car needs a new battery?",
    answer: "If your car struggles to start or the lights dim, it might be battery time! 🔋⚡"
  },
  {
    type: "faq",
    question: "How do I know if my car needs a tune-up?",
    answer: "If your car's performance drops, check engine light is on, or fuel efficiency decreases, it might be time! 🔧"
  },
  {
    type: "faq",
    question: "How do I know if my coolant is low?",
    answer: "Check the coolant reservoir. If it's below the 'full' line, top it up! 🥵💧"
  },
  {
    type: "faq",
    question: "How do I know if my tires are worn out?",
    answer: "Check the tread depth! If it's less than 2/32 of an inch, it's time for new tires. 🛞🔍"
  },
  {
    type: "faq",
    question: "How do I know if my car needs new spark plugs?",
    answer: "If your car misfires, has poor acceleration, or low fuel efficiency, it might be spark plug time! 🔌"
  },
  {
    type: "faq",
    question: "How often should I change my oil?",
    answer: "Most cars need oil changes every 5,000 to 7,500 miles. 🛢️ Check your manual to be sure!"
  },
  {
    type: "faq",
    question: "How often should I check my battery terminals?",
    answer: "Check battery terminals every 6 months for corrosion. Clean them if needed! 🔋🧼"
  },
  {
    type: "faq",
    question: "How often should I check my belts and hoses?",
    answer: "Check belts and hoses every 30,000 miles or during oil changes. 🛠️ Preventative maintenance is key!"
  },
  {
    type: "faq",
    question: "How often should I check my fluid levels?",
    answer: "Check your fluids every month or before long trips. 🛣️ Keep that engine happy!"
  },
  {
    type: "faq",
    question: "How often should I check my tire pressure?",
    answer: "Check your tire pressure at least once a month and before long trips. 🛣️🛞"
  },
  {
    type: "faq",
    question: "How often should I check my transmission fluid?",
    answer: "Check transmission fluid every 30,000..."
  },
  {
    type: "faq",
    question: "How often should I check my wiper blades?",
    answer: "Check your wiper blades every 6-12 months. If they leave streaks, it's time for new ones! 🌧️"
  },
  {
    type: "faq",
    question: "How often should I replace my air filter?",
    answer: "Air filters usually need replacing every 15,000 to 30,000 miles. 🛠️ Check your manual for specifics!"
  },
  {
    type: "faq",
    question: "How often to replace brake pads?",
    answer: "Brake pads usually last around 30,000-70,000 miles. Depends on your driving habits! 🚗💨"
  },
  {
    type: "faq",
    question: "How to know if I need new tires?",
    answer: "If the tread depth is below 2/32 of an inch or you see cracks, it's tire-shopping time! 🛒🛞"
  },
  {
    type: "faq",
    question: "When should I rotate my tires?",
    answer: "Tire rotation? Every 6,000 to 8,000 miles is the sweet spot for longer tire life. 🛞✨"
  },
  {
    type: "faq",
    question: "Why does my AC smell bad?",
    answer: "Bad AC smells can mean mold inside your vents. A simple cleaning or cabin filter change can fix it! ❄️🌬️"
  }
];

module.exports = chatbotData;
