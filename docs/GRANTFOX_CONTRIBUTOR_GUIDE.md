# GrantFox contributor guide

This guide is for external contributors working on xConfess issues labeled
`GrantFox OSS`, `Official Campaign`, and `Maybe Rewarded`.

## 1. Pick an issue

Choose one open campaign issue and keep the pull request focused on that issue
only. Read the issue body, linked docs, and acceptance criteria before changing
files.

Use a branch name that includes the issue number and area:

```bash
git checkout -b docs/1118-grantfox-guide
git checkout -b fix/123-backend-validation
git checkout -b feat/456-frontend-empty-state
```

## 2. Clone and install

```bash
git clone https://github.com/Xconfess/Xconfess.git
cd Xconfess
npm install
```

## 3. Start local services

The local stack uses Postgres and Redis from `compose.yaml`.

```bash
docker compose -f compose.yaml up -d
docker compose -f compose.yaml ps
```

## 4. Copy environment files

Never commit real `.env` or `.env.local` files. Copy the examples and use local
test values only.

```bash
cp xconfess-backend/.env.example xconfess-backend/.env
cp xconfess-frontend/.env.example xconfess-frontend/.env.local
```

For frontend-only work, you can enable the documented local auth bypass:

```bash
NEXT_PUBLIC_DEV_BYPASS_AUTH=true
```

Do not paste production secrets, wallet private keys, API tokens, database
passwords, or Stellar secret keys into issues, comments, screenshots, or pull
request descriptions.

## 5. Run the app

```bash
npm run dev
```

Default local URLs:

| Service | URL |
| --- | --- |
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5000 |
| Backend live health | http://localhost:5000/api/health/live |
| Backend ready health | http://localhost:5000/api/health/ready |

## 6. Validate before opening a PR

Run the smallest relevant command while iterating, then run the full CI command
before requesting review when your machine can support it.

```bash
npm run backend:test
npm run frontend:test
npm run contract:test
npm run ci
```

If a command cannot run locally, explain why in the PR and include the narrower
checks you did run.

## 7. Open the pull request

GrantFox campaign PRs must link the issue with `Closes #ISSUE_NUMBER` so GitHub
and maintainers can connect the work to the bounty issue.

Example PR body:

```markdown
Closes #1118

## Summary
- added GrantFox contributor onboarding guide
- linked the guide from the root README

## Validation
- reviewed commands against README and package scripts
- `git diff --check`

## Secrets
- no production secrets or private keys included
```

Before opening the PR, review:

- [Small PR policy](./SMALL_PR_POLICY.md)
- [Ready for Review template](./WAVE_5_READY_FOR_REVIEW_TEMPLATE.md)
- [Log redaction guide](./LOG_ATTACHING_GUIDE.md)

## 8. Reward and platform notes

GrantFox eligibility is decided by the campaign maintainers or GrantFox flow.
This repository does not document KYC, payout wallets, tax forms, or private
payment details. Follow GrantFox's official instructions for those steps and
never post sensitive payout information publicly.
