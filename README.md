# Argon Shield

Argon Shield is a Firefox Manifest V3 extension for configuring a proxy server you trust, routing requests through it, and surfacing proxy errors.

## Features

- HTTP, HTTPS-proxy, and SOCKS5 configuration.
- Route all eligible web requests through the configured proxy, or use domain allow/block rules.
- Optional auto-enable when Firefox starts.
- Optional public-IP change notifications.
- Proxy-error diagnostics in the popup.
- A browser-based response check that opens `https://api.ipify.org?format=json` in a tab. Compare the displayed public IP with the proxy disabled and enabled; this is a user-assisted check, not a guarantee of anonymity.
- Options page with automatic settings save.
- CI checks for manifest structure, JavaScript syntax, mocked proxy routing behavior, Firefox extension lint, and ZIP packaging.

## Install temporarily in Firefox

1. Download the latest `Argon-Shield-Firefox.zip` artifact from [GitHub Actions](https://github.com/s1nnrockk/Argon-Shield/actions).
2. If the downloaded artifact is itself a wrapper ZIP, extract it once to get `Argon-Shield-Firefox.zip`.
3. Open `about:debugging#/runtime/this-firefox` in Firefox.
4. Click **Load Temporary Add-on…** and select `manifest.json` from the extracted extension folder.
5. Open the extension's settings, enter a proxy host and port from a provider you trust, choose the correct protocol, and enable it from the popup.
6. Use **Open connection test** in settings. The page should return JSON containing a public IP. Compare it with the proxy disabled; a matching IP means the proxy may not be in use. A changed IP is useful evidence but is not a security audit.

Temporary add-ons are removed when Firefox closes. This build has not been published as a signed Firefox Add-on.

## Security and limitations

- The extension does not host or supply proxy servers. It does not automatically scrape or rotate public proxy lists; unknown public proxies can inspect or manipulate unencrypted traffic and may be unreliable.
- Never enter passwords or sensitive data through a proxy you do not trust.
- A successful web response does not prove that all traffic is proxied or that the proxy is safe.
- Proxy authentication (username/password) is not implemented.
- The local mock tests validate routing decisions and API-message behavior. They do not replace testing in a real Firefox installation.
- Firefox reports proxy errors through its proxy API when available; the extension shows the latest error reported to it.

## Development checks

The GitHub Actions workflow runs:
- Manifest and required-file validation
- `node --check` on extension scripts
- Node-based mocked routing tests
- `web-ext lint --warnings-as-errors`
- ZIP integrity checks and artifact upload

Repository: https://github.com/s1nnrockk/Argon-Shield
