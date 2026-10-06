export type AssetMetadata = {
  symbol?: string;
  name?: string;
};

export async function fetchAssetMetadata(ids: string[]): Promise<Record<string, AssetMetadata>> {
  if (ids.length === 0) return {};

  const assets: Record<string, AssetMetadata> = {};
  for (let offset = 0; offset < ids.length; offset += 200) {
    const response = await fetch("/api/solana/asset-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ids.slice(offset, offset + 200) }),
    });
    if (!response.ok) throw new Error("Asset metadata lookup failed");

    const body = await response.json();
    Object.assign(assets, body.assets ?? {});
  }
  return assets;
}