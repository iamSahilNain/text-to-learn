async function generateCourse(topic) {
  // MOCK RESPONSE - replace with real Gemini call after quota resets
  return {
    title: `Complete Course on ${topic}`,
    description: `A comprehensive guide to learning ${topic} from beginner to advanced.`,
    tags: [topic, 'learning', 'education'],
    modules: [
      {
        title: 'Getting Started',
        lessons: ['Introduction', 'Setting Up Your Environment', 'Core Concepts']
      },
      {
        title: 'Fundamentals',
        lessons: ['Basic Principles', 'Key Techniques', 'Common Patterns']
      },
      {
        title: 'Advanced Topics',
        lessons: ['Advanced Concepts', 'Best Practices', 'Real World Applications']
      }
    ]
  };
}
async function generateLesson(courseTitle, moduleTitle, lessonTitle) {
  return {
    title: lessonTitle,
    objectives: [
      `Understand the core concepts of ${lessonTitle}`,
      `Apply ${lessonTitle} in real scenarios`,
      `Identify common patterns and best practices`
    ],
    content: [
      { type: 'heading', text: `Introduction to ${lessonTitle}` },
      { type: 'paragraph', text: `In this lesson, we will explore ${lessonTitle} as part of ${moduleTitle} in the ${courseTitle} course. This is a foundational concept that will help you build a strong understanding of the subject.` },
      { type: 'heading', text: 'Key Concepts' },
      { type: 'paragraph', text: `The main ideas behind ${lessonTitle} revolve around understanding how the pieces fit together. Let's break this down step by step.` },
      { type: 'code', language: 'javascript', text: `// Example code for ${lessonTitle}\nconsole.log('Learning ${lessonTitle}');` },
      { type: 'heading', text: 'Practice Questions' },
      {
        type: 'mcq',
        question: `What is the primary purpose of ${lessonTitle}?`,
        options: [
          'To simplify complex operations',
          'To improve code readability',
          'To enhance performance',
          'All of the above'
        ],
        answer: 3,
        explanation: 'All of these are valid purposes depending on the context.'
      }
    ]
  };
}
module.exports = { generateCourse, generateLesson };