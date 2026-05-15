import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const keys = await redis.lrange("schede_index", 0, 200);
    if (!keys || keys.length === 0) return res.status(200).json({ schede: [] });

    const schede = [];
    for (const key of keys) {
      const raw = await redis.get(key);
      if (raw) {
        const s = typeof raw === "string" ? JSON.parse(raw) : raw;
        schede.push({
          id: s.id,
          ragione_sociale: s.ragione_sociale,
          codice_fiscale: s.codice_fiscale,
          anno_imposta: s.anno_imposta,
          tipo_dichiarazione: s.tipo_dichiarazione,
          created_at: s.created_at
        });
      }
    }

    return res.status(200).json({ schede });
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
