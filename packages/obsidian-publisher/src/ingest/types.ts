export type IngestContentResult = {
  title: string;
  author: string | null;
  published: string | null;
  source_url: string;
  content_markdown: string;
  description?: string | null;
  tags?: string[];
  dynamic_folder?: string;
  meta?: {
    provider_used: "whisper_cpp";
    fallback_used: boolean;
  };
};
