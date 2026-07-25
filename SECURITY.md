# Security policy

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest `main`
revision only.

## Reporting a vulnerability

Do not open a public issue for authentication bypasses, exposed secrets, access
control failures, or leaks of member location data.

Report vulnerabilities privately through GitHub’s **Report a vulnerability**
feature when enabled for the repository. If private reporting is unavailable,
contact the repository owner through their GitHub profile without including
real tokens or member data in the first message.

Include:

- affected route or component;
- reproduction using synthetic data;
- expected and observed authorization behaviour;
- impact;
- suggested mitigation, if known.

## Operator responsibilities

Deployers are responsible for:

- rotating BotFather tokens and webhook secrets after exposure;
- keeping administrator IDs current;
- restricting raw database access;
- publishing a privacy notice and retention policy;
- responding to member deletion requests;
- monitoring dependencies and hosting logs;
- confirming that public site access does not make authenticated API data
  public.
