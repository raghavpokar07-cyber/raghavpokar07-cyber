# Install the profile

The public profile resolves to `raghavpokar07-cyber`. A profile README is displayed from a public repository whose name exactly matches that username.

1. In GitHub, create a **public** repository named `raghavpokar07-cyber`.
2. Copy the contents of this folder into the repository root, preserving `.github/workflows`, `assets`, `data`, `scripts`, and `test`.
3. In repository **Settings → Actions → General → Workflow permissions**, allow read and write access so the workflow can commit refreshed generated files. The workflow itself requests only `contents: write`.
4. Open **Actions → Refresh GitHub profile → Run workflow** and wait for the first successful run.
5. Confirm the README images load and generated timestamps are current. Scheduled updates run daily at 06:23 UTC.

No personal access token or extra secret is required. GitHub Actions supplies its repository-scoped `GITHUB_TOKEN`; the workflow never logs or stores it. The generator fails explicitly on API or GraphQL errors and does not replace real data with placeholder counts.

If GitHub reports that this repository already exists, use that repository instead of creating another. Review its existing files before copying; do not overwrite unrelated content.
