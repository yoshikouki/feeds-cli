import { parseHTML } from "linkedom";

import type { FeedCandidateArticle, ScrapeConfig } from "../types";

export function scrapeArticlesFromHtml(
  html: string,
  pageUrl: string,
  scrape: ScrapeConfig,
): FeedCandidateArticle[] {
  const { document } = parseHTML(html);
  const elements = [...document.querySelectorAll(scrape.selector)];
  const results: FeedCandidateArticle[] = [];
  for (const element of elements) {
    const anchor = element.matches("a[href]") ? element : element.querySelector("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href) {
      continue;
    }

    const titleSource = scrape.titleSelector
      ? element.querySelector(scrape.titleSelector)
      : anchor ?? element;
    const dateSource = scrape.dateSelector ? element.querySelector(scrape.dateSelector) : null;
    const title = titleSource?.textContent?.trim();
    if (!title) {
      continue;
    }

    results.push({
      url: new URL(href, pageUrl).toString(),
      title,
      publishedAt: dateSource?.getAttribute("datetime") ?? dateSource?.textContent?.trim() ?? null,
      content: null,
    });
  }
  return results;
}
