import fs from "fs";
import path from "path";

type IdMap = Record<string, number>;

let idMapCache: IdMap | null = null;
let metaCache: { totalPackages: number; bucketSize: number } | null = null;
const shardCache: Map<string, Array<{ id: number; dependents: number[] }>> = new Map();

// Helper function to get the project root directory reliably
function getProjectRoot(): string {
  const cwd = process.cwd();
  const dataPath = path.join(cwd, "data");
  if (fs.existsSync(dataPath)) {
    return cwd;
  }
  
  // Try resolving from common alternative locations
  try {
    const parentPath = path.resolve(cwd, "..", "data");
    if (fs.existsSync(parentPath)) {
      return path.resolve(cwd, "..");
    }
    const grandparentPath = path.resolve(cwd, "..", "..", "data");
    if (fs.existsSync(grandparentPath)) {
      return path.resolve(cwd, "..", "..");
    }
  } catch {
    // Continue if resolution fails
  }
  
  return cwd;
}

function dataDir(): string {
  const projectRoot = getProjectRoot();
  return path.join(projectRoot, "data");
}

export async function loadIdMap(): Promise<IdMap> {
  if (idMapCache) return idMapCache;
  const file = path.join(dataDir(), "pkg-id-map.json");
  if (!fs.existsSync(file)) return {};
  const raw = await fs.promises.readFile(file, "utf-8");
  idMapCache = JSON.parse(raw);
  return idMapCache as IdMap;
}

export async function loadMeta(): Promise<{ totalPackages: number; bucketSize: number }> {
  if (metaCache) return metaCache;
  const file = path.join(dataDir(), "meta.json");
  if (!fs.existsSync(file)) return { totalPackages: 0, bucketSize: 10000 };
  const raw = await fs.promises.readFile(file, "utf-8");
  metaCache = JSON.parse(raw);
  return metaCache as { totalPackages: number; bucketSize: number };
}

export async function getDependentsBitset(pkg: string): Promise<Uint32Array> {
  const map = await loadIdMap();
  const meta = await loadMeta();
  const id = map[pkg.toLowerCase()];
  if (typeof id !== "number") return new Uint32Array(0);
  const bucket = Math.floor(id / meta.bucketSize);
  const shardName = String(bucket).padStart(4, "0") + ".json";
  let shard = shardCache.get(shardName);
  if (!shard) {
    const file = path.join(dataDir(), "dependents", shardName);
    if (!fs.existsSync(file)) return new Uint32Array(0);
    const raw = await fs.promises.readFile(file, "utf-8");
    shard = JSON.parse(raw) as Array<{ id: number; dependents: number[] }>;
    shardCache.set(shardName, shard);
  }
  for (let i = 0; i < shard.length; i += 1) {
    const row = shard[i];
    if (row.id === id) {
      return Uint32Array.from(row.dependents);
    }
  }
  return new Uint32Array(0);
}


