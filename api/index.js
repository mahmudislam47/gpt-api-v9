const express = require('express');
const { randomBytes, randomUUID } = require('crypto');
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json());

const api_url = 'https://www.blackbox.ai/api/chat';
const headers = {
  'User-Agent':
    'Mozilla/5.0 (Linux; U; Android 4.3; en-us; SGH-T999 Build/JSS15J) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://www.blackbox.ai',
  'Content-Type': 'application/json',
  Origin: 'https://www.blackbox.ai',
  DNT: '1',
  'Sec-GPC': '1',
  'Alt-Used': 'www.blackbox.ai',
  Connection: 'keep-alive',
};

const token_hex = (nbytes) => randomBytes(nbytes).toString('hex');
const uuid4 = () => randomUUID();

const trendingAgentModeConfig = {
  blackbox: {},
  'llama-3.1-405b': { mode: true, id: 'llama-3.1-405b' },
  'llama-3.1-70b': { mode: true, id: 'llama-3.1-70b' },
  'gemini-1.5-flash': { mode: true, id: 'Gemini' },
};

const userSelectedModelConfig = {
  'gpt-4o': 'gpt-4o',
  'claude-3.5-sonnet': 'claude-sonnet-3.5',
  'gemini-pro': 'gemini-pro',
};

const paramOverrides = {
  'gpt-4o': { maxTokens: 4096 },
  'claude-3.5-sonnet': { maxTokens: 8192 },
  'gemini-pro': { maxTokens: 8192 },
};

const messages_to_json = (chat) => {
  return chat.map((msg) => {
    const clonedMsg = structuredClone(msg);
    delete clonedMsg.files;
    return clonedMsg;
  });
};

const generateResponse = async function* (chat, options, { max_retries = 5 }) {
  const fetch = (await import('node-fetch')).default; // Dynamic import of node-fetch
  let random_id = token_hex(16);
  let random_user_id = uuid4();
  chat = messages_to_json(chat);

  let data = {
    messages: chat,
    id: random_id,
    userId: random_user_id,
    previewToken: null,
    codeModelMode: true,
    agentMode: {},
    trendingAgentMode: trendingAgentModeConfig[options.model] || {},
    userSelectedModel: userSelectedModelConfig[options.model] || undefined,
    isMicMode: false,
    isChromeExt: false,
    githubToken: null,
    webSearchMode: true,
    userSystemPrompt: null,
    mobileClient: false,
    maxTokens: 100000,
    playgroundTemperature: parseFloat(options.temperature) ?? 0.7,
    playgroundTopP: 0.9,
    ...paramOverrides[options.model],
  };

  try {
    const response = await fetch(api_url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`status: ${response.status}, error: ${await response.text()}`);
    }

    const reader = response.body;
    let search_results = false;
    let text = '';
    for await (let chunk of reader) {
      chunk = chunk.toString();
      
      
      if (chunk) {
        // Clean up the chunk to remove unwanted tokens
        chunk = chunk.replace(/\$@\$.+?\$@\$/g, ''); // Remove any $@$...$@$ patterns
      
        if (!search_results && chunk.includes('$~~~$')) {
          search_results = true;
        }
        text += chunk; // Accumulate the cleaned chunks
        yield chunk; // Yield the cleaned chunk
      }
    }

    if (search_results) {
      data.mode = 'continue';
      data.messages.push({ content: text, role: 'assistant' });

      yield ' ';

      const response = await fetch(api_url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(data),
      });

      const reader = response.body;
      for await (let chunk of reader) {
        chunk = chunk.toString();
        if (chunk) {
          yield chunk;
        }
      }
    }
  } catch (e) {
    if (max_retries > 0) {
      console.log(e, 'Retrying...');
      yield* generateResponse(chat, options, { max_retries: max_retries - 1 });
    } else {
      throw e;
    }
  }
};

// Root endpoint
app.get("/", (req, res) => res.send("Server is running..."));
app.post('/generate', async (req, res) => {
  const { chat, options } = req.body;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  try {
    for await (const chunk of generateResponse(chat, options, { max_retries: 5 })) {
      res.write(chunk); // Send each chunk to the client in real-time
    }
    res.end(); // End the response
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// Export the app for Vercel serverless functions
module.exports = app;