import express from 'express';
import cors from 'cors';
import { getTrendingData, refreshTrending, startTrendingRefresh } from './trending.js';
import { SERVER_PORT } from './config.js';

const app = express();

app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:4173',
      /\.nostr\.wtf$/,
    ],
  }),
);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/trending', (_req, res) => {
  res.json(getTrendingData());
});

app.post('/api/trending/refresh', async (_req, res) => {
  await refreshTrending();
  res.json(getTrendingData());
});

app.listen(SERVER_PORT, () => {
  console.log(
    `[Server] Nostr WTF API running on http://localhost:${SERVER_PORT}`,
  );
  startTrendingRefresh();
});
