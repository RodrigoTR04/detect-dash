# Security policy

detect-dash has no authentication or authorization. Use it only on loopback or
trusted networks. Never expose it to the internet. Anyone who can reach the port
can read events, ingest logs, triage alerts, and toggle detection rules.

POST and PATCH mutation routes require application/json or application/x-ndjson.
When Origin is present, its host must match the request Host. These checks block
cross-origin browser simple-request writes. They do not authenticate clients,
protect against malicious clients that forge headers, or restrict same-origin
scripts. Requests without Origin remain allowed for agents and command-line tools.

The latest release is supported.

Report vulnerabilities through GitHub private vulnerability reporting on the
project repository. Include the version, reproduction steps, expected impact,
and sanitized logs. Remove credentials and personal data from reports.
