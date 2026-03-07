export type CaseStudyArtifactValue = string | Record<string, unknown>;

export type CaseStudySiteMetadata = Record<string, unknown>;

export type CaseStudyPageArtifacts = {
  "page.json"?: Record<string, unknown>;
  "tokens.json"?: Record<string, unknown>;
  "components.json"?: Record<string, unknown>;
  "copy.json"?: Record<string, unknown>;
  "html.html"?: string;
  "screenshot.png"?: string;
  [fileName: string]: CaseStudyArtifactValue | undefined;
};
