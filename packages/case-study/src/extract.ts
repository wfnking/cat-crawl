type CaseStudyTokens = {
  colors: string[];
  fontFamilies: string[];
  fontSizes: string[];
  fontWeights: string[];
  radii: string[];
  shadows: string[];
  borderStyles: string[];
  spacing: string[];
};

type CaseStudyComponent = {
  name: string;
  kind: "hero" | "testimonials" | "pricing" | "section";
  selector: string;
  purpose: string;
  contentStructure: {
    headings: string[];
    ctas: string[];
    paragraphCount: number;
  };
  styleTraits: string[];
};

type CaseStudyCopy = {
  hero: string;
  proof: string;
  mechanism: string;
  pricing: string;
  cta: string[];
};

function uniqueList(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function collectMatches(input: string, pattern: RegExp): string[] {
  const values: string[] = [];
  for (const match of input.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) {
      values.push(value);
    }
  }
  return values;
}

function stripTags(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSectionBlocks(html: string): string[] {
  const sections = Array.from(html.matchAll(/<section\b[\s\S]*?<\/section>/gi)).map((match) => match[0]);
  if (sections.length > 0) {
    return sections;
  }
  return [html];
}

function extractTextByTag(html: string, tagName: string): string[] {
  return Array.from(
    html.matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi")),
  )
    .map((match) => stripTags(match[1] || ""))
    .filter(Boolean);
}

function extractCtas(html: string): string[] {
  return [
    ...extractTextByTag(html, "a"),
    ...extractTextByTag(html, "button"),
  ].filter(Boolean);
}

function inferComponentKind(sectionHtml: string): CaseStudyComponent["kind"] {
  const text = stripTags(sectionHtml).toLowerCase();
  if (/<h1\b/i.test(sectionHtml)) {
    return "hero";
  }
  if (text.includes("pricing") || text.includes("plan") || /\$\d+/.test(text)) {
    return "pricing";
  }
  if (text.includes("testimonial") || text.includes("community is saying") || text.includes("community")) {
    return "testimonials";
  }
  return "section";
}

function inferPurpose(kind: CaseStudyComponent["kind"]): string {
  if (kind === "hero") {
    return "Top-of-page value proposition and primary CTA";
  }
  if (kind === "pricing") {
    return "Offer packaging and upgrade decision";
  }
  if (kind === "testimonials") {
    return "Social proof and trust building";
  }
  return "General page section";
}

export function extractCaseStudyTokens(html: string): CaseStudyTokens {
  const colorMatches = [
    ...html.matchAll(/(#[0-9a-fA-F]{3,8}\b)/g),
    ...html.matchAll(/(rgba?\([^)]+\))/g),
  ].map((match) => match[1]);

  return {
    colors: uniqueList(colorMatches),
    fontFamilies: uniqueList(collectMatches(html, /font-family\s*:\s*([^;"]+)/gi)),
    fontSizes: uniqueList(collectMatches(html, /font-size\s*:\s*([^;"]+)/gi)),
    fontWeights: uniqueList(collectMatches(html, /font-weight\s*:\s*([^;"]+)/gi)),
    radii: uniqueList(collectMatches(html, /border-radius\s*:\s*([^;"]+)/gi)),
    shadows: uniqueList(collectMatches(html, /box-shadow\s*:\s*([^;"]+)/gi)),
    borderStyles: uniqueList(collectMatches(html, /border\s*:\s*([^;"]+)/gi)),
    spacing: uniqueList([
      ...collectMatches(html, /padding\s*:\s*([^;"]+)/gi),
      ...collectMatches(html, /margin\s*:\s*([^;"]+)/gi),
      ...collectMatches(html, /gap\s*:\s*([^;"]+)/gi),
    ]),
  };
}

export function extractCaseStudyComponents(html: string): CaseStudyComponent[] {
  return extractSectionBlocks(html).map((sectionHtml, index) => {
    const headings = [
      ...extractTextByTag(sectionHtml, "h1"),
      ...extractTextByTag(sectionHtml, "h2"),
      ...extractTextByTag(sectionHtml, "h3"),
    ];
    const ctas = extractCtas(sectionHtml);
    const kind = inferComponentKind(sectionHtml);

    return {
      name: headings[0] || `Section ${index + 1}`,
      kind,
      selector: `section:nth-of-type(${index + 1})`,
      purpose: inferPurpose(kind),
      contentStructure: {
        headings,
        ctas,
        paragraphCount: extractTextByTag(sectionHtml, "p").length,
      },
      styleTraits: kind === "hero" ? ["high-contrast", "primary-cta"] : [],
    };
  });
}

export function extractCaseStudyCopy(title: string, html: string): CaseStudyCopy {
  const heroBlock = extractSectionBlocks(html)[0] || html;
  const pricingBlock =
    extractSectionBlocks(html).find((sectionHtml) => inferComponentKind(sectionHtml) === "pricing") || "";
  const proofBlock =
    extractSectionBlocks(html).find((sectionHtml) => inferComponentKind(sectionHtml) === "testimonials") || "";

  return {
    hero: stripTags(heroBlock) || title,
    proof: stripTags(proofBlock),
    mechanism: "",
    pricing: stripTags(pricingBlock),
    cta: uniqueList(extractCtas(html)),
  };
}
