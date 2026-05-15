import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "ID mancante" });

  try {
    const raw = await redis.get(`scheda:${id}`);
    if (!raw) return res.status(404).json({ error: "Scheda non trovata" });
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    return res.status(200).json(s);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
