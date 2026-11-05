import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.github.com";
const GRAPHQL = "https://api.github.com/graphql";
const LOGIN = process.env.GITHUB_LOGIN || "raghavpokar07-cyber";
const TOKEN = process.env.GITHUB_TOKEN;
const MAX_EVENTS = 8;

const OWN_PROJECTS = [
  {
    name: "HackConnect",
    fullName: `${LOGIN}/HackConnect`,
    note: "Creator",
  },
  {
    name: "AI Teacher",
    fullName: `${LOGIN}/ai-tTeacher`,
    note: "Personal project",
  },
  {
    name: "NPC",
    fullName: `${LOGIN}/NPC`,
    note: "Personal web experiments",
  },
];

const COLLABORATION_PROJECTS = [
  {
    fullName: "kkolap22/JobGuardAI_MUSA",
    note: "Public contributor",
  },
];

const PROJECT_STACKS = {
  HackConnect: "TypeScript · React · Express · MongoDB",
  "ai-tTeacher": "Python · HTML · CSS · JavaScript",
  NPC: "HTML",
  JobGuardAI_MUSA: "TypeScript · React · Express · MongoDB · Playwright",
};

const PALETTE = ["#334155", "#7C3AED", "#4F46E5", "#2563EB", "#0891B2", "#22D3EE"];

function assertToken() {
  if (!TOKEN) {
    throw new Error("GITHUB_TOKEN is required to fetch contribution data. Use the profile workflow's built-in token.");
  }
  if (!/^[a-z0-9-]+$/i.test(LOGIN)) {
    throw new Error("GITHUB_LOGIN must be a GitHub username.");
  }
}

async function requestJson(url, { method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-profile-data-generator",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`GitHub API ${response.status} for ${new URL(url).pathname}: ${detail}`);
  }
  return response.json();
}

async function fetchGraphql(login, year, now) {
  const query = `query ProfileData(
    $login: String!,
    $from: DateTime!,
    $to: DateTime!,
    $pullRequestQuery: String!,
    $issueQuery: String!
  ) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
      }
    }
    pullRequests: search(query: $pullRequestQuery, type: ISSUE, first: 1) {
      issueCount
    }
    issues: search(query: $issueQuery, type: ISSUE, first: 1) {
      issueCount
    }
  }`;

  const result = await requestJson(GRAPHQL, {
    method: "POST",
    body: {
      query,
      variables: {
        login,
        from: `${year}-01-01T00:00:00Z`,
        to: now.toISOString(),
        pullRequestQuery: `author:${login} is:pr is:public`,
        issueQuery: `author:${login} is:issue is:public`,
      },
    },
  });

  if (result.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${result.errors.map((error) => error.message).join("; ")}`);
  }
  if (!result.data?.user?.contributionsCollection) {
    throw new Error(`GitHub returned no contribution calendar for ${login}.`);
  }
  return result.data;
}

async function fetchOwnedRepositories(login) {
  const repositories = [];
  for (let page = 1; page <= 5; page += 1) {
    const batch = await requestJson(
      `${API}/users/${encodeURIComponent(login)}/repos?type=owner&sort=updated&per_page=100&page=${page}`,
    );
    repositories.push(...batch.filter((repository) => !repository.private));
    if (batch.length < 100) break;
  }
  return repositories;
}

async function fetchLanguages(repository) {
  return requestJson(`${API}/repos/${repository.full_name}/languages`);
}

async function fetchCollaboration(login, project) {
  const repository = await requestJson(`${API}/repos/${project.fullName}`);
  const contributors = await requestJson(
    `${API}/repos/${project.fullName}/contributors?per_page=100`,
  );
  const contributor = contributors.find((item) => item.login.toLowerCase() === login.toLowerCase());
  if (!contributor || contributor.contributions < 1) return null;
  return { ...repository, profileRole: project.note, verifiedContributionCount: contributor.contributions };
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function number(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function markdownCell(value) {
  return String(value || "—")
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", " ")
    .trim();
}

function safeHttpsUrl(value, expectedHost) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (expectedHost && url.hostname !== expectedHost)) return null;
    return url.href.replaceAll("(", "%28").replaceAll(")", "%29");
  } catch {
    return null;
  }
}

function projectSummary(repository) {
  if (repository.description) return repository.description.slice(0, 240);
  if (repository.name.toLowerCase() === "npc") {
    return "HTML experiments including a 3D page and digital visiting-card pages.";
  }
  if (repository.name.toLowerCase() === "ai-tteacher") {
    return "AI Teacher project with Python, HTML, and separate backend and frontend folders.";
  }
  return "Public repository; see the source for current details.";
}

function buildProjectMarkdown(projects) {
  const rows = projects.map((project) => {
    const title = project.name === "ai-tTeacher" ? "AI Teacher" : project.name;
    const stack = PROJECT_STACKS[project.name] || project.language || "See repository";
    const repositoryUrl = safeHttpsUrl(project.html_url, "github.com");
    if (!repositoryUrl) return null;
    const role = project.profileRole === "Public contributor"
      ? `Contributor (${number(project.verifiedContributionCount)} public contributions listed)`
      : project.profileRole;
    const homepageUrl = safeHttpsUrl(project.homepage);
    const demo = homepageUrl
      ? ` · [Demo](${homepageUrl})`
      : "";
    return `| [${markdownCell(title)}](${repositoryUrl}) | ${markdownCell(projectSummary(project))} | ${markdownCell(stack)} | ${markdownCell(role)}${demo} |`;
  }).filter(Boolean);
  return [
    "| Project | Verified summary | Primary language | Relationship |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function replacementBlock(readme, replacement, name) {
  const startMarker = `<!-- ${name}:START -->`;
  const endMarker = `<!-- ${name}:END -->`;
  const startIndex = readme.indexOf(startMarker);
  const endIndex = readme.indexOf(endMarker);
  if (startIndex < 0 || endIndex < startIndex) {
    throw new Error(`README is missing the ${name} generated-content markers.`);
  }
  return `${readme.slice(0, startIndex + startMarker.length)}\n${replacement}\n${readme.slice(endIndex)}`;
}

function renderContributionTower(days, year, updatedAt) {
  const width = 1200;
  const height = 430;
  const cellWidth = 10;
  const cellHalfHeight = 4;
  const weekPitch = 15;
  const dayPitch = 8;
  const originX = 205;
  const originY = 105;
  const janFirstWeekday = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const dateLabels = new Map();
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const countsByDate = new Map(sortedDays.map((day) => [day.date, day.contributionCount]));

  for (const day of sortedDays) {
    const [dayYear, month, dayOfMonth] = day.date.split("-").map(Number);
    if (dayYear !== year) continue;
    const date = new Date(Date.UTC(dayYear, month - 1, dayOfMonth));
    const dayOfYear = Math.floor((date - Date.UTC(year, 0, 1)) / 86_400_000);
    const week = Math.floor((dayOfYear + janFirstWeekday) / 7);
    if (dayOfMonth === 1) dateLabels.set(week, date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
  }

  const maximumWeek = Math.max(
    0,
    ...sortedDays
      .filter((day) => day.date.startsWith(`${year}-`))
      .map((day) => {
        const [dayYear, month, dayOfMonth] = day.date.split("-").map(Number);
        const dayOfYear = Math.floor(
          (Date.UTC(dayYear, month - 1, dayOfMonth) - Date.UTC(year, 0, 1)) / 86_400_000,
        );
        return Math.floor((dayOfYear + janFirstWeekday) / 7);
      }),
  );

  const monthMarkup = [...dateLabels.entries()]
    .map(([week, month]) =>
      `<text x="${originX + week * weekPitch}" y="78" fill="#94A3B8" font-size="12">${xml(month)}</text>`,
    )
    .join("");

  const blocks = sortedDays
    .filter((day) => day.date.startsWith(`${year}-`))
    .map((day) => {
      const [dayYear, month, dayOfMonth] = day.date.split("-").map(Number);
      const date = new Date(Date.UTC(dayYear, month - 1, dayOfMonth));
      const dayOfYear = Math.floor((date - Date.UTC(year, 0, 1)) / 86_400_000);
      const week = Math.floor((dayOfYear + janFirstWeekday) / 7);
      const weekday = date.getUTCDay();
      const count = countsByDate.get(day.date) || 0;
      const levels = count === 0 ? 0 : Math.min(6, 1 + Math.floor(Math.log2(count)));
      const extrusion = levels * 4;
      const x = originX + week * weekPitch + weekday * 7;
      const baseY = originY + week * 3 + weekday * dayPitch;
      const topY = baseY - extrusion;
      const color = count === 0 ? PALETTE[0] : PALETTE[Math.min(PALETTE.length - 1, levels)];
      const side = count === 0 ? "#0F172A" : PALETTE[Math.max(0, Math.min(PALETTE.length - 1, levels - 2))];
      const title = `${day.date}: ${count} GitHub contributions`;
      const top = `M${x} ${topY}l${cellWidth} -${cellHalfHeight}l${cellWidth} ${cellHalfHeight}l-${cellWidth} ${cellHalfHeight}Z`;
      if (count === 0) {
        return `<g><title>${xml(title)}</title><path d="${top}" fill="${color}" stroke="#334155" stroke-width=".6"/></g>`;
      }
      const left = `M${x} ${topY}l${cellWidth} ${cellHalfHeight}v${extrusion}l-${cellWidth} -${cellHalfHeight}Z`;
      const right = `M${x + cellWidth} ${topY + cellHalfHeight}l${cellWidth} -${cellHalfHeight}v${extrusion}l-${cellWidth} ${cellHalfHeight}Z`;
      return `<g><title>${xml(title)}</title><path d="${left}" fill="${side}" stroke="#05070D" stroke-width=".55"/><path d="${right}" fill="${color}" stroke="#05070D" stroke-width=".55"/><path d="${top}" fill="${color}" stroke="#67E8F9" stroke-opacity=".55" stroke-width=".55"/></g>`;
    })
    .join("");

  const legend = PALETTE.map((color, index) => {
    const label = ["0", "1", "2–3", "4–7", "8–15", "16+"][index];
    return `<rect x="${864 + index * 35}" y="370" width="12" height="10" rx="2" fill="${color}"/><text x="${880 + index * 35}" y="379" fill="#94A3B8" font-size="10">${label}</text>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${year} GitHub contribution tower</title><desc id="desc">Isometric calendar generated from GitHub's contribution calendar. Each day has a title with its exact contribution count.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#05070D"/><stop offset="1" stop-color="#0B1020"/></linearGradient><linearGradient id="edge" x2="1"><stop stop-color="#A855F7"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="1200" height="430" rx="18" fill="url(#bg)"/><text x="54" y="34" fill="#22D3EE" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="3">${year} / GITHUB CONTRIBUTION TOWER</text><text x="54" y="57" fill="#94A3B8" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="12">Each day is a block · count bands map to height and glow · hover for exact values</text>${monthMarkup}<g>${blocks}</g><path d="M${originX - 20} 354H${originX + (maximumWeek + 1) * weekPitch + 100}" stroke="url(#edge)" stroke-opacity=".45"/>${legend}<text x="54" y="398" fill="#64748B" font-family="JetBrains Mono,Consolas,monospace" font-size="11">LAST SUCCESSFUL DATA REFRESH: ${xml(updatedAt)}</text><rect x=".5" y=".5" width="1199" height="429" rx="17.5" fill="none" stroke="url(#edge)" stroke-opacity=".4"/></svg>`;
}

function renderContributionCalendar(days, year, total, updatedAt) {
  const janFirstWeekday = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const sortedDays = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const monthLabels = new Map();
  const cells = sortedDays.map((day) => {
    const [dayYear, month, dayOfMonth] = day.date.split("-").map(Number);
    if (dayYear !== year) return "";
    const date = new Date(Date.UTC(dayYear, month - 1, dayOfMonth));
    const dayOfYear = Math.floor((date - Date.UTC(year, 0, 1)) / 86_400_000);
    const week = Math.floor((dayOfYear + janFirstWeekday) / 7);
    const weekday = date.getUTCDay();
    if (dayOfMonth === 1) {
      monthLabels.set(week, date.toLocaleString("en-US", { month: "short", timeZone: "UTC" }));
    }
    const count = day.contributionCount;
    const level = count === 0 ? 0 : Math.min(PALETTE.length - 1, 1 + Math.floor(Math.log2(count)));
    const x = 205 + week * 15;
    const y = 85 + weekday * 15;
    return `<g><title>${xml(`${day.date}: ${count} GitHub contributions`)}</title><rect x="${x}" y="${y}" width="11" height="11" rx="2" fill="${PALETTE[level]}" stroke="#05070D" stroke-width=".5"/></g>`;
  }).join("");
  const months = [...monthLabels.entries()]
    .map(([week, month]) => `<text x="${205 + week * 15}" y="73" fill="#94A3B8" font-size="10">${xml(month)}</text>`)
    .join("");
  const legend = PALETTE.map((color, index) => {
    const label = ["0", "1", "2–3", "4–7", "8–15", "16+"][index];
    return `<rect x="${884 + index * 42}" y="199" width="11" height="10" rx="2" fill="${color}"/><text x="${899 + index * 42}" y="208" fill="#94A3B8" font-size="9">${label}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="230" viewBox="0 0 1200 230" role="img" aria-labelledby="title desc"><title id="title">${year} GitHub contribution calendar</title><desc id="desc">A day-by-day calendar from GitHub's contribution API. Hover over a square to see its date and exact count.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#05070D"/><stop offset="1" stop-color="#0B1020"/></linearGradient><linearGradient id="edge" x2="1"><stop stop-color="#A855F7"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="1200" height="230" rx="18" fill="url(#bg)"/><text x="54" y="38" fill="#22D3EE" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="3">${year} / GITHUB CONTRIBUTION ACTIVITY</text><text x="54" y="61" fill="#94A3B8" font-size="12">${number(total)} GitHub contributions year-to-date</text>${months}<g>${cells}</g>${legend}<text x="54" y="211" fill="#64748B" font-family="JetBrains Mono,Consolas,monospace" font-size="9">LAST SUCCESSFUL DATA REFRESH: ${xml(updatedAt)}</text><rect x=".5" y=".5" width="1199" height="229" rx="17.5" fill="none" stroke="url(#edge)" stroke-opacity=".4"/></svg>`;
}

function renderMilestones(profile, repositories, contributions, updatedAt) {
  const stars = repositories.reduce((total, repo) => total + repo.stargazers_count, 0);
  const created = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const milestones = [
    ["GITHUB MEMBER SINCE", created],
    ["PUBLIC REPOSITORIES", number(profile.public_repos)],
    ["PUBLIC STARS", number(stars)],
    ["CALENDAR CONTRIBUTIONS", number(contributions.contributionCalendar.totalContributions)],
  ];
  const cards = milestones.map(([label, value], index) => {
    const x = 42 + index * 287;
    const accent = ["#A855F7", "#3B82F6", "#22D3EE", "#EC4899"][index];
    return `<g><rect x="${x}" y="55" width="268" height="83" rx="12" fill="#0B1020" stroke="${accent}" stroke-opacity=".55"/><text x="${x + 16}" y="81" fill="#94A3B8" font-size="10" font-weight="700" letter-spacing="1">${xml(label)}</text><text x="${x + 16}" y="119" fill="#F8FAFC" font-size="23" font-weight="700">${xml(value)}</text></g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="205" viewBox="0 0 1200 205" role="img" aria-labelledby="title desc"><title id="title">Verified GitHub milestones</title><desc id="desc">Account creation date and public repository, star, and contribution totals.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#05070D"/><stop offset="1" stop-color="#0B1020"/></linearGradient><linearGradient id="edge" x2="1"><stop stop-color="#A855F7"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="1200" height="205" rx="18" fill="url(#bg)"/><text x="42" y="34" fill="#22D3EE" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="3">MILESTONES / VERIFIED PUBLIC METADATA</text>${cards}<text x="42" y="171" fill="#64748B" font-family="JetBrains Mono,Consolas,monospace" font-size="10">NO UNVERIFIED AWARDS · LAST SUCCESSFUL DATA REFRESH: ${xml(updatedAt)}</text><rect x=".5" y=".5" width="1199" height="204" rx="17.5" fill="none" stroke="url(#edge)" stroke-opacity=".4"/></svg>`;
}

function renderAnalytics(profile, repositories, languages, contributions, generatedAt) {
  const languageEntries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const languageTotal = languageEntries.reduce((total, [, size]) => total + size, 0);
  const stars = repositories.reduce((total, repo) => total + repo.stargazers_count, 0);
  const values = [
    ["PUBLIC REPOS", profile.public_repos],
    ["STARS", stars],
    ["FOLLOWERS", profile.followers],
    ["FOLLOWING", profile.following],
    ["CALENDAR CONTRIBUTIONS", contributions.contributionCalendar.totalContributions],
    ["AUTHORED PRs / ISSUES", `${contributions.pullRequests} / ${contributions.issues}`],
  ];
  const cards = values
    .map(([label, value], index) => {
      const x = 35 + index * 188;
      const accent = ["#A855F7", "#3B82F6", "#22D3EE", "#EC4899", "#A855F7", "#3B82F6"][index];
      return `<g><rect x="${x}" y="54" width="174" height="88" rx="12" fill="#0B1020" stroke="${accent}" stroke-opacity=".5"/><text x="${x + 14}" y="80" fill="#94A3B8" font-size="10" font-weight="700" letter-spacing="1">${xml(label)}</text><text x="${x + 14}" y="119" fill="#F8FAFC" font-size="27" font-weight="700">${xml(value)}</text></g>`;
    })
    .join("");
  const bars = languageEntries.slice(0, 7).map(([name, size], index) => {
    const y = 183 + index * 29;
    const percent = languageTotal > 0 ? (size / languageTotal) * 100 : 0;
    const color = PALETTE[Math.min(PALETTE.length - 1, index)];
    return `<g><text x="53" y="${y + 11}" fill="#CBD5E1" font-size="12">${xml(name)}</text><rect x="205" y="${y}" width="625" height="10" rx="5" fill="#1E293B"/><rect x="205" y="${y}" width="${(625 * percent / 100).toFixed(2)}" height="10" rx="5" fill="${color}"/><text x="849" y="${y + 11}" fill="#94A3B8" font-size="11">${percent.toFixed(1)}%</text></g>`;
  }).join("");
  const created = new Date(profile.created_at).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const milestone = `${profile.public_repos} public repositories · GitHub account since ${created} · ${stars} public stars`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="430" viewBox="0 0 1200 430" role="img" aria-labelledby="title desc"><title id="title">Verified GitHub profile analytics</title><desc id="desc">Statistics and language percentages calculated from public GitHub repositories and contributions.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#05070D"/><stop offset="1" stop-color="#0B1020"/></linearGradient><linearGradient id="edge" x2="1"><stop stop-color="#A855F7"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs><rect width="1200" height="430" rx="18" fill="url(#bg)"/><text x="42" y="34" fill="#22D3EE" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="3">ADVANCED ANALYTICS / PUBLIC GITHUB DATA</text>${cards}<text x="53" y="174" fill="#A855F7" font-size="11" font-weight="700" letter-spacing="2">LANGUAGE DISTRIBUTION BY REPOSITORY BYTES</text>${bars}<text x="53" y="397" fill="#94A3B8" font-size="12">${xml(milestone)}</text><text x="53" y="417" fill="#64748B" font-family="JetBrains Mono,Consolas,monospace" font-size="10">LAST SUCCESSFUL DATA REFRESH: ${xml(generatedAt)} · PR/ISSUE COUNTS ARE PUBLIC AUTHORED ITEMS</text><rect x=".5" y=".5" width="1199" height="429" rx="17.5" fill="none" stroke="url(#edge)" stroke-opacity=".4"/></svg>`;
}

function relativeTime(timestamp, now) {
  const elapsed = Math.max(0, now.getTime() - new Date(timestamp).getTime());
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function eventLabel(event) {
  switch (event.type) {
    case "PushEvent": {
      const count = event.payload?.size || event.payload?.commits?.length;
      return typeof count === "number" && count > 0 ? `Pushed ${count} commit(s)` : "Pushed updates";
    }
    case "PullRequestEvent":
      return `${event.payload?.action || "Updated"} a pull request`;
    case "IssuesEvent":
      return `${event.payload?.action || "Updated"} an issue`;
    case "IssueCommentEvent":
      return "Commented on an issue";
    case "PullRequestReviewEvent":
      return "Reviewed a pull request";
    case "CreateEvent":
      return `Created ${event.payload?.ref_type || "repository content"}`;
    case "ReleaseEvent":
      return "Published a release";
    case "WatchEvent":
      return "Starred a repository";
    case "ForkEvent":
      return "Forked a repository";
    default:
      return null;
  }
}

function renderActivity(events, updatedAt, now) {
  const entries = events
    .map((event) => ({
      type: event.type,
      createdAt: event.created_at,
      repository: event.repo?.name || "GitHub",
      summary: eventLabel(event),
    }))
    .filter((event) => event.summary)
    .slice(0, MAX_EVENTS);
  const rows = entries.map((event, index) => {
    const y = 111 + index * 39;
    const color = index % 3 === 0 ? "#22D3EE" : index % 3 === 1 ? "#A855F7" : "#3B82F6";
    return `<g><circle cx="67" cy="${y - 4}" r="4" fill="${color}"/><path d="M67 ${y}v30" stroke="#334155" stroke-width="1"/><text x="87" y="${y}" fill="#F8FAFC" font-size="13" font-weight="600">${xml(event.summary)}</text><text x="87" y="${y + 18}" fill="#94A3B8" font-size="11">${xml(event.repository)} · ${xml(relativeTime(event.createdAt, now))}</text></g>`;
  }).join("");
  const height = Math.max(185, 140 + entries.length * 39);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc"><title id="title">Latest public GitHub activity</title><desc id="desc">Recent public activity from GitHub Events API, periodically refreshed. It is not real-time.</desc><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#05070D"/><stop offset="1" stop-color="#0B1020"/></linearGradient><linearGradient id="edge" x2="1"><stop stop-color="#A855F7"/><stop offset=".55" stop-color="#3B82F6"/><stop offset="1" stop-color="#22D3EE"/></linearGradient><filter id="pulse"><feGaussianBlur stdDeviation="3"/></filter></defs><rect width="1200" height="${height}" rx="18" fill="url(#bg)"/><circle cx="55" cy="51" r="8" fill="#22D3EE" opacity=".3" filter="url(#pulse)"/><circle cx="55" cy="51" r="4" fill="#22D3EE"/><text x="76" y="56" fill="#22D3EE" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="13" font-weight="700" letter-spacing="3">LAST ACTIVITY PULSE / PUBLIC EVENTS · PERIODIC, NOT LIVE</text><text x="76" y="80" fill="#64748B" font-family="JetBrains Mono,Consolas,monospace" font-size="10">LAST SUCCESSFUL REFRESH: ${xml(updatedAt)} · PUBLIC EVENTS API WINDOW IS LIMITED</text>${entries.length ? rows : `<text x="76" y="130" fill="#CBD5E1" font-size="15">No supported public events were returned in the current API window.</text>`}<rect x=".5" y=".5" width="1199" height="${height - 1}" rx="17.5" fill="none" stroke="url(#edge)" stroke-opacity=".4"/></svg>`;
}

function buildActivityData(events, updatedAt, now) {
  return events
    .map((event) => {
      const summary = eventLabel(event);
      if (!summary) return null;
      return {
        type: event.type,
        repository: event.repo?.name || "GitHub",
        summary,
        createdAt: event.created_at,
        relativeTime: relativeTime(event.created_at, now),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_EVENTS)
    .map((event) => ({ ...event, refreshedAt: updatedAt }));
}

async function writeOutput(relativePath, content) {
  const destination = path.join(ROOT, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

export async function generateProfile({ now = new Date() } = {}) {
  assertToken();
  const year = now.getUTCFullYear();
  const updatedAt = now.toISOString();
  const [profile, repositories, events, graphql] = await Promise.all([
    requestJson(`${API}/users/${encodeURIComponent(LOGIN)}`),
    fetchOwnedRepositories(LOGIN),
    requestJson(`${API}/users/${encodeURIComponent(LOGIN)}/events/public?per_page=100`),
    fetchGraphql(LOGIN, year, now),
  ]);
  if (profile.login.toLowerCase() !== LOGIN.toLowerCase()) {
    throw new Error(`GitHub returned ${profile.login} when ${LOGIN} was requested.`);
  }

  const contributions = graphql.user.contributionsCollection;
  const [languageObjects, collaborationResults] = await Promise.all([
    Promise.all(repositories.map(fetchLanguages)),
    Promise.all(COLLABORATION_PROJECTS.map((project) => fetchCollaboration(LOGIN, project))),
  ]);
  const languages = {};
  for (const languageObject of languageObjects) {
    for (const [name, size] of Object.entries(languageObject)) {
      languages[name] = (languages[name] || 0) + size;
    }
  }

  const ownedByName = new Map(repositories.map((repo) => [repo.full_name.toLowerCase(), repo]));
  const featuredOwned = OWN_PROJECTS
    .map((project) => ownedByName.get(project.fullName.toLowerCase()))
    .filter(Boolean)
    .map((repo) => ({ ...repo, profileRole: OWN_PROJECTS.find((item) => item.fullName.toLowerCase() === repo.full_name.toLowerCase())?.note }));
  const projects = [
    ...featuredOwned,
    ...collaborationResults.filter(Boolean),
  ];
  const contributionDays = contributions.contributionCalendar.weeks.flatMap((week) => week.contributionDays);
  const currentYearDays = contributionDays.filter((day) => day.date.startsWith(`${year}-`));
  const activity = buildActivityData(events, updatedAt, now);
  const readmePath = path.join(ROOT, "README.md");
  let readme = await readFile(readmePath, "utf8");
  readme = replacementBlock(readme, buildProjectMarkdown(projects), "PROJECTS");

  await Promise.all([
    writeFile(readmePath, readme),
    writeOutput("assets/contributions-3d.svg", renderContributionTower(currentYearDays, year, updatedAt)),
    writeOutput("assets/contributions-calendar.svg", renderContributionCalendar(
      currentYearDays,
      year,
      contributions.contributionCalendar.totalContributions,
      updatedAt,
    )),
    writeOutput("assets/milestones.svg", renderMilestones(profile, repositories, contributions, updatedAt)),
    writeOutput("assets/analytics.svg", renderAnalytics(
      profile,
      repositories,
      languages,
      {
        contributionCalendar: contributions.contributionCalendar,
        pullRequests: graphql.pullRequests.issueCount,
        issues: graphql.issues.issueCount,
      },
      updatedAt,
    )),
    writeOutput("assets/activity.svg", renderActivity(events, updatedAt, now)),
    writeOutput("data/contributions.json", `${JSON.stringify({
      year,
      contributionCalendarTotal: contributions.contributionCalendar.totalContributions,
      refreshedAt: updatedAt,
      days: currentYearDays,
    }, null, 2)}\n`),
    writeOutput("data/activity.json", `${JSON.stringify({
      refreshedAt: updatedAt,
      source: "GitHub public Events API",
      events: activity,
    }, null, 2)}\n`),
    writeOutput("data/analytics.json", `${JSON.stringify({
      refreshedAt: updatedAt,
      profile: {
        publicRepositories: profile.public_repos,
        stars: repositories.reduce((total, repo) => total + repo.stargazers_count, 0),
        followers: profile.followers,
        following: profile.following,
        contributionCalendarTotal: contributions.contributionCalendar.totalContributions,
        authoredPublicPullRequests: graphql.pullRequests.issueCount,
        authoredPublicIssues: graphql.issues.issueCount,
      },
      languages,
      featuredProjects: projects.map((project) => ({
        repository: project.full_name,
        role: project.profileRole,
        publicContributionCount: project.verifiedContributionCount || null,
        description: project.description || projectSummary(project),
        homepage: project.homepage || null,
      })),
    }, null, 2)}\n`),
  ]);
  return { login: profile.login, repositories: repositories.length, projects: projects.length, year, refreshedAt: updatedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await generateProfile();
    console.info(`Profile data refreshed successfully: ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

export {
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
};
