import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { cwd } from "node:process";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@cat-crawl/core";

export type CaseStudyServeOptions = {
  port?: number;
  rootDir?: string;
};

const logger = createLogger();

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
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  if (requestPath === "/" || requestPath === "") {
    return join(packageRoot, "viewer", "index.html");
  }

  if (requestPath.startsWith("/viewer/")) {
    return join(packageRoot, requestPath.replace(/^\/+/, ""));
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
      logger.log(`case-study viewer running at http://localhost:${resolved.port}`);
      resolve();
    });
  });
}
