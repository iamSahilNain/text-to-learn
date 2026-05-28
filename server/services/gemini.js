const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

async function generateCourse(topic) {
  const prompt = `
You are a curriculum designer. Generate a structured online course for the topic: "${topic}".

Return ONLY a valid JSON object with no markdown, no backticks, no explanation. Just raw JSON.

{
  "title": "Course title",
  "description": "Course description",
  "tags": ["tag1", "tag2"],
  "modules": [
    {
      "title": "Module title",
      "lessons": ["Lesson 1 title", "Lesson 2 title", "Lesson 3 title"]
    }
  ]
}

Rules:
- 3 to 5 modules
- 3 to 4 lessons per module
- Progress from beginner to advanced
- Be specific and educational
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

module.exports = { generateCourse };