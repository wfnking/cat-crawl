import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { cwd } from "node:process";
import { join, normalize } from "node:path";

export type CaseStudyServeOptions = {
  port?: number;
  rootDir?: string;
};

export function resolveCaseStudyServeOptions(
  options?: CaseStudyServeOptions,
): Required<CaseStudyServeOptions> {
  return {
    port: options?.port || 4173,
    rootDir: options?.rootDir || cwd(),
  };
}

function resolveStaticFile(rootDir: string, requestPath: string): string {
  const caseStudiesRoot = join(rootDir, "case-studies");
  if (requestPath === "/" || requestPath === "") {
    return join(caseStudiesRoot, "viewer", "index.html");
  }

  const normalizedPath = normalize(requestPath.replace(/^\/+/, ""));
  return join(caseStudiesRoot, normalizedPath);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

export async function startCaseStudyServer(options?: CaseStudyServeOptions): Promise<void> {
  const resolved = resolveCaseStudyServeOptions(options);

  await new Promise<void>((resolve) => {
    const server = createServer((req, res) => {
      const filePath = resolveStaticFile(resolved.rootDir, req.url || "/");
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      res.setHeader("Content-Type", contentType(filePath));
      createReadStream(filePath).pipe(res);
    });

    server.listen(resolved.port, () => {
      console.log(`case-study viewer running at http://localhost:${resolved.port}`);
      resolve();
    });
  });
}
