# Security Policy

## Reported scope

This is a browser game with no backend. The relevant security boundaries are:

- **Peer input.** Guests can send arbitrary messages to the host. The host parses
  every message with zod, rejects oversized payloads, clamps movement and rate
  limits input.
- **Host snapshots.** Hosts can send arbitrary data to guests. Guests validate
  every message before using it.
- **Content ids.** Unknown part ids are validated at the registry boundary. Wire
  ids are only rendered, never evaluated.
- **Signaling.** PeerJS public signaling is used only to exchange WebRTC offers.
  No game state is stored there.

There is no authentication, no stored data and no server. Hosts are trusted to
run their own room; cheating by the host is out of scope.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Contact the maintainer
through the repository's private security advisory feature and include:

- a description of the issue,
- steps to reproduce,
- the affected browser and version.

You will get an acknowledgement as soon as possible. Please allow time for a fix
before disclosing the issue publicly.

## Supported versions

Only the latest release on the `main` branch receives fixes.
