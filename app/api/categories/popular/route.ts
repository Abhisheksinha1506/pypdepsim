import { NextResponse } from "next/server";
import { loadPopularPackages } from "@/lib/cache";

export async function GET() {
  const list = loadPopularPackages();
  return NextResponse.json(
    { category: "popular", packages: list },
    { status: 200, headers: { "Cache-Control": "public, max-age=86400" } }
  );
}

