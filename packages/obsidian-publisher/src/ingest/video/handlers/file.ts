export const fileVideoHandler = {
  name: "file",
} as const;

export async function resolveFileVideoSource(sourcePath: string): Promise<{
  adapter: "file";
  sourceUrl: string;
  mediaPath: string;
}> {
  return {
    adapter: "file",
    sourceUrl: sourcePath,
    mediaPath: sourcePath,
  };
}
