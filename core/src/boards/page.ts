import { stripHtml } from "../text.ts";
import { parseSeekJob } from "./seek.ts";

// Any fetched job page, as text. Seek pages yield just the job ad; everything
// else is the whole page stripped of markup.
export function pageDescription(html: string): string {
  return parseSeekJob(html) ?? stripHtml(html);
}
