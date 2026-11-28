// A stand-in for the Anthropic Messages API during the browser tests: it reads a meal as two foods and makes
// the coach suggest a slower cut. Started by playwright.config.ts next to the app.
import http from 'node:http';

const port = Number(process.env.FAKE_AI_PORT ?? 18091);

http
  .createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(200).end('fake ai');
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const sent = JSON.parse(body);
      const dutch = /in Dutch/.test(sent.system);
      const text = /You read meals/.test(sent.system)
        ? JSON.stringify({
            items: [
              { name: dutch ? 'testbrood' : 'test bread', grams: 70, estimate: { kcal: 170, protein: 7, carbs: 28, fat: 2 } },
              { name: dutch ? 'drakenvrucht' : 'dragon fruit', grams: 150, estimate: { kcal: 90, protein: 2, carbs: 20, fat: 0 } },
            ],
          })
        : `${dutch ? 'Je doet het goed; rustiger afvallen houdt je training sterk.' : 'You are doing well; a slower cut keeps your training strong.'}\nSUGGESTION {"phase":"cut","ratePctPerWeek":0.25}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_e2e',
          type: 'message',
          role: 'assistant',
          model: sent.model,
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1000, output_tokens: 200 },
        }),
      );
    });
  })
  .listen(port, '127.0.0.1');
