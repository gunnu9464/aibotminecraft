const { GoogleGenerativeAI } = require('@google/generative-ai');

class GeminiAI {
  constructor(apiKey) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
  }

  async ask(prompt) {
    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }
}

module.exports = { GeminiAI };
