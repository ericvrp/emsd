# Tibber

## Purpose

Use Tibber as a dynamic electricity price provider for site-level import price snapshots.

## Authentication

- Set `TIBBER_ACCESS_TOKEN` in the daemon environment.
- Optionally set `TIBBER_HOME_ID` in the daemon environment to target a specific Tibber home.
- The current integration uses Tibber's GraphQL API with a personal access token.

## Endpoint

- `POST https://api.tibber.com/v1-beta/gql`

## Current Query Scope

- `viewer.homes.id`
- `viewer.homes.currentSubscription.priceInfo.current`
- `viewer.homes.currentSubscription.priceInfo.today`
- `viewer.homes.currentSubscription.priceInfo.tomorrow`

## Notes

- If `TIBBER_HOME_ID` is set, the integration uses that Tibber home.
- If it is not set, the integration uses the first Tibber home returned by the account.
- Prices are normalized as timestamped import price points with `currency`, `startsAt`, and `importPrice`.
- The daemon refreshes Tibber price snapshots on a schedule and keeps persistence ownership.

## Source

- `https://developer.tibber.com/docs/overview`
