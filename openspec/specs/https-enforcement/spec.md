# https-enforcement Specification

## Purpose

Opt-in, environment-controlled enforcement of HTTPS for browser-initiated
subresource requests via the `upgrade-insecure-requests` Content Security
Policy, so that deployments served over HTTPS can load mixed `http://`
subresources (including the OnlyOffice DocumentServer) without
mixed-content blocking. The feature is disabled by default and leaves
page behavior unchanged when not enabled.

## Requirements

### Requirement: Upgrade of insecure requests is opt-in and off by default

The system SHALL enable `http→https` upgrading of browser requests only when a
dedicated boolean environment variable is truthy. The feature MUST be disabled
by default (variable unset or falsy), so that environments that do not set it
behave exactly as before.

#### Scenario: Disabled by default
- **WHEN** the upgrade environment variable is unset or falsy
- **THEN** the system SHALL NOT enable `upgrade-insecure-requests` and SHALL
  inject no related Content Security Policy into the document

#### Scenario: Enabled when flag is truthy
- **WHEN** the upgrade environment variable is truthy
- **THEN** the system SHALL enable `upgrade-insecure-requests` for the document

### Requirement: Enabled state injects the CSP meta at bootstrap

When enabled, the system SHALL inject exactly one
`<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">`
element into the document `<head>` during application bootstrap, before any
on-demand resource the application loads (such as the OnlyOffice `api.js`
script) is requested.

#### Scenario: Meta present in head when enabled
- **WHEN** the upgrade environment variable is truthy
- **AND** application bootstrap has run
- **THEN** the document `<head>` SHALL contain the `upgrade-insecure-requests`
  Content Security Policy meta element

#### Scenario: Injected before OnlyOffice api.js loads
- **WHEN** the upgrade environment variable is truthy
- **AND** a user later opens an office file, triggering the OnlyOffice `api.js`
  script load
- **THEN** the `upgrade-insecure-requests` Content Security Policy SHALL already
  be active in the document before that script is requested

### Requirement: Disabled state leaves page behavior unchanged

When disabled, the system SHALL NOT inject any Content Security Policy meta and
SHALL NOT rewrite any request URL in code. All existing request behavior — API
calls, the OnlyOffice config fetch, and the OnlyOffice `api.js` script load —
MUST be identical to the behavior prior to this change.

#### Scenario: No CSP and no URL rewriting when disabled
- **WHEN** the upgrade environment variable is unset or falsy
- **THEN** the document SHALL contain no `upgrade-insecure-requests` meta
- **AND** no request URL produced by the application SHALL be altered relative
  to prior behavior

### Requirement: Upgrade applies page-globally, including OnlyOffice

When enabled on an HTTPS page, the browser SHALL upgrade every `http://`
subresource request the document initiates — including scripts, iframes,
stylesheets, images, and websockets — to `https://`. In particular, this SHALL
cover the OnlyOffice DocumentServer `api.js` script and the resources the
editor subsequently derives from that origin, so the OnlyOffice editor loads
without mixed-content blocking.

#### Scenario: OnlyOffice api.js is upgraded to https
- **WHEN** the upgrade environment variable is truthy
- **AND** the page is served over HTTPS
- **AND** the backend returns an `http://` OnlyOffice `server_url`
- **THEN** the browser SHALL request the OnlyOffice `api.js` script over
  `https://` rather than `http://`

#### Scenario: Upgrade scope is page-global, not OnlyOffice-only
- **WHEN** the upgrade environment variable is truthy
- **AND** the page references any other `http://` subresource besides OnlyOffice
- **THEN** that subresource SHALL also be requested over `https://`
