import test from "node:test";
import assert from "node:assert/strict";
import {
  eventLabel,
  markdownCell,
  relativeTime,
  renderActivity,
  renderAnalytics,
  renderContributionCalendar,
  renderContributionTower,
  renderMilestones,
  safeHttpsUrl,
  xml,
} from "../scripts/generate-profile.mjs";

test("escapes SVG text and untrusted markdown table content", () => {
  assert.equal(xml(`<tag a="b">&'`), "&lt;tag a=&quot;b&quot;&gt;&amp;&apos;");
  assert.equal(markdownCell("x | [link](https://bad) `code`"), "x \\| \\[link\\]\\(https://bad\\) \\`code\\`");
});

test("only uses HTTPS project URLs and GitHub repository links", () => {
  assert.equal(safeHttpsUrl("https://example.com/demo") , "https://example.com/demo");
  assert.equal(safeHttpsUrl("http://example.com/demo"), null);
  assert.equal(safeHttpsUrl("https://evil.example/raghav/repo", "github.com"), null);
  assert.equal(safeHttpsUrl("https://github.com/raghav/repo", "github.com"), "https://github.com/raghav/repo");
  assert.equal(safeHttpsUrl("https://example.com/a_(b)"), "https://example.com/a_%28b%29");
});

test("renders each real contribution day and its exact count as an SVG title", () => {
  const svg = renderContributionTower([
    { date: "2026-01-01", contributionCount: 0 },
    { date: "2026-01-02", contributionCount: 7 },
  ], 2026, "2026-01-03T00:00:00.000Z");
  assert.match(svg, /2026 \/ GITHUB CONTRIBUTION TOWER/);
  assert.match(svg, /2026-01-01: 0 GitHub contributions/);
  assert.match(svg, /2026-01-02: 7 GitHub contributions/);
  assert.match(svg, /LAST SUCCESSFUL DATA REFRESH: 2026-01-03T00:00:00\.000Z/);
  assert.doesNotMatch(svg, /<script/i);
});

test("renders the traditional contribution calendar with exact counts and total", () => {
  const svg = renderContributionCalendar([
    { date: "2026-01-01", contributionCount: 0 },
    { date: "2026-01-02", contributionCount: 3 },
  ], 2026, 3, "2026-01-03T00:00:00.000Z");
  assert.match(svg, /2026 \/ GITHUB CONTRIBUTION ACTIVITY/);
  assert.match(svg, /2026-01-02: 3 GitHub contributions/);
  assert.match(svg, /3 GitHub contributions year-to-date/);
});

test("renders public analytics with byte-based language percentages", () => {
  const svg = renderAnalytics(
    { public_repos: 3, followers: 0, following: 0, created_at: "2025-08-13T14:26:26Z" },
    [{ stargazers_count: 2 }],
    { TypeScript: 75, Python: 25 },
    { contributionCalendar: { totalContributions: 8 }, pullRequests: 2, issues: 1 },
    "2026-01-03T00:00:00.000Z",
  );
  assert.match(svg, />3</);
  assert.match(svg, /75\.0%/);
  assert.match(svg, /25\.0%/);
  assert.match(svg, /AUTHORED PRs \/ ISSUES/);
  assert.match(svg, /LAST SUCCESSFUL DATA REFRESH/);
});

test("milestones use supplied GitHub facts without adding awards", () => {
  const svg = renderMilestones(
    { public_repos: 3, created_at: "2025-08-13T14:26:26Z" },
    [{ stargazers_count: 0 }],
    { contributionCalendar: { totalContributions: 8 } },
    "2026-01-03T00:00:00.000Z",
  );
  assert.match(svg, /PUBLIC REPOSITORIES/);
  assert.match(svg, /NO UNVERIFIED AWARDS/);
  assert.match(svg, /CALENDAR CONTRIBUTIONS/);
});

test("activity feed labels supported event types and accurately states it is periodic", () => {
  const now = new Date("2026-01-03T00:00:00.000Z");
  const event = {
    type: "PushEvent",
    created_at: "2026-01-02T23:00:00.000Z",
    repo: { name: "raghavpokar07-cyber/HackConnect" },
    payload: { size: 0, commits: [{ message: "private details not copied" }] },
  };
  assert.equal(eventLabel(event), "Pushed 1 commit(s)");
  assert.equal(relativeTime(event.created_at, now), "1h ago");
  const svg = renderActivity([event], "2026-01-03T00:00:00.000Z", now);
  assert.match(svg, /PERIODIC, NOT LIVE/);
  assert.match(svg, /raghavpokar07-cyber\/HackConnect/);
  assert.doesNotMatch(svg, /private details not copied/);
});
